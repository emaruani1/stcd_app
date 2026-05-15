"""
Onboard a new tenant into the multi-tenant deployment.

Creates:
  1. A row in stcd_tenants (display name, colors, Sola creds placeholder, etc.)
  2. A Cognito admin user with custom:tenantId immutably stamped, in
     FORCE_CHANGE_PASSWORD state so the user resets on first login.

Idempotent on the tenant row (bails if it already exists) so re-running
is safe — the only side effects on a partially-successful first run are
the tenant row and / or the Cognito user, never both half-written.

Usage:
  python onboard_tenant.py \\
      --tenant-id kkjmiami \\
      --display-name "KKJ Miami" \\
      --legal-name "Kahal Kadosh Joseph of Miami" \\
      --from-email noreply@kkjmiami.example \\
      --admin-email shaul@kkjmiami.example \\
      --primary-color "#0a4d3d" \\
      --secondary-color "#1a8b6f" \\
      --accent-color "#d4af37" \\
      --domain portal.kkjmiami.example \\
      [--sola-x-key XXX --sola-ifields-key XXX]

After onboarding:
  - Operator (you) collects the new tenant's Sola merchant credentials
    and writes them to the tenant row via `update_tenant_sola()` below or
    a direct DynamoDB update.
  - First admin gets a Cognito invite email with a temporary password.
  - Custom domain (if `--domain` was set) still needs to be wired in the
    Amplify console + DNS — see MULTI_TENANT_PLAN.md "Phase 6" section.
"""
import argparse
import json
import sys
import time
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-2'
TENANTS_TABLE = 'stcd_tenants'
COGNITO_POOL_ID = 'us-east-2_Pna4Sv1p8'


