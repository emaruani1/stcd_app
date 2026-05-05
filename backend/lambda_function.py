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
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
cognito = boto3.client('cognito-idp')
members_table = dynamodb.Table(os.environ.get('MEMBERS_TABLE', 'stcd_members'))
transactions_table = dynamodb.Table(os.environ.get('TRANSACTIONS_TABLE', 'stcd_transactions'))
pledges_table = dynamodb.Table(os.environ.get('PLEDGES_TABLE', 'stcd_pledges'))
sponsorships_table = dynamodb.Table(os.environ.get('SPONSORSHIPS_TABLE', 'stcd_sponsorships'))
emails_table = dynamodb.Table(os.environ.get('EMAILS_TABLE', 'stcd_emails'))
settings_table = dynamodb.Table(os.environ.get('SETTINGS_TABLE', 'stcd_settings'))
payment_methods_table = dynamodb.Table(os.environ.get('PAYMENT_METHODS_TABLE', 'stcd_payment_methods'))
COGNITO_POOL_ID = os.environ.get('COGNITO_POOL_ID', 'us-east-2_Pna4Sv1p8')

# Sola / FideliPay
SOLA_X_KEY = os.environ.get('SOLA_X_KEY', '')
SOLA_GATEWAY_URL = os.environ.get('SOLA_GATEWAY_URL', 'https://x1.cardknox.com/gatewayjson')
SOLA_SOFTWARE_NAME = os.environ.get('SOLA_SOFTWARE_NAME', 'STCD-App')
SOLA_SOFTWARE_VERSION = os.environ.get('SOLA_SOFTWARE_VERSION', '1.0.0')
SOLA_API_VERSION = '5.0.0'

ALLOWED_ORIGINS = [
    'https://main.dvy7odxzbdj95.amplifyapp.com',
]


def _origin_allowed(origin):
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    # Allow any localhost / 127.0.0.1 port in dev
    if origin.startswith('http://localhost:') or origin.startswith('http://127.0.0.1:'):
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


def respond(status, body):
    return {
        'statusCode': status,
        'headers': get_cors_headers(_current_event),
        'body': json.dumps(body, default=_json_default),
    }


def parse_body(event):
    body = event.get('body', '{}')
    if isinstance(body, str):
        return json.loads(body) if body else {}
    return body or {}


def extract_path_id(path, prefix):
    """Extract the ID segment after a prefix. e.g. '/members/779' with prefix '/members/' -> '779'"""
    rest = path[len(prefix):]
    return rest.split('/')[0] if rest else None


def lambda_handler(event, context):
    global _current_event
    _current_event = event

    method = event.get('httpMethod', '')
    path = event.get('path', '')

    if method == 'OPTIONS':
        return respond(200, {'message': 'ok'})

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
        if path.startswith('/members/') and method == 'PUT':
            return update_member(extract_path_id(path, '/members/'), parse_body(event))

        # ===== TRANSACTIONS =====
        if path == '/transactions' and method == 'GET':
            return get_transactions(event)
        if path.startswith('/transactions/member/') and method == 'GET':
            member_id = path.split('/transactions/member/')[1]
            return get_member_transactions(member_id, event)
        if path == '/transactions' and method == 'POST':
            return create_transaction(parse_body(event))
        if path.startswith('/transactions/') and method == 'PUT':
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
        print(f"Error: {e}")
        return respond(500, {'error': str(e)})


# ===================== MEMBERS =====================

def get_members(event):
    qs = event.get('queryStringParameters') or {}
    result = members_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = members_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])

    # Sort by lastName, firstName
    items.sort(key=lambda x: (x.get('lastName', '').lower(), x.get('firstName', '').lower()))
    return respond(200, items)


def get_member(member_id):
    result = members_table.get_item(Key={'memberId': member_id})
    item = result.get('Item')
    if not item:
        return respond(404, {'error': 'Member not found'})
    return respond(200, item)


def create_member(body):
    member_id = body.get('memberId', str(uuid.uuid4())[:8])
    body['memberId'] = member_id
    body['balance'] = Decimal(str(body.get('balance', 0)))
    members_table.put_item(Item=body)
    return respond(201, body)


