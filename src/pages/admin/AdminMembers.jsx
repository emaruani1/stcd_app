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
  const [showAddModal, setShowAddModal] = useState(false)
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [newContact, setNewContact] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    address: '', city: '', state: '', zip: '',
    contactType: '', formalSalutation: '',
  })

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleAddContact = async () => {
    if (!newContact.lastName && !newContact.firstName) return
    try {
      await api.createMember({
        firstName: newContact.firstName,
        lastName: newContact.lastName,
        email: newContact.email,
        phone: newContact.phone,
        address: newContact.address,
        city: newContact.city,
        state: newContact.state,
        zip: newContact.zip,
        contactType: newContact.contactType,
        formalSalutation: newContact.formalSalutation,
        balance: 0,
        aliases: [],
        yahrzeits: [],
        children: [],
      })
      setShowAddModal(false)
      setNewContact({ firstName: '', lastName: '', email: '', phone: '', address: '', city: '', state: '', zip: '', contactType: '', formalSalutation: '' })
      showToast('Contact added')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const filtered = allMembers.filter(m => {
    const aliasStr = (m.aliases || []).join(' ').toLowerCase()
    const matchSearch = `${m.firstName} ${m.lastName} ${m.email} ${aliasStr}`.toLowerCase().includes(search.toLowerCase())
    const matchType = typeFilter === 'all' || m.membershipType === typeFilter
    return matchSearch && matchType
  })

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortCol) {
      case 'name': {
        const nameA = `${a.lastName} ${a.firstName}`.toLowerCase()
        const nameB = `${b.lastName} ${b.firstName}`.toLowerCase()
        return nameA < nameB ? -dir : nameA > nameB ? dir : 0
      }
      case 'email':
        return (a.email || '').toLowerCase() < (b.email || '').toLowerCase() ? -dir : dir
      case 'type':
        return (a.contactType || '').toLowerCase() < (b.contactType || '').toLowerCase() ? -dir : dir
      case 'credit': {
        const balA = (memberBalances || {})[a.id] || 0
        const balB = (memberBalances || {})[b.id] || 0
        return (balA - balB) * dir
      }
      case 'outstanding': {
        const outA = a.pledges.filter(p => !p.paid && !p.canceled).reduce((s, p) => s + (p.amount - p.paidAmount), 0)
        const outB = b.pledges.filter(p => !p.paid && !p.canceled).reduce((s, p) => s + (p.amount - p.paidAmount), 0)
        return (outA - outB) * dir
      }
      case 'unpaid': {
        const cntA = a.pledges.filter(p => !p.paid && !p.canceled).length
        const cntB = b.pledges.filter(p => !p.paid && !p.canceled).length
        return (cntA - cntB) * dir
      }
      default:
        return 0
    }
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="pay-btn" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowAddModal(true)}>
            + Add Contact
          </button>
          <button className="modal-btn-secondary" style={{ padding: '10px 20px' }} onClick={() => navigate('/admin/merge')}>
            Merge Accounts
          </button>
        </div>
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
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>Name{sortArrow('name')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('email')}>Email{sortArrow('email')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('type')}>Type / Plan{sortArrow('type')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('credit')}>Credit{sortArrow('credit')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('outstanding')}>Outstanding{sortArrow('outstanding')}</th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('unpaid')}>Unpaid Pledges{sortArrow('unpaid')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan="6" className="empty-row">No members found</td></tr>
              ) : (
                sorted.map(m => {
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
                              <div className="expanded-info-item"><strong>Available Credit:</strong> <span style={{ color: memberBal > 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>${memberBal.toLocaleString()}</span></div>
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
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                              <button
                                className="action-btn action-btn-pay"
                                onClick={(e) => { e.stopPropagation(); navigate(`/admin/members/${m.id}/edit`) }}
                              >
                                Edit Profile
                              </button>
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
                                    <th>Occasion</th>
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
                                      <td style={{ fontSize: '0.82rem' }}>{p.occasion || '—'}</td>
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

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            <h2 className="modal-title">Add New Contact</h2>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" value={newContact.firstName} onChange={e => setNewContact(prev => ({ ...prev, firstName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" value={newContact.lastName} onChange={e => setNewContact(prev => ({ ...prev, lastName: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={newContact.email} onChange={e => setNewContact(prev => ({ ...prev, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={newContact.phone} onChange={e => setNewContact(prev => ({ ...prev, phone: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <input type="text" value={newContact.address} onChange={e => setNewContact(prev => ({ ...prev, address: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City</label>
                  <input type="text" value={newContact.city} onChange={e => setNewContact(prev => ({ ...prev, city: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input type="text" value={newContact.state} onChange={e => setNewContact(prev => ({ ...prev, state: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>ZIP</label>
                  <input type="text" value={newContact.zip} onChange={e => setNewContact(prev => ({ ...prev, zip: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Contact Type</label>
                  <select value={newContact.contactType} onChange={e => setNewContact(prev => ({ ...prev, contactType: e.target.value }))}>
                    <option value="">Select...</option>
                    <option value="MEMBER">Member</option>
                    <option value="REGULAR">Regular</option>
                    <option value="FRIEND OF STCD">Friend of STCD</option>
                    <option value="OCCASIONAL DONOR">Occasional Donor</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Formal Salutation</label>
                  <input type="text" value={newContact.formalSalutation} onChange={e => setNewContact(prev => ({ ...prev, formalSalutation: e.target.value }))} placeholder="e.g. Mr. and Mrs. Cohen" />
                </div>
              </div>
              <button
                className="pay-btn modal-pay-btn"
                onClick={handleAddContact}
                disabled={!newContact.firstName && !newContact.lastName}
              >
                Add Contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
