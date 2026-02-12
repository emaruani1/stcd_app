import { NavLink, useLocation } from 'react-router-dom'
import { currentUser } from '../data/fakeData'
import { useState } from 'react'

export default function Layout({ children, onLogout }) {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/history', label: 'Payment History', icon: '📜' },
    { path: '/pay', label: 'Make Payment', icon: '💳' },
    { path: '/sponsor', label: 'Sponsor', icon: '🕍' },
  ]

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
                <span className="portal-logo-subtitle">Member Portal</span>
              </div>
            </div>
          </div>
          <div className="portal-header-right">
            <div className="portal-user-info">
              <div className="portal-user-avatar">
                {currentUser.firstName[0]}{currentUser.lastName[0]}
              </div>
              <span className="portal-user-name">
                {currentUser.firstName} {currentUser.lastName}
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
                end={item.path === '/'}
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
            <p className="portal-member-id">ID: {currentUser.memberId}</p>
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
