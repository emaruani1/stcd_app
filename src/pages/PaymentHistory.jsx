import { useState, useMemo } from 'react'

export default function PaymentHistory({ currentMember, pledgePayments, extraPayments, adminTransactions }) {
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const memberPaymentHistory = currentMember.paymentHistory
  const memberAdminTxns = (adminTransactions || []).filter(t => t.memberId === currentMember.id)

  const allPayments = useMemo(() => {
    return [...memberPaymentHistory, ...extraPayments, ...memberAdminTxns]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [memberPaymentHistory, extraPayments, memberAdminTxns])

  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOfYear = new Date(today.getFullYear(), 0, 1)

  const filteredPayments = useMemo(() => {
    return allPayments.filter(p => {
      const pDate = new Date(p.date + 'T00:00:00')
      if (filter === 'month') return pDate >= startOfMonth
      if (filter === 'ytd') return pDate >= startOfYear
      if (filter === 'custom') {
        const afterStart = startDate ? pDate >= new Date(startDate + 'T00:00:00') : true
        const beforeEnd = endDate ? pDate <= new Date(endDate + 'T23:59:59') : true
        return afterStart && beforeEnd
      }
      return true
    }).filter(p => {
      if (typeFilter === 'all') return true
      return p.paymentType === typeFilter
    })
  }, [allPayments, filter, typeFilter, startDate, endDate])

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
              <th>Type</th>
              <th>Amount</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {filteredPayments.length === 0 ? (
              <tr><td colSpan="5" className="empty-row">No payments found for this period</td></tr>
            ) : (
              filteredPayments.map((p, idx) => (
                <tr key={p.id || idx}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.description}</td>
                  <td>{paymentTypeBadge(p.paymentType)}</td>
                  <td className="amount-cell">${p.amount.toLocaleString()}</td>
                  <td>{p.method}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
