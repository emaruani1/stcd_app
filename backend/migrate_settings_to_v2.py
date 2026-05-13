"""
Phase 1 backfill for stcd_settings -> stcd_settings_v2.

Reads every row from the legacy single-tenant table and writes it into the
new tenant-scoped table stamped with tenantId='stcd'. Idempotent — re-running
overwrites v2 with whatever's currently in legacy, which is what you want
while dual-write is in flight (any newer legacy write supersedes a stale v2).

Usage:
    cd backend
    python migrate_settings_to_v2.py --profile stcd --region us-east-2 \
        [--source stcd_settings] [--target stcd_settings_v2] [--tenant stcd] \
        [--dry-run]

Run AFTER the Lambda has been flipped to SETTINGS_TABLE_MODE=dual_write_read_legacy
so that any concurrent writes also land in v2. Then verify counts match before
flipping reads.
"""
import argparse
import sys
import boto3
from botocore.exceptions import ClientError


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', default='stcd')
    ap.add_argument('--region', default='us-east-2')
    ap.add_argument('--source', default='stcd_settings')
    ap.add_argument('--target', default='stcd_settings_v2')
    ap.add_argument('--tenant', default='stcd', help='tenantId to stamp on every row')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    ddb = session.resource('dynamodb')
    src = ddb.Table(args.source)
    dst = ddb.Table(args.target)

    print(f'Source: {args.source}')
    print(f'Target: {args.target}')
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

    print(f'Read {len(rows)} legacy rows from {args.source}.')
    if not rows:
        print('Nothing to migrate.'); return 0

    written = 0
    skipped = 0
    for row in rows:
        key = row.get('settingKey')
        if not key:
            skipped += 1
            print(f'  SKIP — row has no settingKey: {row}')
            continue
        item = dict(row)
        item['tenantId'] = args.tenant
        # settingKey already present from source row
        if args.dry_run:
            print(f'  [dry-run] would write tenantId={args.tenant} settingKey={key} (items count={len(item.get("items", []))})')
        else:
            try:
                dst.put_item(Item=item)
                written += 1
                print(f'  wrote: tenantId={args.tenant} settingKey={key}')
            except ClientError as e:
                print(f'  ERROR on settingKey={key}: {e}')

    print()
    print(f'Done. {written} written, {skipped} skipped.')
    if not args.dry_run:
        # Spot-check by reading back two known keys
        for k in ('membershipPlans', 'pledgeTypes'):
            try:
                got = dst.get_item(Key={'tenantId': args.tenant, 'settingKey': k}).get('Item')
                if got:
                    print(f'  verify: {k} present in target (items count={len(got.get("items", []))})')
                else:
                    print(f'  verify: {k} NOT present in target (may not exist in source either)')
            except ClientError as e:
                print(f'  verify failed for {k}: {e}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
