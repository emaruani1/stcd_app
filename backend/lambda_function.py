"""
STCD API Lambda Handler
Handles: Members, Transactions, Pledges, Settings, Sponsorships, Emails, Payment Methods (Sola/FideliPay) CRUD
"""
import json
import os
import time
import uuid
import urllib.request
import urllib.parse
import urllib.error
import boto3
import jwt
from jwt.algorithms import RSAAlgorithm
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
cognito = boto3.client('cognito-idp')
s3 = boto3.client('s3', region_name='us-east-2')
ssm = boto3.client('ssm', region_name='us-east-2')
TENANT_ASSETS_BUCKET = os.environ.get('TENANT_ASSETS_BUCKET', 'stcd-saas-tenant-assets-574630139917')
# CloudFront distribution in front of the tenant assets bucket. Bucket is
# private; access is gated by Origin Access Control (OAC) on this exact
# distribution ARN. Logo URLs returned to the frontend point here so they
# stay stable across sessions (no hourly presigned-URL churn).
TENANT_ASSETS_CDN = os.environ.get('TENANT_ASSETS_CDN', 'https://d3fg8gqx8vufpg.cloudfront.net')
SSM_TENANT_PREFIX = '/stcd/tenants'
tenants_table = dynamodb.Table(os.environ.get('TENANTS_TABLE', 'stcd_tenants'))

settings_table_v2        = dynamodb.Table(os.environ.get('SETTINGS_TABLE_V2',        'stcd_settings_v2'))
emails_table_v2          = dynamodb.Table(os.environ.get('EMAILS_TABLE_V2',          'stcd_emails_v2'))
sponsorships_table_v2    = dynamodb.Table(os.environ.get('SPONSORSHIPS_TABLE_V2',    'stcd_sponsorships_v2'))
members_table_v2         = dynamodb.Table(os.environ.get('MEMBERS_TABLE_V2',         'stcd_members_v2'))
payment_methods_table_v2 = dynamodb.Table(os.environ.get('PAYMENT_METHODS_TABLE_V2', 'stcd_payment_methods_v2'))
pledges_table_v2         = dynamodb.Table(os.environ.get('PLEDGES_TABLE_V2',         'stcd_pledges_v2'))
transactions_table_v2    = dynamodb.Table(os.environ.get('TRANSACTIONS_TABLE_V2',    'stcd_transactions_v2'))
COGNITO_POOL_ID = os.environ.get('COGNITO_POOL_ID', 'us-east-2_Pna4Sv1p8')
COGNITO_REGION = os.environ.get('COGNITO_REGION', 'us-east-2')
COGNITO_CLIENT_ID = os.environ.get('COGNITO_CLIENT_ID', '7hvnos43j267cl5v1m2knojeda')
COGNITO_ISSUER = f'https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_POOL_ID}'
JWKS_URL = f'{COGNITO_ISSUER}/.well-known/jwks.json'

# Sola / FideliPay
SOLA_X_KEY = os.environ.get('SOLA_X_KEY', '')
SOLA_GATEWAY_URL = os.environ.get('SOLA_GATEWAY_URL', 'https://x1.cardknox.com/gatewayjson')
SOLA_SOFTWARE_NAME = os.environ.get('SOLA_SOFTWARE_NAME', 'STCD-App')
SOLA_SOFTWARE_VERSION = os.environ.get('SOLA_SOFTWARE_VERSION', '1.0.0')
SOLA_API_VERSION = '5.0.0'

ALLOWED_ORIGINS = [
    'https://main.dvy7odxzbdj95.amplifyapp.com',
]
# Localhost allowance is OFF by default — flip ALLOW_LOCAL_DEV=true on the
# Lambda env when developing against the live API. With ACAC=true and a
# wildcard localhost rule, an attacker on the same machine (or via DNS
# rebinding) could CSRF authenticated requests against this API.
ALLOW_LOCAL_DEV = os.environ.get('ALLOW_LOCAL_DEV', 'false').lower() in ('true', '1', 'yes')


def _origin_allowed(origin):
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    if ALLOW_LOCAL_DEV and (origin.startswith('http://localhost:') or origin.startswith('http://127.0.0.1:')):
        return True
    return False


def get_cors_headers(event):
    origin = ''
    headers = event.get('headers') or {}
    # Headers can be mixed case from API Gateway
    for k, v in headers.items():
        if k.lower() == 'origin':
            origin = v
            break
    allowed = origin if _origin_allowed(origin) else ALLOWED_ORIGINS[0]
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
    }


def _json_default(obj):
    if isinstance(obj, Decimal):
        return float(obj) if obj % 1 else int(obj)
    if isinstance(obj, set):
        return sorted(list(obj))
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


_current_event = {'headers': {}}

# ===== Account Balance taxonomy =====
# Charges (reduce Account Balance — member owes money):
CHARGE_PAYMENT_TYPES = {'pledge-charge', 'membership-fee', 'sponsorship-fee', 'purchase-fee', 'charge'}
# Payments (raise Account Balance back toward $0):
PAYMENT_PAYMENT_TYPES = {'pledge', 'membership-payment', 'sponsorship-payment', 'purchase-payment', 'payment'}
# Neutral (still display in ledger; show a small note explaining no balance impact):
NEUTRAL_PAYMENT_TYPES = {'donation', 'deposit'}

# Default monthly membership prices when stcd_settings has no membershipPlans entry.
DEFAULT_MEMBERSHIP_PRICING = {
    ('full', 'single'):  100,
    ('full', 'couple'):  150,
    ('full', 'family'):  180,
    ('associate', 'single'): 60,
    ('associate', 'couple'): 90,
    ('associate', 'family'): 120,
}


def respond(status, body):
    return {
        'statusCode': status,
        'headers': get_cors_headers(_current_event),
        'body': json.dumps(body, default=_json_default),
    }


def _now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


# JWKS cache (lives for the Lambda container's lifetime; stale-after refresh handled below)
_jwks_cache = {'keys': None, 'fetched_at': 0}
_JWKS_TTL_SECONDS = 3600  # refresh hourly even if no cache miss


def _fetch_jwks(force=False):
    now = time.time()
    if (not force
            and _jwks_cache['keys']
            and (now - _jwks_cache['fetched_at']) < _JWKS_TTL_SECONDS):
        return _jwks_cache['keys']
    with urllib.request.urlopen(JWKS_URL, timeout=5) as r:
        data = json.loads(r.read())
    _jwks_cache['keys'] = data.get('keys', [])
    _jwks_cache['fetched_at'] = now
    return _jwks_cache['keys']


def _public_key_for_kid(kid):
    """Find the JWK matching `kid`. Refreshes JWKS once if not found."""
    for jwk in _fetch_jwks():
        if jwk.get('kid') == kid:
            return RSAAlgorithm.from_jwk(json.dumps(jwk))
    # Maybe the pool rotated keys — force refresh once.
    for jwk in _fetch_jwks(force=True):
        if jwk.get('kid') == kid:
            return RSAAlgorithm.from_jwk(json.dumps(jwk))
    return None


def _verify_jwt(authorization_header):
    """
    Verify the JWT in the Authorization header against Cognito's JWKS.

    Validates: signature (RS256), issuer, audience, expiration, and that this
    is a Cognito ID token (token_use='id').

    Returns the verified claims dict on success, or None on any failure.
    """
    if not authorization_header:
        return None
    token = authorization_header.replace('Bearer ', '').strip()
    if not token:
        return None
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    kid = unverified_header.get('kid')
    if not kid:
        return None
    public_key = _public_key_for_kid(kid)
    if public_key is None:
        return None
    try:
        # PyJWT's decode does the heavy lifting:
        #   - verifies RS256 signature against the public key
        #   - verifies `iss` matches issuer
        #   - verifies `aud` matches audience (ID tokens have aud=client_id)
        #   - verifies `exp` and `nbf`
        claims = jwt.decode(
            token,
            public_key,
            algorithms=['RS256'],
            audience=COGNITO_CLIENT_ID,
            issuer=COGNITO_ISSUER,
            leeway=30,  # tolerate 30s clock skew
        )
    except jwt.ExpiredSignatureError:
        print('[auth] token expired')
        return None
    except jwt.InvalidTokenError as e:
        print(f'[auth] invalid token: {e}')
        return None
    # Reject anything that isn't a Cognito ID token. The frontend always sends
    # ID tokens; access tokens have a different shape and shouldn't be trusted
    # for actor attribution (no email claim by default).
    if claims.get('token_use') != 'id':
        return None
    return claims


# Sub IDs of the 3 pre-Phase-0 STCD Cognito users that pre-date the
# `custom:tenantId` schema attribute. Cognito's `Mutable=false` schema
# means we can't backfill the attribute on them, so we map their sub to
# 'stcd' explicitly. Any OTHER user with an empty tenantId claim is a
# bug — they get an empty tenant and fail at the first _require_tenant()
# call, which is the correct behavior once tenant #2 is onboarded.
#
# Delete this set (and the lookup) once these 3 users are deleted and
# re-created with the attribute stamped (or once the operator decides
# they're disposable test accounts).
_LEGACY_STCD_SUBS = {
    '4cbfeeee-7a2a-4277-b3cf-ced2f5db2e12',  # elimaruani1@gmail.com (admin/operator)
    '0ff25f91-684f-4277-b2f3-8e3e262bb5f1',  # eliahou.maruani@gmail.com (pledger)
    'e2bef02e-2e0d-449c-a781-ddf836ca8ea4',  # eli_maruani@hotmail.com (member)
}


def _get_actor():
    """
    Pull the verified user identity captured at lambda_handler entry.
    Returns dict with email, role, memberId, sub, tenantId, isSuperadmin.
    Empty if unverified (only the EventBridge cron path reaches here without
    verified claims).

    Transition rule for tenantId: limited to the 3 pre-Phase-0 STCD users
    listed in _LEGACY_STCD_SUBS. Everyone else's empty tenantId resolves
    to '' — which fails _require_tenant() at the first route. This is
    deliberate: post-Phase-2 every new user gets tenantId stamped at
    cognito_create_user time, so a missing claim is a real bug, not a
    legacy backfill case.
    """
    claims = _current_event.get('_verified_claims') or {}
    raw_tenant = (claims.get('custom:custom:tenantId', '') or '').strip()
    raw_super = (claims.get('custom:custom:isSuperadmin', '') or '').strip().lower()
    sub = claims.get('sub', '')
    tenant_id = raw_tenant
    if not tenant_id and sub in _LEGACY_STCD_SUBS:
        tenant_id = 'stcd'
    return {
        'email': claims.get('email', ''),
        'role': claims.get('custom:custom:role', ''),
        'memberId': claims.get('custom:custom:memberId', ''),
        'sub': sub,
        'tenantId': tenant_id,
        'isSuperadmin': raw_super == 'true',
    }


def _is_superadmin():
    return bool(_get_actor().get('isSuperadmin'))


def _require_tenant():
    """Return the actor's tenantId. Always non-empty thanks to the default
    rule in _get_actor(); kept as a helper so the call sites read clearly."""
    return _get_actor()['tenantId']


def _assert_tenant_match(record_tenant):
    """Return True if the actor may access a record stamped with record_tenant.
    Superadmins (custom:isSuperadmin=true) cross tenant boundaries; everyone
    else is locked to their own tenantId. An unstamped record (empty/None
    record_tenant) is treated as belonging to 'stcd' for the same transition
    reason as _get_actor()."""
    if _is_superadmin():
        return True
    actor_tenant = _get_actor()['tenantId']
    rec_tenant = (record_tenant or '').strip() or 'stcd'
    return bool(actor_tenant) and actor_tenant == rec_tenant


# Per-container cache for tenant rows. Lambda keeps globals warm between
# invocations on the same container, so a hot path re-reading the same
# tenant in a single request (or across requests on the same container)
# avoids repeated DynamoDB hits. Bust when a tenant row is updated.
_tenant_cache = {}


def _load_tenant(tenant_id):
    """Fetch a tenant row from stcd_tenants. Returns the raw item dict or
    None if the tenant isn't found. Caches within the warm container."""
    if not tenant_id:
        return None
    cached = _tenant_cache.get(tenant_id)
    if cached is not None:
        return cached
    try:
        item = tenants_table.get_item(Key={'tenantId': tenant_id}).get('Item')
    except Exception as e:
        print(f"[tenant] load failed for {tenant_id}: {e}")
        return None
    if item:
        _tenant_cache[tenant_id] = item
    return item


def _bust_tenant_cache(tenant_id=None):
    """Drop one tenant or the whole cache (call after writes to stcd_tenants)."""
    if tenant_id:
        _tenant_cache.pop(tenant_id, None)
    else:
        _tenant_cache.clear()


def _actor_stamp_create():
    """Returns audit fields for newly created records."""
    a = _get_actor()
    return {
        'createdBy': a['email'] or 'unknown',
        'createdByRole': a['role'] or '',
        'createdByMemberId': a['memberId'] or '',
        'createdAt': _now_iso(),
    }


def _actor_stamp_modify():
    """Returns audit fields stamped on every mutation of an existing record."""
    a = _get_actor()
    return {
        'modifiedBy': a['email'] or 'unknown',
        'modifiedByRole': a['role'] or '',
        'modifiedByMemberId': a['memberId'] or '',
        'modifiedAt': _now_iso(),
    }


def _system_stamp_create():
    """Audit fields for cron-generated records."""
    return {
        'createdBy': 'system',
        'createdByRole': 'system',
        'createdByMemberId': '',
        'createdAt': _now_iso(),
    }


# ===== Authorization helpers =====
def _is_admin():
    return _get_actor()['role'] == 'admin'


def _is_pledger():
    return _get_actor()['role'] == 'pledger'


def _is_self(member_id):
    if not member_id:
        return False
    actor_member_id = _get_actor()['memberId']
    if not actor_member_id:
        return False
    return str(actor_member_id) == str(member_id)


def _forbid(reason='Forbidden'):
    return respond(403, {'error': reason})


# Fields a non-admin (i.e. the member themselves) is allowed to edit on their
# own record via PUT /members/:id. Anything outside this set is silently
# stripped from the request body before update_member runs the DynamoDB write,
# so members cannot grant themselves admin perks, change membership plan,
# alter their balance, etc.
MEMBER_SELF_EDITABLE_FIELDS = {
    'firstName', 'lastName', 'gender', 'email', 'phone', 'dob',
    'address', 'addressLine2', 'city', 'state', 'zip',
    'spouseName', 'spouseGender', 'spouseDob', 'marriageDate',
    'yahrzeits', 'children',
    'billingDayOfMonth',
}


def _idempotent_txn_id(key, suffix=''):
    """Derive a deterministic transactionId from an idempotency key. Same input
    always yields the same id; this lets us use DynamoDB's
    ConditionExpression='attribute_not_exists(transactionId)' as an atomic
    duplicate-write guard, defeating concurrent double-clicks at the storage
    layer (which the previous scan-and-write approach could not)."""
    return f"TXN#idem#{key}{suffix}"


def _try_atomic_put_txn(item):
    """
    Try to write `item` only if its transactionId doesn't already exist.
    Returns (won, existing_item).
    """
    won = _txn_put_conditional(item, condition_expression='attribute_not_exists(transactionId)')
    if won:
        return True, None
    existing = _txn_get(item['memberId'], item['transactionId'])
    return False, existing


