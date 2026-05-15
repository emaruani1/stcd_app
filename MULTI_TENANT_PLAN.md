# Multi-Tenant SaaS Conversion Plan

Audit + remediation plan to convert STCD into a multi-synagogue platform with strict tenant isolation.

Generated: 2026-05-10. Audit performed against AWS account `574630139917`, region `us-east-2`, profile `stcd`.

**Status as of 2026-05-15: All phases functionally complete.** A second tenant can be onboarded via `backend/onboard_tenant.py` + the Amplify custom-domain playbook in §Phase 6. Items marked ⚠️ are followups noted at the time of writing; ❌ are intentionally out-of-scope and not done by design.

---

## Goal

One deployment of the codebase serves many synagogues. Each synagogue (a "tenant") sees only its own members, transactions, pledges, settings, sponsorships, emails, and saved cards. Branding (display name, logo, colors) is per-tenant and editable by tenant admins. Card payments route to each synagogue's own Sola merchant account using their own `xKey` and credentials. Cross-tenant data access must be physically impossible at the data layer, not just filtered at the application layer.

## Locked architectural decisions

- **Payments processor stays as Sola/Cardknox.** Each synagogue brings its own Sola merchant account and their own `xKey` / credentials. No Stripe Connect migration. The platform stores each tenant's Sola credentials on the `stcd_tenants` row and looks them up per request. `iFields` public key is also per-tenant.
- **One Cognito user pool, with a `custom:tenantId` immutable attribute on every user.** Tenancy is enforced from the JWT in the Lambda. Per-tenant Cognito pools are explicitly rejected (operational complexity, no security benefit).
- **One Amplify deployment serves all tenants.** Same build artifact, either per-tenant custom domains or hostname-based tenant lookup.
- **Tenant isolation primarily enforced at the DynamoDB partition-key level**, with belt-and-braces JWT enforcement in every Lambda handler.

---

## Today's state (single-tenant, all of it)