def update_member(member_id, body):
    # First fetch existing member to avoid overwriting with empty values
    existing = members_table.get_item(Key={'memberId': member_id}).get('Item', {})

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

    members_table.update_item(
        Key={'memberId': member_id},
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    return respond(200, {'message': 'Member updated', 'memberId': member_id})


def merge_members(body):
    primary_id = body['primaryId']
    secondary_id = body['secondaryId']
    field_values = body.get('fieldValues', {})

    primary = members_table.get_item(Key={'memberId': primary_id}).get('Item', {})
    secondary = members_table.get_item(Key={'memberId': secondary_id}).get('Item', {})

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
    members_table.put_item(Item=primary)

    # Move secondary's transactions to primary
    sec_txns = transactions_table.query(KeyConditionExpression=Key('memberId').eq(secondary_id))
    for txn in sec_txns.get('Items', []):
        transactions_table.delete_item(Key={'memberId': secondary_id, 'transactionId': txn['transactionId']})
        txn['memberId'] = primary_id
        transactions_table.put_item(Item=txn)

    # Move secondary's pledges to primary
    sec_pledges = pledges_table.query(KeyConditionExpression=Key('memberId').eq(secondary_id))
    for plg in sec_pledges.get('Items', []):
        pledges_table.delete_item(Key={'memberId': secondary_id, 'pledgeId': plg['pledgeId']})
        plg['memberId'] = primary_id
        pledges_table.put_item(Item=plg)

    # Delete secondary member
    members_table.delete_item(Key={'memberId': secondary_id})

    return respond(200, {'message': 'Members merged', 'memberId': primary_id})


# ===================== TRANSACTIONS =====================

def get_transactions(event):
    qs = event.get('queryStringParameters') or {}

    # If yearMonth provided, use GSI
    year_month = qs.get('yearMonth')
    if year_month:
        result = transactions_table.query(
            IndexName='date-index',
            KeyConditionExpression=Key('yearMonth').eq(year_month),
        )
        return respond(200, result['Items'])

    # Otherwise scan all
    result = transactions_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = transactions_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])

    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def get_member_transactions(member_id, event):
    result = transactions_table.query(
        KeyConditionExpression=Key('memberId').eq(member_id),
    )
    items = result['Items']
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_transaction(body):
    member_id = body['memberId']
    date = body.get('date', '')
    txn_id = f"TXN#{date}#{uuid.uuid4().hex[:8]}"
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
    }
    # Clean empty strings
    item = {k: v for k, v in item.items() if v != '' or k in ('memberId', 'transactionId', 'date')}

    transactions_table.put_item(Item=item)

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
        members_table.update_item(
            Key={'memberId': str(member_id)},
            UpdateExpression='SET balance = if_not_exists(balance, :zero) + :d',
            ExpressionAttributeValues={':zero': Decimal('0'), ':d': delta},
        )
    except Exception as e:
        print(f"[balance] failed to adjust member {member_id} by {delta}: {e}")


def update_transaction(body):
    member_id = body['memberId']
    txn_id = body['transactionId']

    existing = transactions_table.get_item(Key={'memberId': member_id, 'transactionId': txn_id}).get('Item', {})

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

    if expr_parts:
        transactions_table.update_item(
            Key={'memberId': member_id, 'transactionId': txn_id},
            UpdateExpression='SET ' + ', '.join(expr_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )

    return respond(200, {'message': 'Transaction updated'})


def delete_transaction(body):
    member_id = body['memberId']
    txn_id = body['transactionId']
    transactions_table.delete_item(Key={'memberId': member_id, 'transactionId': txn_id})
    return respond(200, {'message': 'Transaction deleted'})


# ===================== PLEDGES =====================

def get_pledges(event):
    result = pledges_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = pledges_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def get_member_pledges(member_id):
    result = pledges_table.query(
        KeyConditionExpression=Key('memberId').eq(member_id),
    )
    items = result['Items']
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_pledge(body):
    member_id = body['memberId']
    date = body.get('date', '')
    pledge_id = f"PLG#{date}#{uuid.uuid4().hex[:8]}"

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
    }

    pledges_table.put_item(Item=item)
    return respond(201, item)


