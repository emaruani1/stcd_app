"""
STCD daily cross-region replicator.

Runs once per day. For each of the 8 STCD tables, scans the source region
(us-east-2) for items whose modifiedAt falls within YESTERDAY's calendar
day in America/Chicago, and put_items them into the matching backup table
in us-west-2.

First-run behaviour: if the target backup table is empty, the run treats
every source row as "in window" and seeds the full table. Subsequent runs
do incremental, modifiedAt-bounded scans only.

Scheduled at 5:00 America/Chicago daily via an EventBridge Scheduler so
DST transitions are handled by the scheduler, not by us.

Note: this only captures inserts and updates. Hard deletes from the source
will leave stale rows in the backup tables — that's a known limitation of
the modifiedAt-based design; switch to Streams if that becomes a problem.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Attr


SOURCE_REGION = 'us-east-2'
TARGET_REGION = 'us-west-2'

# CST is UTC-6, CDT is UTC-5. We avoid a zoneinfo dependency by computing
# the window in UTC directly: 5am CT means the run starts somewhere
# between 10:00 and 11:00 UTC depending on DST. To get "yesterday in CT"
# we can equivalently look at: the day containing (now_utc - 6h) on
# winter days and (now_utc - 5h) on summer days. EventBridge Scheduler
# fires us at the right wall-clock time; from there, we just subtract the
# Lambda's now from local-CT and bucket by date.
#
# Simpler approach used here: use Python's zoneinfo from stdlib (3.9+).
# It's part of the standard library; no Lambda layer required.
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
    CT = ZoneInfo('America/Chicago')
except ImportError:  # pragma: no cover
    CT = timezone(timedelta(hours=-6))  # fallback: CST without DST


TABLES = [
    'stcd_tenants',
    'stcd_settings_v2',
    'stcd_emails_v2',
    'stcd_sponsorships_v2',
    'stcd_members_v2',
    'stcd_payment_methods_v2',
    'stcd_pledges_v2',
    'stcd_transactions_v2',
]


_source_ddb = boto3.resource('dynamodb', region_name=SOURCE_REGION)
_target_ddb = boto3.resource('dynamodb', region_name=TARGET_REGION)
_target_client = boto3.client('dynamodb', region_name=TARGET_REGION)


def _yesterday_ct_window_utc(now_utc=None):
    """Return (start_iso, end_iso) covering yesterday's calendar day in
    America/Chicago, expressed as UTC ISO strings of the form
    '2026-05-17T05:00:00Z' (inclusive start, exclusive end).
    """
    if now_utc is None:
        now_utc = datetime.now(tz=timezone.utc)
    now_ct = now_utc.astimezone(CT)
    today_ct_midnight = now_ct.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_ct_midnight = today_ct_midnight - timedelta(days=1)
    start_utc = yesterday_ct_midnight.astimezone(timezone.utc)
    end_utc = today_ct_midnight.astimezone(timezone.utc)
    return (
        start_utc.strftime('%Y-%m-%dT%H:%M:%SZ'),
        end_utc.strftime('%Y-%m-%dT%H:%M:%SZ'),
    )


def _target_is_empty(table_name):
    """Cheap check: any item in the target table? Uses Scan Limit=1 — one
    RCU at most. Returns True only if Count is 0 AND there's no
    LastEvaluatedKey (i.e. we're confident the table is empty)."""
    res = _target_ddb.Table(table_name).scan(Limit=1)
    return res.get('Count', 0) == 0 and not res.get('LastEvaluatedKey')


def _scan_window(table, start_iso, end_iso):
    """Yield items where modifiedAt is in [start_iso, end_iso). Paged.
    Filter is server-side via FilterExpression — still reads every item
    (Scan), but only returns matches across the wire."""
    flt = Attr('modifiedAt').between(start_iso, end_iso)
    # `between` is inclusive of both ends, so we adjust end down by one
    # second's worth to keep the semantic exclusive. Cleaner to just
    # compare with two conditions.
    flt = Attr('modifiedAt').gte(start_iso) & Attr('modifiedAt').lt(end_iso)
    last_key = None
    while True:
        kw = {'FilterExpression': flt}
        if last_key:
            kw['ExclusiveStartKey'] = last_key
        res = table.scan(**kw)
        for item in res.get('Items', []):
            yield item
        last_key = res.get('LastEvaluatedKey')
        if not last_key:
            break


def _scan_all(table):
    """Yield every item. Used on first-run-empty seeding."""
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


def _replicate_table(table_name, start_iso, end_iso):
    """Replicate one table. Returns a dict summary."""
    src = _source_ddb.Table(table_name)
    dst = _target_ddb.Table(table_name)

    seeded = False
    if _target_is_empty(table_name):
        seeded = True
        items_iter = _scan_all(src)
    else:
        items_iter = _scan_window(src, start_iso, end_iso)

    copied = 0
    errors = 0
    # batch_writer handles the 25-item batch limit and unprocessed retries.
    with dst.batch_writer() as batch:
        for item in items_iter:
            try:
                batch.put_item(Item=item)
                copied += 1
            except Exception as e:
                errors += 1
                print(f'[{table_name}] put_item error: {e}')

    return {
        'table': table_name,
        'mode': 'seed' if seeded else 'incremental',
        'copied': copied,
        'errors': errors,
    }


def lambda_handler(event, context):
    """Daily entrypoint."""
    start_iso, end_iso = _yesterday_ct_window_utc()
    print(json.dumps({
        'event': 'replicator_start',
        'window_start_utc': start_iso,
        'window_end_utc': end_iso,
        'tables': TABLES,
    }))

    results = []
    for t in TABLES:
        try:
            r = _replicate_table(t, start_iso, end_iso)
        except Exception as e:
            r = {'table': t, 'mode': 'error', 'copied': 0, 'errors': 1, 'message': str(e)}
            print(f'[{t}] FATAL: {e}')
        results.append(r)
        print(json.dumps({'event': 'replicator_table_done', **r}))

    summary = {
        'event': 'replicator_done',
        'window_start_utc': start_iso,
        'window_end_utc': end_iso,
        'total_copied': sum(r['copied'] for r in results),
        'total_errors': sum(r['errors'] for r in results),
        'results': results,
    }
    print(json.dumps(summary))
    return summary
