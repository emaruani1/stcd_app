"""
Self-contained unit tests for two production bugs fixed 2026-05-31:

  1. UpdateItem "Two document paths overlap ... [modifiedAt]" on member /
     transaction edits — caused by callers folding modifiedAt into the SET
     clause while the universal _stamp_update_kwargs injected it again.

  2. Saving a card -> "bad operand type for unary -: 'str'" — the card list
     sort applied a unary minus to createdAt, which is an ISO string on the
     add-card path (vs an int epoch on the charge-and-save path).

Run from backend/:  python test_bugfixes_2026_05_31.py
No AWS access required — DynamoDB touchpoints are monkeypatched.
"""
import os
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-2')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'test')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'test')

import re
import json
import lambda_function as lf

PASS, FAIL = [], []


def check(name, cond):
    (PASS if cond else FAIL).append(name)
    print(("  ok  " if cond else " FAIL ") + name)


def _modifiedAt_target_count(kwargs):
    """How many distinct SET targets resolve to the 'modifiedAt' attribute."""
    ue = kwargs['UpdateExpression']
    names = kwargs.get('ExpressionAttributeNames') or {}
    count = 0
    # literal attribute name used directly in the expression (NOT a #alias)
    count += len(re.findall(r'(?<![#\w])modifiedAt\s*=', ue))
    # placeholder aliases that map to modifiedAt and are assigned in the expr
    for alias, attr in names.items():
        if attr == 'modifiedAt' and re.search(re.escape(alias) + r'\s*=', ue):
            count += 1
    return count


# ---- Bug 1: _stamp_update_kwargs idempotency ------------------------------
print("\nBug 1 — modifiedAt overlap guard:")

# A) plain caller with no modifiedAt -> helper injects exactly one
kw = {'UpdateExpression': 'SET #a = :a', 'ExpressionAttributeNames': {'#a': 'firstName'},
      'ExpressionAttributeValues': {':a': 'Eli'}}
lf._stamp_update_kwargs(kw)
check("injects modifiedAt when caller omits it", _modifiedAt_target_count(kw) == 1)

# B) caller folds modifiedAt in via alias (the update_member / tenant path)
kw = {'UpdateExpression': 'SET #firstName = :firstName, #modifiedAt = :modifiedAt',
      'ExpressionAttributeNames': {'#firstName': 'firstName', '#modifiedAt': 'modifiedAt'},
      'ExpressionAttributeValues': {':firstName': 'Eli', ':modifiedAt': '2026-05-31T00:00:00Z'}}
lf._stamp_update_kwargs(kw)
check("no double-write when caller uses #modifiedAt alias", _modifiedAt_target_count(kw) == 1)

# C) caller uses a literal modifiedAt = :ca (the cancel_transaction path)
kw = {'UpdateExpression': 'SET #c = :c, modifiedBy = :mb, modifiedAt = :ca',
      'ExpressionAttributeNames': {'#c': 'canceled'},
      'ExpressionAttributeValues': {':c': True, ':mb': 'a@b.c', ':ca': '2026-05-31T00:00:00Z'}}
lf._stamp_update_kwargs(kw)
check("no double-write when caller uses literal modifiedAt", _modifiedAt_target_count(kw) == 1)

# D) does not falsely trip on a similarly-named attribute
kw = {'UpdateExpression': 'SET #e = :e', 'ExpressionAttributeNames': {'#e': 'modifiedAtEpoch'},
      'ExpressionAttributeValues': {':e': 123}}
lf._stamp_update_kwargs(kw)
check("still stamps when only modifiedAtEpoch present", _modifiedAt_target_count(kw) == 1
      and 'modifiedAt' in kw['ExpressionAttributeNames'].values())


# ---- Bug 2: list_payment_methods sort across mixed timestamp formats -------
print("\nBug 2 — card list sort (unary minus on str):")

lf._require_tenant = lambda: 'stcd'
lf._is_admin = lambda: True
lf._is_self = lambda mid: True

mixed_cards = [
    {'paymentMethodId': 'iso',     'isDefault': False, 'last4': '1111',
     'createdAt': '2026-05-30T10:00:00Z', 'createdAtEpoch': 1748599200},   # add-card path
    {'paymentMethodId': 'intca',   'isDefault': False, 'last4': '2222',
     'createdAt': 1748685600},                                             # charge-and-save path
    {'paymentMethodId': 'legacy',  'isDefault': False, 'last4': '3333'},   # no timestamp at all
    {'paymentMethodId': 'default', 'isDefault': True,  'last4': '4444',
     'createdAt': '2026-01-01T00:00:00Z', 'createdAtEpoch': 1735689600},   # default, pinned
]
lf._pm_list_for_member = lambda mid: list(mixed_cards)

resp = lf.list_payment_methods('M1')
ok = resp.get('statusCode') == 200
check("list_payment_methods returns 200 (no unary-minus crash)", ok)
if ok:
    body = json.loads(resp['body'])
    order = [c['paymentMethodId'] for c in body['paymentMethods']]
    # default pinned first; then freshest by epoch: intca(1748685600) > iso(1748599200) > legacy(0)
    check("default card pinned to top", order[0] == 'default')
    check("remaining sorted freshest-first, legacy last",
          order[1:] == ['intca', 'iso', 'legacy'])


print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    for f in FAIL:
        print("  FAILED:", f)
    raise SystemExit(1)
print("ALL GREEN")
