# Commissions Code Review — Issues Found & Fixes Required

## CRITICAL (will crash at runtime)

### 1. `require_user` does not exist — used `require_auth`
**Severity**: CRITICAL — all 4 endpoints broken at import time

The repo uses `require_auth` (defined at `api/server.py:331`), not `require_user`.
Every endpoint I wrote uses `Depends(require_user)` which will raise `NameError`.

**Fix**: Replace all `require_user` with `require_auth`, rename `current_user` to `user`
(matching the existing convention `_user: dict = Depends(require_auth)`).

### 2. `markPaid` body not received by backend
**Severity**: CRITICAL

The API client sends `payment_period` as a JSON body:
```ts
apiClient.post(`/commissions/${commissionId}/mark-paid`, { payment_period: paymentPeriod })
```
But the backend declares it as a bare `str` parameter:
```python
async def mark_commission_paid(commission_id: str, payment_period: str, ...)
```
In FastAPI, a bare `str` in a POST handler is a **query parameter**, not a body field.
The body is silently ignored and `payment_period` will be `None`.

**Fix**: Add a Pydantic `BaseModel` for the request body (matching the repo's
pattern: `CreateBidBody`, `PatchBidBody`, etc.).

### 3. MySQL trigger has dead code
**Severity**: Medium

The trigger has a line `SET v_crm_rep_id = NULL; -- no-op, just skip` which is
confusing dead code. The nested IF/ELSE is correct but the no-op line should be removed.

## MODULARITY / DRY

### 4. Backend routes should be in `api/commissions.py`, not inline in `server.py`
**Severity**: High — violates established architecture

Every other API domain is a separate module with a `register(app, require_auth)`
function called from `server.py`:
- `api/estimating.py` → `register()` at :1378
- `api/proposals.py` → `register()` at :383
- `api/settings.py` → `register()` at :668
- `api/properties.py` → `register()` at :147
- `api/beam_routes.py` → `register()` at :107

I put ~200 lines of commissions code inline in `server.py`, breaking this pattern.

**Fix**: Move to `api/commissions.py` with `register(app, require_auth)`.

### 5. `formatMoney` duplicates existing `formatCents`
**Severity**: Medium — DRY violation

The repo already has `formatCents(cents: number): string` in:
- `studio/src/lib/estimating/maintenance.ts:372`
- `studio/src/lib/estimating/install.ts:312`

Both do: `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

I created a new `formatMoney` in `types/commissions.ts` that does the same thing
with `Intl.NumberFormat`. Should reuse the existing utility.

### 6. Role checks should use `useRole` hook and `lib/roles.ts`
**Severity**: Medium — DRY violation

The repo has:
- `studio/src/lib/roles.ts` with `CROSS_BRANCH_ROLES = ['admin', 'vice_president', 'ceo']`
- `studio/src/hooks/useRole.ts` with `useRole()` returning `{ isAdmin, seesAllBranches, canAccess }`

I hardcoded `user?.role === 'admin' || user?.role === 'vice_president' || user?.role === 'ceo'`
in the component instead of using `useRole()`.

### 7. Backend role checks should use `authz.normalize_role()` and `authz.CROSS_BRANCH_ROLES`
**Severity**: Medium — DRY violation

The repo has `api/authz.py` with:
- `CROSS_BRANCH_ROLES = frozenset({"admin", "vice_president", "ceo"})`
- `normalize_role(role)` for handling legacy roles

I hardcoded `("admin", "vice_president", "ceo")` in each endpoint.

## STANDARDS

### 8. Types should be re-exported from `types/index.ts`
The repo centralizes types in `types/index.ts`. I created `types/commissions.ts`
but didn't add a re-export. Not critical but inconsistent.

### 9. Missing Pydantic model for mark-paid request
The repo uses Pydantic `BaseModel` for all POST bodies (`CreateBidBody`,
`PatchBidBody`, `CalendarEventCreateBody`, etc.). I didn't create one.

### 10. Frontend: `formatRate` and `formatPaymentPeriod` should be utility functions
These are presentation helpers that don't belong in a types file. The repo
puts formatting in `lib/` (e.g., `lib/estimating/maintenance.ts`).

## Summary

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | `require_user` → `require_auth` | CRITICAL | Backend |
| 2 | `markPaid` body not received | CRITICAL | Backend |
| 3 | Dead code in trigger | Medium | Database |
| 4 | Routes inline vs module | High | Modularity |
| 5 | `formatMoney` duplicates `formatCents` | Medium | DRY |
| 6 | Inline role checks vs `useRole` | Medium | DRY |
| 7 | Hardcoded role tuples vs `authz.py` | Medium | DRY |
| 8 | Types not re-exported | Low | Standards |
| 9 | Missing Pydantic model | High | Standards |
| 10 | Helpers in types file | Low | Standards |
