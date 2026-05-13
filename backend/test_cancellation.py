"""
Local tests for the cancellation flow.

Verifies that:
  1. cancel_transaction stamps cancellationReason, canceledBy, canceledByRole,
     canceledByMemberId, canceledAt + modified* fields.
  2. update_pledge with canceled=true stamps the same canceled* + modified* fields
     and forwards cancellationReason.
  3. delete_pledge / delete_transaction return 403 (deletions disabled).
  4. compute_account_balance skips transactions with canceled=true.
  5. cancel_transaction rejects empty reason (400) and non-admin caller (403).

No AWS calls — DynamoDB tables are patched with MagicMock.
Run from the backend/ directory:  python test_cancellation.py
"""
import os
import re
import sys
import json
from decimal import Decimal
from unittest.mock import MagicMock

# Boto3 needs *something* set to avoid hard error on resource() in some
# configurations. The real call is never made because we replace the tables.
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-2')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'test')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'test')

import lambda_function as lf


ISO_TS = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')

PASSED = []
FAILED = []


def check(label, cond, detail=''):
    if cond:
        PASSED.append(label)
        print(f'  PASS  {label}')
    else:
        FAILED.append((label, detail))
        print(f'  FAIL  {label}   {detail}')


def reset_tables():
    lf.pledges_table = MagicMock()
    lf.transactions_table = MagicMock()
    lf.members_table = MagicMock()


def set_admin():
    lf._current_event = {
        'headers': {},
        '_verified_claims': {
            'email': 'admin@stcd.org',
            'custom:custom:role': 'admin',
            'custom:custom:memberId': '779',
            'sub': 'cog-sub-abc',
        },
    }


def set_member():
    lf._current_event = {
        'headers': {},
        '_verified_claims': {
            'email': 'eli@example.com',
            'custom:custom:role': 'member',
            'custom:custom:memberId': '779',
            'sub': 'cog-sub-xyz',
        },
    }


def parse_resp(resp):
    return json.loads(resp.get('body', '{}')), resp.get('statusCode')


# --------------------------------------------------------------------------
print('\n[1] cancel_transaction stamps actor + timestamp on a sponsorship fee')
print('-' * 72)
reset_tables()
set_admin()

resp = lf.cancel_transaction({
    'memberId': '779',
    'transactionId': 'TXN#2026-05-12#abc',
    'cancellationReason': 'duplicate sponsorship — already paid in cash',
})

body, status = parse_resp(resp)
check('returns 200', status == 200, f'got {status}: {body}')

# Inspect the update_item call
assert lf.transactions_table.update_item.called, 'update_item never invoked'
call = lf.transactions_table.update_item.call_args.kwargs
expr = call['UpdateExpression']
names = call['ExpressionAttributeNames']
values = call['ExpressionAttributeValues']

check('SET expression includes #canceled', '#canceled = :c' in expr)
check('SET expression includes #reason', '#reason = :r' in expr)
check('SET expression includes #canceledBy', '#canceledBy = :cb' in expr)
check('SET expression includes #canceledByRole', '#canceledByRole = :cr' in expr)
check('SET expression includes #canceledByMemberId', '#canceledByMemberId = :cm' in expr)
check('SET expression includes #canceledAt', '#canceledAt = :ca' in expr)
check('SET expression also stamps #modifiedBy', '#modifiedBy = :cb' in expr)
check('SET expression also stamps #modifiedAt', '#modifiedAt = :ca' in expr)
check('canceled value is True', values[':c'] is True)
check('reason matches input', values[':r'] == 'duplicate sponsorship — already paid in cash')
check('canceledBy is the admin email', values[':cb'] == 'admin@stcd.org', values[':cb'])
check('canceledByRole is admin', values[':cr'] == 'admin', values[':cr'])
check('canceledByMemberId is the admin memberId', values[':cm'] == '779', values[':cm'])
check('canceledAt is ISO UTC', bool(ISO_TS.match(values[':ca'])), values[':ca'])

