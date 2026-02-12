import { pledges, paymentHistory, currentUser, membershipTiers } from '../data/fakeData'
import { useNavigate } from 'react-router-dom'

export default function Dashboard({ paidPledges, extraPayments }) {
  const navigate = useNavigate()

  const allPledges = pledges.map(p => ({
    ...p,
    paid: p.paid || paidPledges.includes(p.id),
  }))

  const unpaidPledges = allPledges.filter(p => !p.paid)
  const paidPledgesList = allPledges.filter(p => p.paid)
  const totalOwed = unpaidPledges.reduce((sum, p) => sum + p.amount, 0)
  const totalPaid = paidPledgesList.reduce((sum, p) => sum + p.amount, 0)
    + paymentHistory.reduce((sum, p) => sum + p.amount, 0)
    + extraPayments.reduce((sum, p) => sum + p.amount, 0)

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const today = new Date()
  const upcomingPledges = unpaidPledges
    .filter(p => new Date(p.date + 'T00:00:00') >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5)

  const overduePledges = unpaidPledges
    .filter(p => new Date(p.date + 'T00:00:00') < today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  const tier = membershipTiers[currentUser.membershipType]
  const plan = tier.plans[currentUser.membershipPlan]

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Welcome back, {currentUser.firstName}</h1>
          <p className="page-subtitle">Here's an overview of your account</p>
        </div>
      </div>

      {/* Membership Card */}
      <div className="membership-banner">
        <div className="membership-banner-left">
          <span className="membership-badge">{tier.label}</span>
          <h3 className="membership-plan">{plan.label} Plan</h3>
          <p className="membership-rate">${plan.monthly}/month</p>
        </div>
        <div className="membership-banner-right">
          <p className="membership-since">Member since {new Date(currentUser.memberSince + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          <p className="membership-id">ID: {currentUser.memberId}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-card-icon balance-icon">$</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Outstanding Balance</p>
            <p className="summary-card-value">${totalOwed.toLocaleString()}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon paid-icon">&#10003;</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Total Paid</p>
            <p className="summary-card-value paid-value">${totalPaid.toLocaleString()}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon pledges-icon">#</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Unpaid Pledges</p>
            <p className="summary-card-value">{unpaidPledges.length}</p>
          </div>
        </div>
        <div className="summary-card clickable" onClick={() => navigate('/pay')}>
          <div className="summary-card-icon action-icon">&#8594;</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Quick Action</p>
            <p className="summary-card-value action-value">Make a Payment</p>
          </div>
        </div>
      </div>

      {/* Overdue Pledges */}
      {overduePledges.length > 0 && (
        <div className="dashboard-section">
          <h2 className="section-title overdue-title">Overdue Pledges</h2>
          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {overduePledges.map(p => (
                  <tr key={p.id} className="overdue-row">
                    <td>{p.description}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="amount-cell">${p.amount.toLocaleString()}</td>
                    <td><span className="badge badge-overdue">Overdue</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upcoming Pledges */}
      <div className="dashboard-section">
        <h2 className="section-title">Upcoming Pledges</h2>
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcomingPledges.length === 0 ? (
                <tr><td colSpan="4" className="empty-row">No upcoming pledges</td></tr>
              ) : (
                upcomingPledges.map(p => (
                  <tr key={p.id}>
                    <td>{p.description}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="amount-cell">${p.amount.toLocaleString()}</td>
                    <td><span className="badge badge-pending">Pending</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {unpaidPledges.length > 5 && (
          <button className="view-all-btn" onClick={() => navigate('/pay')}>
            View All Pledges &amp; Pay
          </button>
        )}
      </div>

      {/* Recent Payments */}
      <div className="dashboard-section">
        <h2 className="section-title">Recent Payments</h2>
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {paymentHistory.slice(0, 5).map(p => (
                <tr key={p.id}>
                  <td>{p.description}</td>
                  <td>{formatDate(p.date)}</td>
                  <td className="amount-cell">${p.amount.toLocaleString()}</td>
                  <td>{p.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="view-all-btn" onClick={() => navigate('/history')}>
          View Full History
        </button>
      </div>
    </div>
  )
}
