# HEXA Speaking AI v1.3.0 — Configurable Credit Costs

## Default costs
- Part 1: 1 credit
- Part 2: 1 credit
- Part 3: 1 credit
- Full Mock: 3 credits

## Admin
Billing Admin now exposes four editable credit-cost fields under Global access settings. A value of 0 makes that practice type free. Unlimited accounts are not charged.

The existing Firestore field `signupFreeTests` is retained for backwards compatibility, but the UI now correctly describes it as free signup credits.

## Accounting/security behavior
- The server, not the browser, decides the required credit amount.
- The exact credit amount is stored on each reservation as `creditCost`.
- Failed startup refunds the exact reserved amount.
- Expired Gemini authorization refunds the exact reserved amount.
- Old reservations without `creditCost` remain backwards-compatible and refund/consume as 1 credit.
- Existing balances are not changed when an admin changes per-test costs.
- Cost changes apply to newly created reservations only.

## Default Firestore setting shape
`billingSettings/global.creditCosts`:
```json
{
  "part1": 1,
  "part2": 1,
  "part3": 1,
  "full": 3
}
```
The billing API supplies these defaults even before this object has been manually saved. Saving Billing Admin settings persists the object.
