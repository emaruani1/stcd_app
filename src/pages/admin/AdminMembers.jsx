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
  const [showEditModal, setShowEditModal] = useState(false)
  const [editMember, setEditMember] = useState(null)
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

  const startEditMember = (m) => {
    setEditMember({ ...m })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editMember) return
    try {
      await api.updateMember(String(editMember.id), {
        firstName: editMember.firstName,
        lastName: editMember.lastName,
        email: editMember.email,
        phone: editMember.phone,
        address: editMember.address,
        addressLine2: editMember.addressLine2 || '',
        city: editMember.city,
        state: editMember.state,
        zip: editMember.zip,
        contactType: editMember.contactType,
        formalSalutation: editMember.formalSalutation,
        dearWho: editMember.dearWho || '',
        gender: editMember.gender,
        dob: editMember.dob,
        spouseName: editMember.spouseName,
        spouseGender: editMember.spouseGender,
        spouseDob: editMember.spouseDob,
        marriageDate: editMember.marriageDate,
        membershipType: editMember.membershipType,
        membershipPlan: editMember.membershipPlan,
        memberSince: editMember.memberSince,
      })
      setShowEditModal(false)
      setEditMember(null)
      showToast('Profile updated')
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
                <th>Name</th>
                <th>Email</th>
                <th>Type / Plan</th>
                <th>Credit</th>
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
                                onClick={(e) => { e.stopPropagation(); startEditMember(m) }}
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

      {/* Edit Profile Modal */}
      {showEditModal && editMember && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto' }}>
            <button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            <h2 className="modal-title">Edit Profile — {editMember.firstName} {editMember.lastName}</h2>
            <div className="modal-body">
              <h4 style={{ margin: '0 0 0.75rem', color: 'var(--text-light)' }}>Personal Info</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" value={editMember.firstName} onChange={e => setEditMember(prev => ({ ...prev, firstName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" value={editMember.lastName} onChange={e => setEditMember(prev => ({ ...prev, lastName: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={editMember.email} onChange={e => setEditMember(prev => ({ ...prev, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={editMember.phone} onChange={e => setEditMember(prev => ({ ...prev, phone: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Gender</label>
                  <select value={editMember.gender} onChange={e => setEditMember(prev => ({ ...prev, gender: e.target.value }))}>
                    <option value="">—</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Date of Birth</label>
                  <input type="date" value={editMember.dob} onChange={e => setEditMember(prev => ({ ...prev, dob: e.target.value }))} />
                </div>
              </div>

              <h4 style={{ margin: '1.25rem 0 0.75rem', color: 'var(--text-light)' }}>Address</h4>
              <div className="form-group">
                <label>Address Line 1</label>
                <input type="text" value={editMember.address} onChange={e => setEditMember(prev => ({ ...prev, address: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Address Line 2</label>
                <input type="text" value={editMember.addressLine2 || ''} onChange={e => setEditMember(prev => ({ ...prev, addressLine2: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City</label>
                  <input type="text" value={editMember.city} onChange={e => setEditMember(prev => ({ ...prev, city: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input type="text" value={editMember.state} onChange={e => setEditMember(prev => ({ ...prev, state: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>ZIP</label>
                  <input type="text" value={editMember.zip} onChange={e => setEditMember(prev => ({ ...prev, zip: e.target.value }))} />
                </div>
              </div>

              <h4 style={{ margin: '1.25rem 0 0.75rem', color: 'var(--text-light)' }}>Spouse</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Spouse Name</label>
                  <input type="text" value={editMember.spouseName} onChange={e => setEditMember(prev => ({ ...prev, spouseName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Spouse Gender</label>
                  <select value={editMember.spouseGender} onChange={e => setEditMember(prev => ({ ...prev, spouseGender: e.target.value }))}>
                    <option value="">—</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Spouse DOB</label>
                  <input type="date" value={editMember.spouseDob} onChange={e => setEditMember(prev => ({ ...prev, spouseDob: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Marriage Date</label>
                  <input type="date" value={editMember.marriageDate} onChange={e => setEditMember(prev => ({ ...prev, marriageDate: e.target.value }))} />
                </div>
              </div>

              <h4 style={{ margin: '1.25rem 0 0.75rem', color: 'var(--text-light)' }}>Membership</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Contact Type</label>
                  <select value={editMember.contactType} onChange={e => setEditMember(prev => ({ ...prev, contactType: e.target.value }))}>
                    <option value="">—</option>
                    <option value="MEMBER">Member</option>
                    <option value="REGULAR">Regular</option>
                    <option value="FRIEND OF STCD">Friend of STCD</option>
                    <option value="OCCASIONAL DONOR">Occasional Donor</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Membership Type</label>
                  <select value={editMember.membershipType} onChange={e => setEditMember(prev => ({ ...prev, membershipType: e.target.value }))}>
                    <option value="">—</option>
                    <option value="full">Full Member</option>
                    <option value="associate">Associate Member</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Membership Plan</label>
                  <select value={editMember.membershipPlan} onChange={e => setEditMember(prev => ({ ...prev, membershipPlan: e.target.value }))}>
                    <option value="">—</option>
                    <option value="single">Single</option>
                    <option value="couple">Couple</option>
                    <option value="family">Family</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Member Since</label>
                  <input type="date" value={editMember.memberSince} onChange={e => setEditMember(prev => ({ ...prev, memberSince: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Formal Salutation</label>
                <input type="text" value={editMember.formalSalutation} onChange={e => setEditMember(prev => ({ ...prev, formalSalutation: e.target.value }))} />
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button className="modal-btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button className="pay-btn" style={{ padding: '10px 24px' }} onClick={handleSaveEdit}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
