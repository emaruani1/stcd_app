"""
STCD API Lambda Handler
Handles: Members, Transactions, Pledges, Settings, Sponsorships, Emails CRUD
"""
import json
import os
import uuid
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
members_table = dynamodb.Table(os.environ.get('MEMBERS_TABLE', 'stcd_members'))
transactions_table = dynamodb.Table(os.environ.get('TRANSACTIONS_TABLE', 'stcd_transactions'))
pledges_table = dynamodb.Table(os.environ.get('PLEDGES_TABLE', 'stcd_pledges'))
sponsorships_table = dynamodb.Table(os.environ.get('SPONSORSHIPS_TABLE', 'stcd_sponsorships'))
emails_table = dynamodb.Table(os.environ.get('EMAILS_TABLE', 'stcd_emails'))
settings_table = dynamodb.Table(os.environ.get('SETTINGS_TABLE', 'stcd_settings'))

ALLOWED_ORIGINS = [
    'https://main.dvy7odxzbdj95.amplifyapp.com',
    'http://localhost:5173',
    'http://localhost:3000',
]


def get_cors_headers(event):
    origin = ''
    headers = event.get('headers') or {}
    # Headers can be mixed case from API Gateway
    for k, v in headers.items():
        if k.lower() == 'origin':
            origin = v
            break
    allowed = origin if origin in ALLOWED_ORIGINS else ALLOWED_ORIGINS[0]
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
    }


def _json_default(obj):
    if isinstance(obj, Decimal):
        return float(obj) if obj % 1 else int(obj)
    if isinstance(obj, set):
        return sorted(list(obj))
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


_current_event = {'headers': {}}


def respond(status, body):
    return {
        'statusCode': status,
        'headers': get_cors_headers(_current_event),
        'body': json.dumps(body, default=_json_default),
    }


def parse_body(event):
    body = event.get('body', '{}')
    if isinstance(body, str):
        return json.loads(body) if body else {}
    return body or {}


def extract_path_id(path, prefix):
    """Extract the ID segment after a prefix. e.g. '/members/779' with prefix '/members/' -> '779'"""
    rest = path[len(prefix):]
    return rest.split('/')[0] if rest else None


def lambda_handler(event, context):
    global _current_event
    _current_event = event

    method = event.get('httpMethod', '')
    path = event.get('path', '')

    if method == 'OPTIONS':
        return respond(200, {'message': 'ok'})

    try:
        # ===== MEMBERS =====
        if path == '/members' and method == 'GET':
            return get_members(event)
        if path == '/members/merge' and method == 'POST':
            return merge_members(parse_body(event))
        if path.startswith('/members/') and method == 'GET':
            return get_member(extract_path_id(path, '/members/'))
        if path == '/members' and method == 'POST':
            return create_member(parse_body(event))
        if path.startswith('/members/') and method == 'PUT':
            return update_member(extract_path_id(path, '/members/'), parse_body(event))

        # ===== TRANSACTIONS =====
        if path == '/transactions' and method == 'GET':
            return get_transactions(event)
        if path.startswith('/transactions/member/') and method == 'GET':
            member_id = path.split('/transactions/member/')[1]
            return get_member_transactions(member_id, event)
        if path == '/transactions' and method == 'POST':
            return create_transaction(parse_body(event))
        if path.startswith('/transactions/') and method == 'PUT':
            return update_transaction(parse_body(event))
        if path.startswith('/transactions/') and method == 'DELETE':
            return delete_transaction(parse_body(event))

        # ===== PLEDGES =====
        if path == '/pledges' and method == 'GET':
            return get_pledges(event)
        if path.startswith('/pledges/member/') and method == 'GET':
            member_id = path.split('/pledges/member/')[1]
            return get_member_pledges(member_id)
        if path == '/pledges' and method == 'POST':
            return create_pledge(parse_body(event))
        if path.startswith('/pledges/') and method == 'PUT':
            return update_pledge(parse_body(event))
        if path.startswith('/pledges/pay') and method == 'POST':
            return pay_pledge(parse_body(event))
        if path.startswith('/pledges/') and method == 'DELETE':
            return delete_pledge(parse_body(event))

        # ===== SETTINGS =====
        if path == '/settings' and method == 'GET':
            return get_all_settings()
        if path.startswith('/settings/') and method == 'GET':
            key = path.split('/settings/')[1]
            return get_setting(key)
        if path.startswith('/settings/') and method == 'PUT':
            key = path.split('/settings/')[1]
            return update_setting(key, parse_body(event))

        # ===== SPONSORSHIPS =====
        if path == '/sponsorships' and method == 'GET':
            return get_sponsorships()
        if path.startswith('/sponsorships/') and method == 'PUT':
            date_key = extract_path_id(path, '/sponsorships/')
            return update_sponsorship(date_key, parse_body(event))
        if path.startswith('/sponsorships/') and method == 'DELETE':
            date_key = extract_path_id(path, '/sponsorships/')
            return delete_sponsorship(date_key, parse_body(event))

        # ===== EMAILS =====
        if path == '/emails' and method == 'GET':
            return get_emails()
        if path == '/emails' and method == 'POST':
            return create_email(parse_body(event))

        return respond(404, {'error': f'Not found: {method} {path}'})

    except Exception as e:
        print(f"Error: {e}")
        return respond(500, {'error': str(e)})


