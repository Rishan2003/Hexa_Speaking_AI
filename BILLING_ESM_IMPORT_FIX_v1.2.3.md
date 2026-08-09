# HEXA Billing ESM Import Fix — v1.2.3

## Root cause confirmed on Vercel

The v1.2.2 zero-import bootstrap successfully started, but Node 22 returned:

`ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/api/_billingHandler' imported from /var/task/api/billing.js`

The project uses `"type": "module"`. After Vercel compiles TypeScript files to JavaScript, Node's ESM loader requires explicit `.js` extensions for relative file imports.

## Fixed import chain

- `api/billing.ts`: `import('./_billingHandler.js')`
- `api/_billingHandler.ts`: imports `./_firebaseSessionAdminLazy.js` and `./_billing.js`
- `api/_billing.ts`: imports `./_firebaseSessionAdminLazy.js`

TypeScript with `moduleResolution: "bundler"` resolves these `.js` specifiers back to the corresponding `.ts` source files during development/build, while Vercel/Node resolves them to the emitted `.js` files at runtime.

## Test after deploy

1. `/api/billing/bootstrap` should return `apiRevision: 1.2.3-billing-esm-import-fix`.
2. Sign in and inspect `/api/billing/me`.
3. If Firebase configuration is correct it should return the billing/user JSON. If Firebase credentials need attention, the endpoint should now return a readable `FIREBASE_ADMIN_INIT_FAILED` JSON response rather than an import error.
