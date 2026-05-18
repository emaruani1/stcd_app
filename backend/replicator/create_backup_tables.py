"""
Create faithful copies of all 8 STCD DynamoDB tables in us-west-2, in the
same AWS account (574630139917). Same KeySchema, AttributeDefinitions, and
GlobalSecondaryIndexes as the originals. On-demand billing. Point-In-Time
Recovery enabled.

Reads each schema from a schema_*.json file that's a dump of
DescribeTable.Table. Idempotent: if a target table already exists, just
ensures PITR is on and moves on.

Usage:
    python create_backup_tables.py
"""
import json
import sys
import time
import glob
import boto3
from botocore.exceptions import ClientError


SOURCE_REGION = 'us-east-2'
TARGET_REGION = 'us-west-2'
PROFILE = 'stcd'


def _make_create_kwargs(schema):
    """Translate a DescribeTable dump into CreateTable kwargs.
    PAY_PER_REQUEST so we don't have to provision RCUs/WCUs."""
    kw = {
        'TableName': schema['Name'],
        'KeySchema': schema['KeySchema'],
        'AttributeDefinitions': schema['AttributeDefinitions'],
        'BillingMode': 'PAY_PER_REQUEST',
    }
    gsis = schema.get('GSI') or []
    if gsis:
        kw['GlobalSecondaryIndexes'] = [
            {
                'IndexName': g['IndexName'],
                'KeySchema': g['KeySchema'],
                'Projection': g['Projection'],
                # No ProvisionedThroughput in on-demand mode.
            }
            for g in gsis
        ]
    return kw


def _wait_active(client, table_name, timeout_s=300):
    """Poll until the table reaches ACTIVE state."""
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            status = client.describe_table(TableName=table_name)['Table']['TableStatus']
            if status == 'ACTIVE':
                return True
            print(f'  {table_name} status={status} ...')
        except ClientError as e:
            print(f'  describe error: {e}')
        time.sleep(5)
    return False


def _enable_pitr(client, table_name):
    """Turn on Point-In-Time Recovery; harmless if already on."""
    try:
        client.update_continuous_backups(
            TableName=table_name,
            PointInTimeRecoverySpecification={'PointInTimeRecoveryEnabled': True},
        )
        print(f'  PITR enabled on {table_name}')
    except ClientError as e:
        # AlreadyEnabled or in-progress is fine
        code = e.response.get('Error', {}).get('Code', '')
        if 'ContinuousBackupsUnavailable' in code:
            print(f'  WARN: PITR not yet available on {table_name}; retry once table is active')
        else:
            print(f'  PITR error on {table_name}: {e}')


def main():
    session = boto3.Session(profile_name=PROFILE, region_name=TARGET_REGION)
    client = session.client('dynamodb')

    print(f'Target region: {TARGET_REGION}')
    print(f'Profile:       {PROFILE}')
    print()

    schema_dir = 'C:/Users/elima/OneDrive/Documents/Python Projects/stcd_app/backend/replicator'
    schema_files = sorted(glob.glob(f'{schema_dir}/schema_*.json'))
    if not schema_files:
        print(f'ERROR: no schema_*.json files in {schema_dir}'); return 2

    created = 0
    existed = 0
    for path in schema_files:
        schema = json.load(open(path))
        table_name = schema['Name']
        print(f'--- {table_name} ---')

        try:
            client.describe_table(TableName=table_name)
            print(f'  exists in {TARGET_REGION}, skipping create')
            existed += 1
        except client.exceptions.ResourceNotFoundException:
            kwargs = _make_create_kwargs(schema)
            client.create_table(**kwargs)
            print(f'  create_table issued')
            created += 1

        if not _wait_active(client, table_name):
            print(f'  ERROR: {table_name} did not reach ACTIVE in time'); continue
        _enable_pitr(client, table_name)

    print()
    print(f'Done. {created} created, {existed} already existed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
