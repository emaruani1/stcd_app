"""
Unit tests for the Cognito reset/resend fixes (2026-05-31).

The pool uses UsernameAttributes=['email'], so the stored Username is an
internal UUID (sub). admin_create_user rejects the sub with "Username should
be an email" — these tests prove we now pass the EMAIL to admin_create_user,
and that Reset Password routes pending users to a resend.

Run from backend/:  python test_cognito_reset_2026_05_31.py
"""
import os
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-2')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'test')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'test')

import json
import lambda_function as lf

PASS, FAIL = [], []
def check(name, cond):
    (PASS if cond else FAIL).append(name)
    print(("  ok  " if cond else " FAIL ") + name)


class FakeCognito:
    """Records admin_* calls; admin_create_user mimics the real pool by
    rejecting a non-email Username."""
    class exceptions:
        class UnsupportedUserStateException(Exception): pass
        class UsernameExistsException(Exception): pass

    def __init__(self, status='CONFIRMED'):
        self.status = status
        self.calls = []

    def admin_get_user(self, UserPoolId, Username):
        self.calls.append(('admin_get_user', Username))
        return {'UserStatus': self.status}

    def admin_reset_user_password(self, UserPoolId, Username):
        self.calls.append(('admin_reset_user_password', Username))
        return {}

    def admin_create_user(self, UserPoolId, Username, **kw):
        self.calls.append(('admin_create_user', Username))
        # Real Cognito behaviour for UsernameAttributes=['email']:
        if '@' not in Username:
            raise Exception('An error occurred (InvalidParameterException) ... '
                            'Username should be an email.')
        return {'User': {'Username': 'sub-uuid', 'UserStatus': self.status, 'Enabled': True}}


SUB = 'a1b2c3d4-0000-uuid-sub'
EMAIL = 'member@example.com'

def _wire(status):
    fake = FakeCognito(status)
    lf.cognito = fake
    lf._is_admin = lambda: True
    lf._resolve_cognito_username = lambda email: SUB
    lf._assert_cognito_user_in_tenant = lambda username: None
    return fake


print("\nResend invite — must use email, not the sub:")
fake = _wire('FORCE_CHANGE_PASSWORD')
resp = lf.cognito_resend_invite({'email': EMAIL})
check("resend returns 200 (no 'should be an email')", resp.get('statusCode') == 200)
ac = [c for c in fake.calls if c[0] == 'admin_create_user']
check("admin_create_user called with the EMAIL", ac and ac[0][1] == EMAIL)

print("\nReset password — pending user routes to resend:")
fake = _wire('FORCE_CHANGE_PASSWORD')
resp = lf.cognito_reset_password({'email': EMAIL})
check("pending reset returns 200", resp.get('statusCode') == 200)
check("pending reset used admin_create_user(email)",
      ('admin_create_user', EMAIL) in fake.calls)
check("pending reset did NOT call admin_reset_user_password",
      not any(c[0] == 'admin_reset_user_password' for c in fake.calls))

print("\nReset password — confirmed user uses real reset:")
fake = _wire('CONFIRMED')
resp = lf.cognito_reset_password({'email': EMAIL})
check("confirmed reset returns 200", resp.get('statusCode') == 200)
check("confirmed reset called admin_reset_user_password(sub)",
      ('admin_reset_user_password', SUB) in fake.calls)
check("confirmed reset did NOT call admin_create_user",
      not any(c[0] == 'admin_create_user' for c in fake.calls))


print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    for f in FAIL:
        print("  FAILED:", f)
    raise SystemExit(1)
print("ALL GREEN")
