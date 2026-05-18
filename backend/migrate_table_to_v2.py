"""
Generic Phase 1 backfill — copy a legacy single-tenant table into its v2
counterpart, stamping tenantId='stcd' and synthesising any GSI partition
keys the v2 schema requires.

Usage:
    python migrate_table_to_v2.py --table emails        --profile stcd
    python migrate_table_to_v2.py --table sponsorships
    python migrate_table_to_v2.py --table members
    python migrate_table_to_v2.py --table payment_methods
    python migrate_table_to_v2.py --table pledges
    python migrate_table_to_v2.py --table transactions  [--dry-run]

Idempotent — overwrites v2 rows with whatever's currently in legacy. Run
AFTER the Lambda has been flipped to dual_write_read_legacy so concurrent
writes also land in v2 (and any backfill overwrite is harmless).
"""
import argparse
import sys
import time
import boto3
from botocore.exceptions import ClientError
from decimal import Decimal


def _now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _stamp(item):
    """Ensure createdAt + modifiedAt on every migrated row. Preserves any
    existing createdAt from the source row; modifiedAt always set to now."""
    now = _now_iso()
    item.setdefault('createdAt', now)
    item['modifiedAt'] = now
    return item


def _t(d):
    """Return v2 transform for a given table_name."""
    return TRANSFORMS[d]


def transform_emails(row, tenant):
    return {**row, 'tenantId': tenant}


def transform_sponsorships(row, tenant):
    return {**row, 'tenantId': tenant}


def transform_members(row, tenant):
    return {**row, 'tenantId': tenant, 'memberId': str(row.get('memberId', ''))}


def transform_payment_methods(row, tenant):
    member_id = str(row.get('memberId', ''))
    pm_id = row.get('paymentMethodId', '')
    return {
        **row,
        'memberId': member_id,                                # always String in v2
        'tenantId': tenant,
        'memberIdPaymentMethodId': f"{member_id}#{pm_id}",
    }


def transform_pledges(row, tenant):
    member_id = str(row.get('memberId', ''))
    return {
        **row,
        'tenantId': tenant,
        'tenantIdMemberId': f"{tenant}#{member_id}",
    }


def transform_transactions(row, tenant):
    member_id = str(row.get('memberId', ''))
    year_month = row.get('yearMonth', '') or ''
    out = {
        **row,
        'tenantId': tenant,
        'tenantIdMemberId': f"{tenant}#{member_id}",
    }
    if year_month:
        out['tenantIdYearMonth'] = f"{tenant}#{year_month}"
    return out


TRANSFORMS = {
    'emails':          (transform_emails,          'stcd_emails',          'stcd_emails_v2',          'emailId'),
    'sponsorships':    (transform_sponsorships,    'stcd_sponsorships',    'stcd_sponsorships_v2',    'dateKey'),
    'members':         (transform_members,         'stcd_members',         'stcd_members_v2',         'memberId'),
    'payment_methods': (transform_payment_methods, 'stcd_payment_methods', 'stcd_payment_methods_v2', 'memberId+paymentMethodId'),
    'pledges':         (transform_pledges,         'stcd_pledges',         'stcd_pledges_v2',         'memberId+pledgeId'),
    'transactions':    (transform_transactions,    'stcd_transactions',    'stcd_transactions_v2',    'memberId+transactionId'),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--table', required=True, choices=list(TRANSFORMS.keys()))
    ap.add_argument('--profile', default='stcd')
    ap.add_argument('--region', default='us-east-2')
    ap.add_argument('--tenant', default='stcd')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    transform, source, target, _id = TRANSFORMS[args.table]
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    ddb = session.resource('dynamodb')
    src = ddb.Table(source)
    dst = ddb.Table(target)

    print(f'Table:  {args.table}')
    print(f'Source: {source}')
    print(f'Target: {target}')
    print(f'Tenant: {args.tenant}')
    print(f'Mode:   {"DRY RUN" if args.dry_run else "LIVE"}')
    print()

    rows = []
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        res = src.scan(**kw)
        rows.extend(res.get('Items', []))
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break

    print(f'Read {len(rows)} rows from {source}.')
    if not rows:
        return 0

    written = 0
    errors = 0
    for row in rows:
        new_row = transform(row, args.tenant)
        if args.dry_run:
            preview = {k: v for k, v in new_row.items() if k in ('tenantId', 'tenantIdMemberId', 'tenantIdYearMonth', 'memberIdPaymentMethodId', 'memberId', 'pledgeId', 'transactionId', 'emailId', 'dateKey', 'paymentMethodId', 'settingKey')}
            print(f'  [dry-run] {preview}')
        else:
            try:
                dst.put_item(Item=_stamp(new_row))
                written += 1
            except ClientError as e:
                errors += 1
                print(f'  ERROR: {e}  row={ {k: row.get(k) for k in ("memberId","transactionId","pledgeId","emailId","dateKey","paymentMethodId")} }')
    print(f'Done. {written} written, {errors} errors out of {len(rows)} rows.')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