def _claim_charge_idempotency(member_id, idempotency_key):
    """
    For the /charge flow: atomically claim the idempotency key BEFORE we hit
    Sola, so a concurrent duplicate request never makes a second payment. The
    first request wins the claim and proceeds to charge; later requests with
    the same key block-wait briefly for the result and then return it.

    Returns (claimed, prior_record):
      - claimed=True   -> caller should run Sola and then call
                          _finish_charge_idempotency() with the result
      - claimed=False  -> prior_record holds the winner's stored result; caller
                          returns it directly
    """
    if not idempotency_key:
        return True, None
    txn_id = _idempotent_txn_id(idempotency_key, suffix='-claim')
    pending_item = {
        'memberId': str(member_id),
        'transactionId': txn_id,
        'paymentType': 'idempotency-claim',
        'idempotencyKey': idempotency_key,
        'amount': Decimal('0'),
        'status': 'pending',
        'createdAt': _now_iso(),
    }
    won, existing = _try_atomic_put_txn(pending_item)
    if won:
        return True, None
    # Existing claim — wait briefly for the original to complete.
    for _ in range(60):  # ~6 seconds total
        if existing and existing.get('status') in ('completed', 'failed'):
            return False, existing
        time.sleep(0.1)
        existing = _txn_get(str(member_id), txn_id)
    # Took too long — fail closed.
    return False, existing


def _finish_charge_idempotency(member_id, idempotency_key, result, status='completed'):
    """Update the claim row written by _claim_charge_idempotency with the final
    result. Stored as JSON in `result` so duplicate requests can mirror the
    original response verbatim."""
    if not idempotency_key:
        return
    try:
        _txn_update(
            str(member_id),
            _idempotent_txn_id(idempotency_key, suffix='-claim'),
            UpdateExpression='SET #s = :s, #r = :r, completedAt = :t',
            ExpressionAttributeNames={'#s': 'status', '#r': 'result'},
            ExpressionAttributeValues={
                ':s': status,
                ':r': json.dumps(result, default=_json_default),
                ':t': _now_iso(),
            },
        )
    except Exception as e:
        print(f"[idempotency] could not finalise claim: {e}")


def _escape_cognito_filter_value(value):
    """
    Escape user input before interpolating into a Cognito ListUsers Filter.
    Cognito's filter language treats backslash and double-quote specially.
    """
    if not value:
        return ''
    return str(value).replace('\\', '\\\\').replace('"', '\\"')


def parse_body(event):
    body = event.get('body', '{}')
    if isinstance(body, str):
        return json.loads(body) if body else {}
    return body or {}


def extract_path_id(path, prefix):
    """Extract the ID segment after a prefix. e.g. '/members/779' with prefix '/members/' -> '779'"""
    rest = path[len(prefix):]
    return rest.split('/')[0] if rest else None


def _all_member_transactions(member_id):
    """Fetch every transaction row for a member."""
    return _txn_query_by_member(str(member_id))


def compute_account_balance(member_id):
    """
    Account Balance = (sum of payment txns) - (sum of charge txns).
    Pledges contribute through their charge txn (paymentType='pledge-charge'),
    not through pledges_table — that's just the per-pledge tracking record.
    Canceled transactions are excluded so the member's balance reflects the
    cancellation immediately.
    """
    total = Decimal('0')
    for t in _all_member_transactions(member_id):
        if t.get('canceled'):
            continue
        ptype = t.get('paymentType', '')
        amt = Decimal(str(t.get('amount', 0)))
        if ptype in CHARGE_PAYMENT_TYPES:
            total -= amt
        elif ptype in PAYMENT_PAYMENT_TYPES:
            total += amt
        # NEUTRAL_PAYMENT_TYPES: skip
    return total


def _make_pair_id():
    return f"PAIR-{uuid.uuid4().hex[:10]}"


def _write_charge_payment_pair(member_id, date, amount, charge_type, payment_type,
                                charge_description, payment_description, **extra):
    """
    Atomically write a fee+payment pair (e.g. membership-fee + membership-payment,
    or sponsorship-fee + sponsorship-payment). The two rows share `pairId` so
    callers can find them later (e.g. to refund).

    Returns (charge_txn, payment_txn).
    """
    member_id_str = str(member_id)
    pair_id = _make_pair_id()
    idempotency_key = extra.get('idempotencyKey') or ''
    # Deterministic IDs when an idempotency key is provided so concurrent
    # duplicate calls are rejected at the storage layer.
    if idempotency_key:
        charge_txn_id = _idempotent_txn_id(idempotency_key, suffix='-c')
        payment_txn_id = _idempotent_txn_id(idempotency_key, suffix='-p')
    else:
        now_suffix = uuid.uuid4().hex[:8]
        charge_txn_id = f"TXN#{date}#{now_suffix}-c"
        payment_txn_id = f"TXN#{date}#{now_suffix}-p"
    year_month = (date or '')[:7]
    amount_dec = Decimal(str(amount))
    stamp = _actor_stamp_create()

    base = {
        'memberId': member_id_str,
        'date': date,
        'txnDate': date,
        'yearMonth': year_month,
        'amount': amount_dec,
        'pairId': pair_id,
        'method': extra.get('method', ''),
        'category': extra.get('category', ''),
        'groupId': extra.get('groupId', ''),
        'productId': extra.get('productId', ''),
        'pledgeId': extra.get('pledgeId', ''),
        'invoice': extra.get('invoice', ''),
        'alias': extra.get('alias', ''),
        # Gateway metadata only attaches to the payment row
    }
    charge = {
        **base,
        'transactionId': charge_txn_id,
        'description': charge_description,
        'paymentType': charge_type,
        'idempotencyKey': extra.get('idempotencyKey', ''),
        **stamp,
    }
    payment = {
        **base,
        'transactionId': payment_txn_id,
        'description': payment_description,
        'paymentType': payment_type,
        'paymentMethodId': extra.get('paymentMethodId', ''),
        'cardLast4': extra.get('cardLast4', ''),
        'cardBrand': extra.get('cardBrand', ''),
        'gatewayRefNum': extra.get('gatewayRefNum', ''),
        'gatewayAuthCode': extra.get('gatewayAuthCode', ''),
        'gatewayResult': extra.get('gatewayResult', ''),
        'gatewayStatus': extra.get('gatewayStatus', ''),
        'idempotencyKey': extra.get('idempotencyKey', ''),
        **stamp,
    }
    ba_raw = extra.get('balanceApplied', 0)
    balance_applied = Decimal(str(ba_raw)) if ba_raw not in ('', None) else Decimal('0')
    if balance_applied > 0:
        payment['balanceApplied'] = balance_applied

    # Strip empties
    charge = {k: v for k, v in charge.items() if v not in ('', None)}
    payment = {k: v for k, v in payment.items() if v not in ('', None)}

    if idempotency_key:
        # Atomic claim — second writer of the same pair is rejected here.
        won, existing_charge = _try_atomic_put_txn(charge)
        if not won:
            existing_payment = _txn_get(member_id_str, payment_txn_id) or {}
            return existing_charge or charge, existing_payment or payment
        won2, existing_payment = _try_atomic_put_txn(payment)
        # If charge wrote but payment somehow already existed, fall through
        # with whatever's there. Should not happen under same idempotencyKey.
        if not won2:
            return charge, existing_payment or payment
    else:
        _txn_put(charge)
        _txn_put(payment)

    # If part of the payment was funded by stored Account Credit, debit it.
    if balance_applied > 0:
        _adjust_member_balance(member_id_str, -balance_applied)

    return charge, payment


def _membership_monthly_amount(membership_type, membership_plan, settings_pricing=None):
    """Look up monthly fee. Settings format: [{id, label, price}, ...] keyed on plan id.
    Falls back to legacy {type,plan,price} format, then to DEFAULT_MEMBERSHIP_PRICING."""
    if settings_pricing:
        for entry in settings_pricing:
            # New simple format: id == plan
            if entry.get('id') == membership_plan and 'price' in entry:
                return Decimal(str(entry.get('price', 0)))
            # Legacy structured format
            if entry.get('type') == membership_type and entry.get('plan') == membership_plan:
                return Decimal(str(entry.get('price', 0)))
    return Decimal(str(DEFAULT_MEMBERSHIP_PRICING.get((membership_type, membership_plan), 0)))


def lambda_handler(event, context):
    global _current_event
    _current_event = event

    # Scheduled invocation from EventBridge — bypasses HTTP auth (the cron has
    # no JWT and isn't routed through API Gateway). EventBridge invocation is
    # itself gated by the resource policy on the Lambda.
    if event.get('source') == 'aws.events' or event.get('scheduled_action'):
        action = event.get('scheduled_action') or event.get('detail', {}).get('action')
        if action == 'monthly_membership' or event.get('source') == 'aws.events':
            return run_monthly_membership_billing()
        return {'statusCode': 200, 'body': json.dumps({'message': 'ignored'})}

    method = event.get('httpMethod', '')
    path = event.get('path', '')

    # Preflight — no auth required.
    if method == 'OPTIONS':
        return respond(200, {'message': 'ok'})

    # ===== Public routes (no JWT required) =====
    # Pre-login branding for the Login page. Returns the same shape as
    # GET /tenants/me but with NO authentication and only the visual
    # fields (no email config, address, taxId, sola*, etc) — so an
    # unauthenticated probe can't enumerate operational details.
    if path == '/public/branding' and method == 'GET':
        return get_public_branding(event)

    # ===== Mandatory JWT verification for every HTTP route =====
    auth_header = ''
    headers = event.get('headers') or {}
    for k, v in headers.items():
        if k.lower() == 'authorization':
            auth_header = v
            break
    verified_claims = _verify_jwt(auth_header)
    if not verified_claims:
        return respond(401, {'error': 'Invalid or missing authentication token'})
    # Stash the verified claims so _get_actor() and any future authorization
    # checks downstream can rely on them.
    _current_event['_verified_claims'] = verified_claims

    try:
        # ===== MEMBERS =====
        if path == '/members' and method == 'GET':
            return get_members(event)
        if path == '/members/merge' and method == 'POST':
            return merge_members(parse_body(event))
        if path.startswith('/members/') and method == 'GET':
            return get_member(extract_path_id(path, '/members/'))
        if path == '/members' and method == 'POST':
            return create_member(parse_body(event))
        if path.startswith('/members/') and path.endswith('/autopay') and method == 'PUT':
            mid = extract_path_id(path, '/members/')
            return set_member_autopay(mid, parse_body(event))
        if path.startswith('/members/') and method == 'PUT':
            return update_member(extract_path_id(path, '/members/'), parse_body(event))

        # ===== TRANSACTIONS =====
        if path == '/transactions' and method == 'GET':
            return get_transactions(event)
        if path.startswith('/transactions/member/') and method == 'GET':
            member_id = path.split('/transactions/member/')[1]
            return get_member_transactions(member_id, event)
        if path == '/transactions/pair' and method == 'POST':
            return create_charge_payment_pair(parse_body(event))
        if path == '/transactions/settle-fee' and method == 'POST':
            return settle_fee(parse_body(event))
        if path == '/billing/charge-membership-fee' and method == 'POST':
            return charge_membership_fee(parse_body(event))
        if path == '/transactions' and method == 'POST':
            return create_transaction(parse_body(event))
        if path == '/transactions/cancel' and method == 'POST':
            return cancel_transaction(parse_body(event))
        if (path == '/transactions' or path.startswith('/transactions/')) and method == 'PUT':
            return update_transaction(parse_body(event))
        if path.startswith('/transactions/') and method == 'DELETE':
            return delete_transaction(parse_body(event))

        # ===== PLEDGES =====
        if path == '/pledges' and method == 'GET':
            return get_pledges(event)
        if path.startswith('/pledges/member/') and method == 'GET':
            member_id = path.split('/pledges/member/')[1]
            return get_member_pledges(member_id)
        if path == '/pledges' and method == 'POST':
            return create_pledge(parse_body(event))
        if (path == '/pledges' or path.startswith('/pledges/')) and method == 'PUT':
            return update_pledge(parse_body(event))
        if path.startswith('/pledges/pay') and method == 'POST':
            return pay_pledge(parse_body(event))
        if (path == '/pledges' or path.startswith('/pledges/')) and method == 'DELETE':
            return delete_pledge(parse_body(event))

        # ===== SETTINGS =====
        if path == '/settings' and method == 'GET':
            return get_all_settings()
        if path.startswith('/settings/') and method == 'GET':
            key = path.split('/settings/')[1]
            return get_setting(key)
        if path.startswith('/settings/') and method == 'PUT':
            key = path.split('/settings/')[1]
            return update_setting(key, parse_body(event))

        # ===== SPONSORSHIPS =====
        if path == '/sponsorships' and method == 'GET':
            return get_sponsorships()
        if path.startswith('/sponsorships/') and method == 'PUT':
            date_key = extract_path_id(path, '/sponsorships/')
            return update_sponsorship(date_key, parse_body(event))
        if path.startswith('/sponsorships/') and method == 'DELETE':
            date_key = extract_path_id(path, '/sponsorships/')
            return delete_sponsorship(date_key, parse_body(event))

        # ===== EMAILS =====
        if path == '/emails' and method == 'GET':
            return get_emails()
        if path == '/emails' and method == 'POST':
            return create_email(parse_body(event))

        # ===== PAYMENT METHODS (Sola / FideliPay card vault) =====
        if path == '/payment-methods' and method == 'POST':
            return create_payment_method(parse_body(event))
        if path.startswith('/payment-methods/member/') and method == 'GET':
            member_id = path.split('/payment-methods/member/')[1]
            return list_payment_methods(member_id)
        if path.startswith('/payment-methods/') and method == 'DELETE':
            return delete_payment_method(parse_body(event))

        # ===== CHARGE (use a saved card) =====
        if path == '/charge' and method == 'POST':
            return charge_saved_card(parse_body(event))

        # ===== TENANT — payment bootstrap =====
        # Returns the public iFields key + software name + display name so the
        # frontend can mount the Sola iFrame and label charge descriptions
        # without reading the env-var-based VITE_SOLA_IFIELDS_KEY (which is
        # tenant-incorrect once we onboard a second synagogue). NEVER returns
        # xKey — that stays server-side.
        if path == '/tenants/me/payment-config' and method == 'GET':
            return get_tenant_payment_config()
        # Full tenant record (sans credentials). Any authenticated user in
        # the tenant may read; only admins may write.
        if path == '/tenants/me' and method == 'GET':
            return get_tenant_me()
        if path == '/tenants/me' and method == 'PUT':
            return update_tenant_me(parse_body(event))
        if path == '/tenants/me/logo-upload' and method == 'POST':
            return get_logo_upload_url(parse_body(event))

        # ===== COGNITO USER MANAGEMENT =====
        if path == '/users/lookup' and method == 'POST':
            return cognito_lookup_user(parse_body(event))
        if path == '/users/create' and method == 'POST':
            return cognito_create_user(parse_body(event))
        if path == '/users/disable' and method == 'POST':
            return cognito_disable_user(parse_body(event))
        if path == '/users/enable' and method == 'POST':
            return cognito_enable_user(parse_body(event))
        if path == '/users/reset-password' and method == 'POST':
            return cognito_reset_password(parse_body(event))
        if path == '/users/resend-invite' and method == 'POST':
            return cognito_resend_invite(parse_body(event))
        if path == '/users/update-role' and method == 'POST':
            return cognito_update_role(parse_body(event))

        return respond(404, {'error': f'Not found: {method} {path}'})

    except Exception as e:
        # Structured log so CloudWatch Logs Insights can filter ops alerts
        # per-tenant — `fields @message | filter tenantId = 'stcd'` etc.
        # We don't fail the handler if claims aren't loaded yet (a few
        # routes throw before _verified_claims is set).
        try:
            actor = _get_actor()
            tid = actor.get('tenantId') or ''
        except Exception:
            tid = ''
        print(json.dumps({
            'level': 'error',
            'tenantId': tid,
            'method': method,
            'path': path,
            'error': str(e),
        }))
        return respond(500, {'error': str(e)})


# ===================== MEMBERS =====================

def _members_get(member_id):
    tenant_id = _require_tenant()
    res = members_table_v2.get_item(Key={'tenantId': tenant_id, 'memberId': str(member_id)})
    return res.get('Item')


def _members_list_all_for_tenant():
    tenant_id = _require_tenant()
    items = []
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        kw['KeyConditionExpression'] = Key('tenantId').eq(tenant_id)
        res = members_table_v2.query(**kw)
        items.extend(res.get('Items', []))
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break
    return items