def update_pledge(body):
    member_id = body['memberId']
    pledge_id = body['pledgeId']

    existing = pledges_table.get_item(Key={'memberId': member_id, 'pledgeId': pledge_id}).get('Item', {})

    update_fields = {k: v for k, v in body.items() if k not in ('memberId', 'pledgeId')}
    if 'amount' in update_fields:
        update_fields['amount'] = Decimal(str(update_fields['amount']))
    if 'paidAmount' in update_fields:
        update_fields['paidAmount'] = Decimal(str(update_fields['paidAmount']))

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

    if expr_parts:
        pledges_table.update_item(
            Key={'memberId': member_id, 'pledgeId': pledge_id},
            UpdateExpression='SET ' + ', '.join(expr_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )

    return respond(200, {'message': 'Pledge updated'})


def pay_pledge(body):
    """Record a payment against a pledge. Creates a transaction and updates the pledge."""
    member_id = body['memberId']
    pledge_id = body['pledgeId']
    amount = Decimal(str(body.get('amount', 0)))
    method = body.get('method', '')
    date = body.get('date', '')

    # Get current pledge
    result = pledges_table.get_item(Key={'memberId': member_id, 'pledgeId': pledge_id})
    pledge = result.get('Item')
    if not pledge:
        return respond(404, {'error': 'Pledge not found'})

    new_paid = pledge.get('paidAmount', Decimal('0')) + amount
    is_fully_paid = new_paid >= pledge.get('amount', Decimal('0'))

    # Update pledge
    pledges_table.update_item(
        Key={'memberId': member_id, 'pledgeId': pledge_id},
        UpdateExpression='SET paidAmount = :paid, paid = :isPaid, paymentMethod = :method',
        ExpressionAttributeValues={
            ':paid': new_paid,
            ':isPaid': is_fully_paid,
            ':method': method,
        },
    )

    # Create transaction record
    txn_id = f"TXN#{date}#{uuid.uuid4().hex[:8]}"
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
    }
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
    transactions_table.put_item(Item=txn)

    # If this pledge payment was funded (in part) by stored balance, deduct it
    if balance_applied > 0:
        _adjust_member_balance(member_id, -balance_applied)

    return respond(200, {'message': 'Payment recorded', 'pledge': {'paidAmount': new_paid, 'paid': is_fully_paid}, 'transaction': txn})


def delete_pledge(body):
    member_id = body['memberId']
    pledge_id = body['pledgeId']
    pledges_table.delete_item(Key={'memberId': member_id, 'pledgeId': pledge_id})
    return respond(200, {'message': 'Pledge deleted'})


def _apply_pledge_payment(member_id, pledge_id, amount, method):
    """Helper to apply a payment to a pledge when creating a transaction."""
    result = pledges_table.get_item(Key={'memberId': member_id, 'pledgeId': pledge_id})
    pledge = result.get('Item')
    if not pledge:
        return

    new_paid = pledge.get('paidAmount', Decimal('0')) + amount
    is_fully_paid = new_paid >= pledge.get('amount', Decimal('0'))

    pledges_table.update_item(
        Key={'memberId': member_id, 'pledgeId': pledge_id},
        UpdateExpression='SET paidAmount = :paid, paid = :isPaid, paymentMethod = :method',
        ExpressionAttributeValues={
            ':paid': new_paid,
            ':isPaid': is_fully_paid,
            ':method': method,
        },
    )


# ===================== SETTINGS =====================

def get_all_settings():
    result = settings_table.scan()
    items = result['Items']
    settings = {}
    for item in items:
        settings[item['settingKey']] = item.get('items', [])
    return respond(200, settings)


def get_setting(key):
    result = settings_table.get_item(Key={'settingKey': key})
    item = result.get('Item')
    if not item:
        return respond(404, {'error': f'Setting {key} not found'})
    return respond(200, item.get('items', []))


def update_setting(key, body):
    items = body.get('items', [])
    settings_table.put_item(Item={
        'settingKey': key,
        'items': items,
    })
    return respond(200, {'message': f'Setting {key} updated'})


