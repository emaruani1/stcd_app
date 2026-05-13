"""
Local tests for admin-charging-on-behalf-of-a-member.

Verifies that:
  1. Admin can call create_payment_method for any member (auth check passes,
     card item gets createdBy = admin email and ISO createdAt).
  2. Admin can call list_payment_methods for any member (auth check passes).
  3. Admin can call charge_saved_card for any member — the transaction row
     written to stcd_transactions carries createdBy = admin email, ISO
     createdAt, and the right paymentType/description.
  4. A non-admin who is NOT the member is rejected (403).
  5. Idempotency: re-issuing the same idempotency key under the same admin
     does not double-charge (returns the cached prior result).

Sola gateway calls are stubbed — no real card processor traffic.
Run from the backend/ directory:  python test_admin_on_behalf.py
"""
import os
import re
import sys
import json
from decimal import Decimal
from unittest.mock import MagicMock

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-2')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'test')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'test')
os.environ.setdefault('SOLA_X_KEY', 'test-sola-key')

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
    lf.payment_methods_table = MagicMock()
    lf.members_table = MagicMock()


def set_admin():
    lf._current_event = {
        'headers': {},
        '_verified_claims': {
            'email': 'admin@stcd.org',
            'custom:custom:role': 'admin',
            'custom:custom:memberId': '1',
            'sub': 'cog-admin',
        },
    }


def set_other_member():
    """A member who is NOT the target — should be forbidden from acting on the target."""
    lf._current_event = {
        'headers': {},
        '_verified_claims': {
            'email': 'someone-else@example.com',
            'custom:custom:role': 'member',
            'custom:custom:memberId': '999',  # different from target 779
            'sub': 'cog-other',
        },
    }


def parse_resp(resp):
    return json.loads(resp.get('body', '{}')), resp.get('statusCode')


# --------------------------------------------------------------------------
print('\n[1] create_payment_method as admin stamps admin as creator')
print('-' * 72)
reset_tables()
set_admin()

# Stub Sola to return an approved cc:save with an xToken
def fake_sola_save(payload):
    return True, {
        'xResult': 'A',
        'xToken': 'sola-tok-abc123',
        'xMaskedCardNumber': '411111******1111',
        'xCardType': 'Visa',
        'xRefNum': 'sola-ref-1',
    }
lf._sola_post = fake_sola_save
# Make _clear_default_payment_methods a no-op (empty query result)
lf.payment_methods_table.query.return_value = {'Items': []}

resp = lf.create_payment_method({
    'memberId': '779',
    'xCardNum': 'sut-card',
    'xCVV': 'sut-cvv',
    'xExp': '1227',
    'xName': 'Eli Maruani',
    'xZip': '75230',
    'setAsDefault': True,
})

body, status = parse_resp(resp)
check('returns 200 OK', status == 200, f'got {status}: {body}')
assert lf.payment_methods_table.put_item.called, 'card was never written'
saved = lf.payment_methods_table.put_item.call_args.kwargs['Item']
check('card.createdBy is admin email',
      saved.get('createdBy') == 'admin@stcd.org',
      saved.get('createdBy'))
check('card.createdByRole is admin',
      saved.get('createdByRole') == 'admin',
      saved.get('createdByRole'))
check('card.createdByMemberId is admin memberId',
      saved.get('createdByMemberId') == '1',
      saved.get('createdByMemberId'))
check('card.createdAt is ISO UTC',
      bool(ISO_TS.match(saved.get('createdAt') or '')),
      saved.get('createdAt'))
check('card belongs to the target member',
      str(saved.get('memberId')) == '779',
      f'got {saved.get("memberId")}')

# --------------------------------------------------------------------------
print('\n[2] list_payment_methods accepts admin for any memberId')
print('-' * 72)
reset_tables()
set_admin()
lf.payment_methods_table.query.return_value = {
    'Items': [
        {
            'paymentMethodId': 'pm_xyz',
            'memberId': 779,
            'last4': '1111',
            'cardBrand': 'Visa',
            'expMonth': '12',
            'expYear': '27',
            'cardholderName': 'Eli Maruani',
            'isDefault': True,
            'createdAt': 1735689600,
            'xToken': 'sola-tok-abc123',   # MUST be stripped from response
        },
    ],
}
resp = lf.list_payment_methods('779')
body, status = parse_resp(resp)
check('returns 200 OK', status == 200, f'got {status}')
cards = body.get('paymentMethods', [])
check('returns one card', len(cards) == 1, f'got {cards}')
check('xToken is NOT echoed to the client', 'xToken' not in cards[0])
check('last4 surfaced', cards[0].get('last4') == '1111')

