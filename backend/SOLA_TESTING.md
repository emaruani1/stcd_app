# Sola / Cardknox sandbox testing

Source: <https://docs.solapayments.com/>

## How to force a decline

Pick any one of these — they all work in the sandbox account:

| Trigger | Effect |
|---|---|
| Amount **$9.91** | Declined |
| Amount **$9.92** | Gateway Error |
| Cardholder name `Decline` (sent as `xName`) | Declined |

## Other useful sandbox amount triggers

| Amount | Effect |
|---|---|
| **$7.29** | Approved after a 30-second delay (timeout testing) |
| **$7.31** or **$7.32** | "Try Again" response after a 30-second delay |
| **$7.50** with `AllowPartialAuth` | Partial auth of $1.50 |

Any other amount → approved.

## Test cards

| Brand | Number |
|---|---|
| Visa | `4444333322221111` |
| Visa | `4111111111111111` |
| Visa (3DS) | `4000000000002503` |
| Mastercard | `5454545454545454` |
| Discover | `6011208703331119` |
| American Express | `370276000431054` |

Any future expiry, any CVV.

## Where to look this up next time

- Sola docs: <https://docs.solapayments.com/>
- Dev SDK / sandbox credentials portal: <https://solapayments.com/devsdk/>
- Current sandbox `xKey` lives in Lambda env `SOLA_X_KEY` (and on the `stcd` row in `stcd_tenants` after Phase 3).

## Lambda deploy quick-ref

The Lambda code lives in `backend/lambda_function.py`; deps are pre-baked into `backend/lambda_deploy.zip`. To ship a code-only change:

```bash
cd backend
cp lambda_deploy.zip lambda_deploy_new.zip
python -c "
import zipfile, shutil
with zipfile.ZipFile('lambda_deploy_new.zip','r') as zin, \
     zipfile.ZipFile('lambda_deploy_tmp.zip','w', zipfile.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        if it.filename == 'lambda_function.py': continue
        zout.writestr(it, zin.read(it.filename))
    zout.write('lambda_function.py', 'lambda_function.py')
shutil.move('lambda_deploy_tmp.zip','lambda_deploy_new.zip')
"
aws lambda update-function-code \
  --function-name stcd_api \
  --zip-file fileb://lambda_deploy_new.zip \
  --profile stcd --region us-east-2
rm lambda_deploy_new.zip
```

Frontend deploys via Amplify on `git push origin main`.

## Phase 1 migration-mode env vars

Per-table flags on the `stcd_api` Lambda. Set on the Lambda env, no redeploy needed.

| Env var | Mode | Meaning |
|---|---|---|
| `<TABLE>_TABLE_MODE=legacy` | reads + writes → old table only |
| `<TABLE>_TABLE_MODE=dual_write_read_legacy` | writes both, reads from legacy |
| `<TABLE>_TABLE_MODE=dual_write_read_v2` | writes both, reads from v2 (current state for all 7 tables) |
| `<TABLE>_TABLE_MODE=v2_only` | reads + writes → v2 only (cutover complete) |

Tables: `MEMBERS`, `TRANSACTIONS`, `PLEDGES`, `SETTINGS`, `SPONSORSHIPS`, `EMAILS`, `PAYMENT_METHODS`.

If a `v2_only` flip breaks anything, flip back to `dual_write_read_v2` — legacy is still in sync as the safety net until we explicitly drop those tables.