# ===================== SPONSORSHIPS =====================

def get_sponsorships():
    result = sponsorships_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = sponsorships_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])
    items.sort(key=lambda x: x.get('dateKey', ''))
    return respond(200, items)


def update_sponsorship(date_key, body):
    """Update or create a sponsorship for a given Saturday date."""
    item = {'dateKey': date_key}
    if 'kiddush' in body:
        item['kiddush'] = body['kiddush']
    if 'seuda' in body:
        item['seuda'] = body['seuda']
    if 'blocked' in body:
        item['blocked'] = body['blocked']

    # Merge with existing
    existing = sponsorships_table.get_item(Key={'dateKey': date_key}).get('Item', {})
    existing.update(item)
    sponsorships_table.put_item(Item=existing)
    return respond(200, existing)


def delete_sponsorship(date_key, body):
    """Remove a kiddush or seuda booking, or unblock a date."""
    field = body.get('field')  # 'kiddush', 'seuda', or 'blocked'
    if not field:
        sponsorships_table.delete_item(Key={'dateKey': date_key})
        return respond(200, {'message': 'Sponsorship deleted'})

    # Remove just the specified field
    try:
        sponsorships_table.update_item(
            Key={'dateKey': date_key},
            UpdateExpression=f'REMOVE #{field}',
            ExpressionAttributeNames={f'#{field}': field},
        )
    except Exception:
        pass
    return respond(200, {'message': f'{field} removed'})


# ===================== EMAILS =====================

def get_emails():
    result = emails_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = emails_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_email(body):
    email_id = f"EML#{uuid.uuid4().hex[:12]}"
    item = {
        'emailId': email_id,
        'date': body.get('date', ''),
        'type': body.get('type', ''),
        'subject': body.get('subject', ''),
        'body': body.get('body', ''),
        'recipients': body.get('recipients', []),
        'memberIds': body.get('memberIds', []),
    }
    emails_table.put_item(Item=item)
    return respond(201, item)


# ===================== COGNITO USER MANAGEMENT =====================

def cognito_lookup_user(body):
    """Look up a Cognito user by email. Returns user info or {found: false}."""
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    try:
        # Try original case first, then lowercase fallback (Cognito filter is case-sensitive)
        users = []
        for attempt in [email, email.lower()]:
            result = cognito.list_users(
                UserPoolId=COGNITO_POOL_ID,
                Filter=f'email = "{attempt}"',
                Limit=1,
            )
            users = result.get('Users', [])
            if users:
                break
        if not users:
            return respond(200, {'found': False})
        u = users[0]
        attrs = {a['Name']: a['Value'] for a in u.get('Attributes', [])}
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
            Filter=f'email = "{attempt}"',
            Limit=1,
        )
        users = result.get('Users', [])
        if users:
            return users[0]['Username']
    return None


