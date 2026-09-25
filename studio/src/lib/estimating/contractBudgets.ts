// ---------------------------------------------------------------------------
// Contract-structure budgets (split maintenance: homes vs common area).
// Dollars, not cents. Null is unknown — never coerce a blank field to 0.
// A typed 0 stays 0. Mirrors the estimate create/PATCH contract.
// ---------------------------------------------------------------------------

const BUDGET_MAX = 9_999_999_999_999.99

export type BudgetParseResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

/** Half-up to the cent. 10.005 → 10.01. Blank is not handled here. */
function roundHalfUpToCents(amount: number): number {
  const negative = amount < 0
  const scaled = Math.abs(amount) * 100
  // 1e-8 covers binary error (1.005 * 100 === 100.49999999999999) without
  // pushing a value that is truly just under .5 across the boundary.
  const cents = Math.floor(scaled + 0.5 + 1e-8)
  const rounded = cents / 100
  return negative ? -rounded : rounded
}

function asJsonNumber(rounded: number): number {
  // -0 === 0, and JSON would emit 0; keep a known zero as the integer 0.
  if (rounded === 0) return 0
  const nearest = Math.round(rounded)
  if (Math.abs(rounded - nearest) < 1e-9) return nearest
  return Number(rounded.toFixed(2))
}

/**
 * Parse one budget.
 * Omitted, null, and blank (including whitespace) → null.
 * 0 / "0" / "0.00" stay 0. Non-numeric values and negatives are rejected.
 * Never uses Number('') or `|| 0` — both turn a blank field into 0.
 */
export function parseContractBudget(value: unknown, field: string): BudgetParseResult {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value === 'boolean') {
    return { ok: false, error: `${field} must be a number, blank, or null` }
  }

  let amount: number
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') return { ok: true, value: null }
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
      return { ok: false, error: `${field} must be a number, blank, or null` }
    }
    amount = Number(text)
  } else if (typeof value === 'number') {
    amount = value
  } else {
    return { ok: false, error: `${field} must be a number, blank, or null` }
  }

  if (!Number.isFinite(amount)) {
    return { ok: false, error: `${field} must be a number, blank, or null` }
  }

  const rounded = roundHalfUpToCents(amount)
  if (rounded < 0) return { ok: false, error: `${field} cannot be negative` }
  if (rounded > BUDGET_MAX) return { ok: false, error: `${field} is too large` }
  return { ok: true, value: asJsonNumber(rounded) }
}

const BUDGET_FIELDS = ['homesBudget', 'commonAreaBudget'] as const

function normalizePresentBudgets(
  record: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  for (const field of BUDGET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      const parsed = parseContractBudget(record[field], field)
      if (!parsed.ok) return parsed
      record[field] = parsed.value
    }
  }
  return { ok: true }
}

export interface ContractBudgetBody {
  homesBudget?: unknown
  commonAreaBudget?: unknown
  intake?: { payload?: Record<string, unknown> | null } | null
}

/**
 * Column values for a create. Top-level keys win over intake.payload.
 * Omitted from both → null. Present payload keys are rewritten in place
 * (blank → null, "0" → 0) so the stored intake matches the columns.
 */
export function resolveContractBudgets(
  body: ContractBudgetBody,
): { ok: true; homesBudget: number | null; commonAreaBudget: number | null } | { ok: false; error: string } {
  const payload = body.intake?.payload
  if (payload && typeof payload === 'object') {
    const normalized = normalizePresentBudgets(payload)
    if (!normalized.ok) return normalized
  }

  const resolved: Record<(typeof BUDGET_FIELDS)[number], number | null> = {
    homesBudget: null,
    commonAreaBudget: null,
  }
  for (const field of BUDGET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const parsed = parseContractBudget(body[field], field)
      if (!parsed.ok) return parsed
      resolved[field] = parsed.value
      if (payload && typeof payload === 'object') payload[field] = parsed.value
    } else if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, field)) {
      resolved[field] = payload[field] as number | null
    }
  }
  return { ok: true, ...resolved }
}

/** PATCH: absent keys stay absent (keep). Present null or blank clears to null. */
export function coerceBudgetPatch(
  body: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  return normalizePresentBudgets(body)
}

/**
 * Render a budget. Null and undefined are unknown ('—'), never $0.
 * A real 0 renders as $0.
 */
export function formatOptionalBudget(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
