import { NavLink, useLocation } from 'react-router-dom'
import { adminUser } from '../data/fakeData'
import { useState } from 'react'

export default function Layout({ children, onLogout, userRole, currentMember }) {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isAdmin = userRole === 'admin'

  const memberNavItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/profile', label: 'Profile', icon: '👤' },
    { path: '/history', label: 'Payment History', icon: '📜' },
    { path: '/pay', label: 'Make Payment', icon: '💳' },
    { path: '/cards', label: 'Saved Cards', icon: '💼' },
    { path: '/sponsor', label: 'Sponsor', icon: '🕍' },
    { path: '/statements', label: 'Statements', icon: '📄' },
  ]

  const adminNavItems = [
    { path: '/admin', label: 'Dashboard', icon: '📊' },
    { path: '/admin/members', label: 'Members', icon: '👥' },
    { path: '/admin/pledges', label: 'Pledges & Payments', icon: '💰' },
    { path: '/admin/transactions', label: 'Transactions', icon: '🧾' },
    { path: '/admin/sponsorship', label: 'Sponsorships', icon: '🕍' },
    { path: '/admin/yahrzeits', label: 'Yahrzeits', icon: '🕯️' },
    { path: '/admin/birthdays', label: "Birthdays & B'nei Mitzvah", icon: '🎂' },
    { path: '/admin/emails', label: 'Email Center', icon: '📧' },
    { path: '/admin/settings', label: 'Settings', icon: '⚙️' },
  ]

  const navItems = isAdmin ? adminNavItems : memberNavItems
  const displayUser = isAdmin ? adminUser : currentMember
  const displayName = isAdmin
    ? 'Admin'
    : `${displayUser?.firstName || ''} ${displayUser?.lastName || ''}`
  const initials = isAdmin
    ? 'A'
    : `${displayUser?.firstName?.[0] || ''}${displayUser?.lastName?.[0] || ''}`

  return (
    <div className="portal-layout">
      {/* Top Header */}
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-header-left">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div className="portal-logo">
              <img src="/stcd_logo.png" alt="STCD Logo" />
              <div className="portal-logo-text">
                <span className="portal-logo-title">STCD</span>
                <span className="portal-logo-subtitle">
                  {isAdmin ? 'Admin Portal' : 'Member Portal'}
                </span>
              </div>
            </div>
            {isAdmin && <span className="admin-mode-badge">ADMIN</span>}
          </div>
          <div className="portal-header-right">
            <div className="portal-user-info">
              <div className="portal-user-avatar">
                {initials}
              </div>
              <span className="portal-user-name">
                {displayName}
              </span>
            </div>
            <button className="portal-logout-btn" onClick={onLogout}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="portal-body">
        {/* Sidebar */}
        <aside className={`portal-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
          <nav className="portal-nav">
            {navItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/' || item.path === '/admin'}
                className={({ isActive }) =>
                  `portal-nav-item ${isActive ? 'active' : ''}`
                }
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="portal-nav-icon">{item.icon}</span>
                <span className="portal-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="portal-sidebar-footer">
            {isAdmin ? (
              <p className="portal-member-id">Admin Panel</p>
            ) : (
              <p className="portal-member-id">ID: {displayUser?.memberId}</p>
            )}
          </div>
        </aside>

        {/* Overlay for mobile */}
        {mobileMenuOpen && (
          <div
            className="portal-sidebar-overlay"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Main Content */}
        <main className="portal-main">
          {children}
        </main>
      </div>
    </div>
  )
}
