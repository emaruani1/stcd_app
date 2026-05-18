"""
One-time backfill: stamp createdAt + modifiedAt on every existing row in
every STCD DynamoDB table.

Idempotent: uses if_not_exists() in the UpdateExpression so existing
createdAt / modifiedAt values are NEVER overwritten. Rows that already
have both fields are skipped server-side (the update is a no-op write,
but we filter client-side to keep the WCU bill down).

Run AFTER the Lambda has been deployed with universal stamping, so any
writes that happen during/after the backfill carry their own real
timestamps.

Usage:
    cd backend
    python backfill_timestamps.py --profile stcd --region us-east-2 --dry-run
    python backfill_timestamps.py --profile stcd --region us-east-2
    python backfill_timestamps.py --profile stcd --region us-east-2 \
        --tables stcd_members_v2 stcd_pledges_v2
"""
import argparse
import sys
import time
import boto3
from botocore.exceptions import ClientError


# All 8 STCD tables. Listed explicitly so a typo in --tables can't make
# us scan something unintended.
ALL_TABLES = [
    'stcd_tenants',
    'stcd_settings_v2',
    'stcd_emails_v2',
    'stcd_sponsorships_v2',
    'stcd_members_v2',
    'stcd_payment_methods_v2',
    'stcd_pledges_v2',
    'stcd_transactions_v2',
]


def _now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _table_key_names(client, table_name):
    """Read the PK/SK attribute names from the table's schema so we don't
    have to hardcode them per table."""
    desc = client.describe_table(TableName=table_name)['Table']
    return [k['AttributeName'] for k in desc['KeySchema']]


def _scan_all(table):
    """Yield every item in the table, paging through LastEvaluatedKey."""
    last_key = None
    while True:
        kw = {}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        res = table.scan(**kw)
        for item in res.get('Items', []):
            yield item
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break


def backfill_table(ddb, client, table_name, dry_run):
    """Stamp createdAt + modifiedAt on every row that's missing them.
    Returns (scanned, updated, skipped) counts."""
    print(f'\n--- {table_name} ---')
    try:
        key_names = _table_key_names(client, table_name)
    except ClientError as e:
        print(f'  ERROR describing {table_name}: {e}')
        return (0, 0, 0)
    print(f'  key schema: {key_names}')

    table = ddb.Table(table_name)
    now = _now_iso()
    scanned = 0
    updated = 0
    skipped = 0
    errors = 0

    for item in _scan_all(table):
        scanned += 1
        has_created = 'createdAt' in item
        has_modified = 'modifiedAt' in item
        if has_created and has_modified:
            skipped += 1
            continue

        key = {k: item[k] for k in key_names}
        if dry_run:
            updated += 1
            if updated <= 5:
                # Show the first few so the operator can sanity-check
                # before the live run.
                print(f'  [dry-run] would stamp {key}  '
                      f'(createdAt missing={not has_created}, modifiedAt missing={not has_modified})')
            continue

        try:
            # if_not_exists guarantees we never overwrite a real value.
            # Both fields are set in one update call to halve the WCU.
            table.update_item(
                Key=key,
                UpdateExpression='SET createdAt = if_not_exists(createdAt, :now), modifiedAt = if_not_exists(modifiedAt, :now)',
                ExpressionAttributeValues={':now': now},
            )
            updated += 1
        except ClientError as e:
            errors += 1
            print(f'  ERROR on {key}: {e}')

    verb = 'would update' if dry_run else 'updated'
    print(f'  scanned={scanned}  {verb}={updated}  already_stamped_skipped={skipped}  errors={errors}')
    return (scanned, updated, skipped)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', default='stcd')
    ap.add_argument('--region', default='us-east-2')
    ap.add_argument('--tables', nargs='+', default=ALL_TABLES,
                    help='Subset of tables to backfill. Default: all 8.')
    ap.add_argument('--dry-run', action='store_true',
                    help='Scan and report what would change; write nothing.')
    args = ap.parse_args()

    unknown = [t for t in args.tables if t not in ALL_TABLES]
    if unknown:
        print(f'ERROR: unknown table name(s): {unknown}')
        print(f'Valid tables: {ALL_TABLES}')
        return 2

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    ddb = session.resource('dynamodb')
    client = session.client('dynamodb')

    print(f'Profile: {args.profile}   Region: {args.region}')
    print(f'Mode:    {"DRY RUN" if args.dry_run else "LIVE"}')
    print(f'Tables:  {args.tables}')

    totals = [0, 0, 0]
    for table_name in args.tables:
        s, u, sk = backfill_table(ddb, client, table_name, args.dry_run)
        totals[0] += s
        totals[1] += u
        totals[2] += sk

    print()
    print(f'TOTAL  scanned={totals[0]}  {"would update" if args.dry_run else "updated"}={totals[1]}  already_stamped_skipped={totals[2]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
