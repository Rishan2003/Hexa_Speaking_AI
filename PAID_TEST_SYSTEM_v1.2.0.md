# HEXA Speaking AI — Paid Test System v1.2.0

This build converts speaking mock tests from an unrestricted/free launch flow to a server-authorized paid entitlement system. Real payment credentials are intentionally not stored in the repository.

## What is implemented

- Configurable free test credits for newly initialized accounts.
- Per-user credit balance with admin +1, +5, and exact-balance controls.
- Indefinite unlimited access, with backend support for an optional expiry timestamp.
- Editable credit and unlimited test packages.
- Student Buy Tests page, current balance display, and recent payment orders.
- Credential-free development payment simulator.
- SSLCOMMERZ hosted checkout adapter for BDT payments. Gateway methods such as bKash depend on what is enabled for the merchant account.
- Server-side SSLCOMMERZ transaction validation before credits are granted.
- Payment-order idempotency: an already-paid order cannot credit the account twice.
- Test reservation ledger: credit is reserved at secure session creation, consumed after Gemini Live setup succeeds, and returned if startup fails before consumption.
- Server-only creation of paid speaking sessions in Firestore.
- Gemini Live token minting requires an authenticated, active server-created speaking session linked to a valid billing reservation. Direct mint calls cannot bypass paid access.
- Firestore client rules deny direct modification of billing settings, balances, packages, orders, reservations, and ledger records.

## Billing collections

- `billingSettings/global`
- `testEntitlements/{uid}`
- `testPackages/{packageId}`
- `paymentOrders/{orderId}`
- `testReservations/{sessionId}`
- `entitlementLedger/{entryId}`

## Environment variables

Use `.env.example` as the template. For credential-free testing:

```env
DEFAULT_FREE_TESTS=3
ALLOW_DEVELOPMENT_PAYMENTS=true
APP_URL=http://localhost:3000
```

When SSLCOMMERZ credentials are available, add them only to local secret environment storage / Vercel Project Settings, not to Git:

```env
SSLCOMMERZ_STORE_ID=
SSLCOMMERZ_STORE_PASSWORD=
SSLCOMMERZ_IS_LIVE=false
```

Keep `SSLCOMMERZ_IS_LIVE=false` for sandbox verification. Set `ALLOW_DEVELOPMENT_PAYMENTS=false` before production launch, then switch the Admin Billing default provider to SSLCOMMERZ. Only set `SSLCOMMERZ_IS_LIVE=true` after the merchant account is ready for live transactions.

For Vercel production also set `APP_URL` and `VITE_APP_URL` to the deployed HTTPS app URL and keep the existing Firebase/Gemini variables configured.

## Administrator access

Billing-admin APIs require either:

- a Firebase custom claim `admin: true` or `role: "admin"`, or
- `users/{uid}.role = "admin"` (or `admin = true`) in Firestore.

The browser cannot grant itself this role. Bootstrap the first administrator from Firebase Admin tooling / Firebase Console, then use the Billing Admin screen for paid-test management.

## Deployment order

1. Back up Firestore / deploy to a staging project first.
2. Deploy the updated `firestore.rules` so paid sessions and billing records cannot be modified directly by students.
3. Deploy the app/functions with the existing Firebase and Gemini environment variables plus the paid-test variables above.
4. Open `/admin/billing` using an administrator account.
5. Set the signup free-test allowance and package prices.
6. Keep Development as the provider and complete simulated purchases. Verify balances, test reservation, successful consumption, and startup refund behavior.
7. Add SSLCOMMERZ sandbox credentials, select SSLCOMMERZ in Billing Admin, and complete provider sandbox tests.
8. When the merchant account is production-ready, disable development payments, add live credentials, set `SSLCOMMERZ_IS_LIVE=true`, and perform a small real transaction before wider launch.

## Important behavior

Changing **Free tests on signup** changes the allowance used when a new entitlement is first initialized. It does not rewrite an existing entitlement balance. Existing students can be changed through the individual admin controls.

A paid test now follows:

`Start Test -> authenticate -> reserve access -> create authoritative Firestore session -> authorize Gemini mint -> connect Live examiner -> consume reservation`

If authoritative session persistence or initial Live connection fails before consumption, a reserved credit is released. Once a reservation is consumed, reconnection for the same active session does not charge another credit.

## Verification performed in this workspace

- All 79 TypeScript/TSX source files were syntax-transpiled with TypeScript 5.8.x: zero syntax-error files.
- `vercel.json` was parsed as valid JSON.
- Static integration checks verify the paid session-create route, Firestore server-only session creation, billing rewrite, client session ID mint authorization, reservation consume/release calls, and development/SSLCOMMERZ environment placeholders.
- A normal `npm ci` / full Vite build could not be executed in this workspace because the environment's npm registry proxy returned a 404 for a dependency tarball (`yargs-parser-21.1.1.tgz`). No `node_modules` are included in the release ZIP. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` in your normal development/CI environment before production deployment.