def _members_put(item):
    """Write a full member record. Stamps tenantId on the v2 write so the
    composite PK is well-formed; memberId is coerced to string."""
    tenant_id = _require_tenant()
    v2_item = {**item, 'tenantId': tenant_id, 'memberId': str(item.get('memberId', ''))}
    members_table_v2.put_item(Item=v2_item)


def _members_update(member_id, **kwargs):
    """Wrap update_item — accepts UpdateExpression, ExpressionAttribute*."""
    tenant_id = _require_tenant()
    members_table_v2.update_item(Key={'tenantId': tenant_id, 'memberId': str(member_id)}, **kwargs)


def _members_delete(member_id):
    tenant_id = _require_tenant()
    members_table_v2.delete_item(Key={'tenantId': tenant_id, 'memberId': str(member_id)})


def get_members(event):
    qs = event.get('queryStringParameters') or {}
    items = _members_list_all_for_tenant()

    # Sort by lastName, firstName
    items.sort(key=lambda x: (x.get('lastName', '').lower(), x.get('firstName', '').lower()))

    # PII gate: admins and pledgers see all member fields. Members see their
    # own full record + slim records (id + names + aliases + gender) for
    # everyone else — no addresses, phones, balances, or family details leak
    # cross-member.
    if not (_is_admin() or _is_pledger()):
        actor_mid = str(_get_actor().get('memberId') or '')
        slim = {'memberId', 'firstName', 'lastName', 'aliases', 'gender'}
        items = [
            m if str(m.get('memberId', '')) == actor_mid
            else {k: v for k, v in m.items() if k in slim}
            for m in items
        ]

    return respond(200, items)


def get_member(member_id):
    if not (_is_admin() or _is_pledger() or _is_self(member_id)):
        return _forbid()
    item = _members_get(member_id)
    if not item:
        return respond(404, {'error': 'Member not found'})
    # Augment with computed Account Balance.
    # 'balance' field on the member itself is Account Credit (stored prepaid funds);
    # we keep the legacy name on the wire to avoid breaking callers, plus add the
    # explicit names for clarity.
    account_credit = Decimal(str(item.get('balance', 0)))
    item['accountCredit'] = account_credit
    item['accountBalance'] = compute_account_balance(member_id)
    return respond(200, item)


def create_member(body):
    if not _is_admin():
        return _forbid()
    member_id = body.get('memberId', str(uuid.uuid4())[:8])
    body['memberId'] = member_id
    body['balance'] = Decimal(str(body.get('balance', 0)))
    body.update(_actor_stamp_create())
    _members_put(body)
    return respond(201, body)


def update_member(member_id, body):
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()

    # When a member edits their own record, drop any field they're not allowed
    # to change. This stops e.g. balance, membershipPlan, contactType,
    # autopay* tampering through PUT /members/:id.
    if not _is_admin():
        body = {k: v for k, v in body.items() if k in MEMBER_SELF_EDITABLE_FIELDS}

    # First fetch existing member to avoid overwriting with empty values
    existing = _members_get(member_id) or {}

    # Always stamp who/when on every member update
    body = {**body, **_actor_stamp_modify()}

    expr_parts = []
    expr_values = {}
    expr_names = {}
    for key, value in body.items():
        if key == 'memberId':
            continue

        # Skip empty strings/None if the existing field has a real value
        # (only overwrite if the new value is non-empty, or if explicitly clearing with a special marker)
        existing_val = existing.get(key)
        if value == '' and existing_val and existing_val != '':
            continue  # Don't overwrite existing data with empty string
        if value is None:
            continue  # Never overwrite with None

        # For lists: don't overwrite non-empty lists with empty lists
        if isinstance(value, list) and len(value) == 0 and isinstance(existing_val, list) and len(existing_val) > 0:
            continue

        safe_key = f"#{key}"
        expr_names[safe_key] = key
        expr_parts.append(f"{safe_key} = :{key}")
        if isinstance(value, (int, float)):
            expr_values[f":{key}"] = Decimal(str(value))
        else:
            expr_values[f":{key}"] = value

    if not expr_parts:
        return respond(400, {'error': 'No fields to update'})

    _members_update(
        member_id,
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    return respond(200, {'message': 'Member updated', 'memberId': member_id})


def merge_members(body):
    if not _is_admin():
        return _forbid()
    primary_id = body['primaryId']
    secondary_id = body['secondaryId']
    field_values = body.get('fieldValues', {})

    primary = _members_get(primary_id) or {}
    secondary = _members_get(secondary_id) or {}

    if not primary or not secondary:
        return respond(404, {'error': 'One or both members not found'})

    # Apply field overrides
    for key, value in field_values.items():
        primary[key] = value

    # Merge aliases
    aliases = set(primary.get('aliases', []) + secondary.get('aliases', []))
    sec_name = f"{secondary.get('firstName', '')} {secondary.get('lastName', '')}".strip()
    if sec_name:
        aliases.add(sec_name)
    primary['aliases'] = list(aliases)

    # Merge balance
    primary['balance'] = Decimal(str(primary.get('balance', 0))) + Decimal(str(secondary.get('balance', 0)))

    # Merge list fields
    for field in ['yahrzeits', 'children']:
        primary[field] = primary.get(field, []) + secondary.get(field, [])

    # Save merged primary
    primary.update(_actor_stamp_modify())
    _members_put(primary)

    # Move secondary's transactions to primary
    for txn in _txn_query_by_member(secondary_id):
        _txn_delete(secondary_id, txn['transactionId'])
        txn['memberId'] = primary_id
        _txn_put(txn)

    # Move secondary's pledges to primary
    for plg in _pledges_list_for_member(secondary_id):
        _pledge_delete(secondary_id, plg['pledgeId'])
        plg['memberId'] = primary_id
        _pledge_put(plg)

    # Delete secondary member
    _members_delete(secondary_id)

    return respond(200, {'message': 'Members merged', 'memberId': primary_id})


# ===================== TRANSACTIONS =====================
# v2 schema: PK tenantId + SK transactionId. Two GSIs:
#   - member-index   on (tenantIdMemberId, txnDate)
#   - date-index     on (tenantIdYearMonth, txnDate)
# These synthesised composite attrs are written on every v2 row.


def _txn_v2_extra_attrs(item):
    tenant_id = _require_tenant()
    member_id = str(item.get('memberId', ''))
    year_month = item.get('yearMonth', '') or ''
    out = {
        'tenantId': tenant_id,
        'tenantIdMemberId': f"{tenant_id}#{member_id}",
    }
    if year_month:
        out['tenantIdYearMonth'] = f"{tenant_id}#{year_month}"
    return out


def _txn_get(member_id, transaction_id):
    """Read a single transaction. member_id accepted for source-compat
    (not part of the v2 key)."""
    tenant_id = _require_tenant()
    res = transactions_table_v2.get_item(Key={'tenantId': tenant_id, 'transactionId': transaction_id})
    return res.get('Item')


def _txn_query_by_member(member_id):
    tenant_id = _require_tenant()
    res = transactions_table_v2.query(
        IndexName='member-index',
        KeyConditionExpression=Key('tenantIdMemberId').eq(f"{tenant_id}#{member_id}"),
    )
    return res.get('Items', [])


def _txn_query_by_yearmonth(year_month):
    tenant_id = _require_tenant()
    res = transactions_table_v2.query(
        IndexName='date-index',
        KeyConditionExpression=Key('tenantIdYearMonth').eq(f"{tenant_id}#{year_month}"),
    )
    return res.get('Items', [])


def _txn_scan_all_for_tenant():
    tenant_id = _require_tenant()
    items = []
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        kw['KeyConditionExpression'] = Key('tenantId').eq(tenant_id)
        res = transactions_table_v2.query(**kw)
        items.extend(res.get('Items', []))
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break
    return items


def _txn_put(item):
    transactions_table_v2.put_item(Item={**item, **_txn_v2_extra_attrs(item)})


def _txn_put_conditional(item, condition_expression=None):
    """Used by the idempotency claim — supports ConditionExpression.
    Returns True if the put succeeded, False if the condition failed
    (duplicate). Non-condition errors propagate so the caller can
    surface them rather than silently treating an idempotent claim as
    successful when a real write error happened.
    """
    try:
        kw = {'Item': {**item, **_txn_v2_extra_attrs(item)}}
        if condition_expression:
            kw['ConditionExpression'] = condition_expression
        transactions_table_v2.put_item(**kw)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def _txn_update(member_id, transaction_id, **kwargs):
    tenant_id = _require_tenant()
    transactions_table_v2.update_item(
        Key={'tenantId': tenant_id, 'transactionId': transaction_id},
        **kwargs,
    )


def _txn_delete(member_id, transaction_id):
    tenant_id = _require_tenant()
    transactions_table_v2.delete_item(Key={'tenantId': tenant_id, 'transactionId': transaction_id})


def get_transactions(event):
    if not _is_admin():
        return _forbid()
    qs = event.get('queryStringParameters') or {}
    year_month = qs.get('yearMonth')
    items = _txn_query_by_yearmonth(year_month) if year_month else _txn_scan_all_for_tenant()
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def get_member_transactions(member_id, event):
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    items = _txn_query_by_member(member_id)
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_transaction(body):
    member_id = body.get('memberId')
    if not member_id:
        return respond(400, {'error': 'memberId is required'})
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()

    idempotency_key = body.get('idempotencyKey') or ''
    date = body.get('date', '')
    # Deterministic id when an idempotency key is provided so a concurrent
    # duplicate is rejected by DynamoDB's ConditionExpression rather than
    # racing to write a second row.
    txn_id = _idempotent_txn_id(idempotency_key) if idempotency_key else f"TXN#{date}#{uuid.uuid4().hex[:8]}"
    payment_type = body.get('paymentType', '')
    amount = Decimal(str(body.get('amount', 0)))
    # Optional: how much of THIS payment came out of the member's stored balance/credit.
    # The frontend passes this when a payment is funded (fully or partially) by Account Credit.
    balance_applied = Decimal(str(body.get('balanceApplied', 0)))

    item = {
        'memberId': member_id,
        'transactionId': txn_id,
        'date': date,
        'txnDate': date,
        'yearMonth': date[:7] if date else '',
        'description': body.get('description', ''),
        'amount': amount,
        'method': body.get('method', ''),
        'paymentType': payment_type,
        'source': body.get('source', ''),
        'category': body.get('category', ''),
        'groupId': body.get('groupId', ''),
        'pledgeId': body.get('pledgeId', ''),
        'productId': body.get('productId', ''),
        'alias': body.get('alias', ''),
        # Gateway metadata (optional — populated when this txn was paid via Sola /charge)
        'paymentMethodId': body.get('paymentMethodId', ''),
        'cardLast4': body.get('cardLast4', ''),
        'cardBrand': body.get('cardBrand', ''),
        'gatewayRefNum': body.get('gatewayRefNum', ''),
        'gatewayAuthCode': body.get('gatewayAuthCode', ''),
        'gatewayResult': body.get('gatewayResult', ''),
        'gatewayStatus': body.get('gatewayStatus', ''),
        'balanceApplied': balance_applied if balance_applied > 0 else '',
        'idempotencyKey': idempotency_key,
        **_actor_stamp_create(),
    }
    # Clean empty strings
    item = {k: v for k, v in item.items() if v != '' or k in ('memberId', 'transactionId', 'date')}

    if idempotency_key:
        # Conditional put — second writer with the same key gets the first
        # writer's row back instead of duplicating it.
        won, existing = _try_atomic_put_txn(item)
        if not won:
            return respond(200, {**(existing or item), 'idempotent': True})
    else:
        _txn_put(item)

    # If this is a pledge payment linked to a specific pledge, update the pledge
    if body.get('pledgeId') and body.get('paymentType') == 'pledge':
        _apply_pledge_payment(member_id, body['pledgeId'], Decimal(str(body.get('amount', 0))), body.get('method', ''))

    # Update the member's stored balance/credit:
    #   - Deposits add the full amount
    #   - Any other transaction with balanceApplied > 0 deducts that portion
    delta = Decimal('0')
    if payment_type == 'deposit':
        delta += amount
    if balance_applied > 0:
        delta -= balance_applied
    if delta != 0:
        _adjust_member_balance(member_id, delta)

    return respond(201, item)


def _adjust_member_balance(member_id, delta):
    """Atomically add `delta` (Decimal, can be negative) to a member's stored balance."""
    try:
        _members_update(
            str(member_id),
            UpdateExpression='SET balance = if_not_exists(balance, :zero) + :d',
            ExpressionAttributeValues={':zero': Decimal('0'), ':d': delta},
        )
    except Exception as e:
        print(f"[balance] failed to adjust member {member_id} by {delta}: {e}")


def create_charge_payment_pair(body):
    """
    Write a fee+payment pair (membership / sponsorship / purchase / generic charge).
    Body:
      memberId, date, amount, kind ('membership' | 'sponsorship' | 'purchase' | 'charge'),
      description, [chargeDescription, paymentDescription], [method], [category],
      [productId], [pledgeId], [groupId], [invoice], [alias],
      [paymentMethodId], [cardLast4], [cardBrand],
      [gatewayRefNum], [gatewayAuthCode], [gatewayResult], [gatewayStatus],
      [balanceApplied], [idempotencyKey]
    """
    member_id = body.get('memberId')
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    # Idempotency is handled atomically inside _write_charge_payment_pair via
    # ConditionExpression on the deterministic txn ids. A pre-check using the
    # legacy scan helper would race anyway; the storage layer is the truth.
    date = body.get('date') or time.strftime('%Y-%m-%d', time.gmtime())
    amount = body.get('amount')
    kind = (body.get('kind') or 'charge').lower()
    if not member_id or amount is None:
        return respond(400, {'error': 'memberId and amount are required'})
    try:
        amount_dec = Decimal(str(amount))
    except Exception:
        return respond(400, {'error': 'amount must be numeric'})
    if amount_dec <= 0:
        return respond(400, {'error': 'amount must be > 0'})

    pair_kinds = {
        'membership':  ('membership-fee',  'membership-payment',  'Membership fee',     'Membership payment'),
        'sponsorship': ('sponsorship-fee', 'sponsorship-payment', 'Sponsorship fee',    'Sponsorship payment'),
        'purchase':    ('purchase-fee',    'purchase-payment',    'Purchase',           'Purchase payment'),
        'charge':      ('charge',          'payment',             'Charge',             'Payment'),
    }
    if kind not in pair_kinds:
        return respond(400, {'error': f'kind must be one of {list(pair_kinds)}'})
    charge_type, payment_type, default_charge_desc, default_payment_desc = pair_kinds[kind]

    description = body.get('description') or ''
    charge_desc = body.get('chargeDescription') or description or default_charge_desc
    payment_desc = body.get('paymentDescription') or description or default_payment_desc

    extra_keys = (
        'method', 'category', 'groupId', 'productId', 'pledgeId', 'invoice', 'alias',
        'paymentMethodId', 'cardLast4', 'cardBrand',
        'gatewayRefNum', 'gatewayAuthCode', 'gatewayResult', 'gatewayStatus',
        'balanceApplied', 'idempotencyKey',
    )
    extras = {k: body.get(k, '') for k in extra_keys}

    charge_txn, payment_txn = _write_charge_payment_pair(
        member_id, date, amount_dec, charge_type, payment_type,
        charge_desc, payment_desc, **extras,
    )
    return respond(201, {'charge': charge_txn, 'payment': payment_txn})


def settle_fee(body):
    """
    Admin marks an outstanding sponsorship/membership/purchase fee as paid by
    writing a matching payment row. The payment carries `settlesTxnId` so the
    AdminPledges outstanding-list filter can pair them up.

    Body: { memberId, feeTransactionId, amount, method, date, [paymentDescription] }
    """
    if not _is_admin():
        return _forbid()
    member_id = body.get('memberId')
    fee_txn_id = body.get('feeTransactionId') or ''
    if not member_id or not fee_txn_id:
        return respond(400, {'error': 'memberId and feeTransactionId are required'})

    fee = _txn_get(str(member_id), fee_txn_id)
    if not fee:
        return respond(404, {'error': 'Fee transaction not found'})

    # Idempotency: if a payment that settles this fee already exists, return it
    # rather than writing a second row. Stops duplicate clicks / retries from
    # double-booking the ledger.
    for t in _all_member_transactions(str(member_id)):
        if t.get('settlesTxnId') == fee_txn_id and t.get('paymentType', '').endswith('-payment'):
            return respond(200, {**t, 'idempotent': True})

    # Map fee type -> payment type
    fee_to_payment = {
        'sponsorship-fee': 'sponsorship-payment',
        'membership-fee':  'membership-payment',
        'purchase-fee':    'purchase-payment',
        'charge':          'payment',
    }
    payment_type = fee_to_payment.get(fee.get('paymentType'), 'payment')

    today = body.get('date') or time.strftime('%Y-%m-%d', time.gmtime())
    amount = Decimal(str(body.get('amount', fee.get('amount', 0))))
    method = body.get('method', 'Manual')
    payment_desc = body.get('paymentDescription') or (
        (fee.get('description') or 'Fee') + ' — payment'
    )
    payment_txn_id = f"TXN#{today}#{uuid.uuid4().hex[:8]}"

    # Inherit alias from the fee if the caller didn't pass one — keeps the
    # "Paying As" filter consistent across the fee + payment pair.
    alias = body.get('alias') or fee.get('alias') or ''
    payment_row = {
        'memberId': str(member_id),
        'transactionId': payment_txn_id,
        'date': today,
        'txnDate': today,
        'yearMonth': today[:7],
        'description': payment_desc,
        'amount': amount,
        'method': method,
        'paymentType': payment_type,
        'category': fee.get('category', ''),
        'settlesTxnId': fee_txn_id,
        'alias': alias,
        **_actor_stamp_create(),
    }
    payment_row = {k: v for k, v in payment_row.items() if v not in ('', None)}
    _txn_put(payment_row)
    return respond(201, payment_row)


def set_member_autopay(member_id, body):
    """PUT /members/:id/autopay  body: {enabled: bool, paymentMethodId: str}"""
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    enabled = bool(body.get('enabled'))
    payment_method_id = body.get('paymentMethodId') or ''
    if enabled and not payment_method_id:
        return respond(400, {'error': 'paymentMethodId is required when enabling autopay'})
    stamp = _actor_stamp_modify()
    _members_update(
        str(member_id),
        UpdateExpression=(
            'SET autopayEnabled = :e, autopayPaymentMethodId = :p, '
            'modifiedBy = :mb, modifiedByRole = :mr, modifiedByMemberId = :mm, modifiedAt = :ma'
        ),
        ExpressionAttributeValues={
            ':e': enabled,
            ':p': payment_method_id,
            ':mb': stamp['modifiedBy'],
            ':mr': stamp['modifiedByRole'],
            ':mm': stamp['modifiedByMemberId'],
            ':ma': stamp['modifiedAt'],
        },
    )
    return respond(200, {
        'message': 'Autopay updated',
        'autopayEnabled': enabled,
        'autopayPaymentMethodId': payment_method_id,
    })


def _membership_pricing_from_settings():
    """Read settings.membershipPlans first; fall back to legacy membershipPricing key."""
    try:
        items = _settings_read('membershipPlans')
        if items:
            return items
    except Exception:
        pass
    try:
        return _settings_read('membershipPricing') or []
    except Exception:
        return []


def charge_membership_fee(body):
    """
    Charge a single member's saved card to settle one outstanding membership-fee.
    Body:
      memberId, feeTransactionId, paymentMethodId, amount

    Idempotency:
      - If the fee already has a matching membership-payment row for the same
        yearMonth, return 200 with already_paid=true. Caller should treat as success.
      - On Sola decline, no payment row is written; returns 402 with gateway detail.
      - On Sola approval, writes the membership-payment row sharing pairId with
        an updated fee row so the two can be linked.
    """
    if not _is_admin():
        return _forbid()
    member_id = str(body.get('memberId') or '')
    fee_txn_id = body.get('feeTransactionId') or ''
    payment_method_id = body.get('paymentMethodId') or ''
    amount_raw = body.get('amount')

    if not member_id or not fee_txn_id or not payment_method_id or amount_raw is None:
        return respond(400, {'error': 'memberId, feeTransactionId, paymentMethodId, amount are required'})
    try:
        amount = Decimal(str(amount_raw))
    except Exception:
        return respond(400, {'error': 'amount must be numeric'})
    if amount <= 0:
        return respond(400, {'error': 'amount must be > 0'})

    # Fetch the fee txn to confirm it exists and is unpaid.
    fee = _txn_get(member_id, fee_txn_id)
    if not fee or fee.get('paymentType') != 'membership-fee':
        return respond(404, {'error': 'membership-fee transaction not found'})

    fee_year_month = fee.get('yearMonth', '')
    # If already paired, short-circuit.
    if fee.get('pairId'):
        for t in _all_member_transactions(member_id):
            if t.get('paymentType') == 'membership-payment' and t.get('pairId') == fee.get('pairId'):
                return respond(200, {
                    'success': True,
                    'alreadyPaid': True,
                    'paymentTransactionId': t.get('transactionId'),
                })
    # If any membership-payment for the same yearMonth covers this amount, treat as paid.
    same_month_payments = [
        t for t in _all_member_transactions(member_id)
        if t.get('paymentType') == 'membership-payment' and t.get('yearMonth') == fee_year_month
    ]
    if same_month_payments:
        return respond(200, {
            'success': True,
            'alreadyPaid': True,
            'paymentTransactionId': same_month_payments[0].get('transactionId'),
        })

    # Resolve member + payment method.
    member = _members_get(member_id)
    if not member:
        return respond(404, {'error': 'Member not found'})
    pm = _pm_get(member_id, payment_method_id)
    if not pm:
        return respond(404, {'error': 'Saved card not found for this member'})

    # Sola charge.
    plan_label = f"{member.get('membershipType', '').capitalize()} {member.get('membershipPlan', '').capitalize()}".strip()
    tenant = _load_tenant(_require_tenant()) or {}
    tenant_name = tenant.get('displayName') or tenant.get('legalName') or 'Membership'
    sola_payload = {
        'xCommand': 'cc:sale',
        'xAmount': f"{float(amount):.2f}",
        'xToken': pm['xToken'],
        'xDescription': f"{tenant_name} monthly membership ({plan_label})",
        'xInvoice': fee_txn_id,
    }
    ok, resp = _sola_post(sola_payload)
    if not ok:
        return respond(402, {
            'success': False,
            'error': resp.get('xError', 'Charge declined'),
            'errorCode': resp.get('xErrorCode'),
            'gatewayRefNum': resp.get('xRefNum'),
            'gatewayResult': resp.get('xResult'),
        })

    # Approval: write the matching membership-payment row, link to the fee via pairId.
    pair_id = fee.get('pairId') or _make_pair_id()
    today = time.strftime('%Y-%m-%d', time.gmtime())
    payment_txn_id = f"TXN#{today}#{uuid.uuid4().hex[:8]}"
    payment_txn = {
        'memberId': member_id,
        'transactionId': payment_txn_id,
        'date': today,
        'txnDate': today,
        'yearMonth': fee_year_month or today[:7],
        'description': fee.get('description', 'Membership payment').replace('Monthly membership', 'Monthly membership payment'),
        'amount': amount,
        'paymentType': 'membership-payment',
        'category': 'Membership',
        'method': 'Card on file (admin batch)',
        'pairId': pair_id,
        'paymentMethodId': payment_method_id,
        'cardLast4': pm.get('last4', ''),
        'cardBrand': pm.get('cardBrand', ''),
        'gatewayRefNum': resp.get('xRefNum', ''),
        'gatewayAuthCode': resp.get('xAuthCode', ''),
        'gatewayResult': resp.get('xResult', ''),
        'gatewayStatus': resp.get('xStatus', ''),
        **_actor_stamp_create(),
    }
    payment_txn = {k: v for k, v in payment_txn.items() if v not in ('', None)}
    _txn_put(payment_txn)

    # Stamp pairId onto the fee so future runs short-circuit cleanly.
    if not fee.get('pairId'):
        try:
            _txn_update(
                member_id, fee_txn_id,
                UpdateExpression='SET pairId = :p',
                ExpressionAttributeValues={':p': pair_id},
            )
        except Exception as e:
            print(f"[billing] could not stamp pairId on fee {fee_txn_id}: {e}")

    return respond(200, {
        'success': True,
        'alreadyPaid': False,
        'gatewayRefNum': resp.get('xRefNum'),
        'authCode': resp.get('xAuthCode'),
        'paymentTransactionId': payment_txn_id,
        'cardLast4': pm.get('last4', ''),
        'cardBrand': pm.get('cardBrand', ''),
    })


def run_monthly_membership_billing():
    """Cron entry. Iterates every active tenant in stcd_tenants and runs the
    per-tenant tick. Synthesises a system actor for each tenant so all
    downstream `_require_tenant()` calls see the right value; restores the
    previous claims (or clears them) at the end so a same-container HTTP
    invocation after the cron isn't poisoned with stale tenant context."""
    try:
        scan = tenants_table.scan()
    except Exception as e:
        print(f'[cron] failed to scan stcd_tenants: {e}')
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}

    all_summaries = {}
    saved_claims = _current_event.get('_verified_claims')
    try:
        for t in scan.get('Items', []):
            tid = t.get('tenantId')
            if not tid:
                continue
            if (t.get('status') or 'active') != 'active':
                all_summaries[tid] = {'skipped': 'tenant inactive'}
                continue
            _current_event['_verified_claims'] = {
                'email': 'system',
                'custom:custom:role': 'system',
                'custom:custom:memberId': '',
                'custom:custom:tenantId': tid,
                'custom:custom:isSuperadmin': '',
                'sub': 'system-cron',
            }
            try:
                # Self-heal: migrate any legacy plaintext xKey to SSM on
                # every cron tick. Cheap (cache hit after first migration)
                # and protects against future onboarding bugs that leave
                # a key on the row.
                _get_tenant_sola_xkey(tid)
                all_summaries[tid] = _run_monthly_membership_billing_for_current_tenant()
            except Exception as e:
                print(f'[cron] tenant {tid} failed: {e}')
                all_summaries[tid] = {'error': str(e)}
    finally:
        if saved_claims is None:
            _current_event.pop('_verified_claims', None)
        else:
            _current_event['_verified_claims'] = saved_claims

    print(f"[daily billing] {all_summaries}")
    return {'statusCode': 200, 'body': json.dumps({'tenants': all_summaries}, default=_json_default)}


