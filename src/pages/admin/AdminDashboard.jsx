import { useNavigate } from 'react-router-dom'

export default function AdminDashboard({ allMembers, memberBalances }) {
  const navigate = useNavigate()

  const totalMembers = allMembers.length

  const totalMemberBalances = Object.values(memberBalances || {}).reduce((sum, bal) => sum + bal, 0)

  const totalOutstanding = allMembers.reduce((sum, member) => {
    const memberOwed = member.pledges
      .filter(p => !p.paid && !p.canceled)
      .reduce((s, p) => s + (p.amount - p.paidAmount), 0)
    return sum + memberOwed
  }, 0)

  // Yahrzeits this week
  const today = new Date()
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const yahrzeitsThisWeek = allMembers.reduce((count, member) => {
    return count + member.yahrzeits.filter(y => {
      const d = new Date(y.date + 'T00:00:00')
      return d >= today && d <= weekEnd
    }).length
  }, 0)

  // Upcoming birthdays (next 30 days)
  const monthEnd = new Date(today)
  monthEnd.setDate(monthEnd.getDate() + 30)
  const upcomingBirthdays = allMembers.reduce((count, member) => {
    const bdays = []
    if (member.dob) bdays.push(member.dob)
    if (member.spouseDob) bdays.push(member.spouseDob)
    member.children.forEach(c => { if (c.dob) bdays.push(c.dob) })
    return count + bdays.filter(dob => {
      const d = new Date(dob + 'T00:00:00')
      const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate())
      return thisYear >= today && thisYear <= monthEnd
    }).length
  }, 0)

  // Members with overdue pledges (top 5)
  const todayStr = today.toISOString().split('T')[0]
  const membersWithOverdue = allMembers
    .map(member => {
      const overdue = member.pledges.filter(p =>
        !p.paid && !p.canceled && p.date < todayStr
      )
      const overdueTotal = overdue.reduce((s, p) => s + (p.amount - p.paidAmount), 0)
      return { ...member, overdueCount: overdue.length, overdueTotal }
    })
    .filter(m => m.overdueCount > 0)
    .sort((a, b) => b.overdueTotal - a.overdueTotal)
    .slice(0, 5)

  const quickLinks = [
    { icon: '👥', label: 'Members', path: '/admin/members' },
    { icon: '💰', label: 'Pledges & Payments', path: '/admin/pledges' },
    { icon: '🕍', label: 'Sponsorships', path: '/admin/sponsorship' },
    { icon: '🕯️', label: 'Yahrzeits', path: '/admin/yahrzeits' },
    { icon: '🎂', label: 'Birthdays', path: '/admin/birthdays' },
    { icon: '📧', label: 'Email Center', path: '/admin/emails' },
  ]

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="page-subtitle">Overview of all members and activity</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-card-icon pledges-icon">👥</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Total Members</p>
            <p className="summary-card-value">{totalMembers}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon balance-icon">$</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Total Outstanding</p>
            <p className="summary-card-value">${totalOutstanding.toLocaleString()}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon action-icon">🕯️</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Yahrzeits This Week</p>
            <p className="summary-card-value">{yahrzeitsThisWeek}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon paid-icon">🎂</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Upcoming Birthdays</p>
            <p className="summary-card-value">{upcomingBirthdays}</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon admin-wallet-icon">&#128179;</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Total Member Balances</p>
            <p className="summary-card-value" style={{ color: 'var(--success)' }}>${totalMemberBalances.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Members with Overdue Pledges */}
      {membersWithOverdue.length > 0 && (
        <div className="dashboard-section">
          <h2 className="section-title overdue-title">Members with Overdue Pledges</h2>
          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Overdue Pledges</th>
                  <th>Overdue Amount</th>
                </tr>
              </thead>
              <tbody>
                {membersWithOverdue.map(m => (
                  <tr key={m.id} className="overdue-row">
                    <td>{m.firstName} {m.lastName}</td>
                    <td>{m.email}</td>
                    <td>{m.overdueCount}</td>
                    <td className="amount-cell">${m.overdueTotal.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="admin-quick-links">
        {quickLinks.map(link => (
          <div
            key={link.path}
            className="admin-quick-link"
            onClick={() => navigate(link.path)}
          >
            <span className="admin-quick-link-icon">{link.icon}</span>
            <span className="admin-quick-link-label">{link.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
