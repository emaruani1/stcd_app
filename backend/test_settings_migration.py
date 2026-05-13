"""
Tests for the Phase 1 settings migration shim. Verifies that the four
migration modes route reads/writes to the right tables and that handler
behaviour is preserved.

Run from backend/:  python test_settings_migration.py
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


def reset(mode):
    """Reset table mocks and set the migration mode env var."""
    lf.settings_table = MagicMock()
    lf.settings_table_v2 = MagicMock()
    if mode is None:
        os.environ.pop('SETTINGS_TABLE_MODE', None)
    else:
        os.environ['SETTINGS_TABLE_MODE'] = mode


def set_admin(tenant='stcd', is_super=False):
    lf._current_event = {
        'headers': {},
        '_verified_claims': {
            'email': 'admin@stcd.org',
            'custom:custom:role': 'admin',
            'custom:custom:tenantId': tenant,
            'custom:custom:isSuperadmin': 'true' if is_super else '',
        },
    }


def parse(resp):
    return json.loads(resp.get('body', '{}')), resp.get('statusCode')


# --------------------------------------------------------------------------
print('\n[1] mode helpers — env var parsing + defaults')
print('-' * 72)
for env_val, expected in [
    (None, 'legacy'),
    ('legacy', 'legacy'),
    ('dual_write_read_legacy', 'dual_write_read_legacy'),
    ('dual_write_read_v2', 'dual_write_read_v2'),
    ('v2_only', 'v2_only'),
    ('garbage', 'legacy'),       # invalid -> safe default
    ('  V2_ONLY  ', 'v2_only'),  # case + whitespace tolerant
    ('', 'legacy'),
]:
    if env_val is None:
        os.environ.pop('SETTINGS_TABLE_MODE', None)
    else:
        os.environ['SETTINGS_TABLE_MODE'] = env_val
    got = lf._migration_mode('SETTINGS')
    check(f'_migration_mode env={env_val!r} -> {expected}', got == expected, got)

# --------------------------------------------------------------------------
print('\n[2] read/write target predicates for each mode')
print('-' * 72)
expected_targets = {
    # mode                       legacy?  v2-write?  read-v2?
    'legacy':                    (True,  False, False),
    'dual_write_read_legacy':    (True,  True,  False),
    'dual_write_read_v2':        (True,  True,  True),
    'v2_only':                   (False, True,  True),
}
for mode, (wl, wv, rv) in expected_targets.items():
    os.environ['SETTINGS_TABLE_MODE'] = mode
    check(f'{mode}: should_write_legacy={wl}', lf._should_write_legacy('SETTINGS') is wl)
    check(f'{mode}: should_write_v2={wv}',     lf._should_write_v2('SETTINGS')     is wv)
    check(f'{mode}: should_read_v2={rv}',      lf._should_read_v2('SETTINGS')      is rv)

# --------------------------------------------------------------------------
print('\n[3] legacy mode — handler behaviour unchanged')
print('-' * 72)
reset('legacy')
set_admin()
lf.settings_table.get_item.return_value = {'Item': {'settingKey': 'pledgeTypes', 'items': [{'id': 'p1', 'label': 'Tefilla'}]}}

resp = lf.get_setting('pledgeTypes')
body, status = parse(resp)
check('get_setting -> 200', status == 200)
check('get_setting reads only from legacy', lf.settings_table.get_item.called)
check('get_setting did NOT touch v2', not lf.settings_table_v2.get_item.called)

reset('legacy')
set_admin()
resp = lf.update_setting('pledgeTypes', {'items': [{'id': 'p1', 'label': 'New'}]})
body, status = parse(resp)
check('update_setting -> 200', status == 200)
check('update_setting writes only to legacy', lf.settings_table.put_item.called)
check('update_setting did NOT touch v2', not lf.settings_table_v2.put_item.called)

# --------------------------------------------------------------------------
print('\n[4] dual_write_read_legacy — writes hit both, reads still legacy')
print('-' * 72)
reset('dual_write_read_legacy')
set_admin()
lf.settings_table.get_item.return_value = {'Item': {'settingKey': 'pledgeTypes', 'items': []}}

resp = lf.get_setting('pledgeTypes')
check('read came from legacy', lf.settings_table.get_item.called)
check('read did NOT come from v2', not lf.settings_table_v2.get_item.called)

reset('dual_write_read_legacy')
set_admin()
lf.update_setting('pledgeTypes', {'items': [{'id': 'p2'}]})
check('write hit legacy', lf.settings_table.put_item.called)
check('write hit v2',     lf.settings_table_v2.put_item.called)

# Verify the v2 item carries tenantId from the actor's claim
v2_item = lf.settings_table_v2.put_item.call_args.kwargs['Item']
check('v2 row has tenantId',        v2_item.get('tenantId') == 'stcd', v2_item.get('tenantId'))
check('v2 row has settingKey',      v2_item.get('settingKey') == 'pledgeTypes')
check('v2 row has items payload',   v2_item.get('items') == [{'id': 'p2'}])
check('v2 row has modifiedBy stamp', v2_item.get('modifiedBy') == 'admin@stcd.org')

# --------------------------------------------------------------------------
print('\n[5] dual_write_read_v2 — cutover: reads from v2, writes to both')
print('-' * 72)
reset('dual_write_read_v2')
set_admin()
lf.settings_table_v2.get_item.return_value = {'Item': {'tenantId': 'stcd', 'settingKey': 'pledgeTypes', 'items': [{'id': 'p3'}]}}

resp = lf.get_setting('pledgeTypes')
body, status = parse(resp)
check('reads now come from v2', lf.settings_table_v2.get_item.called)
check('reads do NOT touch legacy', not lf.settings_table.get_item.called)
check('v2 read includes tenantId in the key',
      lf.settings_table_v2.get_item.call_args.kwargs['Key'] == {'tenantId': 'stcd', 'settingKey': 'pledgeTypes'})

reset('dual_write_read_v2')
set_admin()
lf.update_setting('pledgeTypes', {'items': []})
check('write still hits legacy (dual)', lf.settings_table.put_item.called)
check('write still hits v2',            lf.settings_table_v2.put_item.called)

# --------------------------------------------------------------------------
print('\n[6] v2_only — final state: no legacy traffic at all')
print('-' * 72)
reset('v2_only')
set_admin()
lf.settings_table_v2.get_item.return_value = {'Item': {'tenantId': 'stcd', 'settingKey': 'pledgeTypes', 'items': []}}

resp = lf.get_setting('pledgeTypes')
check('v2_only reads from v2 only', lf.settings_table_v2.get_item.called)
check('v2_only does NOT read legacy', not lf.settings_table.get_item.called)

reset('v2_only')
set_admin()
lf.update_setting('pledgeTypes', {'items': []})
check('v2_only writes to v2 only', lf.settings_table_v2.put_item.called)
check('v2_only does NOT write legacy', not lf.settings_table.put_item.called)

# --------------------------------------------------------------------------
print('\n[7] tenant isolation — different tenants see different rows')
print('-' * 72)
reset('v2_only')
set_admin(tenant='kkjmiami')
lf.settings_table_v2.get_item.return_value = {'Item': {'tenantId': 'kkjmiami', 'settingKey': 'pledgeTypes', 'items': [{'id': 'k1'}]}}
lf.get_setting('pledgeTypes')
key = lf.settings_table_v2.get_item.call_args.kwargs['Key']
check('kkjmiami actor reads kkjmiami partition',
      key == {'tenantId': 'kkjmiami', 'settingKey': 'pledgeTypes'}, key)

reset('v2_only')
set_admin(tenant='kkjmiami')
lf.update_setting('pledgeTypes', {'items': [{'id': 'k2'}]})
v2_item = lf.settings_table_v2.put_item.call_args.kwargs['Item']
check('kkjmiami write stamps tenantId=kkjmiami', v2_item['tenantId'] == 'kkjmiami')

# --------------------------------------------------------------------------
print('\n[8] 404 preserved on missing setting')
print('-' * 72)
reset('legacy')
set_admin()
lf.settings_table.get_item.return_value = {}  # no Item
resp = lf.get_setting('does-not-exist')
body, status = parse(resp)
check('missing setting -> 404 (legacy)', status == 404, body)

reset('dual_write_read_v2')
set_admin()
lf.settings_table_v2.get_item.return_value = {}
resp = lf.get_setting('does-not-exist')
body, status = parse(resp)
check('missing setting -> 404 (v2)', status == 404, body)

# --------------------------------------------------------------------------
print('\n[9] get_all_settings — query in v2 mode, scan in legacy mode')
print('-' * 72)
reset('legacy')
set_admin()
lf.settings_table.scan.return_value = {'Items': [{'settingKey': 'a', 'items': [1]}, {'settingKey': 'b', 'items': [2]}]}
resp = lf.get_all_settings()
body, status = parse(resp)
check('legacy: get_all uses scan', lf.settings_table.scan.called)
check('legacy: payload shape preserved', body == {'a': [1], 'b': [2]}, body)

reset('dual_write_read_v2')
set_admin()
lf.settings_table_v2.query.return_value = {'Items': [
    {'tenantId': 'stcd', 'settingKey': 'a', 'items': [10]},
    {'tenantId': 'stcd', 'settingKey': 'b', 'items': [20]},
]}
resp = lf.get_all_settings()
body, status = parse(resp)
check('v2: get_all uses query', lf.settings_table_v2.query.called)
check('v2: query is tenant-scoped',
      'KeyConditionExpression' in lf.settings_table_v2.query.call_args.kwargs)
check('v2: payload shape preserved', body == {'a': [10], 'b': [20]}, body)

# --------------------------------------------------------------------------
print('\n' + '=' * 72)
print(f'  RESULTS: {len(PASSED)} passed, {len(FAILED)} failed')
print('=' * 72)
if FAILED:
    print('\nFailures:')
    for label, detail in FAILED:
        print(f'  - {label}\n      {detail}')
    sys.exit(1)
