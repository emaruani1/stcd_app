import { useState, useMemo } from 'react'

export default function PaymentHistory({ currentMember, pledgePayments, extraPayments, adminTransactions }) {
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [aliasFilter, setAliasFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [viewMode, setViewMode] = useState('payments') // 'payments' or 'ledger'

  const memberAliases = currentMember.aliases || []

  const memberPaymentHistory = currentMember.paymentHistory
  const memberAdminTxns = (adminTransactions || []).filter(t => t.memberId === currentMember.id)

  const allPayments = useMemo(() => {
    return [...memberPaymentHistory, ...extraPayments, ...memberAdminTxns]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [memberPaymentHistory, extraPayments, memberAdminTxns])

  // Build a full ledger: charges (pledges) + payments, sorted oldest-first for running balance
  const ledgerEntries = useMemo(() => {
    const entries = []

    // Add pledges as charges
    for (const p of currentMember.pledges) {
      if (p.canceled) continue
      entries.push({
        id: `pledge-${p.id}`,
        date: p.date,
        description: p.description || p.pledgeType || 'Pledge',
        type: 'charge',
        category: p.category || 'pledge',
        amount: p.amount,
        method: '',
        alias: '',
      })
    }

    // Add payments as credits
    for (const p of [...memberPaymentHistory, ...extraPayments, ...memberAdminTxns]) {
      entries.push({
        id: p.id || `pay-${p.date}-${p.amount}`,
        date: p.date,
        description: p.description,
        type: 'payment',
        category: p.paymentType || '',
        amount: p.amount,
        method: p.method || '',
        alias: p.alias || '',
      })
    }

    // Sort oldest first for running balance calculation
    entries.sort((a, b) => {
      const diff = new Date(a.date) - new Date(b.date)
      // If same date, charges before payments
      if (diff === 0) return a.type === 'charge' ? -1 : 1
      return diff
    })

    // Calculate running balance (charges increase balance owed, payments decrease it)
    let running = 0
    for (const entry of entries) {
      if (entry.type === 'charge') {
        running += entry.amount
      } else {
        running -= entry.amount
      }
      entry.balance = running
    }

    return entries
  }, [currentMember.pledges, memberPaymentHistory, extraPayments, memberAdminTxns])

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

  const filteredPayments = useMemo(() => {
    return allPayments.filter(p => {
      if (!dateFilter(p.date)) return false
      if (typeFilter !== 'all' && p.paymentType !== typeFilter) return false
      if (aliasFilter !== 'all') {
        if (aliasFilter === '__primary__' && p.alias) return false
        if (aliasFilter !== '__primary__' && aliasFilter !== 'all' && p.alias !== aliasFilter) return false
      }
      return true
    })
  }, [allPayments, filter, typeFilter, aliasFilter, startDate, endDate])

  const filteredLedger = useMemo(() => {
    return ledgerEntries.filter(e => dateFilter(e.date))
      .reverse() // newest first for display
  }, [ledgerEntries, filter, startDate, endDate])

  const totalFiltered = filteredPayments.reduce((sum, p) => sum + p.amount, 0)

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const paymentTypeBadge = (type) => {
    const cls = {
      membership: 'badge-membership',
      pledge: 'badge-pledge',
      donation: 'badge-donation',
      purchase: 'badge-purchase',
    }[type] || 'badge-pending'
    return <span className={`badge ${cls}`}>{type ? type.charAt(0).toUpperCase() + type.slice(1) : '—'}</span>
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
              { key: 'membership', label: 'Membership' },
              { key: 'pledge', label: 'Pledge' },
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
              Total ({filter === 'all' ? 'All Time' : filter === 'month' ? 'This Month' : filter === 'ytd' ? 'Year to Date' : 'Selected Range'}):
            </span>
            <span className="history-summary-amount">${totalFiltered.toLocaleString()}</span>
            <span className="history-summary-count">{filteredPayments.length} payment{filteredPayments.length !== 1 ? 's' : ''}</span>
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
                  filteredPayments.map((p, idx) => (
                    <tr key={p.id || idx}>
                      <td>{formatDate(p.date)}</td>
                      <td>{p.description}</td>
                      {memberAliases.length > 0 && <td style={{ fontSize: '0.82rem' }}>{p.alias || `${currentMember.firstName} ${currentMember.lastName}`}</td>}
                      <td>{paymentTypeBadge(p.paymentType)}</td>
                      <td className="amount-cell">${p.amount.toLocaleString()}</td>
                      <td>{p.method}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewMode === 'ledger' && (
        <>
          <div className="history-summary">
            <span className="history-summary-label">Current Balance Owed:</span>
            <span className="history-summary-amount" style={{ color: ledgerEntries.length > 0 && ledgerEntries[ledgerEntries.length - 1].balance > 0 ? 'var(--danger, #dc3545)' : 'var(--success)' }}>
              ${ledgerEntries.length > 0 ? Math.abs(ledgerEntries[ledgerEntries.length - 1].balance).toLocaleString() : '0'}
              {ledgerEntries.length > 0 && ledgerEntries[ledgerEntries.length - 1].balance < 0 && ' credit'}
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
                  filteredLedger.map((e, idx) => (
                    <tr key={e.id || idx}>
                      <td>{formatDate(e.date)}</td>
                      <td>{e.description}</td>
                      <td>
                        {e.type === 'charge' ? (
                          <span className="badge badge-pending">Charge</span>
                        ) : (
                          <span className="badge badge-paid">Payment</span>
                        )}
                      </td>
                      <td className="amount-cell" style={{ color: e.type === 'charge' ? 'var(--danger, #dc3545)' : '' }}>
                        {e.type === 'charge' ? `$${e.amount.toLocaleString()}` : ''}
                      </td>
                      <td className="amount-cell" style={{ color: e.type === 'payment' ? 'var(--success)' : '' }}>
                        {e.type === 'payment' ? `$${e.amount.toLocaleString()}` : ''}
                      </td>
                      <td className="amount-cell" style={{ fontWeight: 600, color: e.balance > 0 ? 'var(--danger, #dc3545)' : 'var(--success)' }}>
                        {e.balance >= 0 ? `$${e.balance.toLocaleString()}` : `-$${Math.abs(e.balance).toLocaleString()}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