def _run_monthly_membership_billing_for_current_tenant():
    """Per-tenant tick. Caller must have stamped `_current_event` claims so
    `_require_tenant()` returns the target tenant. Returns a summary dict.

    Daily idempotent (despite the legacy name). For each member with an
    active plan, creates a membership-fee charge row only if today's day of
    the month matches the member's billingDayOfMonth (default 1). End-of-month
    edge: if a member's billing day is later than the current month's last
    day (e.g. 31 in February), they're billed on the last day of the month
    instead, so nobody gets skipped for a whole cycle.
    """
    today_str = time.strftime('%Y-%m-%d', time.gmtime())
    year_month = today_str[:7]
    today_day = int(time.strftime('%d', time.gmtime()))
    # Days in this month (UTC).
    import calendar as _calendar
    yy, mm = (int(x) for x in today_str.split('-')[:2])
    last_day_of_month = _calendar.monthrange(yy, mm)[1]

    pricing = _membership_pricing_from_settings()

    members = _members_list_all_for_tenant()

    summary = {
        'fees_created': 0,
        'skipped_too_early': 0,        # day hasn't arrived yet
        'skipped_already_billed': 0,
        'skipped_no_plan': 0,
    }

    for m in members:
        mtype = m.get('membershipType', '')
        plan = m.get('membershipPlan', '')
        if not mtype or not plan:
            summary['skipped_no_plan'] += 1
            continue

        # Default billing day = 1. Clamp to the actual last day of the month
        # so a member set to 31 still gets billed in February.
        try:
            billing_day = int(m.get('billingDayOfMonth') or 1)
        except (TypeError, ValueError):
            billing_day = 1
        if billing_day < 1: billing_day = 1
        if billing_day > 28 and billing_day > last_day_of_month:
            effective_day = last_day_of_month
        else:
            effective_day = min(billing_day, last_day_of_month)
        # Catch-up semantics: post the fee on any day at or after the member's
        # billing day, as long as no fee has been posted yet this month. This
        # makes day-of-month changes safe — nobody can be skipped, even if
        # they shift their billing day mid-month.
        if today_day < effective_day:
            summary['skipped_too_early'] += 1
            continue

        # Per-member override beats the plan price. 0 / blank => plan price.
        override_raw = m.get('membershipPriceOverride')
        override_val = None
        if override_raw is not None and str(override_raw) != '':
            try:
                v = Decimal(str(override_raw))
                if v > 0:
                    override_val = v
            except Exception:
                pass
        amount = override_val if override_val is not None else _membership_monthly_amount(mtype, plan, pricing)
        if amount <= 0:
            summary['skipped_no_plan'] += 1
            continue

        member_id = str(m['memberId'])
        already_billed = any(
            t.get('paymentType') == 'membership-fee' and t.get('yearMonth') == year_month
            for t in _all_member_transactions(member_id)
        )
        if already_billed:
            summary['skipped_already_billed'] += 1
            continue

        plan_label = plan.capitalize()
        is_override = override_val is not None
        description = f"Monthly membership — {plan_label}" + (' (custom rate)' if is_override else '')
        charge_txn = {
            'memberId': member_id,
            'transactionId': f"TXN#{today_str}#{uuid.uuid4().hex[:8]}",
            'date': today_str,
            'txnDate': today_str,
            'yearMonth': year_month,
            'description': description,
            'amount': amount,
            'paymentType': 'membership-fee',
            'category': 'Membership',
            **_system_stamp_create(),
        }
        _txn_put(charge_txn)
        summary['fees_created'] += 1

    return summary


