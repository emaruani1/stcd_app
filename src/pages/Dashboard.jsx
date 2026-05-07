import { membershipTiers } from '../data/fakeData'
import { useNavigate } from 'react-router-dom'

export default function Dashboard({ currentMember, pledgePayments, extraPayments, currentBalance, membershipPlans }) {
  const navigate = useNavigate()

  const memberPledges = currentMember.pledges

  const getRemainingBalance = (p) => {
    const sessionPaid = pledgePayments[p.id] || 0
    return p.amount - p.paidAmount - sessionPaid
  }

  const allPledges = memberPledges.map(p => ({
    ...p,
    remaining: getRemainingBalance(p),
    fullyPaid: getRemainingBalance(p) <= 0,
  }))

  const unpaidPledges = allPledges.filter(p => !p.fullyPaid && !p.canceled)
  const totalOwed = unpaidPledges.reduce((sum, p) => sum + p.remaining, 0)

  const totalStaticPaid = memberPledges.reduce((sum, p) => sum + p.paidAmount, 0)
  const totalSessionPledgePaid = Object.values(pledgePayments).reduce((sum, v) => sum + v, 0)
  const totalHistoryPaid = currentMember.paymentHistory.reduce((sum, p) => sum + p.amount, 0)
  const totalExtraPaid = extraPayments.reduce((sum, p) => sum + p.amount, 0)
  const totalPaid = totalStaticPaid + totalSessionPledgePaid + totalHistoryPaid + totalExtraPaid

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const categoryBadge = (cat) => {
    const cls = {
      membership: 'badge-membership',
      pledge: 'badge-pledge',
    }[cat] || 'badge-pending'
    return <span className={`badge ${cls}`} style={{ fontSize: '0.72rem' }}>{cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '—'}</span>
  }

  // Show every outstanding pledge, newest first.
  const outstandingPledges = unpaidPledges
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const isMember = currentMember.membershipType && membershipTiers[currentMember.membershipType]
  const tier = isMember ? membershipTiers[currentMember.membershipType] : null
  const plan = tier ? (tier.plans[currentMember.membershipPlan] || { label: '', monthly: 0 }) : null

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Welcome back, {currentMember.firstName}</h1>
          <p className="page-subtitle">Here's an overview of your account</p>
        </div>
      </div>

      {/* Membership Card */}
      {isMember ? (
        <div className="membership-banner">
          <div className="membership-banner-left">
            <span className="membership-badge">{tier.label}</span>
            <h3 className="membership-plan">{plan.label} Plan</h3>
            <p className="membership-rate">${plan.monthly}/month</p>
          </div>
          <div className="membership-banner-right">
            {currentMember.memberSince && (
              <p className="membership-since">Member since {new Date(currentMember.memberSince + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
            )}
            <p className="membership-id">ID: {currentMember.memberId}</p>
          </div>
        </div>
      ) : (
        <div className="membership-banner" style={{ background: 'linear-gradient(135deg, var(--accent-dark), var(--accent))' }}>
          <div className="membership-banner-left">
            <span className="membership-badge" style={{ background: 'rgba(255,255,255,0.2)' }}>{currentMember.contactType || 'Guest'}</span>
            <h3 className="membership-plan" style={{ margin: '0.5rem 0 0.25rem' }}>Become a Member</h3>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem', margin: 0 }}>
              Join our community with a monthly membership and support the synagogue.
            </p>
          </div>
          <div className="membership-banner-right" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
            <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)', textAlign: 'right' }}>
              {(membershipPlans || []).map((p, idx, arr) => (
                <p key={p.id} style={{ margin: idx === arr.length - 1 ? 0 : '0 0 2px' }}>
                  {p.label}: ${p.price}/mo
                </p>
              ))}
            </div>
            <button
              className="pay-btn"
              style={{ background: '#fff', color: 'var(--accent-dark)', padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600 }}
              onClick={() => navigate('/pay?join=true')}
            >
              Join Now
            </button>
          </div>
        </div>
      )}

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
          <div className={`summary-card-icon ${currentBalance > 0 ? 'wallet-icon' : 'wallet-icon empty'}`}>&#128179;</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Account Credit</p>
            <p className={`summary-card-value ${currentBalance > 0 ? 'wallet-value' : 'wallet-value empty'}`}>${currentBalance.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Outstanding Pledges */}
      <div className="dashboard-section">
        <h2 className="section-title">Outstanding Pledges</h2>
        {outstandingPledges.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>You&apos;re all caught up — no outstanding pledges.</p>
        ) : (
          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Occasion</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {outstandingPledges.map(p => (
                  <tr key={p.id}>
                    <td>{p.description}</td>
                    <td style={{ fontSize: '0.82rem' }}>{p.occasion || '—'}</td>
                    <td>{categoryBadge(p.category)}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="amount-cell">
                      ${p.amount.toLocaleString()}
                      {p.remaining < p.amount && (
                        <span className="remaining-badge">${p.remaining.toLocaleString()} remaining</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