### DynamoDB (account 574630139917, region us-east-2)
| Table | PK (HASH) | SK (RANGE) | GSIs | Tenant key? |
|---|---|---|---|---|
| `stcd_members` | `memberId` (S) | — | none | No |
| `stcd_transactions` | `memberId` (S) | `transactionId` (S) | `date-index` on (`yearMonth` HASH, `txnDate` RANGE), ALL | No (cross-tenant leak via GSI) |
| `stcd_pledges` | `memberId` (S) | `pledgeId` (S) | none | No |
| `stcd_settings` | `settingKey` (S) | — | none | No (settings are GLOBAL today) |
| `stcd_sponsorships` | `dateKey` (S) | — | none | No (two synagogues can't book same Saturday) |
| `stcd_emails` | `emailId` (S) | — | none | No |
| `stcd_payment_methods` | `memberId` (**N**) | `paymentMethodId` (S) | none | No; also `memberId` Number type mismatches every other table — fix during migration |

### Cognito
- One pool `us-east-2_Pna4Sv1p8` (`stcd-users`), one client `7hvnos43j267cl5v1m2knojeda`
- MFA OPTIONAL (TOTP). Sign-in by email
- Custom attributes: `custom:role`, `custom:memberId` only. **No `tenantId`.**
- Lambda reads them as `custom:custom:role` / `custom:custom:memberId` (intentional double prefix from Cognito JWT mapping)
- No Cognito groups; roles are encoded in the custom attribute

### API Gateway + Lambda
- REST API `stcd-api` (`uvv584f1gb`), stage `prod` → `https://uvv584f1gb.execute-api.us-east-2.amazonaws.com/prod`
- Resources `/` and `/{proxy+}`, both `ANY` + `OPTIONS`
- Authorizer `stcd-cognito-auth` (`nr7rei`), type `COGNITO_USER_POOLS`
- Lambda `stcd_api` (Python 3.12, role `stcd-lambda-role`), ~2565 lines, single-file handler
- Lambda re-verifies JWT in-handler at lines 150-199 (defense in depth)
- ~25 routes, none are tenant-scoped

### Payments (Sola/Cardknox)
- Frontend tokenises card via Cardknox iFields (`cdn.cardknox.com/ifields/3.4.2602.2001/ifields.min.js`) → SUT
- Backend posts to `https://x1.cardknox.com/gatewayjson` with **single global** env `SOLA_X_KEY=sephtoracentdalldev0505b49794f94fea8fb0e3a5b0` (sandbox-looking)
- All charges route to one merchant account today
- Lambda env: `SOLA_GATEWAY_URL`, `SOLA_SOFTWARE_NAME=STCD-App`, `SOLA_SOFTWARE_VERSION=1.0.0`, `SOLA_X_KEY`
- Frontend env: `VITE_SOLA_IFIELDS_KEY=ifields_sephatorahcentedalla541c5e8bb8d64e1a8`

### EventBridge
- Rule `stcd-monthly-membership-billing`, cron `0 10 * * ? *` (daily 10:00 UTC)
- Invokes Lambda → `run_monthly_membership_billing()` (line 1303)
- Currently iterates all members globally; would charge every tenant via wrong MID

### S3
- 0 buckets in account. Logo upload flow is greenfield.

### Hosting
- Frontend on Amplify at `https://main.dvy7odxzbdj95.amplifyapp.com`
- Only origin in Lambda CORS allowlist (`lambda_function.py:42`)

### Hard-coded branding (every reference)
- Logo: `public/stcd_logo.png` referenced in `index.html:5`, `src/components/Layout.jsx:68`, `src/pages/Login.jsx:236`
- Display name "STCD": `src/components/Layout.jsx:70`
- "Sephardic Torah Center of Dallas" / "Sephardic Torah Center" / "of Dallas":
  - `src/pages/Login.jsx:237-238`
  - `src/pages/AccountStatements.jsx:243`
  - `src/pages/MakePayment.jsx:836`
  - `src/App.jsx:32-34` (default email-template footer)
  - `src/data/fakeData.js:31-39`
  - `src/data/fakeData.js:22` (`adminUser.email = 'admin@stcd.org'`)
- `<title>STCD Member Portal</title>`: `index.html:7`
- TOTP issuer `'STCD Member Portal'`: `src/auth.js:150`
- Sola `softwareName='STCD-App'`: `src/components/IFieldsCardForm.jsx:14,47`, `src/components/PaymentChooser.jsx`, Lambda env `SOLA_SOFTWARE_NAME`
- `'STCD payment'` / `'STCD donation'` Sola descriptions: `src/pages/MakePayment.jsx:217-218`
- `f"STCD monthly membership ({plan_label})"` Sola description: `backend/lambda_function.py:1240`
- Brand colors: `src/index.css:6-35` (`:root` block — single source of truth for the whole theme)

---

## Remediation plan

### Phase 0 execution notes (2026-05-13)

- ✅ Cognito attributes `custom:tenantId` (immutable) and `custom:isSuperadmin` (mutable) added to pool `us-east-2_Pna4Sv1p8`. Schema name with the codebase's existing doubled-prefix convention: `custom:custom:tenantId`. App client `ReadAttributes`/`WriteAttributes` are null = all attributes allowed → new claims auto-flow into the JWT.
- ✅ DynamoDB table `stcd_tenants` created (PAY_PER_REQUEST, PITR enabled). First row seeded for tenant `stcd` with current branding + Sola creds copied from the Lambda env.
- ✅ S3 bucket `stcd-saas-tenant-assets-574630139917` created (block-all-public, SSE-S3, versioning). CloudFront/OAC deferred to Phase 4 (when the upload UI lands).
- ⚠️ **AWS limitation discovered:** `Mutable=false` means the attribute can NEVER be written — including the first time, on existing users. AWS only accepts the value at user *creation*. The 3 pre-Phase-0 users (operator + 2 test accounts) therefore cannot be backfilled.
  - **Resolution:** transition rule in `_get_actor()` — if `custom:custom:tenantId` claim is empty, default to `'stcd'`. New users created post-Phase-0 always get the attribute stamped via `admin-create-user`; the immutable schema then prevents tampering for the user's lifetime.
  - Remove the transition rule once the 3 legacy users are delete-and-recreated (or whenever we onboard a second tenant, since by then any empty-tenantId user is a real bug).

### Phase 0 — Foundations (Cognito + Tenants table + S3 bucket + helpers)

| # | Target | Change | Why |
|---|---|---|---|
| 0.1 | Cognito pool `us-east-2_Pna4Sv1p8` | Add custom attribute `custom:tenantId` (String, max 36, **mutable=false**) | Binds every user to one tenant; cannot be flipped via `admin_update_user_attributes` |
| 0.2 | Cognito pool | Add custom attribute `custom:isSuperadmin` (String, mutable=true) | You-the-operator need to cross tenant boundaries for support/onboarding |
| 0.3 | Cognito pool | Verify a fresh ID token's claims contain `custom:tenantId` (Cognito auto-maps custom attrs to claims; no PreTokenGeneration trigger needed unless that proves false) | The JWT is the only safe source of tenancy |
| 0.4 | New DynamoDB table `stcd_tenants` | PK: `tenantId` (S). Attributes: `displayName`, `legalName`, `domain` (vanity), `primaryColor`, `secondaryColor`, `accentColor`, `logoS3Key`, `solaXKey`, `solaIFieldsKey`, `solaSoftwareName`, `solaSoftwareVersion`, `solaGatewayUrl` (default `https://x1.cardknox.com/gatewayjson`), `timezone`, `currency`, `fromEmail`, `replyToEmail`, `emailFooterSignature`, `taxId`, `address`, `createdAt`, `createdBy`, `status` (active/suspended) | Central source of truth for everything currently hard-coded, including each synagogue's own Sola credentials |
| 0.5 | New S3 bucket `stcd-saas-tenant-assets-574630139917` + CloudFront distribution + OAC | Block public access; serve via CloudFront only | Logos and any tenant-uploaded assets need a host outside the build artifact |
| 0.6 | `backend/lambda_function.py:202-214` (`_get_actor`) | Read `tenantId` and `isSuperadmin` from verified claims | One place to read tenancy; downstream code never touches claims directly |
| 0.7 | `backend/lambda_function.py` | Add `_require_tenant()` (returns claim or 401) and `_assert_tenant_match(record_tenant)` (403 on mismatch, superadmin bypass). Add `_load_tenant(tenant_id)` that fetches and caches the tenant row | Defense at route layer in addition to PK shape |

### Phase 1 — DynamoDB schema migration

Strategy: introduce composite tenant-prefixed PKs. New table per old table with PK = `tenantId` HASH + existing key as RANGE. Dual-write → backfill all rows with `tenantId='stcd'` → cutover → drop old.

| # | Table | New schema | Notes |
|---|---|---|---|
| 1.1 | `stcd_members` | PK `tenantId` HASH + `memberId` RANGE | Update `get_members` (lambda line 701) to query, not scan |
| 1.2 | `stcd_transactions` | PK `tenantId` HASH + `transactionId` RANGE | New GSI `member-index` on (`tenantId#memberId` HASH, `txnDate` RANGE). Recreate `date-index` as (`tenantId#yearMonth` HASH, `txnDate` RANGE). The current single-attr `yearMonth` GSI is the worst cross-tenant leak |
| 1.3 | `stcd_pledges` | PK `tenantId` HASH + `pledgeId` RANGE | Add GSI on (`tenantId#memberId` HASH, `date` RANGE) for `get_member_pledges` |
| 1.4 | `stcd_settings` | PK `tenantId` HASH + `settingKey` RANGE | Settings are TODAY shared across the deployment — every tenant must have its own pledge types, payment methods, products, kiddush prices, membership plans, email templates |
| 1.5 | `stcd_sponsorships` | PK `tenantId` HASH + `dateKey` RANGE | Otherwise tenant A's kiddush booking blocks tenant B from booking the same Saturday |
| 1.6 | `stcd_emails` | PK `tenantId` HASH + `emailId` RANGE | Email-history privacy |
| 1.7 | `stcd_payment_methods` | PK `tenantId` HASH + `memberId#paymentMethodId` RANGE; **change `memberId` from Number to String** | Card vault tokens are the most sensitive data — must be tenant-isolated. Also fixes the latent type-coercion bug at lambda lines 1226, 2304, 2424 |

### Phase 2 — Lambda enforcement on every route

| # | Target | Change | Why |
|---|---|---|---|
| 2.1 | All ~25 routes in `backend/lambda_function.py:587-696` | Inject `tenant_id = _require_tenant()` at start of every branch. Pass `tenant_id` to every DynamoDB call. Reject any body containing a `tenantId` field different from the actor's | Belt-and-braces: even if PK shape is wrong somewhere, handler still 403s |
| 2.2 | `get_members` (line 701) | Replace `members_table.scan()` with `query(KeyConditionExpression=Key('tenantId').eq(tenant_id))` | Scan-and-filter is post-read; it's a leak by design |
| 2.3 | `get_transactions` (line 868) | When `yearMonth` is provided, query the new GSI with key `f'{tenant_id}#{year_month}'` | The existing GSI hashes on `yearMonth` alone — tenant boundary invisible |
| 2.4 | `merge_members` (line 811) | Assert both source and target rows have `tenantId == claims tenantId` | Otherwise admin merge could pull a row from another tenant if memberIds collide |
| 2.5 | `run_monthly_membership_billing` (line 1303) | For each tenant in `stcd_tenants`, query members where `tenantId = t`. Each tenant's charges use that tenant's `solaXKey` | Today this would charge every member with one MID |
| 2.6 | `_sola_post` (line 2116) | Take `xKey`, `xSoftwareName`, `xSoftwareVersion`, `gatewayUrl` as parameters instead of reading globals | Per-call tenant context; also makes the function unit-testable |
| 2.7 | `charge_saved_card` (line 2356), `charge_membership_fee` (line 1166), `create_payment_method` (line 2177) | Replace global `SOLA_X_KEY` env with per-call lookup: `tenant = _load_tenant(tenant_id); xkey = tenant['solaXKey']` | **The funds-routing fix.** Each synagogue's own Sola credentials |
| 2.8 | All `cognito_*` handlers (lines 1914-2100) | Stamp `custom:tenantId` from the calling admin's claims onto every newly-created user. Reject `cognito_lookup_user` / `cognito_disable_user` / `cognito_update_role` if target user's `tenantId` doesn't match caller's (superadmin bypass) | Otherwise tenant-A admin could create/disable users in tenant B |
| 2.9 | `backend/lambda_function.py:42` (`ALLOWED_ORIGINS`) | If keeping single Amplify URL, no change. If per-tenant subdomains, switch to a regex like `^https://[a-z0-9-]+\.(stcd\.app\|yoursaas\.com)$` | Otherwise CORS breaks for new tenant domains |

### Phase 3 — Per-tenant Sola credentials

(Stripe Connect path explicitly rejected. Each synagogue brings its own Sola MID, `xKey`, and iFields key.)

| # | Target | Change | Why |
|---|---|---|---|
| 3.1 | `stcd_tenants` row schema | Store `solaXKey`, `solaIFieldsKey`, `solaSoftwareName`, `solaSoftwareVersion`, `solaGatewayUrl`, `solaTokenSettings` (any per-tenant tokenisation prefs) | Per-tenant credentials lookup target |
| 3.2 | Onboarding playbook | New tenant signs up with Sola → operator collects `xKey` + `iFields` key → operator (superadmin) writes them to `stcd_tenants` row | Manual op step until you build a self-service onboarding UI |
| 3.3 | Lambda envs | Remove `SOLA_X_KEY` from Lambda environment once Phase 2.7 is live; `SOLA_GATEWAY_URL` and `SOLA_SOFTWARE_NAME` keep as fallback defaults only | Single env-level shared credential is the antithesis of multi-tenant |
| 3.4 | New backend route `GET /tenants/me/payment-config` | Returns `{ iFieldsKey, softwareName }` (NO `xKey` ever leaves the Lambda) | Frontend needs the iFields public key to bootstrap the Cardknox iframe |
| 3.5 | `src/components/IFieldsCardForm.jsx:14,21-25,47` | Read `iFieldsKey` and `softwareName` from tenant context (set in `src/main.jsx` boot) instead of `import.meta.env.VITE_SOLA_IFIELDS_KEY` | Each synagogue's iframe loads with its own iFields key |
| 3.6 | `src/components/PaymentChooser.jsx` | Pass `softwareName` from tenant context | Same |
| 3.7 | `src/pages/MakePayment.jsx:217-218` | `'STCD payment'` / `'STCD donation'` → tenant-specific descriptions (`f'{tenant.displayName} payment'`, etc.) | What shows on cardholder bank statements |
| 3.8 | `backend/lambda_function.py:1240` | `f"STCD monthly membership ({plan_label})"` → tenant-specific | Same |
| 3.9 | **Rotate** the existing `SOLA_X_KEY` (`sephtoracentdalldev0505b49794f94fea8fb0e3a5b0`) | Issue a fresh production xKey for STCD-the-tenant; write it to its `stcd_tenants` row; deactivate the old key | Old key was visible in Lambda env throughout development — rotate before any non-STCD tenant is onboarded |

### Phase 4 — Admin Settings tab + branding

| # | Target | Change | Why |
|---|---|---|---|
| 4.1 | Backend new routes | `GET /tenants/me` (returns tenant row minus credentials), `PUT /tenants/me` (admin only; updates displayName/colors/etc.), `POST /tenants/me/logo-upload` (admin only; returns presigned S3 PUT locked to `tenants/{tenantId}/logo.png`), `GET /tenants/me/branding` (called at boot) | Single API surface for the Settings tab and theming |
| 4.2 | Public route `GET /public/branding?host={hostname}` | Unauth, CDN-cacheable. Looks up tenant by `domain` field; returns name + logo URL + colors only | Login screen is pre-auth — needs branding before JWT exists |
| 4.3 | `src/pages/admin/AdminSettings.jsx:38-45` (tabs array) | Add a `'branding'` tab with: text inputs for displayName/legalName/fromEmail; color pickers for primary/secondary/accent; file upload for logo (uses presigned-URL flow). Persist via `PUT /tenants/me` | The user-facing entry point for tenant admins |
| 4.4 | `src/main.jsx` (or new `src/tenant.js`) | Before rendering `<App/>`, fetch `/tenants/me/branding` (or `/public/branding?host=` pre-auth). Apply: `document.documentElement.style.setProperty('--primary', tenant.primaryColor)` for each color var; `document.title = tenant.displayName + ' Member Portal'`; `document.querySelector('link[rel=icon]').href = tenant.faviconUrl` | CSS variables in `src/index.css:6-35` already drive the theme — one boot-time write re-themes the app |
| 4.5 | React TenantContext | New context provider holding tenant object; consumed by every place that needs `displayName`, `logoUrl`, `solaSoftwareName`, etc. | Avoids prop drilling |
| 4.6 | `src/components/Layout.jsx:67-74` | Replace `<img src="/stcd_logo.png" />` and `'STCD'` / `'Member Portal'` literals with `tenant.logoUrl` and `tenant.displayName` from context | Visible-everywhere branding bottleneck |
| 4.7 | `src/pages/Login.jsx:236-239` | Use `window.location.hostname` → `GET /public/branding?host=` to fetch logo + name pre-auth | Login is the only branded page seen pre-login |
| 4.8 | `src/pages/AccountStatements.jsx:243` | `'Sephardic Torah Center of Dallas'` → `tenant.displayName`. Pull `tenant.legalName`, `tenant.address`, `tenant.taxId` for printed/PDF statement header | Most legally-visible branding |
| 4.9 | `src/pages/MakePayment.jsx:836` | `'Sephardic Torah Center of Dallas'` → `tenant.displayName` | Membership-join blurb |
| 4.10 | `src/App.jsx:32-34` and `src/data/fakeData.js:31-39` | Strip hard-coded email-template footer signatures. Default-template fallback reads `tenant.emailFooterSignature` instead | |
| 4.11 | `src/auth.js:150` | TOTP issuer `'STCD Member Portal'` → `tenant.displayName + ' Portal'` | The otpauth URI shows in Google Authenticator — admins should see their own name |
| 4.12 | `src/data/fakeData.js:22` | Delete `adminUser.email = 'admin@stcd.org'` and the `adminUser` stub entirely; use the actual logged-in admin's email everywhere `Layout` displays it | One tiny piece of cross-tenant pollution |
| 4.13 | `index.html:5,7` | `<title>` and favicon set dynamically by `src/main.jsx` after tenant lookup (per 4.4) | Even browser tab should reflect the tenant |

### Phase 5 — Operational hygiene

| # | Target | Change | Why |
|---|---|---|---|
| 5.1 | `backend/iam-policy.json` and `stcd-lambda-role` | Narrow resource ARNs to new table names; add `s3:GetObject`/`s3:PutObject` on `stcd-saas-tenant-assets-*/tenants/*`; add `dynamodb:*` on `stcd_tenants` | Least privilege; survives migration cleanly |
| 5.2 | `stcd-monthly-membership-billing` EventBridge rule | Single-rule + fan-out-in-handler approach: handler iterates `stcd_tenants` and processes each | Per-tenant fan-out without N rules |
| 5.3 | CloudWatch | Add `tenantId` dimension to every published metric; alarms scoped per tenant | One noisy tenant shouldn't blind ops |
| 5.4 | DynamoDB | Confirm PITR enabled on every tenant-scoped table | Multi-tenant data loss is far worse than single-tenant |
| 5.5 | Sola | Rotate `SOLA_X_KEY` (per Phase 3.9). Establish key-rotation policy for new tenants | Funds-routing credential hygiene |

### Phase 6 — Frontend deploy posture

| # | Target | Change | Why |
|---|---|---|---|
| 6.1 | Amplify | Single deployment, multiple custom domains (`tcs.stcd.app`, `kkjmiami.stcd.app`, etc.) — preferred. OR single domain + tenant-from-hostname lookup | Same artifact serves all tenants — that's what makes it a SaaS |
| 6.2 | DNS | One ACM cert with SANs (or one cert per tenant subdomain), CNAMEs to Amplify | Standard custom-domain wiring |
| 6.3 | Tenant onboarding script (`backend/onboard_tenant.py`) | One-shot script: create tenant row → invite first admin user (Cognito with `custom:tenantId` set) → optionally provision custom domain. ✅ Built. | Repeatable onboarding |

#### 6.1 / 6.2 — Custom-domain wiring playbook

Per-tenant subdomains are wired via Amplify's "Manage custom domains" panel.
Single deployment, N domains. Steps when onboarding tenant #N:

1. **DNS prerequisite.** Tenant either uses a vanity subdomain you own
   (`<tenant>.stcd.app`) or provides their own domain
   (`portal.<tenant>.org`). For their own domain, they must give you NS or
   CNAME control.
2. **Amplify Console → App → Domain management → Add domain.**
   - Enter the apex or subdomain. Amplify provisions an ACM cert
     automatically (DNS validation — you'll be given a CNAME pair to add).
   - For per-tenant SUBdomains of a single apex you own, an ACM cert with
     SANs covers them; Amplify still walks the same flow per subdomain.
3. **Add the new origin to `ALLOWED_ORIGINS`** in `backend/lambda_function.py:42`,
   or switch to the regex form already sketched in Phase 2.9. Without
   this CORS will block API calls from the new domain.
4. **Set the `domain` field on the new tenant's `stcd_tenants` row** to
   the hostname (lowercased, no protocol, no path). The
   `/public/branding?host=` endpoint scans this field to resolve a
   hostname to a tenant pre-login.
5. **Confirm `/public/branding?host=<new-host>`** returns the new tenant
   before pointing real users at the domain.

Single-domain alternative (skip 6.1 / 6.2 entirely):
- Use one Amplify URL for everyone.
- Tenant resolution falls back to the JWT claim (post-login) and the
  bundled platform default (pre-login).
- Loses pre-login per-tenant branding. Simpler operationally.

#### 6.3 — Onboarding script

`backend/onboard_tenant.py` — idempotent on the tenant row, safe to retry.

```
python backend/onboard_tenant.py \
    --tenant-id kkjmiami \
    --display-name "KKJ Miami" \
    --legal-name "Kahal Kadosh Joseph of Miami" \
    --admin-email shaul@kkjmiami.example \
    --from-email noreply@kkjmiami.example \
    --primary-color "#0a4d3d" \
    --secondary-color "#1a8b6f" \
    --accent-color "#d4af37" \
    --domain portal.kkjmiami.example
```

What it does:
1. Creates the `stcd_tenants` row (skips if exists; `--dry-run` available).
2. Invites the first admin in Cognito with `custom:tenantId` stamped
   immutably — the schema attribute can never be rewritten for the user's
   lifetime, so this is the only chance to bind them.
3. Prints a next-steps checklist: Sola credential collection, Amplify
   custom-domain wiring, logo upload, first-admin login.

Sola creds intentionally optional at onboarding — paste them in via a
follow-up `dynamodb update-item` once the new tenant gets their merchant
account. Until then, `_sola_post` fails closed for the new tenant
(returns CONFIG error, no charge routes to STCD's account).

---

## Suggested execution order (when we come back to this)

1. **Phase 0.1–0.4** — Cognito attribute + Tenants table + S3 bucket. Non-breaking; existing app keeps working.
2. **Phase 0.6–0.7** — Helper functions in Lambda. Non-breaking.
3. **Phase 1** — Schema migration. Each table goes through dual-write → backfill (`tenantId='stcd'`) → cutover → drop. Do this per-table; do not big-bang.
4. **Phase 2** — Lambda enforcement on every route. Will break the app for any user without `custom:tenantId` set, so the STCD Cognito users must be backfilled with `custom:tenantId='stcd'` first.
5. **Phase 3** — Per-tenant Sola credentials. STCD-the-tenant gets its `xKey` and `iFieldsKey` written to its `stcd_tenants` row; remove from envs; rotate.
6. **Phase 4** — Settings tab + theming. Pure additive frontend work + a few new routes.
7. **Phase 5** — Ops hygiene. Concurrent with onboarding the second tenant.
8. **Phase 6** — Per-tenant subdomains when ready to onboard the second tenant publicly.

## Open questions to resolve before starting

1. **Domain strategy.** Per-tenant subdomains (`tcs.stcd.app`, etc.) or per-tenant fully-custom domains (`portal.tcsdallas.org`)? Affects ACM cert and Amplify config in Phase 6.
2. **Pre-login branding.** Do we want the login page to show each synagogue's logo and colors? Yes implies the `/public/branding?host=` route in Phase 4.2 and a tenant-by-hostname mapping. No simplifies things — generic login page, brand applies post-auth.
3. **Sola onboarding.** Manual collection of new tenant's `xKey` for now (operator pastes into Tenants row), or build a self-service onboarding wizard later? Manual is faster to ship.
4. **Tenant-admin self-service.** Can a tenant admin invite users themselves (within their own tenant), or does the operator (superadmin) provision them? Either way the JWT enforcement in Phase 2.8 is the same.
5. **Superadmin role.** What can `custom:isSuperadmin=true` do? Read-write across all tenants for support? Read-only? Define before granting.
6. **Vanity domain field.** If two tenants both want `portal.example.org` — they can't. The `stcd_tenants.domain` field is unique. Worth indexing it (GSI) for the `/public/branding?host=` lookup.

## Out of scope (intentionally)

- Migrating to Stripe / any other processor. Locked decision: Sola stays.
- Per-tenant Cognito user pools. Locked decision: one pool with `custom:tenantId`.
- Multi-region. Single region us-east-2 for now.
- Tenant-level data export / GDPR-style deletion. Worth designing later but not in this conversion.
