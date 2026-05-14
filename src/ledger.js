/**
 * Account Balance taxonomy — must match backend/lambda_function.py.
 *
 * Two distinct concepts:
 *   - Account Credit  = stored prepaid funds (member.balance / member.accountCredit).
 *   - Account Balance = (sum of payment txns) - (sum of charge txns).
 *                       0 = current, negative = owes money.
 */

export const CHARGE_PAYMENT_TYPES = new Set([
  'pledge-charge', 'membership-fee', 'sponsorship-fee', 'purchase-fee', 'charge',
])

export const PAYMENT_PAYMENT_TYPES = new Set([
  'pledge', 'membership-payment', 'sponsorship-payment', 'purchase-payment', 'payment',
])

// 'idempotency-claim' is an internal row that exists only so that DynamoDB's
// ConditionExpression can serialize concurrent payment attempts. It never
// represents a real money movement, so we hide it from member-facing tables
// (App.jsx filters these out before the ledger ever sees them — listed here
// for completeness).
export const NEUTRAL_PAYMENT_TYPES = new Set(['donation', 'deposit', 'card-deleted', 'idempotency-claim'])
export const INTERNAL_PAYMENT_TYPES = new Set(['idempotency-claim'])

export function balanceImpact(paymentType) {
  if (CHARGE_PAYMENT_TYPES.has(paymentType)) return 'charge'
  if (PAYMENT_PAYMENT_TYPES.has(paymentType)) return 'payment'
  if (NEUTRAL_PAYMENT_TYPES.has(paymentType)) return 'neutral'
  return 'unknown'
}

export function neutralReason(paymentType) {
  if (paymentType === 'deposit') return 'Adds to Account Credit only — does not affect Account Balance.'
  if (paymentType === 'donation') return 'Voluntary donation — does not affect Account Balance.'
  if (paymentType === 'card-deleted') return 'Audit log — saved card removed. No money changed hands.'
  return ''
}

/**
 * Compute Account Balance from an array of transactions.
 * Returns a Number; negative means the member owes money. Canceled rows are
 * ignored so cancellation flows through to the member's balance immediately.
 */
export function computeAccountBalance(transactions) {
  let total = 0
  for (const t of transactions) {
    if (t.canceled) continue
    const amt = Number(t.amount) || 0
    const impact = balanceImpact(t.paymentType)
    if (impact === 'charge') total -= amt
    else if (impact === 'payment') total += amt
  }
  return total
}

/**
 * Annotate transactions sorted oldest -> newest with a runningBalance field.
 * Canceled rows (admin-canceled OR gateway-declined) stay in the output so
 * members see the audit trail, but they carry balanceImpact='canceled' and
 * don't advance the running balance.
 */
export function withRunningBalance(transactions) {
  const sorted = [...transactions]
    .sort((a, b) => {
      const aDate = (a.date || '').localeCompare(b.date || '')
      if (aDate !== 0) return aDate
      // Within the same day: charges before payments so a same-day pair displays
      // as -X then +X (net 0) rather than +X then -X (which briefly shows as positive).
      const order = { charge: 0, neutral: 1, payment: 2, canceled: 3 }
      const aImp = a.canceled ? 'canceled' : balanceImpact(a.paymentType)
      const bImp = b.canceled ? 'canceled' : balanceImpact(b.paymentType)
      return (order[aImp] ?? 1) - (order[bImp] ?? 1)
    })
  let running = 0
  return sorted.map((t) => {
    if (t.canceled) {
      return { ...t, runningBalance: running, balanceImpact: 'canceled' }
    }
    const amt = Number(t.amount) || 0
    const impact = balanceImpact(t.paymentType)
    if (impact === 'charge') running -= amt
    else if (impact === 'payment') running += amt
    return { ...t, runningBalance: running, balanceImpact: impact }
  })
}

/**
 * Comparator for "newest first" sorting across any ledger-style record
 * (transactions, pledges, emails, etc.). Prefers `createdAt` (full ISO
 * timestamp set at insert time) so same-day items still order correctly;
 * falls back to `date` (YYYY-MM-DD) for legacy rows missing createdAt.
 * Empty strings sort last. Use as `arr.sort(byNewest)`.
 */
export function byNewest(a, b) {
  const ka = a.createdAt || a.date || ''
  const kb = b.createdAt || b.date || ''
  if (ka === kb) return 0
  if (!ka) return 1
  if (!kb) return -1
  return kb < ka ? -1 : 1
}


/**
 * Distinguish a gateway decline from an admin-cancellation on a canceled row.
 * `cancellationReason` starting with "Declined:" is stamped by charge_saved_card
 * when Sola returns a decline; `gatewayResult === 'D'` is the gateway's own
 * signal. Either makes it a decline; otherwise it's an admin cancel.
 */
export function cancelKind(t) {
  if (!t || !t.canceled) return ''
  if (t.gatewayResult === 'D') return 'declined'
  if ((t.cancellationReason || '').toLowerCase().startsWith('declined')) return 'declined'
  return 'canceled'
}

/**
 * Format an audit attribution sub-line, e.g. "Logged May 7, 2026 2:34 PM · Eli Maruani (pledger)".
 * Prefers createdByName (resolved from the email -> member map in App.jsx).
 * Returns null if no actor is set (legacy rows).
 */
export function formatAttribution(record) {
  const by = record.createdByName || record.modifiedByName || record.createdBy || record.modifiedBy
  if (!by) return null
  const role = record.createdByRole || record.modifiedByRole || ''
  const at = record.createdAt || record.modifiedAt || ''
  let when = ''
  if (at) {
    try {
      const d = new Date(at)
      if (!Number.isNaN(d.getTime())) {
        when = d.toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit',
        })
      } else {
        when = at
      }
    } catch {
      when = at
    }
  }
  const friendlyBy = by === 'system' ? 'System (auto)' : by
  return `${when ? when + ' · ' : ''}${friendlyBy}${role ? ` (${role})` : ''}`
}

/** Friendly label for the type column / badges. */
export function paymentTypeLabel(type) {
  switch (type) {
    case 'pledge-charge': return 'Pledge'
    case 'pledge': return 'Pledge Payment'
    case 'membership-fee': return 'Membership Fee'
    case 'membership-payment': return 'Membership Payment'
    case 'sponsorship-fee': return 'Sponsorship'
    case 'sponsorship-payment': return 'Sponsorship Payment'
    case 'purchase-fee': return 'Purchase'
    case 'purchase-payment': return 'Purchase Payment'
    case 'charge': return 'Charge'
    case 'payment': return 'Payment'
    case 'donation': return 'Donation'
    case 'deposit': return 'Account Deposit'
    case 'card-deleted': return 'Card Removed'
    default: return type ? type.charAt(0).toUpperCase() + type.slice(1) : '—'
  }
}
