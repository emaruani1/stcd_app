import { useState, useMemo } from 'react'
import { paymentHistory } from '../data/fakeData'

export default function PaymentHistory({ paidPledges, extraPayments }) {
  const [filter, setFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Combine original payment history with session payments
  const allPayments = useMemo(() => {
    return [...paymentHistory, ...extraPayments]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [extraPayments])

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
    })
  }, [allPayments, filter, startDate, endDate])

  const totalFiltered = filteredPayments.reduce((sum, p) => sum + p.amount, 0)

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="history-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Payment History</h1>
          <p className="page-subtitle">View all your past payments and donations</p>
        </div>
      </div>

      {/* Filter Tabs */}
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

      {/* Summary */}
      <div className="history-summary">
        <span className="history-summary-label">
          Total ({filter === 'all' ? 'All Time' : filter === 'month' ? 'This Month' : filter === 'ytd' ? 'Year to Date' : 'Selected Range'}):
        </span>
        <span className="history-summary-amount">${totalFiltered.toLocaleString()}</span>
        <span className="history-summary-count">{filteredPayments.length} payment{filteredPayments.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="pledges-table-wrap">
        <table className="pledges-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {filteredPayments.length === 0 ? (
              <tr><td colSpan="4" className="empty-row">No payments found for this period</td></tr>
            ) : (
              filteredPayments.map((p, idx) => (
                <tr key={p.id || idx}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.description}</td>
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
