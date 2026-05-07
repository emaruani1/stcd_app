import { useState, useEffect, useMemo } from 'react'
import * as api from '../../api'

const monthLabel = (yearMonth) => {
  if (!yearMonth) return ''
  const [y, m] = yearMonth.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function AdminMembershipBilling({ allMembers, refreshData }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [paymentMethodsByMember, setPaymentMethodsByMember] = useState({})
  const [statusByMember, setStatusByMember] = useState({}) // { [memberId]: { state, message, gatewayRefNum, last4 } }
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [running, setRunning] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [loading, setLoading] = useState(true)

  // Build the candidate list from already-loaded data:
  //   any member whose latest membership-fee for `yearMonth` has no matching membership-payment
  //   (and they have a membershipType+plan).
  const candidates = useMemo(() => {
    const rows = []
    for (const m of allMembers) {
      if (!m.membershipType || !m.membershipPlan) continue
      const fees = (m.paymentHistory || []).filter(t => t.paymentType === 'membership-fee')
      const monthFees = fees.filter(t => (t.date || '').startsWith(yearMonth))
      if (monthFees.length === 0) continue
      const monthPayments = (m.paymentHistory || []).filter(
        t => t.paymentType === 'membership-payment' && (t.date || '').startsWith(yearMonth)
      )
      // If at least one fee is unpaired, surface this member.
      const totalFees = monthFees.reduce((s, t) => s + Number(t.amount || 0), 0)
      const totalPayments = monthPayments.reduce((s, t) => s + Number(t.amount || 0), 0)
      if (totalPayments >= totalFees) continue // already settled
      // Pick the earliest unsettled fee row to charge.
      const fee = monthFees.find(f => !monthPayments.some(p => p.pairId && p.pairId === f.pairId)) || monthFees[0]
      rows.push({
        memberId: String(m.id),
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        membershipPlan: m.membershipPlan,
        membershipType: m.membershipType,
        feeAmount: Number(fee.amount) || 0,
        feeTransactionId: fee.id,
        feeDate: fee.date,
        autopayPaymentMethodId: m.autopayPaymentMethodId || '',
      })
    }
    rows.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
    return rows
  }, [allMembers, yearMonth])

  // Lazy-load payment methods for all candidates so we can show "no card" pre-flight
  // and pick the right card to charge.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const memberIds = candidates.map(c => c.memberId)
    Promise.all(memberIds.map(id =>
      api.fetchPaymentMethods(id).then(r => [id, r?.paymentMethods || []]).catch(() => [id, []])
    )).then(entries => {
      if (cancelled) return
      const map = {}
      for (const [id, methods] of entries) map[id] = methods
      setPaymentMethodsByMember(map)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [candidates])

  // Pick the card to charge per candidate: prefer autopayPaymentMethodId, fall back to default, then first.
  const cardForCandidate = (c) => {
    const methods = paymentMethodsByMember[c.memberId] || []
    if (c.autopayPaymentMethodId) {
      const m = methods.find(x => x.paymentMethodId === c.autopayPaymentMethodId)
      if (m) return m
    }
    return methods.find(x => x.isDefault) || methods[0] || null
  }

  const summary = useMemo(() => {
    let approved = 0, declined = 0, skipped = 0, pending = 0, alreadyPaid = 0
    for (const c of candidates) {
      const s = statusByMember[c.memberId]?.state
      if (s === 'approved') approved++
      else if (s === 'declined' || s === 'error') declined++
      else if (s === 'skipped-no-card') skipped++
      else if (s === 'already-paid') alreadyPaid++
      else pending++
    }
    return { approved, declined, skipped, pending, alreadyPaid, total: candidates.length }
  }, [candidates, statusByMember])

  /** Charge a single candidate. Returns the next state value. */
  const chargeOne = async (c) => {
    const existing = statusByMember[c.memberId]?.state
    if (existing === 'approved' || existing === 'already-paid') return null

    const card = cardForCandidate(c)
    if (!card) {
      setStatusByMember(prev => ({
        ...prev,
        [c.memberId]: { state: 'skipped-no-card', message: 'No saved card on file' }
      }))
      return null
    }

    setStatusByMember(prev => ({
      ...prev,
      [c.memberId]: { state: 'running', message: `Charging •••• ${card.last4}` }
    }))

    try {
      const res = await api.chargeMembershipFee({
        memberId: c.memberId,
        feeTransactionId: c.feeTransactionId,
        paymentMethodId: card.paymentMethodId,
        amount: c.feeAmount,
      })
      if (res.alreadyPaid) {
        setStatusByMember(prev => ({
          ...prev,
          [c.memberId]: { state: 'already-paid', message: 'Already settled' }
        }))
      } else {
        setStatusByMember(prev => ({
          ...prev,
          [c.memberId]: {
            state: 'approved',
            message: 'Approved',
            gatewayRefNum: res.gatewayRefNum,
            authCode: res.authCode,
            last4: res.cardLast4,
            cardBrand: res.cardBrand,
          }
        }))
      }
    } catch (err) {
      // chargeMembershipFee throws on non-2xx (incl. 402 declines)
      const msg = err?.message || 'Charge failed'
      const isDecline = /declined|insufficient|invalid|expired/i.test(msg)
      setStatusByMember(prev => ({
        ...prev,
        [c.memberId]: {
          state: isDecline ? 'declined' : 'error',
          message: msg,
        }
      }))
    }
  }

  const runBatch = async (subset) => {
    const list = subset && subset.length > 0 ? subset : candidates
    setStopRequested(false)
    setRunning(true)
    for (const c of list) {
      if (stopRequested) break
      await chargeOne(c)
    }
    setRunning(false)
    if (refreshData) refreshData()
  }

  /** Charge a single member from the per-row "Charge" button. */
  const chargeIndividual = async (c) => {
    setRunning(true)
    await chargeOne(c)
    setRunning(false)
    if (refreshData) refreshData()
  }

  const toggleSelect = (memberId) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  const allSelected = candidates.length > 0 && candidates.every(c => selectedIds.has(c.memberId))
  const someSelected = candidates.some(c => selectedIds.has(c.memberId))
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(candidates.map(c => c.memberId)))
  }

  const selectedCandidates = candidates.filter(c => selectedIds.has(c.memberId))

  const stopBatch = () => setStopRequested(true)

  const retryDeclines = async () => {
    // Wipe the failed states and re-run only the previously failed members.
    const failedIds = Object.entries(statusByMember)
      .filter(([, v]) => ['declined', 'error', 'skipped-no-card'].includes(v?.state))
      .map(([id]) => id)
    setStatusByMember(prev => {
      const next = { ...prev }
      for (const id of failedIds) delete next[id]
      return next
    })
    await runBatch(candidates.filter(c => failedIds.includes(c.memberId)))
  }

  const renderStatusBadge = (s) => {
    if (!s) return <span className="badge badge-pending">Pending</span>
    if (s.state === 'running') return <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Charging…</span>
    if (s.state === 'approved') return <span className="badge badge-paid">Approved</span>
    if (s.state === 'already-paid') return <span className="badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>Already Paid</span>
    if (s.state === 'declined') return <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Declined</span>
    if (s.state === 'error') return <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>Error</span>
    if (s.state === 'skipped-no-card') return <span className="badge" style={{ background: '#f3f4f6', color: '#6b7280' }}>No Card</span>
    return <span className="badge badge-pending">Pending</span>
  }

  const formatPlan = (c) => {
    const t = c.membershipType ? c.membershipType.charAt(0).toUpperCase() + c.membershipType.slice(1) : ''
    const p = c.membershipPlan ? c.membershipPlan.charAt(0).toUpperCase() + c.membershipPlan.slice(1) : ''
    return [t, p].filter(Boolean).join(' ')
  }

  const totalDue = candidates.reduce((s, c) => s + c.feeAmount, 0)
  const someoneFailed = summary.declined > 0 || summary.skipped > 0

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Membership Billing</h1>
          <p className="page-subtitle">Run monthly membership payments for all members with an outstanding fee</p>
        </div>
      </div>

      <div className="dashboard-section">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div className="form-group" style={{ minWidth: '180px' }}>
            <label htmlFor="ym">Billing Period</label>
            <input
              id="ym"
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              disabled={running}
            />
          </div>
          <button
            className="pay-btn"
            onClick={() => runBatch()}
            disabled={running || loading || candidates.length === 0}
            style={{ padding: '10px 24px' }}
          >
            {running ? 'Running…' : `Run All (${candidates.length})`}
          </button>
          {someSelected && (
            <button
              className="pay-btn"
              onClick={() => runBatch(selectedCandidates)}
              disabled={running || loading}
              style={{ padding: '10px 24px', background: 'var(--accent-dark)' }}
            >
              {running ? 'Running…' : `Run Selected (${selectedCandidates.length})`}
            </button>
          )}
          {running && (
            <button className="modal-btn-secondary" onClick={stopBatch} style={{ padding: '10px 24px' }}>
              Stop after current
            </button>
          )}
          {!running && someoneFailed && (
            <button className="modal-btn-secondary" onClick={retryDeclines} style={{ padding: '10px 24px' }}>
              Retry failures
            </button>
          )}
        </div>

        <div className="summary-cards" style={{ marginBottom: '1rem' }}>
          <div className="summary-card">
            <div className="summary-card-info">
              <p className="summary-card-label">Outstanding for {monthLabel(yearMonth)}</p>
              <p className="summary-card-value">${totalDue.toLocaleString()}</p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{candidates.length} member{candidates.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-info">
              <p className="summary-card-label">Approved</p>
              <p className="summary-card-value" style={{ color: 'var(--success)' }}>{summary.approved}</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-info">
              <p className="summary-card-label">Declined / Error</p>
              <p className="summary-card-value" style={{ color: 'var(--danger)' }}>{summary.declined}</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-info">
              <p className="summary-card-label">No Card on File</p>
              <p className="summary-card-value" style={{ color: 'var(--text-muted)' }}>{summary.skipped}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading saved cards…</p>
        ) : candidates.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No outstanding membership fees for {monthLabel(yearMonth)}.</p>
        ) : (
          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th style={{ width: '32px' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }}
                      onChange={toggleSelectAll}
                      disabled={running}
                      aria-label="Select all members"
                    />
                  </th>
                  <th>Member</th>
                  <th>Plan</th>
                  <th>Card</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th style={{ width: '110px' }}></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => {
                  const card = cardForCandidate(c)
                  const s = statusByMember[c.memberId]
                  const checked = selectedIds.has(c.memberId)
                  const settled = s?.state === 'approved' || s?.state === 'already-paid'
                  return (
                    <tr key={c.memberId} style={checked ? { background: 'var(--bg-warm)' } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(c.memberId)}
                          disabled={running}
                          aria-label={`Select ${c.firstName} ${c.lastName}`}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.firstName} {c.lastName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.email}</div>
                      </td>
                      <td>{formatPlan(c)}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {card ? (
                          <>
                            {card.cardBrand} •••• {card.last4}
                            {c.autopayPaymentMethodId === card.paymentMethodId && (
                              <span style={{ marginLeft: '6px', fontSize: '0.7rem', color: 'var(--accent)' }}>preferred</span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: 'var(--danger)' }}>No card on file</span>
                        )}
                      </td>
                      <td className="amount-cell">${c.feeAmount.toLocaleString()}</td>
                      <td>{renderStatusBadge(s)}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {s?.gatewayRefNum && <div>Ref: {s.gatewayRefNum}</div>}
                        {s?.authCode && <div>Auth: {s.authCode}</div>}
                        {s?.message && <div>{s.message}</div>}
                      </td>
                      <td>
                        <button
                          className="action-btn action-btn-pay"
                          onClick={() => chargeIndividual(c)}
                          disabled={running || settled || !card}
                          title={!card ? 'No card on file' : settled ? 'Already settled' : 'Charge this member only'}
                        >
                          Charge
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