# ===================== MEMBERS =====================

def get_members(event):
    qs = event.get('queryStringParameters') or {}
    result = members_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = members_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])

    # Sort by lastName, firstName
    items.sort(key=lambda x: (x.get('lastName', '').lower(), x.get('firstName', '').lower()))
    return respond(200, items)


def get_member(member_id):
    result = members_table.get_item(Key={'memberId': member_id})
    item = result.get('Item')
    if not item:
        return respond(404, {'error': 'Member not found'})
    return respond(200, item)


def create_member(body):
    member_id = body.get('memberId', str(uuid.uuid4())[:8])
    body['memberId'] = member_id
    body['balance'] = Decimal(str(body.get('balance', 0)))
    members_table.put_item(Item=body)
    return respond(201, body)


def update_member(member_id, body):
    expr_parts = []
    expr_values = {}
    expr_names = {}
    for key, value in body.items():
        if key == 'memberId':
            continue
        safe_key = f"#{key}"
        expr_names[safe_key] = key
        expr_parts.append(f"{safe_key} = :{key}")
        if isinstance(value, (int, float)):
            expr_values[f":{key}"] = Decimal(str(value))
        else:
            expr_values[f":{key}"] = value

    if not expr_parts:
        return respond(400, {'error': 'No fields to update'})

    members_table.update_item(
        Key={'memberId': member_id},
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    return respond(200, {'message': 'Member updated', 'memberId': member_id})


def merge_members(body):
    primary_id = body['primaryId']
    secondary_id = body['secondaryId']
    field_values = body.get('fieldValues', {})

    primary = members_table.get_item(Key={'memberId': primary_id}).get('Item', {})
    secondary = members_table.get_item(Key={'memberId': secondary_id}).get('Item', {})

    if not primary or not secondary:
        return respond(404, {'error': 'One or both members not found'})

    # Apply field overrides
    for key, value in field_values.items():
        primary[key] = value

    # Merge aliases
    aliases = set(primary.get('aliases', []) + secondary.get('aliases', []))
    sec_name = f"{secondary.get('firstName', '')} {secondary.get('lastName', '')}".strip()
    if sec_name:
        aliases.add(sec_name)
    primary['aliases'] = list(aliases)

    # Merge balance
    primary['balance'] = Decimal(str(primary.get('balance', 0))) + Decimal(str(secondary.get('balance', 0)))

    # Merge list fields
    for field in ['yahrzeits', 'children']:
        primary[field] = primary.get(field, []) + secondary.get(field, [])

    # Save merged primary
    members_table.put_item(Item=primary)

    # Move secondary's transactions to primary
    sec_txns = transactions_table.query(KeyConditionExpression=Key('memberId').eq(secondary_id))
    for txn in sec_txns.get('Items', []):
        transactions_table.delete_item(Key={'memberId': secondary_id, 'transactionId': txn['transactionId']})
        txn['memberId'] = primary_id
        transactions_table.put_item(Item=txn)

    # Move secondary's pledges to primary
    sec_pledges = pledges_table.query(KeyConditionExpression=Key('memberId').eq(secondary_id))
    for plg in sec_pledges.get('Items', []):
        pledges_table.delete_item(Key={'memberId': secondary_id, 'pledgeId': plg['pledgeId']})
        plg['memberId'] = primary_id
        pledges_table.put_item(Item=plg)

    # Delete secondary member
    members_table.delete_item(Key={'memberId': secondary_id})

    return respond(200, {'message': 'Members merged', 'memberId': primary_id})


# ===================== TRANSACTIONS =====================

def get_transactions(event):
    qs = event.get('queryStringParameters') or {}

    # If yearMonth provided, use GSI
    year_month = qs.get('yearMonth')
    if year_month:
        result = transactions_table.query(
            IndexName='date-index',
            KeyConditionExpression=Key('yearMonth').eq(year_month),
        )
        return respond(200, result['Items'])

    # Otherwise scan all
    result = transactions_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = transactions_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])

    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def get_member_transactions(member_id, event):
    result = transactions_table.query(
        KeyConditionExpression=Key('memberId').eq(member_id),
    )
    items = result['Items']
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_transaction(body):
    member_id = body['memberId']
    date = body.get('date', '')
    txn_id = f"TXN#{date}#{uuid.uuid4().hex[:8]}"

    item = {
        'memberId': member_id,
        'transactionId': txn_id,
        'date': date,
        'txnDate': date,
        'yearMonth': date[:7] if date else '',
        'description': body.get('description', ''),
        'amount': Decimal(str(body.get('amount', 0))),
        'method': body.get('method', ''),
        'paymentType': body.get('paymentType', ''),
        'source': body.get('source', ''),
        'category': body.get('category', ''),
        'groupId': body.get('groupId', ''),
        'pledgeId': body.get('pledgeId', ''),
        'productId': body.get('productId', ''),
    }
    # Clean empty strings
    item = {k: v for k, v in item.items() if v != '' or k in ('memberId', 'transactionId', 'date')}

    transactions_table.put_item(Item=item)

    # If this is a pledge payment linked to a specific pledge, update the pledge
    if body.get('pledgeId') and body.get('paymentType') == 'pledge':
        _apply_pledge_payment(member_id, body['pledgeId'], Decimal(str(body.get('amount', 0))), body.get('method', ''))

    return respond(201, item)