# --------------------------------------------------------------------------
print('\n[2] update_pledge with canceled=true stamps canceled* + forwards reason')
print('-' * 72)
reset_tables()
set_admin()

# Existing pledge state — required because update_pledge does a get_item first
lf.pledges_table.get_item.return_value = {
    'Item': {
        'memberId': '779',
        'pledgeId': 'PLG#2026-05-01#xx',
        'amount': Decimal('150'),
        'paidAmount': Decimal('0'),
        'paid': False,
        'canceled': False,
    },
}
# update_pledge also iterates member transactions to drop the mirror charge —
# return an empty iterator to skip that path
lf._all_member_transactions = lambda mid: []

resp = lf.update_pledge({
    'memberId': '779',
    'pledgeId': 'PLG#2026-05-01#xx',
    'canceled': True,
    'cancellationReason': 'member asked us to withdraw it',
})

body, status = parse_resp(resp)
check('returns 200', status == 200, f'got {status}: {body}')
assert lf.pledges_table.update_item.called, 'update_item never invoked'
call = lf.pledges_table.update_item.call_args.kwargs
expr = call['UpdateExpression']
values = call['ExpressionAttributeValues']
names = call['ExpressionAttributeNames']

# Find which placeholder maps to each attribute (the helper builds them
# dynamically, so we look up via the name map)
def placeholder_for(attr):
    for k, v in names.items():
        if v == attr:
            # placeholder is the same key with # -> :
            return ':' + k.lstrip('#')
    return None

# Helper to verify the SET clause references each attribute
for attr in ['canceled', 'cancellationReason', 'canceledBy', 'canceledByRole',
             'canceledByMemberId', 'canceledAt', 'modifiedBy', 'modifiedAt']:
    ph = placeholder_for(attr)
    check(f'pledge SET references {attr}', ph is not None and f'#{attr} = {ph}' in expr,
          f'expr={expr}')

check('canceled value is True',
      values.get(placeholder_for('canceled')) is True)
check('reason forwarded',
      values.get(placeholder_for('cancellationReason')) == 'member asked us to withdraw it')
check('canceledBy is the admin email',
      values.get(placeholder_for('canceledBy')) == 'admin@stcd.org')
check('canceledByRole is admin',
      values.get(placeholder_for('canceledByRole')) == 'admin')
check('canceledByMemberId is the admin memberId',
      values.get(placeholder_for('canceledByMemberId')) == '779')
check('canceledAt is ISO UTC',
      bool(ISO_TS.match(values.get(placeholder_for('canceledAt')) or '')))
check('modifiedAt is ISO UTC',
      bool(ISO_TS.match(values.get(placeholder_for('modifiedAt')) or '')))
check('modifiedBy is the admin email',
      values.get(placeholder_for('modifiedBy')) == 'admin@stcd.org')

# --------------------------------------------------------------------------
print('\n[3] re-cancelling a pledge does NOT overwrite original canceledBy / At')
print('-' * 72)
reset_tables()
set_admin()
lf.pledges_table.get_item.return_value = {
    'Item': {
        'memberId': '779',
        'pledgeId': 'PLG#x',
        'canceled': True,                     # already canceled
        'canceledBy': 'someone-else@stcd.org',
        'canceledAt': '2026-05-01T00:00:00Z',
        'amount': Decimal('100'),
    },
}
lf._all_member_transactions = lambda mid: []
resp = lf.update_pledge({
    'memberId': '779', 'pledgeId': 'PLG#x',
    'canceled': True,
    'cancellationReason': 'second pass',
})
body, status = parse_resp(resp)
check('returns 200', status == 200)
call = lf.pledges_table.update_item.call_args.kwargs
values = call['ExpressionAttributeValues']
names = call['ExpressionAttributeNames']

def find_value(attr):
    for k, v in names.items():
        if v == attr:
            return values.get(':' + k.lstrip('#'))
    return None

# canceledBy should NOT be set in this update — the helper used setdefault()
check('canceledBy is NOT re-stamped on re-cancel',
      find_value('canceledBy') is None,
      f'unexpected canceledBy={find_value("canceledBy")}')
