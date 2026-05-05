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

export const NEUTRAL_PAYMENT_TYPES = new Set(['donation', 'deposit'])

export function balanceImpact(paymentType) {
  if (CHARGE_PAYMENT_TYPES.has(paymentType)) return 'charge'
  if (PAYMENT_PAYMENT_TYPES.has(paymentType)) return 'payment'
  if (NEUTRAL_PAYMENT_TYPES.has(paymentType)) return 'neutral'
  return 'unknown'
}

export function neutralReason(paymentType) {
  if (paymentType === 'deposit') return 'Adds to Account Credit only — does not affect Account Balance.'
  if (paymentType === 'donation') return 'Voluntary donation — does not affect Account Balance.'
  return ''
}

/**
 * Compute Account Balance from an array of transactions.
 * Returns a Number; negative means the member owes money.
 */
export function computeAccountBalance(transactions) {
  let total = 0
  for (const t of transactions) {
    const amt = Number(t.amount) || 0
    const impact = balanceImpact(t.paymentType)
    if (impact === 'charge') total -= amt
    else if (impact === 'payment') total += amt
  }
  return total
}

/**
 * Annotate transactions sorted oldest -> newest with a runningBalance field.
 * Pass in an array; returns a new array same length.
 */
export function withRunningBalance(transactions) {
  const sorted = [...transactions].sort((a, b) => {
    const aDate = (a.date || '').localeCompare(b.date || '')
    if (aDate !== 0) return aDate
    // Within the same day: charges before payments so a same-day pair displays
    // as -X then +X (net 0) rather than +X then -X (which briefly shows as positive).
    const order = { charge: 0, neutral: 1, payment: 2 }
    return (order[balanceImpact(a.paymentType)] ?? 1) - (order[balanceImpact(b.paymentType)] ?? 1)
  })
  let running = 0
  return sorted.map((t) => {
    const amt = Number(t.amount) || 0
    const impact = balanceImpact(t.paymentType)
    if (impact === 'charge') running -= amt
    else if (impact === 'payment') running += amt
    return { ...t, runningBalance: running, balanceImpact: impact }
  })
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
    default: return type ? type.charAt(0).toUpperCase() + type.slice(1) : '—'
  }
}