def update_transaction(body):
    member_id = body['memberId']
    txn_id = body['transactionId']

    update_fields = {k: v for k, v in body.items() if k not in ('memberId', 'transactionId')}
    if 'amount' in update_fields:
        update_fields['amount'] = Decimal(str(update_fields['amount']))
    if 'date' in update_fields:
        update_fields['txnDate'] = update_fields['date']
        update_fields['yearMonth'] = update_fields['date'][:7]

    expr_parts = []
    expr_values = {}
    expr_names = {}
    for key, value in update_fields.items():
        safe_key = f"#{key}"
        expr_names[safe_key] = key
        expr_parts.append(f"{safe_key} = :{key}")
        expr_values[f":{key}"] = value

    if expr_parts:
        transactions_table.update_item(
            Key={'memberId': member_id, 'transactionId': txn_id},
            UpdateExpression='SET ' + ', '.join(expr_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )

    return respond(200, {'message': 'Transaction updated'})


def delete_transaction(body):
    member_id = body['memberId']
    txn_id = body['transactionId']
    transactions_table.delete_item(Key={'memberId': member_id, 'transactionId': txn_id})
    return respond(200, {'message': 'Transaction deleted'})


# ===================== PLEDGES =====================

def get_pledges(event):
    result = pledges_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = pledges_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def get_member_pledges(member_id):
    result = pledges_table.query(
        KeyConditionExpression=Key('memberId').eq(member_id),
    )
    items = result['Items']
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_pledge(body):
    member_id = body['memberId']
    date = body.get('date', '')
    pledge_id = f"PLG#{date}#{uuid.uuid4().hex[:8]}"

    item = {
        'memberId': member_id,
        'pledgeId': pledge_id,
        'date': date,
        'pledgeType': body.get('pledgeType', ''),
        'occasion': body.get('occasion', ''),
        'description': body.get('description', ''),
        'amount': Decimal(str(body.get('amount', 0))),
        'paidAmount': Decimal('0'),
        'paid': False,
        'canceled': False,
        'paymentMethod': '',
        'category': body.get('category', 'pledge'),
    }

    pledges_table.put_item(Item=item)
    return respond(201, item)


def update_pledge(body):
    member_id = body['memberId']
    pledge_id = body['pledgeId']

    update_fields = {k: v for k, v in body.items() if k not in ('memberId', 'pledgeId')}
    if 'amount' in update_fields:
        update_fields['amount'] = Decimal(str(update_fields['amount']))
    if 'paidAmount' in update_fields:
        update_fields['paidAmount'] = Decimal(str(update_fields['paidAmount']))

    expr_parts = []
    expr_values = {}
    expr_names = {}
    for key, value in update_fields.items():
        safe_key = f"#{key}"
        expr_names[safe_key] = key
        expr_parts.append(f"{safe_key} = :{key}")
        expr_values[f":{key}"] = value

    if expr_parts:
        pledges_table.update_item(
            Key={'memberId': member_id, 'pledgeId': pledge_id},
            UpdateExpression='SET ' + ', '.join(expr_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )

    return respond(200, {'message': 'Pledge updated'})


def pay_pledge(body):
    """Record a payment against a pledge. Creates a transaction and updates the pledge."""
    member_id = body['memberId']
    pledge_id = body['pledgeId']
    amount = Decimal(str(body.get('amount', 0)))
    method = body.get('method', '')
    date = body.get('date', '')

    # Get current pledge
    result = pledges_table.get_item(Key={'memberId': member_id, 'pledgeId': pledge_id})
    pledge = result.get('Item')
    if not pledge:
        return respond(404, {'error': 'Pledge not found'})

    new_paid = pledge.get('paidAmount', Decimal('0')) + amount
    is_fully_paid = new_paid >= pledge.get('amount', Decimal('0'))

    # Update pledge
    pledges_table.update_item(
        Key={'memberId': member_id, 'pledgeId': pledge_id},
        UpdateExpression='SET paidAmount = :paid, paid = :isPaid, paymentMethod = :method',
        ExpressionAttributeValues={
            ':paid': new_paid,
            ':isPaid': is_fully_paid,
            ':method': method,
        },
    )

    # Create transaction record
    txn_id = f"TXN#{date}#{uuid.uuid4().hex[:8]}"
    desc = pledge.get('description', 'Pledge Payment')
    if amount < (pledge.get('amount', Decimal('0')) - pledge.get('paidAmount', Decimal('0'))):
        desc += ' (Partial)'

    txn = {
        'memberId': member_id,
        'transactionId': txn_id,
        'date': date,
        'txnDate': date,
        'yearMonth': date[:7] if date else '',
        'description': desc,
        'amount': amount,
        'method': method,
        'paymentType': 'pledge',
        'pledgeId': pledge_id,
    }
    transactions_table.put_item(Item=txn)

    return respond(200, {'message': 'Payment recorded', 'pledge': {'paidAmount': new_paid, 'paid': is_fully_paid}, 'transaction': txn})


def delete_pledge(body):
    member_id = body['memberId']
    pledge_id = body['pledgeId']
    pledges_table.delete_item(Key={'memberId': member_id, 'pledgeId': pledge_id})
    return respond(200, {'message': 'Pledge deleted'})


def _apply_pledge_payment(member_id, pledge_id, amount, method):
    """Helper to apply a payment to a pledge when creating a transaction."""
    result = pledges_table.get_item(Key={'memberId': member_id, 'pledgeId': pledge_id})
    pledge = result.get('Item')
    if not pledge:
        return

    new_paid = pledge.get('paidAmount', Decimal('0')) + amount
    is_fully_paid = new_paid >= pledge.get('amount', Decimal('0'))

    pledges_table.update_item(
        Key={'memberId': member_id, 'pledgeId': pledge_id},
        UpdateExpression='SET paidAmount = :paid, paid = :isPaid, paymentMethod = :method',
        ExpressionAttributeValues={
            ':paid': new_paid,
            ':isPaid': is_fully_paid,
            ':method': method,
        },
    )


# ===================== SETTINGS =====================

def get_all_settings():
    result = settings_table.scan()
    items = result['Items']
    settings = {}
    for item in items:
        settings[item['settingKey']] = item.get('items', [])
    return respond(200, settings)


def get_setting(key):
    result = settings_table.get_item(Key={'settingKey': key})
    item = result.get('Item')
    if not item:
        return respond(404, {'error': f'Setting {key} not found'})
    return respond(200, item.get('items', []))


def update_setting(key, body):
    items = body.get('items', [])
    settings_table.put_item(Item={
        'settingKey': key,
        'items': items,
    })
    return respond(200, {'message': f'Setting {key} updated'})


# ===================== SPONSORSHIPS =====================

def get_sponsorships():
    result = sponsorships_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = sponsorships_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])
    items.sort(key=lambda x: x.get('dateKey', ''))
    return respond(200, items)