def _now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def create_tenant_row(ddb, args):
    """Write the new tenant's row, bailing if one already exists."""
    item = {
        'tenantId': args.tenant_id,
        'displayName': args.display_name,
        'legalName': args.legal_name or args.display_name,
        'domain': args.domain or '',
        'primaryColor': args.primary_color,
        'secondaryColor': args.secondary_color,
        'accentColor': args.accent_color,
        'logoS3Key': f'tenants/{args.tenant_id}/logo.png',
        'solaXKey': args.sola_x_key or '',
        'solaIFieldsKey': args.sola_ifields_key or '',
        'solaSoftwareName': args.display_name + '-App',
        'solaSoftwareVersion': '1.0.0',
        'solaGatewayUrl': 'https://x1.cardknox.com/gatewayjson',
        'timezone': args.timezone,
        'currency': 'USD',
        'fromEmail': args.from_email or '',
        'replyToEmail': args.from_email or '',
        'emailFooterSignature': args.legal_name or args.display_name,
        'taxId': args.tax_id or '',
        'address': args.address or '',
        'status': 'active',
        'createdAt': _now_iso(),
        'createdBy': 'onboard_tenant.py',
    }
    table = ddb.Table(TENANTS_TABLE)
    try:
        table.put_item(
            Item=item,
            ConditionExpression='attribute_not_exists(tenantId)',
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            print(f'[skip] tenant row {args.tenant_id} already exists — leaving it untouched')
            return False
        raise
    print(f'[ok]   tenant row {args.tenant_id} created')
    return True


def create_admin_user(cognito, args):
    """Invite the first admin user. custom:tenantId stamped immutably."""
    try:
        cognito.admin_create_user(
            UserPoolId=COGNITO_POOL_ID,
            Username=args.admin_email,
            UserAttributes=[
                {'Name': 'email',                       'Value': args.admin_email},
                {'Name': 'email_verified',              'Value': 'true'},
                {'Name': 'custom:custom:role',          'Value': 'admin'},
                {'Name': 'custom:custom:memberId',      'Value': ''},
                {'Name': 'custom:custom:tenantId',      'Value': args.tenant_id},
            ],
            DesiredDeliveryMediums=['EMAIL'],
        )
        print(f'[ok]   admin {args.admin_email} invited — temp password sent via email')
    except cognito.exceptions.UsernameExistsException:
        print(f'[skip] admin {args.admin_email} already exists in Cognito')


def print_next_steps(args):
    print()
    print('=' * 60)
    print(f'Tenant {args.tenant_id} onboarded.')
    print('=' * 60)
    print()
    print('What you still need to do:')
    print()
    if not args.sola_x_key:
        print(f'  1. Collect the tenant\'s Sola xKey + iFields key from Sola.')
        print(f'     Then update the tenant row:')
        print(f'       aws dynamodb update-item --table-name stcd_tenants \\')
        print(f'         --key \'{{"tenantId":{{"S":"{args.tenant_id}"}}}}\' \\')
        print(f'         --update-expression "SET solaXKey = :k, solaIFieldsKey = :i" \\')
        print(f'         --expression-attribute-values \'{{":k":{{"S":"NEW_KEY"}},":i":{{"S":"NEW_IF_KEY"}}}}\' \\')
        print(f'         --profile stcd --region {REGION}')
        print()
    if args.domain:
        print(f'  2. Wire the custom domain {args.domain} in Amplify console:')
        print(f'     - Add custom domain to the existing Amplify app')
        print(f'     - ACM issues a cert; validate via DNS')
        print(f'     - CNAME the tenant\'s domain at their DNS provider')
        print(f'     - Verify CORS in lambda_function.py ALLOWED_ORIGINS accepts the new origin')
        print()
    print(f'  3. Upload tenant logo to S3 (or have the admin do it via Settings → Branding):')
    print(f'       aws s3 cp <logo.png> s3://stcd-saas-tenant-assets-574630139917/tenants/{args.tenant_id}/logo.png \\')
    print(f'         --content-type image/png --profile stcd --region {REGION}')
    print()
    print(f'  4. First admin logs in at the portal URL with the emailed temp password,')
    print(f'     resets their password, and starts inviting other admins / members.')
    print()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--tenant-id', required=True,
                   help='Lowercase short slug. Used in JWT claim, S3 prefix, URL subdomain.')
    p.add_argument('--display-name', required=True, help='Shown in header and emails.')
    p.add_argument('--legal-name', help='Full legal name for receipts / statements. Defaults to --display-name.')
    p.add_argument('--admin-email', required=True, help='First admin user email — gets the Cognito invite.')
    p.add_argument('--from-email', help='SES from-address for outbound emails.')
    p.add_argument('--primary-color',   default='#1a365d')
    p.add_argument('--secondary-color', default='#2a4a7f')
    p.add_argument('--accent-color',    default='#c6973f')
    p.add_argument('--domain', help='Custom domain (e.g. portal.example.org). Optional.')
    p.add_argument('--sola-x-key',       help='Sola merchant xKey. Can be set later.')
    p.add_argument('--sola-ifields-key', help='Sola iFields public key. Can be set later.')
    p.add_argument('--timezone', default='America/New_York', help='IANA tz, default America/New_York.')
    p.add_argument('--tax-id')
    p.add_argument('--address')
    p.add_argument('--profile', default='stcd', help='AWS CLI profile to use.')
    p.add_argument('--dry-run', action='store_true', help='Print what would be created without writing.')
    args = p.parse_args()

    if not args.tenant_id.replace('-', '').replace('_', '').isalnum():
        print(f'ERROR: tenant-id must be alphanumeric (+ - _). Got: {args.tenant_id!r}', file=sys.stderr)
        sys.exit(2)

    session = boto3.Session(profile_name=args.profile, region_name=REGION)
    ddb = session.resource('dynamodb')
    cognito = session.client('cognito-idp')

    if args.dry_run:
        print('--- DRY RUN — no writes ---')
        print(f'tenantId:    {args.tenant_id}')
        print(f'displayName: {args.display_name}')
        print(f'adminEmail:  {args.admin_email}')
        print(f'colors:      {args.primary_color} / {args.secondary_color} / {args.accent_color}')
        if args.domain: print(f'domain:      {args.domain}')
        print('---')
        return 0

    created = create_tenant_row(ddb, args)
    create_admin_user(cognito, args)
    print_next_steps(args)
    return 0 if created else 1


if __name__ == '__main__':
    sys.exit(main())
