"""
Local tests for Phase 0 tenant helpers — _get_actor() extension and the new
_require_tenant / _assert_tenant_match / _load_tenant helpers.

These are addition-only changes; existing handlers don't yet read the new
fields. The tests below prove the helpers behave correctly and that the
transition rule (empty claim -> 'stcd') protects legacy users.

Run from the backend/ directory:  python test_tenant_helpers.py
"""
import os
import sys
import json
from unittest.mock import MagicMock

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-2')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'test')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'test')

import lambda_function as lf

PASSED = []
FAILED = []


def check(label, cond, detail=''):
    if cond:
        PASSED.append(label)
        print(f'  PASS  {label}')
    else:
        FAILED.append((label, detail))
        print(f'  FAIL  {label}   {detail}')


def set_claims(**kwargs):
    """Stub out the JWT claims dictionary the handler would normally fill."""
    lf._current_event = {'headers': {}, '_verified_claims': kwargs}


def reset_tenant_cache():
    lf._tenant_cache.clear()


# --------------------------------------------------------------------------
print('\n[1] _get_actor reads tenantId from the JWT claim when present')
print('-' * 72)
set_claims(**{
    'email': 'admin@otherchurch.org',
    'custom:custom:role': 'admin',
    'custom:custom:tenantId': 'kkjmiami',
    'custom:custom:isSuperadmin': '',
})
a = lf._get_actor()
check('tenantId reflects the claim value', a['tenantId'] == 'kkjmiami', a['tenantId'])
check('isSuperadmin is False on empty', a['isSuperadmin'] is False)
check('email passes through', a['email'] == 'admin@otherchurch.org')
check('role passes through', a['role'] == 'admin')

# --------------------------------------------------------------------------
print('\n[2] _get_actor transition rule — empty tenantId defaults to "stcd"')
print('-' * 72)
set_claims(**{
    'email': 'elimaruani1@gmail.com',
    'custom:custom:role': 'admin',
    # NO tenantId claim — simulates a legacy user
})
a = lf._get_actor()
check('empty/missing claim -> tenantId="stcd"', a['tenantId'] == 'stcd', a['tenantId'])

set_claims(**{
    'email': 'x@y.com',
    'custom:custom:role': 'member',
    'custom:custom:tenantId': '   ',   # whitespace-only
})
a = lf._get_actor()
check('whitespace-only -> tenantId="stcd"', a['tenantId'] == 'stcd', a['tenantId'])

# --------------------------------------------------------------------------
print('\n[3] _get_actor parses isSuperadmin only when value is exactly "true"')
print('-' * 72)
for val, expect in [
    ('true', True),
    ('True', True),    # case-insensitive
    ('TRUE', True),
    ('false', False),
    ('', False),
    ('1', False),       # only 'true' counts — be strict
    ('yes', False),
]:
    set_claims(**{
        'email': 'a@b.com',
        'custom:custom:role': 'admin',
        'custom:custom:tenantId': 'stcd',
        'custom:custom:isSuperadmin': val,
    })
    a = lf._get_actor()
    check(f'isSuperadmin claim={val!r} -> {expect}', a['isSuperadmin'] is expect,
          f'got {a["isSuperadmin"]}')

# --------------------------------------------------------------------------
print('\n[4] _require_tenant always returns a tenantId (never raises)')
print('-' * 72)
set_claims(**{'email': 'x@y.com', 'custom:custom:role': 'admin'})  # empty tenant
t = lf._require_tenant()
check('_require_tenant returns "stcd" for legacy user', t == 'stcd', t)

set_claims(**{
    'email': 'a@b.com', 'custom:custom:role': 'admin',
    'custom:custom:tenantId': 'kkjmiami',
})
t = lf._require_tenant()
check('_require_tenant returns the claim value when present', t == 'kkjmiami', t)

# --------------------------------------------------------------------------
print('\n[5] _assert_tenant_match — basic same-tenant + cross-tenant')
print('-' * 72)
set_claims(**{
    'email': 'a@stcd.org', 'custom:custom:role': 'admin',
    'custom:custom:tenantId': 'stcd',
})
check('same tenant -> True', lf._assert_tenant_match('stcd') is True)
check('different tenant -> False', lf._assert_tenant_match('kkjmiami') is False)
check('empty record_tenant treated as stcd -> True',
      lf._assert_tenant_match('') is True)
check('None record_tenant treated as stcd -> True',
      lf._assert_tenant_match(None) is True)

# Non-stcd actor against unstamped record (legacy data) — must NOT match,
# because legacy data implicitly belongs to stcd.
set_claims(**{
    'email': 'a@kkjmiami.org', 'custom:custom:role': 'admin',
    'custom:custom:tenantId': 'kkjmiami',
})
check('kkjmiami actor against unstamped legacy record -> False',
      lf._assert_tenant_match('') is False)
check('kkjmiami actor against stcd record -> False',
      lf._assert_tenant_match('stcd') is False)
check('kkjmiami actor against own record -> True',
      lf._assert_tenant_match('kkjmiami') is True)

# --------------------------------------------------------------------------
print('\n[6] _assert_tenant_match — superadmin bypasses tenancy')
print('-' * 72)
set_claims(**{
    'email': 'ops@you.com', 'custom:custom:role': 'admin',
    'custom:custom:tenantId': 'stcd',
    'custom:custom:isSuperadmin': 'true',
})
check('superadmin same tenant -> True', lf._assert_tenant_match('stcd') is True)
check('superadmin cross tenant -> True (bypass)',
      lf._assert_tenant_match('kkjmiami') is True)
check('superadmin against empty record -> True',
      lf._assert_tenant_match('') is True)

# --------------------------------------------------------------------------
print('\n[7] _load_tenant — caches across calls, returns row from DynamoDB')
print('-' * 72)
reset_tenant_cache()
lf.tenants_table = MagicMock()
lf.tenants_table.get_item.return_value = {
    'Item': {'tenantId': 'stcd', 'displayName': 'STCD', 'primaryColor': '#1a365d'},
}

first = lf._load_tenant('stcd')
check('returns the tenant row', first.get('displayName') == 'STCD', first)
check('DynamoDB called once on first read', lf.tenants_table.get_item.call_count == 1)

second = lf._load_tenant('stcd')
check('second call returns same data', second.get('displayName') == 'STCD')
check('DynamoDB NOT called again (cache hit)',
      lf.tenants_table.get_item.call_count == 1)

# Empty tenant_id -> None, no DynamoDB call
none_call_count = lf.tenants_table.get_item.call_count
check('empty tenant_id -> None', lf._load_tenant('') is None)
check('empty tenant_id -> no DynamoDB call',
      lf.tenants_table.get_item.call_count == none_call_count)

# Unknown tenant -> None (DynamoDB returns no Item)
lf.tenants_table.get_item.return_value = {}
check('unknown tenant -> None', lf._load_tenant('does-not-exist') is None)

# Bust cache and re-read -> hits DynamoDB again
lf._bust_tenant_cache('stcd')
lf.tenants_table.get_item.return_value = {'Item': {'tenantId': 'stcd', 'displayName': 'STCD-Updated'}}
third = lf._load_tenant('stcd')
check('after bust, fresh data is loaded',
      third.get('displayName') == 'STCD-Updated', third)

# --------------------------------------------------------------------------
print('\n' + '=' * 72)
print(f'  RESULTS: {len(PASSED)} passed, {len(FAILED)} failed')
print('=' * 72)
if FAILED:
    print('\nFailures:')
    for label, detail in FAILED:
        print(f'  - {label}\n      {detail}')
    sys.exit(1)