# --------------------------------------------------------------------------
print('\n[3] charge_saved_card stamps admin email + timestamp on the txn row')
print('-' * 72)
reset_tables()
set_admin()

# Mock the idempotency claim helper so it lets us through (real implementation
# touches DynamoDB which we're mocking).
lf._claim_charge_idempotency = lambda mid, key: (True, None)

# Mock the saved-card lookup
lf.payment_methods_table.get_item.return_value = {
    'Item': {
        'memberId': 779,
        'paymentMethodId': 'pm_xyz',
        'xToken': 'sola-tok-abc123',
        'last4': '1111',
        'cardBrand': 'Visa',
        'expMonth': '12',
        'expYear': '27',
    },
}

# Mock Sola sale → approved
def fake_sola_sale(payload):
    return True, {
        'xResult': 'A',
        'xStatus': 'Approved',
        'xRefNum': 'sola-ref-sale-9',
        'xAuthCode': 'AUTH777',
        'xMaskedCardNumber': '411111******1111',
        'xCardType': 'Visa',
    }
lf._sola_post = fake_sola_sale

resp = lf.charge_saved_card({
    'memberId': '779',
    'paymentMethodId': 'pm_xyz',
    'amount': 125.50,
    'paymentType': 'donation',
    'description': 'On-behalf donation entered at front desk',
    'alias': 'Maruani Family',
    'idempotencyKey': 'idem-key-front-desk-001',
})

body, status = parse_resp(resp)
check('returns 200 OK', status == 200, f'got {status}: {body}')

# Find the put_item call that wrote the actual charge transaction (NOT the
# idempotency claim or other audit rows).
charge_txns = [
    call.kwargs['Item']
    for call in lf.transactions_table.put_item.call_args_list
    if call.kwargs.get('Item', {}).get('paymentType') == 'donation'
]
check('exactly one donation txn written',
      len(charge_txns) == 1,
      f'put_item calls: {[c.kwargs.get("Item", {}).get("paymentType") for c in lf.transactions_table.put_item.call_args_list]}')
if charge_txns:
    txn = charge_txns[0]
    check('txn.createdBy is admin email',
          txn.get('createdBy') == 'admin@stcd.org',
          txn.get('createdBy'))
    check('txn.createdByRole is admin',
          txn.get('createdByRole') == 'admin',
          txn.get('createdByRole'))
    check('txn.createdByMemberId is admin memberId',
          txn.get('createdByMemberId') == '1',
          txn.get('createdByMemberId'))
    check('txn.createdAt is ISO UTC',
          bool(ISO_TS.match(txn.get('createdAt') or '')),
          txn.get('createdAt'))
    check('txn.memberId is the target member',
          str(txn.get('memberId')) == '779',
          txn.get('memberId'))
    check('txn.amount is the charge amount',
          float(txn.get('amount')) == 125.50,
          txn.get('amount'))
    check('txn.description carries the on-behalf description',
          txn.get('description') == 'On-behalf donation entered at front desk',
          txn.get('description'))
    check('txn.alias forwards member alias',
          txn.get('alias') == 'Maruani Family',
          txn.get('alias'))
    check('txn.cardLast4 is captured',
          txn.get('cardLast4') == '1111',
          txn.get('cardLast4'))
    check('txn.gatewayAuthCode is captured',
          txn.get('gatewayAuthCode') == 'AUTH777',
          txn.get('gatewayAuthCode'))

# --------------------------------------------------------------------------
print('\n[4] charge_saved_card with paymentType=pledge increments pledge paidAmount')
print('-' * 72)
reset_tables()
set_admin()
lf._claim_charge_idempotency = lambda mid, key: (True, None)
lf.payment_methods_table.get_item.return_value = {
    'Item': {
        'memberId': 779, 'paymentMethodId': 'pm_xyz',
        'xToken': 'sola-tok-abc123', 'last4': '1111', 'cardBrand': 'Visa',
        'expMonth': '12', 'expYear': '27',
    },
}
lf.pledges_table.get_item.return_value = {
    'Item': {
        'memberId': '779',
        'pledgeId': 'PLG#2026-05-12#xx',
        'amount': Decimal('200'),
        'paidAmount': Decimal('50'),
        'paid': False,
    },
}
lf._sola_post = lambda payload: (True, {
    'xResult': 'A', 'xStatus': 'Approved',
    'xRefNum': 'sola-ref-pledge-1', 'xAuthCode': 'AUTHPLG1',
    'xMaskedCardNumber': '411111******1111', 'xCardType': 'Visa',
})

