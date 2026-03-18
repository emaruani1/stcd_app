import { useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { membershipTiers } from '../../data/fakeData'
import * as api from '../../api'

export default function AdminMembers({ allMembers, setAllMembers, memberBalances, adminTransactions, refreshData }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [editingAliasId, setEditingAliasId] = useState(null)
  const [aliasInput, setAliasInput] = useState('')
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const filtered = allMembers.filter(m => {
    const aliasStr = (m.aliases || []).join(' ').toLowerCase()
    const matchSearch = `${m.firstName} ${m.lastName} ${m.email} ${aliasStr}`.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || m.membershipType === typeFilter
    return matchSearch && matchType
  })

  const getOutstanding = (member) => {
    return member.pledges
      .filter(p => !p.paid && !p.canceled)
      .reduce((s, p) => s + (p.amount - p.paidAmount), 0)
  }

  const getUnpaidCount = (member) => {
    return member.pledges.filter(p => !p.paid && !p.canceled).length
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
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
    return <span className={`badge ${cls}`} style={{ fontSize: '0.72rem' }}>{type ? type.charAt(0).toUpperCase() + type.slice(1) : '—'}</span>
  }

  const categoryBadge = (cat) => {
    const cls = {
      membership: 'badge-membership',
      pledge: 'badge-pledge',
    }[cat] || 'badge-pending'
    return <span className={`badge ${cls}`} style={{ fontSize: '0.72rem' }}>{cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '—'}</span>
  }

  const addAlias = async (memberId) => {
    if (!aliasInput.trim()) return
    const member = allMembers.find(m => m.id === memberId)
    const aliases = [...(member?.aliases || []), aliasInput.trim()]
    try {
      await api.updateMember(String(memberId), { aliases })
      setAliasInput('')
      showToast('Alias added')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const removeAlias = async (memberId, alias) => {
    const member = allMembers.find(m => m.id === memberId)
    const aliases = (member?.aliases || []).filter(a => a !== alias)
    try {
      await api.updateMember(String(memberId), { aliases })
      showToast('Alias removed')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  // Get admin transactions for a member
  const getAdminTxns = (memberId) => {
    return (adminTransactions || []).filter(t => t.memberId === memberId)
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-subtitle">Manage all community members</p>
        </div>
        <button className="modal-btn-secondary" style={{ padding: '10px 20px' }} onClick={() => navigate('/admin/merge')}>
          Merge Accounts
        </button>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      <div className="admin-filter-bar">
        <input
          type="text"
          className="admin-search-input"
          placeholder="Search by name, email, or alias..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="admin-filter-select"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="all">All Types</option>
          <option value="full">Full Member</option>
          <option value="associate">Associate Member</option>
        </select>
      </div>

      <div className="dashboard-section">
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Type / Plan</th>
                <th>Balance</th>
                <th>Outstanding</th>
                <th>Unpaid Pledges</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="6" className="empty-row">No members found</td></tr>
              ) : (
                filtered.map(m => {
                  const tier = membershipTiers[m.membershipType] || { label: m.contactType || 'Contact', plans: {} }
                  const plan = tier.plans[m.membershipPlan] || { label: '', monthly: 0 }
                  const outstanding = getOutstanding(m)
                  const unpaid = getUnpaidCount(m)
                  const memberBal = (memberBalances || {})[m.id] || 0
                  const isExpanded = expandedId === m.id

                  return (
                    <Fragment key={m.id}>
                      <tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedId(isExpanded ? null : m.id)}
                        className={isExpanded ? 'selected-row' : ''}
                      >
                        <td>
                          <strong>{m.firstName} {m.lastName}</strong>
                          {(m.aliases || []).length > 0 && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                              aka {m.aliases.join(', ')}
                            </span>
                          )}
                        </td>
                        <td>{m.email}</td>
                        <td>
                          <span className={`badge ${m.membershipType === 'full' ? 'badge-active' : 'badge-pending'}`}>
                            {tier.label}
                          </span>
                          {' '}
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{plan.label}</span>
                        </td>
                        <td className="amount-cell" style={{ color: memberBal > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                          ${memberBal.toLocaleString()}
                        </td>
                        <td className="amount-cell">${outstanding.toLocaleString()}</td>
                        <td>{unpaid}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan="6" className="expanded-row-content">
                            <h4>Profile</h4>
                            <div className="expanded-info-grid">
                              <div className="expanded-info-item"><strong>Phone:</strong> {m.phone}</div>
                              <div className="expanded-info-item"><strong>Member ID:</strong> {m.memberId}</div>
                              <div className="expanded-info-item"><strong>Since:</strong> {formatDate(m.memberSince)}</div>
                              <div className="expanded-info-item"><strong>Address:</strong> {m.address}, {m.city}, {m.state} {m.zip}</div>
                              <div className="expanded-info-item"><strong>Account Balance:</strong> <span style={{ color: memberBal > 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>${memberBal.toLocaleString()}</span></div>
                              {m.spouseName && <div className="expanded-info-item"><strong>Spouse:</strong> {m.spouseName}</div>}
                              {m.children.length > 0 && <div className="expanded-info-item"><strong>Children:</strong> {m.children.map(c => c.name).join(', ')}</div>}
                            </div>

                            {/* Aliases */}
                            <h4>Aliases</h4>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                              {(m.aliases || []).map(alias => (
                                <span key={alias} className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                  {alias}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeAlias(m.id, alias) }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, fontSize: '0.9rem' }}
                                  >
                                    x
                                  </button>
                                </span>
                              ))}
                              {(m.aliases || []).length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No aliases</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
                              <input
                                type="text"
                                placeholder="Add alias (e.g. company name)"
                                value={editingAliasId === m.id ? aliasInput : ''}
                                onFocus={() => { setEditingAliasId(m.id); setAliasInput('') }}
                                onChange={e => setAliasInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addAlias(m.id)}
                                onClick={e => e.stopPropagation()}
                                style={{ padding: '6px 10px', fontSize: '0.85rem', flex: 1, maxWidth: '300px' }}
                              />
                              <button
                                className="action-btn action-btn-pay"
                                onClick={(e) => { e.stopPropagation(); addAlias(m.id) }}
                                style={{ padding: '6px 12px' }}
                              >
                                Add
                              </button>
                            </div>

                            {/* Quick actions */}
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                              <button
                                className="action-btn action-btn-pay"
                                onClick={(e) => { e.stopPropagation(); navigate(`/admin/statements/${m.id}`) }}
                              >
                                View Statement
                              </button>
                              <button
                                className="action-btn action-btn-cancel"
                                onClick={(e) => { e.stopPropagation(); navigate(`/admin/merge?member=${m.id}`) }}
                              >
                                Merge Account
                              </button>
                            </div>

                            <h4>Pledges</h4>
                            <div className="pledges-table-wrap">
                              <table className="pledges-table">
                                <thead>
                                  <tr>
                                    <th>Description</th>
                                    <th>Category</th>
                                    <th>Date</th>
                                    <th>Amount</th>
                                    <th>Paid</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.pledges.slice(0, 10).map(p => (
                                    <tr key={p.id}>
                                      <td>{p.description}</td>
                                      <td>{categoryBadge(p.category)}</td>
                                      <td>{formatDate(p.date)}</td>
                                      <td className="amount-cell">${p.amount.toLocaleString()}</td>
                                      <td className="amount-cell">${p.paidAmount.toLocaleString()}</td>
                                      <td>
                                        {p.canceled ? (
                                          <span className="badge badge-canceled">Canceled</span>
                                        ) : p.paid ? (
                                          <span className="badge badge-paid">Paid</span>
                                        ) : (
                                          <span className="badge badge-pending">Pending</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <h4>Recent Payments</h4>
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
                                  {[...m.paymentHistory, ...getAdminTxns(m.id)]
                                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                                    .slice(0, 10)
                                    .map((p, idx) => (
                                    <tr key={p.id || idx}>
                                      <td>{formatDate(p.date)}</td>
                                      <td>{p.description}</td>
                                      <td>{paymentTypeBadge(p.paymentType)}</td>
                                      <td className="amount-cell">${p.amount.toLocaleString()}</td>
                                      <td>{p.method}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