def update_transaction(body):
    if not _is_admin():
        return _forbid()
    member_id = body['memberId']
    txn_id = body['transactionId']

    existing = _txn_get(member_id, txn_id) or {}

    update_fields = {k: v for k, v in body.items() if k not in ('memberId', 'transactionId')}
    if 'amount' in update_fields:
        update_fields['amount'] = Decimal(str(update_fields['amount']))
    if 'date' in update_fields:
        update_fields['txnDate'] = update_fields['date']
        update_fields['yearMonth'] = update_fields['date'][:7]

    expr_parts = []
    expr_values = {}
    expr_names = {}
    for key, value in update_fields.items():
        # Skip empty values that would overwrite existing data
        if value == '' and existing.get(key, '') != '':
            continue
        if value is None:
            continue
        safe_key = f"#{key}"
        expr_names[safe_key] = key
        expr_parts.append(f"{safe_key} = :{key}")
        expr_values[f":{key}"] = value

    # Always include modifiedBy/modifiedAt on the update itself
    for k, v in _actor_stamp_modify().items():
        safe_key = f"#{k}"
        expr_names[safe_key] = k
        expr_parts.append(f"{safe_key} = :{k}")
        expr_values[f":{k}"] = v

    if expr_parts:
        _txn_update(
            member_id, txn_id,
            UpdateExpression='SET ' + ', '.join(expr_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )

    # Keep linked pledge.paidAmount in sync with the ledger. Covers amount
    # edits, paymentType flips, and pledgeId reassignments.
    old_pledge_id = existing.get('pledgeId') if existing.get('paymentType') == 'pledge' else ''
    new_ptype = update_fields.get('paymentType', existing.get('paymentType', ''))
    new_pledge_id = update_fields.get('pledgeId', existing.get('pledgeId', ''))
    if old_pledge_id:
        _recompute_pledge_paid(member_id, old_pledge_id)
    if new_ptype == 'pledge' and new_pledge_id and new_pledge_id != old_pledge_id:
        _recompute_pledge_paid(member_id, new_pledge_id)

    return respond(200, {'message': 'Transaction updated'})


def delete_transaction(body):
    # Deletions are disabled platform-wide. Admins cancel instead so a reason
    # and audit trail are preserved.
    return respond(403, {'error': 'Deletions are disabled. Cancel the transaction instead.'})


def cancel_transaction(body):
    """Soft-cancel a transaction (e.g. a sponsorship fee). The row stays in
    DynamoDB so admins can review it; the user no longer sees it and the
    balance recomputes ignoring canceled rows."""
    if not _is_admin():
        return _forbid()
    member_id = body['memberId']
    txn_id = body['transactionId']
    reason = (body.get('cancellationReason') or '').strip()
    if not reason:
        return respond(400, {'error': 'cancellationReason is required'})
    actor = _get_actor()
    now = _now_iso()
    _txn_update(
        member_id, txn_id,
        UpdateExpression=(
            'SET #canceled = :c, #reason = :r, '
            '#canceledBy = :cb, #canceledByRole = :cr, '
            '#canceledByMemberId = :cm, #canceledAt = :ca, '
            '#modifiedBy = :cb, #modifiedByRole = :cr, '
            '#modifiedByMemberId = :cm, #modifiedAt = :ca'
        ),
        ExpressionAttributeNames={
            '#canceled': 'canceled',
            '#reason': 'cancellationReason',
            '#canceledBy': 'canceledBy',
            '#canceledByRole': 'canceledByRole',
            '#canceledByMemberId': 'canceledByMemberId',
            '#canceledAt': 'canceledAt',
            '#modifiedBy': 'modifiedBy',
            '#modifiedByRole': 'modifiedByRole',
            '#modifiedByMemberId': 'modifiedByMemberId',
            '#modifiedAt': 'modifiedAt',
        },
        ExpressionAttributeValues={
            ':c': True,
            ':r': reason,
            ':cb': actor['email'] or 'unknown',
            ':cr': actor['role'] or '',
            ':cm': actor['memberId'] or '',
            ':ca': now,
        },
    )

    # If this was a pledge payment, recompute the linked pledge so its
    # outstanding goes back up to reflect the canceled payment.
    canceled = _txn_get(member_id, txn_id) or {}
    if canceled.get('paymentType') == 'pledge' and canceled.get('pledgeId'):
        _recompute_pledge_paid(member_id, canceled['pledgeId'])

    return respond(200, {'message': 'Transaction canceled'})


# ===================== PLEDGES =====================
# v2 schema: PK tenantId + SK pledgeId. New GSI member-index on
# (tenantIdMemberId, date) so per-member queries still work.


def _pledges_v2_extra_attrs(item):
    """Synthesise the GSI partition key for v2."""
    tenant_id = _require_tenant()
    return {
        'tenantId': tenant_id,
        'tenantIdMemberId': f"{tenant_id}#{item.get('memberId', '')}",
    }


def _pledge_get(member_id, pledge_id):
    tenant_id = _require_tenant()
    res = pledges_table_v2.get_item(Key={'tenantId': tenant_id, 'pledgeId': pledge_id})
    return res.get('Item')


def _pledges_list_all_for_tenant():
    tenant_id = _require_tenant()
    items = []
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        kw['KeyConditionExpression'] = Key('tenantId').eq(tenant_id)
        res = pledges_table_v2.query(**kw)
        items.extend(res.get('Items', []))
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break
    return items


def _pledges_list_for_member(member_id):
    tenant_id = _require_tenant()
    res = pledges_table_v2.query(
        IndexName='member-index',
        KeyConditionExpression=Key('tenantIdMemberId').eq(f"{tenant_id}#{member_id}"),
    )
    return res.get('Items', [])


def _pledge_put(item):
    pledges_table_v2.put_item(Item={**item, **_pledges_v2_extra_attrs(item)})


def _pledge_update(member_id, pledge_id, **kwargs):
    tenant_id = _require_tenant()
    pledges_table_v2.update_item(Key={'tenantId': tenant_id, 'pledgeId': pledge_id}, **kwargs)


def _pledge_delete(member_id, pledge_id):
    tenant_id = _require_tenant()
    pledges_table_v2.delete_item(Key={'tenantId': tenant_id, 'pledgeId': pledge_id})


def get_pledges(event):
    if not _is_admin():
        return _forbid()
    items = _pledges_list_all_for_tenant()
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def get_member_pledges(member_id):
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    items = _pledges_list_for_member(member_id)
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_pledge(body):
    if not (_is_admin() or _is_pledger()):
        return _forbid()
    member_id = body['memberId']
    date = body.get('date', '')
    pledge_id = f"PLG#{date}#{uuid.uuid4().hex[:8]}"

    actor_stamp = _actor_stamp_create()
    alias = body.get('alias', '')
    notes = (body.get('notes') or '').strip()
    item = {
        'memberId': member_id,
        'pledgeId': pledge_id,
        'date': date,
        'pledgeType': body.get('pledgeType', ''),
        'occasion': body.get('occasion', ''),
        'description': body.get('description', ''),
        'amount': Decimal(str(body.get('amount', 0))),
        'paidAmount': Decimal('0'),
        'paid': False,
        'canceled': False,
        'paymentMethod': '',
        'category': body.get('category', 'pledge'),
        **actor_stamp,
    }
    if alias:
        item['alias'] = alias
    if notes:
        item['notes'] = notes

    _pledge_put(item)

    # Mirror the pledge as a charge transaction so the ledger and
    # Account Balance see -$amount immediately. Carries the same alias so the
    # ledger filter for "Paying As <alias>" includes the charge row.
    desc = item['description'] or item['pledgeType'] or 'Pledge'
    charge_txn = {
        'memberId': str(member_id),
        'transactionId': f"TXN#{date}#{uuid.uuid4().hex[:8]}",
        'date': date,
        'txnDate': date,
        'yearMonth': date[:7] if date else '',
        'description': desc,
        'amount': item['amount'],
        'paymentType': 'pledge-charge',
        'pledgeId': pledge_id,
        'category': item['category'],
        'alias': alias,
        **actor_stamp,
    }
    charge_txn = {k: v for k, v in charge_txn.items() if v not in ('', None)}
    _txn_put(charge_txn)
    return respond(201, item)


def update_pledge(body):
    if not _is_admin():
        return _forbid()
    member_id = body['memberId']
    pledge_id = body['pledgeId']

    existing = _pledge_get(member_id, pledge_id) or {}

    update_fields = {k: v for k, v in body.items() if k not in ('memberId', 'pledgeId')}
    if 'amount' in update_fields:
        update_fields['amount'] = Decimal(str(update_fields['amount']))
    if 'paidAmount' in update_fields:
        update_fields['paidAmount'] = Decimal(str(update_fields['paidAmount']))

    # When a pledge is being canceled for the first time, stamp who/when so the
    # admin-only cancellation reason has an actor + timestamp attached.
    if body.get('canceled') is True and not existing.get('canceled'):
        actor = _get_actor()
        update_fields.setdefault('canceledBy', actor['email'] or 'unknown')
        update_fields.setdefault('canceledByRole', actor['role'] or '')
        update_fields.setdefault('canceledByMemberId', actor['memberId'] or '')
        update_fields.setdefault('canceledAt', _now_iso())

    # Fields that an admin is allowed to explicitly clear by sending an empty
    # string — these get REMOVEd from the item instead of being silently kept.
    CLEARABLE_FIELDS = {'notes'}

    expr_parts = []
    remove_parts = []
    expr_values = {}
    expr_names = {}
    for key, value in update_fields.items():
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == '':
            if key in CLEARABLE_FIELDS:
                if existing.get(key):
                    safe_key = f"#{key}"
                    expr_names[safe_key] = key
                    remove_parts.append(safe_key)
                continue
            # Non-clearable field: skip empty so we don't overwrite existing data.
            if existing.get(key, '') != '':
                continue
        safe_key = f"#{key}"
        expr_names[safe_key] = key
        expr_parts.append(f"{safe_key} = :{key}")
        expr_values[f":{key}"] = value

    # Always stamp who modified this pledge
    for k, v in _actor_stamp_modify().items():
        safe_key = f"#{k}"
        expr_names[safe_key] = k
        expr_parts.append(f"{safe_key} = :{k}")
        expr_values[f":{k}"] = v

    if expr_parts or remove_parts:
        clauses = []
        if expr_parts:
            clauses.append('SET ' + ', '.join(expr_parts))
        if remove_parts:
            clauses.append('REMOVE ' + ', '.join(remove_parts))
        kwargs = {
            'UpdateExpression': ' '.join(clauses),
            'ExpressionAttributeNames': expr_names,
        }
        if expr_values:
            kwargs['ExpressionAttributeValues'] = expr_values
        _pledge_update(member_id, pledge_id, **kwargs)

    # Keep the mirrored pledge-charge txn aligned with the pledge.
    # On cancel, drop the charge so balance stops counting it.
    # On amount change, update the charge amount.
    if 'canceled' in body and body.get('canceled'):
        for t in _all_member_transactions(member_id):
            if t.get('paymentType') == 'pledge-charge' and t.get('pledgeId') == pledge_id:
                _txn_delete(t['memberId'], t['transactionId'])
    elif 'amount' in body:
        new_amt = Decimal(str(body['amount']))
        for t in _all_member_transactions(member_id):
            if t.get('paymentType') == 'pledge-charge' and t.get('pledgeId') == pledge_id:
                _txn_update(
                    t['memberId'], t['transactionId'],
                    UpdateExpression='SET amount = :a',
                    ExpressionAttributeValues={':a': new_amt},
                )

    return respond(200, {'message': 'Pledge updated'})


def _recompute_pledge_paid(member_id, pledge_id):
    """Recompute a pledge's paidAmount from the live sum of its non-canceled
    'pledge' payment transactions and re-stamp the `paid` flag. Called after
    a pledge-linked txn is edited or canceled so the pledge's outstanding
    stays in sync with the ledger."""
    if not pledge_id:
        return
    pledge = _pledge_get(member_id, pledge_id)
    if not pledge:
        return
    total = Decimal('0')
    for t in _all_member_transactions(member_id):
        if t.get('canceled'):
            continue
        if t.get('paymentType') != 'pledge':
            continue
        if t.get('pledgeId') != pledge_id:
            continue
        total += Decimal(str(t.get('amount', 0)))
    pledge_amount = Decimal(str(pledge.get('amount', 0)))
    is_paid = pledge_amount > 0 and total >= pledge_amount
    _pledge_update(
        member_id, pledge_id,
        UpdateExpression='SET paidAmount = :p, paid = :ip',
        ExpressionAttributeValues={':p': total, ':ip': is_paid},
    )


def pay_pledge(body):
    """Record a payment against a pledge. Creates a transaction and updates the pledge."""
    member_id = body['memberId']
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    pledge_id = body['pledgeId']
    amount = Decimal(str(body.get('amount', 0)))
    method = body.get('method', '')
    date = body.get('date', '')

    idempotency_key = body.get('idempotencyKey') or ''

    # Get current pledge
    pledge = _pledge_get(member_id, pledge_id)
    if not pledge:
        return respond(404, {'error': 'Pledge not found'})

    new_paid = pledge.get('paidAmount', Decimal('0')) + amount
    is_fully_paid = new_paid >= pledge.get('amount', Decimal('0'))

    # Build transaction record (deterministic id when idempotency key provided)
    txn_id = _idempotent_txn_id(idempotency_key) if idempotency_key else f"TXN#{date}#{uuid.uuid4().hex[:8]}"
    desc = pledge.get('description', 'Pledge Payment')
    if amount < (pledge.get('amount', Decimal('0')) - pledge.get('paidAmount', Decimal('0'))):
        desc += ' (Partial)'

    txn = {
        'memberId': member_id,
        'transactionId': txn_id,
        'date': date,
        'txnDate': date,
        'yearMonth': date[:7] if date else '',
        'description': desc,
        'amount': amount,
        'method': method,
        'paymentType': 'pledge',
        'pledgeId': pledge_id,
        **_actor_stamp_create(),
    }
    if idempotency_key:
        txn['idempotencyKey'] = idempotency_key
    alias = body.get('alias', '')
    if alias:
        txn['alias'] = alias
    # Gateway metadata when paid via Sola
    for k in ('paymentMethodId', 'cardLast4', 'cardBrand', 'gatewayRefNum', 'gatewayAuthCode', 'gatewayResult', 'gatewayStatus', 'groupId'):
        v = body.get(k, '')
        if v:
            txn[k] = v
    balance_applied = Decimal(str(body.get('balanceApplied', 0)))
    if balance_applied > 0:
        txn['balanceApplied'] = balance_applied

    # Atomic claim BEFORE we touch pledge.paidAmount or member balance, so a
    # concurrent duplicate request can't bump those twice.
    if idempotency_key:
        won, existing = _try_atomic_put_txn(txn)
        if not won:
            return respond(200, {
                'message': 'Payment already recorded',
                'idempotent': True,
                'transaction': existing or txn,
            })
    else:
        _txn_put(txn)

    # Side effects only run for the winner:
    _pledge_update(
        member_id, pledge_id,
        UpdateExpression='SET paidAmount = :paid, paid = :isPaid, paymentMethod = :method',
        ExpressionAttributeValues={
            ':paid': new_paid,
            ':isPaid': is_fully_paid,
            ':method': method,
        },
    )
    if balance_applied > 0:
        _adjust_member_balance(member_id, -balance_applied)

    return respond(200, {'message': 'Payment recorded', 'pledge': {'paidAmount': new_paid, 'paid': is_fully_paid}, 'transaction': txn})


def delete_pledge(body):
    # Deletions are disabled platform-wide. Admins cancel pledges with a
    # required reason instead so the record + audit trail are preserved.
    return respond(403, {'error': 'Deletions are disabled. Cancel the pledge instead.'})


def _apply_pledge_payment(member_id, pledge_id, amount, method):
    """Helper to apply a payment to a pledge when creating a transaction."""
    pledge = _pledge_get(member_id, pledge_id)
    if not pledge:
        return

    new_paid = pledge.get('paidAmount', Decimal('0')) + amount
    is_fully_paid = new_paid >= pledge.get('amount', Decimal('0'))

    _pledge_update(
        member_id, pledge_id,
        UpdateExpression='SET paidAmount = :paid, paid = :isPaid, paymentMethod = :method',
        ExpressionAttributeValues={
            ':paid': new_paid,
            ':isPaid': is_fully_paid,
            ':method': method,
        },
    )


# ===================== SETTINGS =====================
#
# Settings are tenant-scoped. The v2 table receives every write keyed
# by (tenantId, settingKey) so each synagogue has its own pledge types,
# payment methods, products, kiddush prices, membership plans, and
# email templates. The transition rule in _get_actor() guarantees a
# tenantId is always present.


def _settings_get(key):
    """Return the raw item dict for (current tenant, settingKey), or None
    if not found."""
    tenant_id = _require_tenant()
    res = settings_table_v2.get_item(Key={'tenantId': tenant_id, 'settingKey': key})
    return res.get('Item')


def _settings_read(key):
    """Convenience: return the items list for a settingKey, or [] if missing."""
    item = _settings_get(key)
    return (item or {}).get('items', [])


def _settings_read_all_for_tenant():
    """Return a dict {settingKey: items} for the current tenant."""
    tenant_id = _require_tenant()
    out = {}
    res = settings_table_v2.query(KeyConditionExpression=Key('tenantId').eq(tenant_id))
    for item in res.get('Items', []):
        out[item['settingKey']] = item.get('items', [])
    return out


def _settings_write(key, items, stamp):
    """Write one settingKey for the current tenant."""
    tenant_id = _require_tenant()
    settings_table_v2.put_item(Item={
        'tenantId': tenant_id,
        'settingKey': key,
        'items': items,
        **stamp,
    })


def get_all_settings():
    return respond(200, _settings_read_all_for_tenant())


def get_setting(key):
    item = _settings_get(key)
    if not item:
        return respond(404, {'error': f'Setting {key} not found'})
    return respond(200, item.get('items', []))


def update_setting(key, body):
    if not _is_admin():
        return _forbid()
    items = body.get('items', [])
    _settings_write(key, items, _actor_stamp_modify())
    return respond(200, {'message': f'Setting {key} updated'})


# ===================== SPONSORSHIPS =====================

def _sponsorships_get(date_key):
    tenant_id = _require_tenant()
    res = sponsorships_table_v2.get_item(Key={'tenantId': tenant_id, 'dateKey': date_key})
    return res.get('Item')


def _sponsorships_list_all_for_tenant():
    tenant_id = _require_tenant()
    items = []
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        kw['KeyConditionExpression'] = Key('tenantId').eq(tenant_id)
        res = sponsorships_table_v2.query(**kw)
        items.extend(res.get('Items', []))
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break
    return items


def _sponsorships_put(item):
    tenant_id = _require_tenant()
    sponsorships_table_v2.put_item(Item={**item, 'tenantId': tenant_id})


def _sponsorships_delete(date_key):
    tenant_id = _require_tenant()
    sponsorships_table_v2.delete_item(Key={'tenantId': tenant_id, 'dateKey': date_key})


def _sponsorships_remove_field(date_key, field):
    tenant_id = _require_tenant()
    kwargs = {
        'UpdateExpression': f'REMOVE #{field}',
        'ExpressionAttributeNames': {f'#{field}': field},
    }
    try:
        sponsorships_table_v2.update_item(Key={'tenantId': tenant_id, 'dateKey': date_key}, **kwargs)
    except Exception:
        pass


def get_sponsorships():
    items = _sponsorships_list_all_for_tenant()
    items.sort(key=lambda x: x.get('dateKey', ''))
    return respond(200, items)


def update_sponsorship(date_key, body):
    """Update or create a sponsorship for a given Saturday date."""
    # Both kiddush and seuda payloads carry memberId of the booking member;
    # admin can do either. A member can only book on their own behalf.
    booking_member_id = (body.get('kiddush') or {}).get('memberId') or (body.get('seuda') or {}).get('memberId')
    if not (_is_admin() or _is_self(booking_member_id)):
        return _forbid()
    item = {'dateKey': date_key}
    if 'kiddush' in body:
        item['kiddush'] = body['kiddush']
    if 'seuda' in body:
        item['seuda'] = body['seuda']
    if 'blocked' in body:
        item['blocked'] = body['blocked']

    # Merge with existing
    existing = _sponsorships_get(date_key) or {}
    existing.update(item)
    existing.update(_actor_stamp_modify())
    _sponsorships_put(existing)
    return respond(200, existing)


def _delete_sponsorship_txns(existing, field_name, date_key):
    """
    When a sponsorship field is removed, also clean up the ledger row(s) the
    booking created. Three paths:
      - field has txnId         -> delete that one row (admin-reserved fee)
      - field has pairId        -> delete both fee + payment rows (member-paid)
      - neither (legacy rows)   -> scan for matching sponsorship-fee/donation
                                    by member + category + date and delete
    """
    booking = existing.get(field_name) or {}
    member_id = booking.get('memberId')
    if not member_id:
        return
    member_id_str = str(member_id)
    txn_id = booking.get('txnId')
    pair_id = booking.get('pairId')

    if txn_id:
        try:
            _txn_delete(member_id_str, txn_id)
        except Exception as e:
            print(f"[delete-sponsorship] could not delete txn {txn_id}: {e}")
        return

    if pair_id:
        for t in _all_member_transactions(member_id_str):
            if t.get('pairId') == pair_id:
                try:
                    _txn_delete(t['memberId'], t['transactionId'])
                except Exception as e:
                    print(f"[delete-sponsorship] could not delete pair member: {e}")
        return

    # Legacy fallback for sponsorships booked before we started stamping
    # txnId/pairId. Match on member + category + the date appearing in the
    # description. Doesn't touch real-money payments — only the unpaired
    # fee/donation row.
    category = 'Kiddush' if field_name == 'kiddush' else 'Seuda Shelishit'
    for t in _all_member_transactions(member_id_str):
        ptype = t.get('paymentType')
        if ptype not in ('sponsorship-fee', 'donation'):
            continue
        if t.get('category') != category:
            continue
        if date_key not in (t.get('description') or ''):
            continue
        try:
            _txn_delete(t['memberId'], t['transactionId'])
            print(f"[delete-sponsorship] legacy fallback removed {t['transactionId']}")
        except Exception as e:
            print(f"[delete-sponsorship] legacy fallback failed: {e}")


def delete_sponsorship(date_key, body):
    """Remove a kiddush or seuda booking, or unblock a date."""
    if not _is_admin():
        return _forbid()
    field = body.get('field')  # 'kiddush', 'seuda', or 'blocked'

    existing = _sponsorships_get(date_key) or {}

    if not field:
        # Whole-row delete: clean up txns for both kiddush and seuda first.
        for f in ('kiddush', 'seuda'):
            _delete_sponsorship_txns(existing, f, date_key)
        _sponsorships_delete(date_key)
        return respond(200, {'message': 'Sponsorship deleted'})

    if field in ('kiddush', 'seuda'):
        _delete_sponsorship_txns(existing, field, date_key)

    _sponsorships_remove_field(date_key, field)
    return respond(200, {'message': f'{field} removed'})


# ===================== EMAILS =====================

def _emails_list_all_for_tenant():
    tenant_id = _require_tenant()
    items = []
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        kw['KeyConditionExpression'] = Key('tenantId').eq(tenant_id)
        res = emails_table_v2.query(**kw)
        items.extend(res.get('Items', []))
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break
    return items


def _emails_put(item):
    tenant_id = _require_tenant()
    emails_table_v2.put_item(Item={**item, 'tenantId': tenant_id})


def get_emails():
    if not _is_admin():
        return _forbid()
    items = _emails_list_all_for_tenant()
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_email(body):
    if not _is_admin():
        return _forbid()
    email_id = f"EML#{uuid.uuid4().hex[:12]}"
    item = {
        'emailId': email_id,
        'date': body.get('date', ''),
        'type': body.get('type', ''),
        'subject': body.get('subject', ''),
        'body': body.get('body', ''),
        'recipients': body.get('recipients', []),
        'memberIds': body.get('memberIds', []),
        **_actor_stamp_create(),
    }
    _emails_put(item)
    return respond(201, item)


# ===================== COGNITO USER MANAGEMENT =====================

def _cognito_get_user_tenant(username):
    """Read a user's custom:tenantId attribute. Pre-Phase-0 users have no
    value (AWS won't let us backfill the immutable schema attr), so we apply
    the same transition rule as _get_actor and default to 'stcd'. Returns
    None if the user doesn't exist at all."""
    try:
        u = cognito.admin_get_user(UserPoolId=COGNITO_POOL_ID, Username=username)
    except cognito.exceptions.UserNotFoundException:
        return None
    attrs = {a['Name']: a['Value'] for a in u.get('UserAttributes', [])}
    return (attrs.get('custom:custom:tenantId') or '').strip() or 'stcd'


def _assert_cognito_user_in_tenant(username):
    """Belt-and-braces guard for admin operations on Cognito users.
    Returns a respond() to short-circuit the handler, or None to proceed.
    Superadmins bypass."""
    if _is_superadmin():
        return None
    user_tenant = _cognito_get_user_tenant(username)
    if user_tenant is None:
        return respond(404, {'error': 'User not found'})
    if user_tenant != _require_tenant():
        return _forbid('Cross-tenant access denied')
    return None


def cognito_lookup_user(body):
    """Look up a Cognito user by email. Returns user info or {found: false}.
    Cross-tenant lookups are silently masked as 'not found' so an admin can't
    enumerate users in other tenants by probing email addresses."""
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    try:
        # Try original case first, then lowercase fallback (Cognito filter is case-sensitive)
        users = []
        for attempt in [email, email.lower()]:
            result = cognito.list_users(
                UserPoolId=COGNITO_POOL_ID,
                Filter=f'email = "{_escape_cognito_filter_value(attempt)}"',
                Limit=1,
            )
            users = result.get('Users', [])
            if users:
                break
        if not users:
            return respond(200, {'found': False})
        u = users[0]
        attrs = {a['Name']: a['Value'] for a in u.get('Attributes', [])}
        user_tenant = (attrs.get('custom:custom:tenantId') or '').strip() or 'stcd'
        if not _is_superadmin() and user_tenant != _require_tenant():
            return respond(200, {'found': False})
        return respond(200, {
            'found': True,
            'username': u['Username'],
            'status': u['UserStatus'],
            'enabled': u['Enabled'],
            'created': u['UserCreateDate'].isoformat(),
            'modified': u['UserLastModifiedDate'].isoformat(),
            'email': attrs.get('email', ''),
            'emailVerified': attrs.get('email_verified', 'false'),
            'role': attrs.get('custom:custom:role', ''),
            'memberId': attrs.get('custom:custom:memberId', ''),
        })
    except Exception as e:
        return respond(500, {'error': str(e)})


def _resolve_cognito_username(email):
    """Find the Cognito Username for a given email (case-insensitive)."""
    for attempt in [email, email.lower()]:
        result = cognito.list_users(
            UserPoolId=COGNITO_POOL_ID,
            Filter=f'email = "{_escape_cognito_filter_value(attempt)}"',
            Limit=1,
        )
        users = result.get('Users', [])
        if users:
            return users[0]['Username']
    return None


def cognito_create_user(body):
    """Create a Cognito user with the given email. Admin-only.

    Stamps custom:tenantId from the calling admin's claims onto the new user.
    The attribute is immutable in the pool schema, so this is the only time
    in the user's lifetime it can be set — binding them to this tenant for
    good. (Superadmins can pass an explicit tenantId in the body to onboard
    users into other tenants.)"""
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip().lower()
    role = body.get('role', 'member')
    member_id = body.get('memberId', '')
    if not email:
        return respond(400, {'error': 'email is required'})
    new_tenant = _require_tenant()
    if _is_superadmin() and body.get('tenantId'):
        new_tenant = body['tenantId']
    try:
        result = cognito.admin_create_user(
            UserPoolId=COGNITO_POOL_ID,
            Username=email,
            UserAttributes=[
                {'Name': 'email', 'Value': email},
                {'Name': 'email_verified', 'Value': 'true'},
                {'Name': 'custom:custom:role', 'Value': role},
                {'Name': 'custom:custom:memberId', 'Value': str(member_id)},
                {'Name': 'custom:custom:tenantId', 'Value': new_tenant},
            ],
            DesiredDeliveryMediums=['EMAIL'],
        )
        u = result['User']
        return respond(201, {
            'username': u['Username'],
            'status': u['UserStatus'],
            'enabled': u['Enabled'],
        })
    except cognito.exceptions.UsernameExistsException:
        return respond(409, {'error': 'A user with this email already exists'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_disable_user(body):
    """Disable a Cognito user account."""
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    guard = _assert_cognito_user_in_tenant(username)
    if guard:
        return guard
    try:
        cognito.admin_disable_user(UserPoolId=COGNITO_POOL_ID, Username=username)
        return respond(200, {'message': 'User disabled'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_enable_user(body):
    """Enable a Cognito user account."""
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    guard = _assert_cognito_user_in_tenant(username)
    if guard:
        return guard
    try:
        cognito.admin_enable_user(UserPoolId=COGNITO_POOL_ID, Username=username)
        return respond(200, {'message': 'User enabled'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_reset_password(body):
    """Force a password reset — sends a new temporary password via email."""
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    guard = _assert_cognito_user_in_tenant(username)
    if guard:
        return guard
    try:
        cognito.admin_reset_user_password(UserPoolId=COGNITO_POOL_ID, Username=username)
        return respond(200, {'message': 'Password reset email sent'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_resend_invite(body):
    """Resend the welcome/invite email with a fresh temporary password.

    Only valid for users still in FORCE_CHANGE_PASSWORD state. For users who
    already set a permanent password, use cognito_reset_password instead.
    """
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip().lower()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    guard = _assert_cognito_user_in_tenant(username)
    if guard:
        return guard
    try:
        cognito.admin_create_user(
            UserPoolId=COGNITO_POOL_ID,
            Username=username,
            MessageAction='RESEND',
            DesiredDeliveryMediums=['EMAIL'],
        )
        return respond(200, {'message': 'Invitation resent'})
    except cognito.exceptions.UnsupportedUserStateException:
        return respond(409, {'error': 'This user has already set a password. Use Reset Password instead.'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_update_role(body):
    """Update a Cognito user's role attribute."""
    if not _is_admin():
        return _forbid()
    email = body.get('email', '').strip()
    role = body.get('role', 'member')
    if not email:
        return respond(400, {'error': 'email is required'})
    if role not in ('admin', 'member', 'pledger'):
        return respond(400, {'error': 'role must be admin, member, or pledger'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    guard = _assert_cognito_user_in_tenant(username)
    if guard:
        return guard
    try:
        cognito.admin_update_user_attributes(
            UserPoolId=COGNITO_POOL_ID,
            Username=username,
            UserAttributes=[{'Name': 'custom:custom:role', 'Value': role}],
        )
        return respond(200, {'message': f'Role updated to {role}'})
    except Exception as e:
        return respond(500, {'error': str(e)})


# ===================== SOLA / FIDELIPAY PAYMENT METHODS =====================
# Card-on-file vault built on the Sola Transaction API.
#
# Flow:
#   1. Frontend uses iFields to capture card -> SUT (single-use token)
#   2. Frontend POSTs SUT to /payment-methods (this Lambda)
#   3. Lambda calls Sola cc:save -> receives multi-use xToken + masked card
#   4. Lambda persists { memberId, paymentMethodId, xToken, masked, brand, exp } in DynamoDB
#   5. To charge: POST /charge with { memberId, paymentMethodId, amount, ... } -> cc:sale
#
# We never store CVV or full card number. Sola is the vault for the card data;
# our DynamoDB is the index that maps members -> their saved tokens.

# Fields readable by anyone in the tenant. Excludes solaXKey (server-only) and
# any future private credentials we add to stcd_tenants.
_TENANT_PUBLIC_FIELDS = {
    'tenantId', 'displayName', 'legalName', 'domain', 'primaryColor',
    'secondaryColor', 'accentColor', 'logoS3Key', 'solaIFieldsKey',
    'solaSoftwareName', 'solaSoftwareVersion', 'timezone', 'currency',
    'fromEmail', 'replyToEmail', 'emailFooterSignature', 'taxId', 'address',
    'status', 'createdAt', 'createdBy',
}
# Fields admins may edit via PUT /tenants/me. Intentionally excludes
# tenantId, createdAt/createdBy, status — those are platform-owned. solaXKey
# IS editable (admins need to rotate their own gateway credentials) but is
# never returned in GET responses; the frontend only sees a last-4 hint.
_TENANT_ADMIN_EDITABLE = {
    'displayName', 'legalName', 'primaryColor', 'secondaryColor', 'accentColor',
    'logoS3Key', 'solaIFieldsKey', 'solaXKey', 'timezone', 'currency', 'fromEmail',
    'replyToEmail', 'emailFooterSignature', 'taxId', 'address',
}


def get_public_branding(event):
    """Pre-login branding lookup, keyed by ?host=<hostname>. Returns the
    visual fields only — name + colors + logo key — so the Login page can
    render with the right synagogue's brand before any JWT exists. NEVER
    returns operational details (email, address, taxId, sola*, status).

    Lookup strategy: scan-and-filter on `domain`. We have a small number
    of tenants (single-digit for now), so adding a GSI is premature. If
    no tenant matches, falls back to the 'stcd' row so the existing
    deployment keeps working before custom domains are wired up."""
    qs = event.get('queryStringParameters') or {}
    host = (qs.get('host') or '').strip().lower()
    match = None
    if host:
        try:
            # Query domain-index GSI — O(1) hostname lookup. Scales to
            # hundreds of tenants without scanning the table.
            res = tenants_table.query(
                IndexName='domain-index',
                KeyConditionExpression=Key('domain').eq(host),
                Limit=1,
            )
            items = res.get('Items', [])
            if items:
                match = items[0]
        except Exception as e:
            print(f'[public-branding] GSI query failed: {e}')
    if not match:
        match = _load_tenant('stcd') or {}
    safe = {
        'tenantId': match.get('tenantId', ''),
        'displayName': match.get('displayName', 'Member Portal'),
        'legalName': match.get('legalName', ''),
        'primaryColor': match.get('primaryColor', '#1a365d'),
        'secondaryColor': match.get('secondaryColor', '#2a4a7f'),
        'accentColor': match.get('accentColor', '#c6973f'),
        'logoS3Key': match.get('logoS3Key', ''),
        # Presigned GET so the Login page can render the per-tenant logo
        # before any JWT exists. URL has the credentials embedded; the
        # bucket can stay private.
        'logoUrl': _presigned_logo_url(match.get('logoS3Key')),
    }
    return respond(200, safe)


def _presigned_logo_url(logo_key):
    """Stable CloudFront URL for a tenant's logo. The bucket is private;
    OAC on the distribution is the only thing that can read from it, so
    posting this URL doesn't expose the bucket. Returns '' when no key
    is set so the frontend falls back to the bundled default.

    (Name retained for source-compat with earlier code that called this
    helper; the URL is no longer presigned — it's a stable CDN URL that
    doesn't rotate.)"""
    if not logo_key:
        return ''
    return f'{TENANT_ASSETS_CDN.rstrip("/")}/{logo_key.lstrip("/")}'


def get_tenant_me():
    """Return the caller's tenant row with private credentials stripped.
    Available to any authenticated user in the tenant. Includes a 1-hour
    presigned `logoUrl` so the frontend can render the logo without the
    S3 bucket being public. solaXKey is **never** returned (lives only in
    SSM Parameter Store SecureString); the UI sees `solaXKeyLast4` and
    `solaXKeyConfigured` hints instead."""
    tenant_id = _require_tenant()
    # Force the SSM migration side effect if a legacy plaintext xKey is
    # still on the row, so a fresh GET clears it immediately. Charging
    # would have done this on the next sale; we don't want admins to see
    # the row still hold plaintext while waiting for a charge to happen.
    _get_tenant_sola_xkey(tenant_id)
    tenant = _load_tenant(tenant_id) or {}
    out = {k: v for k, v in tenant.items() if k in _TENANT_PUBLIC_FIELDS}
    out['logoUrl'] = _presigned_logo_url(tenant.get('logoS3Key'))
    out['solaXKeyLast4']    = tenant.get('solaXKeyLast4', '') or ''
    out['solaXKeyConfigured'] = bool(tenant.get('solaXKeyConfigured'))
    # iFields key still lives on the row (it's the public iframe key, not a
    # rotated secret), but we show only the last 4 in the Settings UI so the
    # whole string doesn't clutter the form. Frontend rebuilds the iframe
    # using the full value from /tenants/me/payment-config separately.
    ifk = (tenant.get('solaIFieldsKey') or '').strip()
    out['solaIFieldsKeyLast4']    = ifk[-4:] if len(ifk) >= 4 else ''
    out['solaIFieldsKeyConfigured'] = bool(ifk)
    return respond(200, out)


def get_logo_upload_url(body):
    """Admin-only: returns a 5-minute presigned PUT URL locked to
    `tenants/{tenantId}/logo.<ext>`. Returns the chosen S3 key so the
    frontend can persist it on the tenant row via PUT /tenants/me."""
    if not _is_admin():
        return _forbid()
    tenant_id = _require_tenant()
    content_type = (body or {}).get('contentType', 'image/png')
    ct = content_type.lower()
    if 'jpeg' in ct or 'jpg' in ct:
        ext = 'jpg'
    elif 'svg' in ct:
        ext = 'svg'
    elif 'webp' in ct:
        ext = 'webp'
    else:
        ext = 'png'
    key = f'tenants/{tenant_id}/logo.{ext}'
    try:
        url = s3.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': TENANT_ASSETS_BUCKET,
                'Key': key,
                'ContentType': content_type,
            },
            ExpiresIn=300,
        )
    except Exception as e:
        return respond(500, {'error': f'Failed to issue presigned URL: {e}'})
    return respond(200, {'uploadUrl': url, 'logoS3Key': key, 'contentType': content_type})


def update_tenant_me(body):
    """Admin-only: update the caller's tenant row. Only fields in
    _TENANT_ADMIN_EDITABLE are accepted; everything else is silently
    dropped so a tampered request can't promote itself or rewrite a
    field that's supposed to be platform-owned."""
    if not _is_admin():
        return _forbid()
    tenant_id = _require_tenant()
    updates = {k: v for k, v in (body or {}).items() if k in _TENANT_ADMIN_EDITABLE}
    # Belt-and-braces for gateway credentials: an empty/whitespace value
    # from the frontend must NOT clear a working key. Saving the Branding
    # tab without re-typing the keys is the common case, so the inputs
    # would naturally submit blank. Drop blanks here so the existing keys
    # are preserved; only an explicit "__CLEAR__" sentinel actually unsets.
    for secret in ('solaXKey', 'solaIFieldsKey'):
        if secret in updates:
            v = (str(updates[secret]) or '').strip()
            if not v:
                updates.pop(secret, None)
            elif v == '__CLEAR__':
                updates[secret] = ''
            else:
                updates[secret] = v

    # Sola xKey lives in SSM Parameter Store SecureString, never in
    # DynamoDB. Handle it out-of-band so the plaintext key never appears
    # in the regular update_item write.
    if 'solaXKey' in updates:
        new_xkey = updates.pop('solaXKey')
        try:
            _put_tenant_sola_xkey(tenant_id, new_xkey)
        except Exception as e:
            return respond(500, {'error': f'Failed to store xKey: {e}'})

    if not updates:
        # The xKey-only update path doesn't need a tenants_table.update_item
        # call (handled above), so just return the fresh tenant view.
        return get_tenant_me()
    expr_parts, expr_names, expr_values = [], {}, {}
    for k, v in updates.items():
        safe = f"#{k}"
        expr_names[safe] = k
        expr_parts.append(f"{safe} = :{k}")
        expr_values[f":{k}"] = v
    actor = _get_actor()
    for k, v in {'modifiedBy': actor['email'] or 'unknown', 'modifiedByRole': actor['role'] or '', 'modifiedAt': _now_iso()}.items():
        safe = f"#{k}"
        expr_names[safe] = k
        expr_parts.append(f"{safe} = :{k}")
        expr_values[f":{k}"] = v
    tenants_table.update_item(
        Key={'tenantId': tenant_id},
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    _bust_tenant_cache(tenant_id)
    # Return the updated public view so the frontend can re-apply branding
    # without a separate refetch.
    return get_tenant_me()


def get_tenant_payment_config():
    """Public-to-the-tenant bootstrap data for the Sola iFrame + receipts.
    Available to any authenticated user in the tenant. NEVER includes xKey
    or any private credential."""
    tenant_id = _require_tenant()
    tenant = _load_tenant(tenant_id) or {}
    return respond(200, {
        'tenantId': tenant_id,
        'iFieldsKey': tenant.get('solaIFieldsKey', '') or '',
        'softwareName': tenant.get('solaSoftwareName', '') or SOLA_SOFTWARE_NAME,
        'softwareVersion': tenant.get('solaSoftwareVersion', '') or SOLA_SOFTWARE_VERSION,
        'displayName': tenant.get('displayName', '') or 'Member Portal',
    })


# Warm-container cache for resolved Sola xKeys. SSM costs are tiny but
# Lambda cold starts already pay ~30ms for a single GetParameter; we
# avoid it for the rest of the container's life by caching post-resolve.
# Bust on writes.
_xkey_cache = {}


def _xkey_ssm_name(tenant_id):
    return f'{SSM_TENANT_PREFIX}/{tenant_id}/solaXKey'


def _get_tenant_sola_xkey(tenant_id):
    """Resolve the tenant's Sola xKey from SSM Parameter Store SecureString.
    Auto-migrates legacy values still living on the stcd_tenants row to
    SSM the first time we resolve them, then clears the plaintext from
    DynamoDB so it never sits there again. Cached for the warm container.
    Returns '' if no key is configured anywhere."""
    if not tenant_id:
        return ''
    cached = _xkey_cache.get(tenant_id)
    if cached is not None:
        return cached
    name = _xkey_ssm_name(tenant_id)
    try:
        v = ssm.get_parameter(Name=name, WithDecryption=True).get('Parameter', {}).get('Value', '')
        if v:
            _xkey_cache[tenant_id] = v
            return v
    except ssm.exceptions.ParameterNotFound:
        pass
    except Exception as e:
        print(f'[xkey] SSM read failed for {tenant_id}: {e}')
    # Fall back to legacy plaintext on the DynamoDB row, migrate on first read.
    tenant = _load_tenant(tenant_id) or {}
    legacy_key = (tenant.get('solaXKey') or '').strip()
    if not legacy_key:
        _xkey_cache[tenant_id] = ''
        return ''
    try:
        ssm.put_parameter(
            Name=name, Value=legacy_key, Type='SecureString', Overwrite=True,
            Description=f'Sola merchant xKey for tenant {tenant_id}',
        )
        # Clear the plaintext from DynamoDB; keep the last-4 + configured
        # flag so the Settings UI hint still works without the secret.
        tenants_table.update_item(
            Key={'tenantId': tenant_id},
            UpdateExpression='SET solaXKey = :empty, solaXKeyLast4 = :l4, solaXKeyConfigured = :c',
            ExpressionAttributeValues={':empty': '', ':l4': legacy_key[-4:], ':c': True},
        )
        _bust_tenant_cache(tenant_id)
        print(json.dumps({'level': 'info', 'event': 'sola_xkey_migrated_to_ssm', 'tenantId': tenant_id}))
    except Exception as e:
        # Migration failure shouldn't break charges — use the legacy value
        # this call and retry on the next cold container.
        print(f'[xkey] migration to SSM failed for {tenant_id}: {e}')
    _xkey_cache[tenant_id] = legacy_key
    return legacy_key


def _put_tenant_sola_xkey(tenant_id, new_key):
    """Write or rotate the tenant's xKey. Stores in SSM only; the
    DynamoDB row gets the last-4 + configured-flag hint. Empty string
    deletes the parameter (admin explicitly unsetting the credential)."""
    name = _xkey_ssm_name(tenant_id)
    if new_key:
        ssm.put_parameter(
            Name=name, Value=new_key, Type='SecureString', Overwrite=True,
            Description=f'Sola merchant xKey for tenant {tenant_id}',
        )
        tenants_table.update_item(
            Key={'tenantId': tenant_id},
            UpdateExpression='SET solaXKey = :empty, solaXKeyLast4 = :l4, solaXKeyConfigured = :c',
            ExpressionAttributeValues={':empty': '', ':l4': new_key[-4:], ':c': True},
        )
    else:
        try:
            ssm.delete_parameter(Name=name)
        except ssm.exceptions.ParameterNotFound:
            pass
        tenants_table.update_item(
            Key={'tenantId': tenant_id},
            UpdateExpression='SET solaXKey = :empty, solaXKeyLast4 = :empty, solaXKeyConfigured = :c',
            ExpressionAttributeValues={':empty': '', ':c': False},
        )
    _xkey_cache.pop(tenant_id, None)
    _bust_tenant_cache(tenant_id)


def _sola_post(payload):
    """POST to the Sola Transaction API using the current tenant's credentials.
    Returns (ok, response_dict).

    Each tenant brings their own Sola merchant account, so xKey, gateway URL,
    and softwareName/Version are resolved from the `stcd_tenants` row (with
    Lambda-env defaults retained as last-resort fallbacks for solaGatewayUrl,
    softwareName, softwareVersion only — never for xKey, which MUST come from
    the tenant row or the call fails closed)."""
    tenant_id = _require_tenant()
    tenant = _load_tenant(tenant_id) or {}
    x_key = _get_tenant_sola_xkey(tenant_id)
    if not x_key:
        return False, {'xResult': 'E', 'xError': f'Tenant {tenant_id} has no Sola xKey configured', 'xErrorCode': 'CONFIG'}
    gateway_url = (tenant.get('solaGatewayUrl') or '').strip() or SOLA_GATEWAY_URL
    software_name = (tenant.get('solaSoftwareName') or '').strip() or SOLA_SOFTWARE_NAME
    software_version = (tenant.get('solaSoftwareVersion') or '').strip() or SOLA_SOFTWARE_VERSION

    body = {
        'xKey': x_key,
        'xVersion': SOLA_API_VERSION,
        'xSoftwareName': software_name,
        'xSoftwareVersion': software_version,
    }
    body.update(payload)

    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        gateway_url,
        data=data,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8') if e.fp else ''
        print(f"[sola] HTTPError {e.code}: {raw}")
        return False, {'xResult': 'E', 'xError': f'HTTP {e.code}', 'xErrorCode': str(e.code), 'raw': raw}
    except Exception as e:
        print(f"[sola] request failed: {e}")
        return False, {'xResult': 'E', 'xError': str(e), 'xErrorCode': 'NETWORK'}

    try:
        resp = json.loads(raw)
    except ValueError:
        print(f"[sola] non-JSON response: {raw}")
        return False, {'xResult': 'E', 'xError': 'Invalid response from gateway', 'raw': raw}

    ok = resp.get('xResult') == 'A'
    return ok, resp


# ===== Payment methods helpers =====
# v2 schema fixes the long-standing Number-vs-String memberId mismatch by
# using a synthesised composite `memberIdPaymentMethodId` range key (always
# String).


def _pm_v2_range_key(member_id, payment_method_id):
    return f"{member_id}#{payment_method_id}"


def _pm_get(member_id, payment_method_id):
    tenant_id = _require_tenant()
    res = payment_methods_table_v2.get_item(Key={
        'tenantId': tenant_id,
        'memberIdPaymentMethodId': _pm_v2_range_key(member_id, payment_method_id),
    })
    return res.get('Item')


def _pm_list_for_member(member_id):
    tenant_id = _require_tenant()
    res = payment_methods_table_v2.query(
        KeyConditionExpression=Key('tenantId').eq(tenant_id) & Key('memberIdPaymentMethodId').begins_with(f"{member_id}#"),
    )
    return res.get('Items', [])


def _pm_put(item):
    """item carries memberId + paymentMethodId."""
    tenant_id = _require_tenant()
    member_id = str(item.get('memberId', ''))
    payment_method_id = item.get('paymentMethodId', '')
    v2_item = {**item,
               'memberId': member_id,                       # always String in v2
               'tenantId': tenant_id,
               'memberIdPaymentMethodId': _pm_v2_range_key(member_id, payment_method_id)}
    payment_methods_table_v2.put_item(Item=v2_item)


def _pm_update(member_id, payment_method_id, **kwargs):
    tenant_id = _require_tenant()
    payment_methods_table_v2.update_item(
        Key={'tenantId': tenant_id, 'memberIdPaymentMethodId': _pm_v2_range_key(member_id, payment_method_id)},
        **kwargs,
    )


def _pm_delete(member_id, payment_method_id):
    tenant_id = _require_tenant()
    payment_methods_table_v2.delete_item(Key={
        'tenantId': tenant_id,
        'memberIdPaymentMethodId': _pm_v2_range_key(member_id, payment_method_id),
    })


def _detect_brand(masked):
    """Best-effort brand from masked PAN. Sola also returns xCardType but we double-check."""
    if not masked:
        return ''
    digits = ''.join(c for c in masked if c.isdigit())
    if not digits:
        return ''
    first = digits[0]
    first2 = digits[:2] if len(digits) >= 2 else ''
    if first == '4':
        return 'Visa'
    if first2 in ('51', '52', '53', '54', '55') or (first2 and 22 <= int(first2 or 0) <= 27):
        return 'Mastercard'
    if first2 in ('34', '37'):
        return 'Amex'
    if digits.startswith('6011') or first2 == '65':
        return 'Discover'
    return ''


def create_payment_method(body):
    """
    Save a card on file. Body:
      { memberId, xCardNum, xExp, [xCVV], [xName], [xZip], [setAsDefault] }
    xCardNum and xCVV should be SUTs from iFields.
    """
    member_id = body.get('memberId')
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    sut_card = body.get('xCardNum') or ''
    exp = (body.get('xExp') or '').strip()
    sut_cvv = body.get('xCVV') or ''
    name = body.get('xName') or ''
    zip_code = body.get('xZip') or ''
    set_default = bool(body.get('setAsDefault'))

    if not member_id or not sut_card or not exp:
        return respond(400, {'error': 'memberId, xCardNum (SUT) and xExp are required'})

    # Tokenize via Sola cc:save (no funds moved; just stores card and returns xToken)
    sola_payload = {
        'xCommand': 'cc:save',
        'xCardNum': sut_card,
        'xExp': exp,
    }
    if sut_cvv:
        sola_payload['xCVV'] = sut_cvv
    if name:
        sola_payload['xName'] = name
    if zip_code:
        sola_payload['xBillZip'] = zip_code

    ok, resp = _sola_post(sola_payload)
    if not ok:
        return respond(400, {
            'error': resp.get('xError', 'Failed to save card'),
            'errorCode': resp.get('xErrorCode'),
            'gatewayRefNum': resp.get('xRefNum'),
        })

    x_token = resp.get('xToken') or ''
    masked = resp.get('xMaskedCardNumber') or ''
    brand = resp.get('xCardType') or _detect_brand(masked)
    last4 = ''.join(c for c in masked if c.isdigit())[-4:]

    if not x_token:
        # Don't echo the full gateway response — log it for ops, return a
        # safe message to the client.
        print(f"[sola] cc:save returned no xToken: {resp}")
        return respond(502, {'error': 'Card vault rejected the card. Please try again.'})

    payment_method_id = f"pm_{uuid.uuid4().hex[:12]}"

    # If this member is setting a new default, clear other defaults
    if set_default:
        _clear_default_payment_methods(member_id)

    actor = _actor_stamp_create()
    item = {
        'memberId': str(member_id),
        'paymentMethodId': payment_method_id,
        'xToken': x_token,
        'maskedCardNumber': masked,
        'last4': last4,
        'cardBrand': brand,
        'expMonth': exp[:2],
        'expYear': exp[2:],
        'cardholderName': name,
        'zip': zip_code,
        'isDefault': set_default,
        # Existing field uses unix epoch; we keep it for back-compat. The ISO
        # createdAt and createdBy come from the actor stamp.
        'createdAtEpoch': int(time.time()),
        **actor,
    }
    item = {k: v for k, v in item.items() if v not in ('', None)}
    _pm_put(item)

    return respond(200, {
        'paymentMethodId': payment_method_id,
        'maskedCardNumber': masked,
        'last4': last4,
        'cardBrand': brand,
        'expMonth': exp[:2],
        'expYear': exp[2:],
        'isDefault': set_default,
        'gatewayRefNum': resp.get('xRefNum'),
    })


def list_payment_methods(member_id):
    """Return all saved cards for a member, freshest first."""
    if not member_id:
        return respond(400, {'error': 'memberId required'})
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()
    items = _pm_list_for_member(member_id)
    # Strip the actual token from the response — frontend never sees it
    safe = []
    for it in items:
        safe.append({
            'paymentMethodId': it.get('paymentMethodId'),
            'maskedCardNumber': it.get('maskedCardNumber'),
            'last4': it.get('last4'),
            'cardBrand': it.get('cardBrand'),
            'expMonth': it.get('expMonth'),
            'expYear': it.get('expYear'),
            'cardholderName': it.get('cardholderName', ''),
            'isDefault': bool(it.get('isDefault', False)),
            'createdAt': it.get('createdAt'),
        })
    safe.sort(key=lambda x: (not x['isDefault'], -(x.get('createdAt') or 0)))
    return respond(200, {'paymentMethods': safe})


def delete_payment_method(body):
    """Delete a saved card. Body: { memberId, paymentMethodId }."""
    member_id = body.get('memberId')
    payment_method_id = body.get('paymentMethodId')
    if not member_id or not payment_method_id:
        return respond(400, {'error': 'memberId and paymentMethodId are required'})
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()

    # Look up the card so we can write an audit row before erasing it.
    pm = _pm_get(member_id, payment_method_id) or {}

    # Audit log: a 'card-deleted' txn with no balance impact, stamped with
    # the actor and a snapshot of the (non-sensitive) card metadata. The
    # xToken itself is dropped — only brand/last4/exp are preserved for
    # forensics. PITR on stcd_payment_methods provides 35-day undo.
    today = time.strftime('%Y-%m-%d', time.gmtime())
    audit_txn = {
        'memberId': str(member_id),
        'transactionId': f"AUDIT#{today}#{uuid.uuid4().hex[:8]}",
        'date': today,
        'txnDate': today,
        'yearMonth': today[:7],
        'description': f"Saved card removed: {pm.get('cardBrand', 'Card')} •••• {pm.get('last4', '')}".strip(),
        'amount': Decimal('0'),
        'paymentType': 'card-deleted',
        'cardLast4': pm.get('last4', ''),
        'cardBrand': pm.get('cardBrand', ''),
        'paymentMethodId': payment_method_id,
        **_actor_stamp_create(),
    }
    audit_txn = {k: v for k, v in audit_txn.items() if v not in ('', None)}
    try:
        _txn_put(audit_txn)
    except Exception as e:
        print(f"[card-delete] audit log failed: {e}")

    _pm_delete(member_id, payment_method_id)
    return respond(200, {'message': 'Payment method removed'})


def _clear_default_payment_methods(member_id):
    for it in _pm_list_for_member(member_id):
        if it.get('isDefault'):
            _pm_update(
                member_id, it['paymentMethodId'],
                UpdateExpression='SET isDefault = :f',
                ExpressionAttributeValues={':f': False},
            )


def charge_saved_card(body):
    """
    Charge a card. Two modes:

      A) Saved card: { memberId, paymentMethodId, amount, ... }
      B) One-off card: { memberId, xCardNum (SUT), xExp, [xCVV (SUT)], [xName], [xZip], amount, [saveOnSuccess: true] }

    Optional metadata persisted on the transaction record:
      paymentType, description, invoice, source, category, pledgeId, productId, alias, groupId

    Optional flags:
      skipRecord:  true -> don't write to stcd_transactions (caller will do its own bookkeeping)
      saveOnSuccess: true (mode B only) -> also persist as a saved payment method on success
    """
    member_id = body.get('memberId')
    if not (_is_admin() or _is_self(member_id)):
        return _forbid()

    # Idempotency: atomically claim the key BEFORE we touch Sola so a concurrent
    # double-click can't charge the card twice. The first request wins the
    # claim and proceeds to charge; later duplicates wait briefly for the
    # winner's result and return it verbatim.
    idempotency_key = body.get('idempotencyKey') or ''
    if idempotency_key:
        claimed, prior = _claim_charge_idempotency(str(member_id), idempotency_key)
        if not claimed:
            if prior and prior.get('result'):
                try:
                    return respond(200, {**json.loads(prior['result']), 'idempotent': True})
                except Exception:
                    pass
            # Couldn't read the winner's result — refuse rather than risk a
            # second charge.
            return respond(409, {'error': 'Duplicate request still in flight. Please retry shortly.'})

    amount = body.get('amount')
    payment_method_id = body.get('paymentMethodId') or ''
    sut_card = body.get('xCardNum') or ''
    sut_cvv = body.get('xCVV') or ''
    exp = (body.get('xExp') or '').strip()
    name = body.get('xName') or ''
    zip_code = body.get('xZip') or ''
    save_on_success = bool(body.get('saveOnSuccess'))
    skip_record = bool(body.get('skipRecord'))

    # Metadata for txn record (mode A or mode B)
    payment_type = body.get('paymentType') or 'card-on-file'
    description = body.get('description') or ''
    invoice = body.get('invoice') or ''
    source = body.get('source') or ''
    category = body.get('category') or ''
    pledge_id = body.get('pledgeId') or ''
    product_id = body.get('productId') or ''
    alias = body.get('alias') or ''
    group_id = body.get('groupId') or ''
    # `settlesTxnId` lets an admin pay an outstanding fee row (e.g. sponsorship-fee)
    # by card — the resulting payment row points back at the fee so the
    # settled-fee matcher in AdminPledges sees it as paid.
    settles_txn_id = body.get('settlesTxnId') or ''

    # Common validation
    if not member_id or amount is None:
        return respond(400, {'error': 'memberId and amount are required'})
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return respond(400, {'error': 'amount must be a number'})
    if amount <= 0:
        return respond(400, {'error': 'amount must be > 0'})
    if not payment_method_id and not sut_card:
        return respond(400, {'error': 'Provide either paymentMethodId or xCardNum (SUT)'})

    key_value = int(member_id) if str(member_id).isdigit() else member_id

    # Build the Sola request based on mode
    sola_payload = {
        'xCommand': 'cc:sale',
        'xAmount': f"{amount:.2f}",
    }
    if invoice:
        sola_payload['xInvoice'] = invoice
    if description:
        sola_payload['xDescription'] = description

    pm = None  # filled in mode A
    if payment_method_id:
        # ---------- Mode A: saved card ----------
        pm = _pm_get(member_id, payment_method_id)
        if not pm:
            return respond(404, {'error': 'Payment method not found for this member'})
        sola_payload['xToken'] = pm['xToken']
        if sut_cvv:  # Optional fresh CVV re-prompt for higher-value charges
            sola_payload['xCVV'] = sut_cvv
    else:
        # ---------- Mode B: one-off card via SUT ----------
        if not exp or len(exp) < 4:
            return respond(400, {'error': 'xExp (MMYY) is required for one-off card charges'})
        sola_payload['xCardNum'] = sut_card
        sola_payload['xExp'] = exp
        if sut_cvv:
            sola_payload['xCVV'] = sut_cvv
        if name:
            sola_payload['xName'] = name
        if zip_code:
            sola_payload['xBillZip'] = zip_code

    ok, resp = _sola_post(sola_payload)

    # If mode B and saveOnSuccess and the sale approved, persist the returned multi-use token
    saved_payment_method_id = None
    if ok and save_on_success and not payment_method_id:
        x_token = resp.get('xToken') or ''
        masked = resp.get('xMaskedCardNumber') or ''
        last4 = ''.join(c for c in masked if c.isdigit())[-4:]
        brand = resp.get('xCardType') or _detect_brand(masked)
        if x_token:
            saved_payment_method_id = f"pm_{uuid.uuid4().hex[:12]}"
            item = {
                'memberId': str(member_id),
                'paymentMethodId': saved_payment_method_id,
                'xToken': x_token,
                'maskedCardNumber': masked,
                'last4': last4,
                'cardBrand': brand,
                'expMonth': exp[:2],
                'expYear': exp[2:],
                'cardholderName': name,
                'zip': zip_code,
                'isDefault': False,
                'createdAt': int(time.time()),
            }
            item = {k: v for k, v in item.items() if v not in ('', None)}
            try:
                _pm_put(item)
            except Exception as e:
                print(f"[charge] failed to persist new payment method: {e}")
                saved_payment_method_id = None

    # Compute brand/last4 for the txn record (works in both modes)
    if pm:
        last4_for_record = pm.get('last4', '')
        brand_for_record = pm.get('cardBrand', '')
    else:
        masked = resp.get('xMaskedCardNumber') or ''
        last4_for_record = ''.join(c for c in masked if c.isdigit())[-4:]
        brand_for_record = resp.get('xCardType') or _detect_brand(masked)

    # Record the charge unless caller asked us not to
    txn_record = None
    if not skip_record:
        # stcd_transactions uses memberId as STRING; stcd_payment_methods uses NUMBER. Coerce per table.
        txn_record = {
            'memberId': str(member_id),
            'transactionId': f"TXN#{time.strftime('%Y-%m-%d', time.gmtime())}#{uuid.uuid4().hex[:8]}",
            'date': time.strftime('%Y-%m-%d', time.gmtime()),
            'txnDate': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'yearMonth': time.strftime('%Y-%m', time.gmtime()),
            'amount': Decimal(str(round(amount, 2))),
            'method': 'card',
            'paymentType': payment_type,
            'description': description,
            'invoice': invoice,
            'source': source,
            'category': category,
            'pledgeId': pledge_id,
            'productId': product_id,
            'alias': alias,
            'groupId': group_id,
            'settlesTxnId': settles_txn_id,
            'paymentMethodId': payment_method_id or saved_payment_method_id or '',
            'cardLast4': last4_for_record,
            'cardBrand': brand_for_record,
            'gatewayRefNum': resp.get('xRefNum', ''),
            'gatewayAuthCode': resp.get('xAuthCode', ''),
            'gatewayResult': resp.get('xResult', ''),
            'gatewayStatus': resp.get('xStatus', ''),
            'gatewayError': resp.get('xError', ''),
            'gatewayErrorCode': resp.get('xErrorCode', ''),
            'idempotencyKey': idempotency_key,
            **_actor_stamp_create(),
        }
        # On decline/gateway error: mark the row canceled so it stays visible
        # in the ledger as an audit trail but doesn't contribute to the member's
        # account balance or any linked pledge's paidAmount.
        if not ok:
            actor = _get_actor()
            now = _now_iso()
            txn_record['canceled'] = True
            txn_record['cancellationReason'] = f"Declined: {resp.get('xError') or 'Charge declined'}"
            txn_record['canceledBy'] = actor['email'] or 'system'
            txn_record['canceledByRole'] = actor['role'] or 'system'
            txn_record['canceledByMemberId'] = actor['memberId'] or ''
            txn_record['canceledAt'] = now
        txn_record = {k: v for k, v in txn_record.items() if v not in ('', None)}
        try:
            _txn_put(txn_record)
        except Exception as e:
            print(f"[charge] failed to record txn: {e}")

        # When this charge is a pledge payment linked to a specific pledge,
        # mirror the create_transaction flow so the pledge row's paidAmount
        # increments (and `paid` flips when fully covered).
        if ok and pledge_id and payment_type == 'pledge':
            try:
                _apply_pledge_payment(str(member_id), pledge_id, Decimal(str(round(amount, 2))), 'card')
            except Exception as e:
                print(f"[charge] failed to apply pledge payment: {e}")

    if not ok:
        decline_payload = {
            'success': False,
            'error': resp.get('xError', 'Charge declined'),
            'errorCode': resp.get('xErrorCode'),
            'gatewayRefNum': resp.get('xRefNum'),
            'gatewayResult': resp.get('xResult'),
        }
        # Stamp the claim row with the failure so duplicate retries see the
        # same decline rather than re-charging.
        _finish_charge_idempotency(str(member_id), idempotency_key, decline_payload, status='failed')
        return respond(402, decline_payload)

    success_payload = {
        'success': True,
        'gatewayRefNum': resp.get('xRefNum'),
        'authCode': resp.get('xAuthCode'),
        'amount': amount,
        'last4': last4_for_record,
        'cardBrand': brand_for_record,
        'transactionId': (txn_record or {}).get('transactionId'),
        'savedPaymentMethodId': saved_payment_method_id,
    }
    _finish_charge_idempotency(str(member_id), idempotency_key, success_payload)
    return respond(200, success_payload)