def cognito_create_user(body):
    """Create a Cognito user with the given email. Admin-only."""
    email = body.get('email', '').strip().lower()
    role = body.get('role', 'member')
    member_id = body.get('memberId', '')
    if not email:
        return respond(400, {'error': 'email is required'})
    try:
        result = cognito.admin_create_user(
            UserPoolId=COGNITO_POOL_ID,
            Username=email,
            UserAttributes=[
                {'Name': 'email', 'Value': email},
                {'Name': 'email_verified', 'Value': 'true'},
                {'Name': 'custom:custom:role', 'Value': role},
                {'Name': 'custom:custom:memberId', 'Value': str(member_id)},
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
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    try:
        cognito.admin_disable_user(UserPoolId=COGNITO_POOL_ID, Username=username)
        return respond(200, {'message': 'User disabled'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_enable_user(body):
    """Enable a Cognito user account."""
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
    try:
        cognito.admin_enable_user(UserPoolId=COGNITO_POOL_ID, Username=username)
        return respond(200, {'message': 'User enabled'})
    except Exception as e:
        return respond(500, {'error': str(e)})


def cognito_reset_password(body):
    """Force a password reset — sends a new temporary password via email."""
    email = body.get('email', '').strip()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
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
    email = body.get('email', '').strip().lower()
    if not email:
        return respond(400, {'error': 'email is required'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
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
    email = body.get('email', '').strip()
    role = body.get('role', 'member')
    if not email:
        return respond(400, {'error': 'email is required'})
    if role not in ('admin', 'member'):
        return respond(400, {'error': 'role must be admin or member'})
    username = _resolve_cognito_username(email)
    if not username:
        return respond(404, {'error': 'User not found'})
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

def _sola_post(payload):
    """POST to the Sola Transaction API. Returns (ok, response_dict)."""
    if not SOLA_X_KEY:
        return False, {'xResult': 'E', 'xError': 'SOLA_X_KEY is not configured', 'xErrorCode': 'CONFIG'}

    body = {
        'xKey': SOLA_X_KEY,
        'xVersion': SOLA_API_VERSION,
        'xSoftwareName': SOLA_SOFTWARE_NAME,
        'xSoftwareVersion': SOLA_SOFTWARE_VERSION,
    }
    body.update(payload)

    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        SOLA_GATEWAY_URL,
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
        return respond(502, {'error': 'Sola did not return a token', 'gateway': resp})

    payment_method_id = f"pm_{uuid.uuid4().hex[:12]}"

    # If this member is setting a new default, clear other defaults
    if set_default:
        _clear_default_payment_methods(member_id)

    item = {
        'memberId': int(member_id) if str(member_id).isdigit() else member_id,
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
        'createdAt': int(time.time()),
    }
    item = {k: v for k, v in item.items() if v not in ('', None)}
    payment_methods_table.put_item(Item=item)

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
    key_value = int(member_id) if str(member_id).isdigit() else member_id
    res = payment_methods_table.query(
        KeyConditionExpression=Key('memberId').eq(key_value)
    )
    items = res.get('Items', [])
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
    key_value = int(member_id) if str(member_id).isdigit() else member_id
    payment_methods_table.delete_item(Key={
        'memberId': key_value,
        'paymentMethodId': payment_method_id,
    })
    return respond(200, {'message': 'Payment method removed'})


def _clear_default_payment_methods(member_id):
    key_value = int(member_id) if str(member_id).isdigit() else member_id
    res = payment_methods_table.query(KeyConditionExpression=Key('memberId').eq(key_value))
    for it in res.get('Items', []):
        if it.get('isDefault'):
            payment_methods_table.update_item(
                Key={'memberId': key_value, 'paymentMethodId': it['paymentMethodId']},
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
        pm = payment_methods_table.get_item(Key={
            'memberId': key_value, 'paymentMethodId': payment_method_id,
        }).get('Item')
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
                'memberId': key_value,
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
                payment_methods_table.put_item(Item=item)
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
            'paymentMethodId': payment_method_id or saved_payment_method_id or '',
            'cardLast4': last4_for_record,
            'cardBrand': brand_for_record,
            'gatewayRefNum': resp.get('xRefNum', ''),
            'gatewayAuthCode': resp.get('xAuthCode', ''),
            'gatewayResult': resp.get('xResult', ''),
            'gatewayStatus': resp.get('xStatus', ''),
            'gatewayError': resp.get('xError', ''),
            'gatewayErrorCode': resp.get('xErrorCode', ''),
        }
        txn_record = {k: v for k, v in txn_record.items() if v not in ('', None)}
        try:
            transactions_table.put_item(Item=txn_record)
        except Exception as e:
            print(f"[charge] failed to record txn: {e}")

    if not ok:
        return respond(402, {
            'success': False,
            'error': resp.get('xError', 'Charge declined'),
            'errorCode': resp.get('xErrorCode'),
            'gatewayRefNum': resp.get('xRefNum'),
            'gatewayResult': resp.get('xResult'),
        })

    return respond(200, {
        'success': True,
        'gatewayRefNum': resp.get('xRefNum'),
        'authCode': resp.get('xAuthCode'),
        'amount': amount,
        'last4': last4_for_record,
        'cardBrand': brand_for_record,
        'transactionId': (txn_record or {}).get('transactionId'),
        'savedPaymentMethodId': saved_payment_method_id,
    })
