import { useState, useMemo } from 'react'
import { withRunningBalance, balanceImpact, neutralReason, paymentTypeLabel } from '../ledger'

// eslint-disable-next-line no-unused-vars
export default function PaymentHistory({ currentMember, pledgePayments, extraPayments, adminTransactions }) {
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [aliasFilter, setAliasFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [viewMode, setViewMode] = useState('payments') // 'payments' or 'ledger'

  const memberAliases = currentMember.aliases || []

  // currentMember.paymentHistory is the full transaction list including charge rows
  // (pledge-charge / membership-fee / sponsorship-fee / etc.) thanks to App.jsx.
  const memberPaymentHistory = currentMember.paymentHistory
  const memberAdminTxns = (adminTransactions || []).filter(t => t.memberId === currentMember.id)

  const allTxns = useMemo(() => {
    return [...memberPaymentHistory, ...extraPayments, ...memberAdminTxns]
  }, [memberPaymentHistory, extraPayments, memberAdminTxns])

  const annotatedAll = useMemo(() => withRunningBalance(allTxns), [allTxns])

  // Newest-first for the displayed payments list
  const allPayments = useMemo(
    () => [...annotatedAll].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [annotatedAll],
  )

  // Newest-first for the ledger view (running balance was computed oldest->newest)
  const ledgerEntries = useMemo(() => [...annotatedAll].reverse(), [annotatedAll])

  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOfYear = new Date(today.getFullYear(), 0, 1)

  const dateFilter = (date) => {
    const pDate = new Date(date + 'T00:00:00')
    if (filter === 'month') return pDate >= startOfMonth
    if (filter === 'ytd') return pDate >= startOfYear
    if (filter === 'custom') {
      const afterStart = startDate ? pDate >= new Date(startDate + 'T00:00:00') : true
      const beforeEnd = endDate ? pDate <= new Date(endDate + 'T23:59:59') : true
      return afterStart && beforeEnd
    }
    return true
  }

  const matchesTypeFilter = (p) => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'pledges') return p.paymentType === 'pledge' || p.paymentType === 'pledge-charge'
    if (typeFilter === 'membership') return p.paymentType === 'membership-fee' || p.paymentType === 'membership-payment'
    if (typeFilter === 'sponsorship') return p.paymentType === 'sponsorship-fee' || p.paymentType === 'sponsorship-payment'
    if (typeFilter === 'purchase') return p.paymentType === 'purchase-fee' || p.paymentType === 'purchase-payment'
    return p.paymentType === typeFilter
  }

  const filteredPayments = useMemo(() => {
    return allPayments.filter(p => {
      if (!dateFilter(p.date)) return false
      if (!matchesTypeFilter(p)) return false
      if (aliasFilter !== 'all') {
        if (aliasFilter === '__primary__' && p.alias) return false
        if (aliasFilter !== '__primary__' && aliasFilter !== 'all' && p.alias !== aliasFilter) return false
      }
      return true
    })
  }, [allPayments, filter, typeFilter, aliasFilter, startDate, endDate])

  const filteredLedger = useMemo(() => {
    return ledgerEntries.filter(e => dateFilter(e.date))
  }, [ledgerEntries, filter, startDate, endDate])

  // Show net (payments - charges) to match the running-balance concept
  const totalFiltered = filteredPayments.reduce((sum, p) => {
    const impact = p.balanceImpact ?? balanceImpact(p.paymentType)
    if (impact === 'charge') return sum - p.amount
    if (impact === 'payment') return sum + p.amount
    return sum
  }, 0)
  const accountBalance = currentMember.accountBalance ?? 0

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const paymentTypeBadge = (type) => {
    const root = type?.split('-')[0]
    const cls = {
      membership: 'badge-membership',
      pledge: 'badge-pledge',
      donation: 'badge-donation',
      purchase: 'badge-purchase',
      sponsorship: 'badge-purchase',
      deposit: 'badge-membership',
      charge: 'badge-pending',
      payment: 'badge-paid',
    }[root] || 'badge-pending'
    return <span className={`badge ${cls}`}>{paymentTypeLabel(type)}</span>
  }

  return (
    <div className="history-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Payment History</h1>
          <p className="page-subtitle">View all your past payments and donations</p>
        </div>
        <div className="filter-tabs" style={{ margin: 0 }}>
          <button
            className={`filter-tab ${viewMode === 'payments' ? 'active' : ''}`}
            onClick={() => setViewMode('payments')}
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
          >
            Payments
          </button>
          <button
            className={`filter-tab ${viewMode === 'ledger' ? 'active' : ''}`}
            onClick={() => setViewMode('ledger')}
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
          >
            Account Ledger
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-tabs">
          {[
            { key: 'all', label: 'All Time' },
            { key: 'month', label: 'This Month' },
            { key: 'ytd', label: 'Year to Date' },
            { key: 'custom', label: 'Custom Range' },
          ].map(f => (
            <button
              key={f.key}
              className={`filter-tab ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {filter === 'custom' && (
          <div className="date-range-picker">
            <div className="date-input-group">
              <label>From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="date-input-group">
              <label>To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {viewMode === 'payments' && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0', flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'All Types' },
              { key: 'deposit', label: 'Account Credit' },
              { key: 'membership', label: 'Membership' },
              { key: 'pledges', label: 'Pledges' },
              { key: 'sponsorship', label: 'Sponsorship' },
              { key: 'donation', label: 'Donation' },
              { key: 'purchase', label: 'Purchase' },
            ].map(f => (
              <button
                key={f.key}
                className={`filter-tab ${typeFilter === f.key ? 'active' : ''}`}
                onClick={() => setTypeFilter(f.key)}
                style={{ padding: '6px 14px', fontSize: '0.82rem' }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {memberAliases.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-muted)' }}>Paying As:</span>
              {[
                { key: 'all', label: 'All' },
                { key: '__primary__', label: `${currentMember.firstName} ${currentMember.lastName}` },
                ...memberAliases.map(a => ({ key: a, label: a })),
              ].map(f => (
                <button
                  key={f.key}
                  className={`filter-tab ${aliasFilter === f.key ? 'active' : ''}`}
                  onClick={() => setAliasFilter(f.key)}
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="history-summary">
            <span className="history-summary-label">
              Net ({filter === 'all' ? 'All Time' : filter === 'month' ? 'This Month' : filter === 'ytd' ? 'Year to Date' : 'Selected Range'}):
            </span>
            <span className="history-summary-amount" style={{ color: totalFiltered < 0 ? 'var(--danger)' : '' }}>
              {totalFiltered < 0 ? '-' : ''}${Math.abs(totalFiltered).toLocaleString()}
            </span>
            <span className="history-summary-count">{filteredPayments.length} entr{filteredPayments.length !== 1 ? 'ies' : 'y'}</span>
          </div>

          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  {memberAliases.length > 0 && <th>Paying As</th>}
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr><td colSpan={memberAliases.length > 0 ? 6 : 5} className="empty-row">No payments found for this period</td></tr>
                ) : (
                  filteredPayments.map((p, idx) => {
                    const impact = p.balanceImpact ?? balanceImpact(p.paymentType)
                    const isNeutral = impact === 'neutral'
                    const noteText = isNeutral ? neutralReason(p.paymentType) : ''
                    const sign = impact === 'charge' ? '-' : impact === 'payment' ? '+' : ''
                    const color = impact === 'charge' ? 'var(--danger)' : impact === 'payment' ? 'var(--success)' : 'inherit'
                    return (
                      <tr key={p.id || idx}>
                        <td>{formatDate(p.date)}</td>
                        <td>
                          {p.description}
                          {noteText && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '2px' }}>
                              {noteText}
                            </div>
                          )}
                        </td>
                        {memberAliases.length > 0 && <td style={{ fontSize: '0.82rem' }}>{p.alias || `${currentMember.firstName} ${currentMember.lastName}`}</td>}
                        <td>{paymentTypeBadge(p.paymentType)}</td>
                        <td className="amount-cell" style={{ color, fontWeight: sign ? 600 : 400 }}>
                          {sign}${p.amount.toLocaleString()}
                        </td>
                        <td>{p.method}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewMode === 'ledger' && (
        <>
          <div className="history-summary">
            <span className="history-summary-label">Current Account Balance:</span>
            <span className="history-summary-amount" style={{ color: accountBalance < 0 ? 'var(--danger)' : 'var(--success)' }}>
              {accountBalance < 0 ? '-' : ''}${Math.abs(accountBalance).toLocaleString()}
              {accountBalance > 0 && ' credit'}
            </span>
            <span className="history-summary-count">{filteredLedger.length} entries</span>
          </div>

          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Charges</th>
                  <th style={{ textAlign: 'right' }}>Payments</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.length === 0 ? (
                  <tr><td colSpan={6} className="empty-row">No activity found for this period</td></tr>
                ) : (
                  filteredLedger.map((e, idx) => {
                    const impact = e.balanceImpact ?? balanceImpact(e.paymentType)
                    const isNeutral = impact === 'neutral'
                    const noteText = isNeutral ? neutralReason(e.paymentType) : ''
                    return (
                      <tr key={e.id || idx}>
                        <td>{formatDate(e.date)}</td>
                        <td>
                          {e.description}
                          {noteText && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '2px' }}>
                              {noteText}
                            </div>
                          )}
                        </td>
                        <td>{paymentTypeBadge(e.paymentType)}</td>
                        <td className="amount-cell" style={{ color: 'var(--danger)' }}>
                          {impact === 'charge' ? `$${e.amount.toLocaleString()}` : ''}
                        </td>
                        <td className="amount-cell" style={{ color: 'var(--success)' }}>
                          {impact === 'payment' ? `$${e.amount.toLocaleString()}` : ''}
                        </td>
                        <td className="amount-cell" style={{
                          fontWeight: 600,
                          color: e.runningBalance < 0 ? 'var(--danger)' : 'var(--success)',
                        }}>
                          {isNeutral ? '—' : (
                            e.runningBalance < 0
                              ? `-$${Math.abs(e.runningBalance).toLocaleString()}`
                              : `$${e.runningBalance.toLocaleString()}`
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