check('canceledAt is NOT re-stamped on re-cancel',
      find_value('canceledAt') is None)
# but modifiedBy + cancellationReason should still update
check('modifiedBy is updated on re-cancel',
      find_value('modifiedBy') == 'admin@stcd.org')
check('cancellationReason still flows through',
      find_value('cancellationReason') == 'second pass')

# --------------------------------------------------------------------------
print('\n[4] delete_pledge and delete_transaction return 403 (deletions disabled)')
print('-' * 72)
reset_tables()
set_admin()
resp_p = lf.delete_pledge({'memberId': '779', 'pledgeId': 'X'})
body_p, status_p = parse_resp(resp_p)
check('delete_pledge -> 403', status_p == 403, f'got {status_p}')
check('delete_pledge body mentions deletions disabled',
      'disabled' in (body_p.get('error') or '').lower(),
      body_p)
check('delete_pledge does NOT call delete_item',
      not lf.pledges_table.delete_item.called)

resp_t = lf.delete_transaction({'memberId': '779', 'transactionId': 'X'})
body_t, status_t = parse_resp(resp_t)
check('delete_transaction -> 403', status_t == 403, f'got {status_t}')
check('delete_transaction body mentions deletions disabled',
      'disabled' in (body_t.get('error') or '').lower(),
      body_t)
check('delete_transaction does NOT call delete_item',
      not lf.transactions_table.delete_item.called)

# --------------------------------------------------------------------------
print('\n[5] compute_account_balance skips canceled transactions')
print('-' * 72)
reset_tables()
set_admin()

txns = [
    {'paymentType': 'pledge-charge',      'amount': Decimal('100')},  # -100
    {'paymentType': 'pledge',             'amount': Decimal('40')},   # +40
    {'paymentType': 'sponsorship-fee',    'amount': Decimal('50'),    # -50 BUT canceled → skip
     'canceled': True},
    {'paymentType': 'membership-payment', 'amount': Decimal('30')},   # +30
]
lf._all_member_transactions = lambda mid: txns

bal = lf.compute_account_balance('779')
# Expected: -100 + 40 + 30 = -30  (the canceled -50 must NOT count)
check('balance ignores canceled txn', bal == Decimal('-30'), f'got {bal}')

# Sanity: without cancel flag, balance would be -80
txns_no_cancel = [dict(t, canceled=False) for t in txns]
lf._all_member_transactions = lambda mid: txns_no_cancel
bal2 = lf.compute_account_balance('779')
check('balance with everything active = -80', bal2 == Decimal('-80'), f'got {bal2}')

# --------------------------------------------------------------------------
print('\n[6] cancel_transaction rejects empty reason and non-admin caller')
print('-' * 72)
reset_tables()
set_admin()
resp_empty = lf.cancel_transaction({'memberId': '779', 'transactionId': 'X', 'cancellationReason': '   '})
body, status = parse_resp(resp_empty)
check('empty reason -> 400', status == 400, f'got {status}: {body}')
check('empty reason error message',
      'cancellationreason' in (body.get('error') or '').lower(),
      body)
check('empty reason does NOT call update_item',
      not lf.transactions_table.update_item.called)

reset_tables()
set_member()  # non-admin
resp_forbid = lf.cancel_transaction({
    'memberId': '779', 'transactionId': 'X', 'cancellationReason': 'nope',
})
body, status = parse_resp(resp_forbid)
check('non-admin -> 403', status == 403, f'got {status}: {body}')
check('non-admin does NOT call update_item',
      not lf.transactions_table.update_item.called)

# --------------------------------------------------------------------------
print('\n' + '=' * 72)
print(f'  RESULTS: {len(PASSED)} passed, {len(FAILED)} failed')
print('=' * 72)
if FAILED:
    print('\nFailures:')
    for label, detail in FAILED:
        print(f'  - {label}\n      {detail}')
    sys.exit(1)