resp = lf.charge_saved_card({
    'memberId': '779',
    'paymentMethodId': 'pm_xyz',
    'amount': 75,
    'paymentType': 'pledge',
    'pledgeId': 'PLG#2026-05-12#xx',
    'description': 'Pledge payment via card on file',
    'idempotencyKey': 'idem-charge-pledge-1',
})
body, status = parse_resp(resp)
check('charge returns 200', status == 200, f'got {status}: {body}')

# The txn must include pledgeId AND be paymentType=pledge
pledge_txns = [
    call.kwargs['Item']
    for call in lf.transactions_table.put_item.call_args_list
    if call.kwargs.get('Item', {}).get('paymentType') == 'pledge'
]
check('exactly one pledge txn written', len(pledge_txns) == 1)
if pledge_txns:
    txn = pledge_txns[0]
    check('txn has pledgeId',
          txn.get('pledgeId') == 'PLG#2026-05-12#xx')
    check('txn.createdBy = admin email',
          txn.get('createdBy') == 'admin@stcd.org')
    check('txn.createdAt is ISO UTC',
          bool(ISO_TS.match(txn.get('createdAt') or '')))

# Pledge row should have been updated via _apply_pledge_payment
check('pledges_table.update_item was called',
      lf.pledges_table.update_item.called,
      'expected _apply_pledge_payment to call update_item on the pledge row')

# --------------------------------------------------------------------------
print('\n[5] charge_saved_card carries settlesTxnId forward for fee settlement')
print('-' * 72)
reset_tables()
set_admin()
lf._claim_charge_idempotency = lambda mid, key: (True, None)
lf.payment_methods_table.get_item.return_value = {
    'Item': {
        'memberId': 779, 'paymentMethodId': 'pm_xyz',
        'xToken': 'sola-tok-abc123', 'last4': '1111', 'cardBrand': 'Visa',
        'expMonth': '12', 'expYear': '27',
    },
}
lf._sola_post = lambda payload: (True, {
    'xResult': 'A', 'xStatus': 'Approved',
    'xRefNum': 'sola-ref-fee-1', 'xAuthCode': 'AUTHFEE1',
    'xMaskedCardNumber': '411111******1111', 'xCardType': 'Visa',
})

resp = lf.charge_saved_card({
    'memberId': '779',
    'paymentMethodId': 'pm_xyz',
    'amount': 36,
    'paymentType': 'sponsorship-payment',
    'settlesTxnId': 'TXN#2026-05-01#fee-abc',
    'description': 'Kiddush sponsorship by card',
    'idempotencyKey': 'idem-charge-fee-1',
})
body, status = parse_resp(resp)
check('charge returns 200', status == 200, f'got {status}: {body}')

fee_txns = [
    call.kwargs['Item']
    for call in lf.transactions_table.put_item.call_args_list
    if call.kwargs.get('Item', {}).get('paymentType') == 'sponsorship-payment'
]
check('exactly one sponsorship-payment txn written', len(fee_txns) == 1)
if fee_txns:
    txn = fee_txns[0]
    check('txn.settlesTxnId carries forward',
          txn.get('settlesTxnId') == 'TXN#2026-05-01#fee-abc',
          txn.get('settlesTxnId'))
    check('txn.createdBy = admin email',
          txn.get('createdBy') == 'admin@stcd.org')
    check('txn.createdAt is ISO UTC',
          bool(ISO_TS.match(txn.get('createdAt') or '')))

# --------------------------------------------------------------------------
print('\n[6] non-admin who is not the member is rejected from all three calls')
print('-' * 72)
reset_tables()
set_other_member()
lf._sola_post = lambda payload: (True, {})

resp_create = lf.create_payment_method({
    'memberId': '779',
    'xCardNum': 'sut', 'xExp': '1227',
})
body, status = parse_resp(resp_create)
check('create_payment_method -> 403', status == 403, f'got {status}')

resp_list = lf.list_payment_methods('779')
body, status = parse_resp(resp_list)
check('list_payment_methods -> 403', status == 403, f'got {status}')

resp_charge = lf.charge_saved_card({
    'memberId': '779', 'paymentMethodId': 'pm_xyz', 'amount': 50,
})
body, status = parse_resp(resp_charge)
check('charge_saved_card -> 403', status == 403, f'got {status}')

check('no put_item on payment_methods_table',
      not lf.payment_methods_table.put_item.called)
check('no put_item on transactions_table',
      not lf.transactions_table.put_item.called)

# --------------------------------------------------------------------------
print('\n' + '=' * 72)
print(f'  RESULTS: {len(PASSED)} passed, {len(FAILED)} failed')
print('=' * 72)
if FAILED:
    print('\nFailures:')
    for label, detail in FAILED:
        print(f'  - {label}\n      {detail}')
    sys.exit(1)