def update_sponsorship(date_key, body):
    """Update or create a sponsorship for a given Saturday date."""
    item = {'dateKey': date_key}
    if 'kiddush' in body:
        item['kiddush'] = body['kiddush']
    if 'seuda' in body:
        item['seuda'] = body['seuda']
    if 'blocked' in body:
        item['blocked'] = body['blocked']

    # Merge with existing
    existing = sponsorships_table.get_item(Key={'dateKey': date_key}).get('Item', {})
    existing.update(item)
    sponsorships_table.put_item(Item=existing)
    return respond(200, existing)


def delete_sponsorship(date_key, body):
    """Remove a kiddush or seuda booking, or unblock a date."""
    field = body.get('field')  # 'kiddush', 'seuda', or 'blocked'
    if not field:
        sponsorships_table.delete_item(Key={'dateKey': date_key})
        return respond(200, {'message': 'Sponsorship deleted'})

    # Remove just the specified field
    try:
        sponsorships_table.update_item(
            Key={'dateKey': date_key},
            UpdateExpression=f'REMOVE #{field}',
            ExpressionAttributeNames={f'#{field}': field},
        )
    except Exception:
        pass
    return respond(200, {'message': f'{field} removed'})


# ===================== EMAILS =====================

def get_emails():
    result = emails_table.scan()
    items = result['Items']
    while 'LastEvaluatedKey' in result:
        result = emails_table.scan(ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result['Items'])
    items.sort(key=lambda x: x.get('date', ''), reverse=True)
    return respond(200, items)


def create_email(body):
    email_id = f"EML#{uuid.uuid4().hex[:12]}"
    item = {
        'emailId': email_id,
        'date': body.get('date', ''),
        'type': body.get('type', ''),
        'subject': body.get('subject', ''),
        'body': body.get('body', ''),
        'recipients': body.get('recipients', []),
        'memberIds': body.get('memberIds', []),
    }
    emails_table.put_item(Item=item)
    return respond(201, item)
