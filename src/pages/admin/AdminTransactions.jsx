import { useState, useMemo } from 'react'
import * as api from '../../api'
import MemberSearchSelect from '../../components/MemberSearchSelect'

export default function AdminTransactions({
  allMembers, setAllMembers,
  adminTransactions, setAdminTransactions,
  paymentMethods, products,
  refreshData,
}) {
  const [search, setSearch] = useState('')
  const [memberFilter, setMemberFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [toast, setToast] = useState('')

  // Bucket a row by gateway result. Rows from /charge carry gatewayResult ('A'|'D'|'E').
  // Rows from manual /transactions entries don't have it — they're treated as 'recorded'.
  const deriveStatus = (t) => {
    const r = (t.gatewayResult || '').toUpperCase()
    if (r === 'A') return 'approved'
    if (r === 'D') return 'declined'
    if (r === 'E') return 'error'
    return 'recorded'
  }

  const statusBadge = (status) => {
    const styles = {
      approved: { bg: '#dcfce7', fg: '#166534', label: 'Approved' },
      declined: { bg: '#fee2e2', fg: '#991b1b', label: 'Declined' },
      error:    { bg: '#fef3c7', fg: '#92400e', label: 'Error' },
      recorded: { bg: '#e5e7eb', fg: '#374151', label: 'Recorded' },
    }[status] || { bg: '#e5e7eb', fg: '#374151', label: status }
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        background: styles.bg,
        color: styles.fg,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '.04em',
      }}>{styles.label}</span>
    )
  }

  // New transaction form
  const [newTxn, setNewTxn] = useState({
    memberId: '',
    paymentType: 'donation',
    amount: '',
    method: paymentMethods[0]?.label || 'Cash',
    description: '',
    date: new Date().toISOString().split('T')[0],
    productId: '',
    pledgeId: '',
    applyToCredit: false,
    alias: '',
  })

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

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
    return <span className={`badge ${cls}`}>{type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unknown'}</span>
  }

  // Merge all transactions from all members + admin transactions
  const allTransactions = useMemo(() => {
    const productMap = {}
    for (const p of products) productMap[p.id] = p.name

    const fromMembers = allMembers.flatMap(m =>
      m.paymentHistory.map(p => ({
        ...p,
        memberId: m.id,
        memberName: `${m.firstName} ${m.lastName}`,
        productName: p.productId ? (productMap[p.productId] || p.productId) : '',
        source: 'member',
      }))
    )
    const fromAdmin = adminTransactions.map(t => {
      const member = allMembers.find(m => m.id === t.memberId)
      return {
        ...t,
        memberName: member ? `${member.firstName} ${member.lastName}` : 'Unknown',
        productName: t.productId ? (productMap[t.productId] || t.productId) : '',
        source: 'admin',
      }
    })
    return [...fromMembers, ...fromAdmin].sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [allMembers, adminTransactions, products])

  const filtered = allTransactions.filter(t => {
    if (memberFilter !== 'all' && String(t.memberId) !== String(memberFilter)) return false
    if (typeFilter !== 'all' && t.paymentType !== typeFilter) return false
    if (statusFilter !== 'all' && deriveStatus(t) !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const member = allMembers.find(m => String(m.id) === String(t.memberId))
      const aliasStr = member ? (member.aliases || []).join(' ').toLowerCase() : ''
      const email = member ? (member.email || '').toLowerCase() : ''
      if (!`${t.description} ${t.memberName}`.toLowerCase().includes(q) && !email.includes(q) && !aliasStr.includes(q)) return false
    }
    return true
  })

  // Counts for the status strip — based on the full transaction list (no filters)
  const statusCounts = useMemo(() => {
    const c = { all: allTransactions.length, approved: 0, declined: 0, error: 0, recorded: 0 }
    for (const t of allTransactions) {
      const s = deriveStatus(t)
      c[s] = (c[s] || 0) + 1
    }
    return c
  }, [allTransactions])

  const handleAddTransaction = async () => {
    if (!newTxn.memberId || !newTxn.amount) return

    let description = newTxn.description
    let amount = parseFloat(newTxn.amount)

    if (newTxn.paymentType === 'purchase' && newTxn.productId) {
      const product = products.find(p => p.id === newTxn.productId)
      if (product) {
        description = description || product.name
        if (!newTxn.amount) amount = product.price
      }
    }

    try {
      await api.createTransaction({
        memberId: String(newTxn.memberId),
        date: newTxn.date,
        description: description || 'Transaction',
        amount,
        method: newTxn.method,
        paymentType: newTxn.paymentType,
        pledgeId: newTxn.pledgeId || '',
        productId: newTxn.productId || '',
        ...(newTxn.alias ? { alias: newTxn.alias } : {}),
      })

      // Apply to member credit if checked
      if (newTxn.applyToCredit) {
        const member = allMembers.find(m => String(m.id) === String(newTxn.memberId))
        const currentBal = member ? Number(member.balance) || 0 : 0
        await api.updateMember(String(newTxn.memberId), { balance: currentBal + amount })
      }

      setShowAddModal(false)
      setNewTxn({
        memberId: '', paymentType: 'donation', amount: '', method: paymentMethods[0]?.label || 'Cash',
        description: '', date: new Date().toISOString().split('T')[0], productId: '', pledgeId: '', applyToCredit: false, alias: '',
      })
      showToast(newTxn.applyToCredit ? 'Transaction created & credit applied' : 'Transaction created')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleStartEdit = (txn) => {
    setEditTarget({ ...txn })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editTarget) return
    try {
      await api.updateTransaction({
        memberId: String(editTarget.memberId),
        transactionId: editTarget.id,
        description: editTarget.description,
        amount: parseFloat(editTarget.amount),
        method: editTarget.method,
        paymentType: editTarget.paymentType,
        date: editTarget.date,
        alias: editTarget.alias || '',
      })
      setShowEditModal(false)
      setEditTarget(null)
      showToast('Transaction updated')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleDelete = async (txn) => {
    if (!confirm('Delete this transaction?')) return
    try {
      await api.deleteTransaction({
        memberId: String(txn.memberId),
        transactionId: txn.id,
      })
      showToast('Transaction deleted')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const selectedMemberForAdd = allMembers.find(m => String(m.id) === String(newTxn.memberId))
  const selectedMemberAliases = selectedMemberForAdd?.aliases || []
  const unpaidPledges = selectedMemberForAdd
    ? selectedMemberForAdd.pledges.filter(p => !p.paid && !p.canceled && p.category === 'pledge')
    : []

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">View and manage all transactions</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      <div className="admin-filter-bar">
        <input
          type="text"
          className="admin-search-input"
          placeholder="Search by name, email, alias, or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ minWidth: '250px' }}>
          <MemberSearchSelect
            allMembers={allMembers}
            value={memberFilter === 'all' ? '' : memberFilter}
            onChange={v => setMemberFilter(v || 'all')}
            placeholder="Filter by member..."
          />
        </div>
        <select className="admin-filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          <option value="membership">Membership</option>
          <option value="pledge">Pledge</option>
          <option value="donation">Donation</option>
          <option value="purchase">Purchase</option>
        </select>
        <select className="admin-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="approved">Approved only</option>
          <option value="declined">Declined only</option>
          <option value="error">Errors only</option>
          <option value="recorded">Recorded (manual / cash / check)</option>
        </select>
        <button className="pay-btn" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowAddModal(true)}>
          + Add Transaction
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          { k: 'all',      label: 'All',       fg: '#374151', bg: '#e5e7eb' },
          { k: 'approved', label: 'Approved',  fg: '#166534', bg: '#dcfce7' },
          { k: 'declined', label: 'Declined',  fg: '#991b1b', bg: '#fee2e2' },
          { k: 'error',    label: 'Errors',    fg: '#92400e', bg: '#fef3c7' },
          { k: 'recorded', label: 'Recorded',  fg: '#374151', bg: '#e5e7eb' },
        ].map(s => (
          <button
            key={s.k}
            onClick={() => setStatusFilter(s.k)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: statusFilter === s.k ? `2px solid ${s.fg}` : '1px solid #e5e7eb',
              background: s.bg,
              color: s.fg,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {s.label} <span style={{ opacity: 0.7 }}>({statusCounts[s.k] || 0})</span>
          </button>
        ))}
      </div>

      <div className="dashboard-section">
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Date</th>
                <th>Description</th>
                <th>Alias</th>
                <th>Product</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="10" className="empty-row">No transactions found</td></tr>
              ) : (
                filtered.map((t, idx) => {
                  const status = deriveStatus(t)
                  const rowStyle = status === 'declined'
                    ? { background: '#fef2f2' }
                    : status === 'error'
                    ? { background: '#fffbeb' }
                    : undefined
                  const cardSuffix = t.cardLast4 ? ` •••• ${t.cardLast4}` : ''
                  return (
                    <tr key={`${t.source}-${t.id}-${idx}`} style={rowStyle}>
                      <td><strong>{t.memberName}</strong></td>
                      <td>{formatDate(t.date)}</td>
                      <td>
                        {t.description}
                        {(t.gatewayError || t.gatewayErrorCode) && (
                          <div style={{ fontSize: '0.72rem', color: '#991b1b', marginTop: 2 }}>
                            {t.gatewayError}{t.gatewayErrorCode ? ` (${t.gatewayErrorCode})` : ''}
                          </div>
                        )}
                        {t.gatewayRefNum && (
                          <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 2 }}>
                            ref {t.gatewayRefNum}
                            {t.gatewayAuthCode ? ` · auth ${t.gatewayAuthCode}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{t.alias || '—'}</td>
                      <td style={{ fontSize: '0.82rem' }}>{t.productName || t.productId || '—'}</td>
                      <td>{paymentTypeBadge(t.paymentType)}</td>
                      <td className="amount-cell">${(t.amount || 0).toLocaleString()}</td>
                      <td>
                        {t.method}
                        {cardSuffix && <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>{cardSuffix}</span>}
                      </td>
                      <td>{statusBadge(status)}</td>
                      <td>
                        <div className="action-btns">
                          <button className="action-btn action-btn-pay" onClick={() => handleStartEdit(t)}>Edit</button>
                          <button className="action-btn action-btn-delete" onClick={() => handleDelete(t)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            <h2 className="modal-title">New Transaction</h2>
            <div className="modal-body">
              <div className="form-group">
                <label>Member</label>
                <MemberSearchSelect
                  allMembers={allMembers}
                  value={newTxn.memberId}
                  onChange={v => setNewTxn(prev => ({ ...prev, memberId: v, pledgeId: '', alias: '' }))}
                  placeholder="Search by name, email, or alias..."
                />
              </div>
              {selectedMemberAliases.length > 0 && (
                <div className="form-group">
                  <label>Paying As (Alias)</label>
                  <select value={newTxn.alias} onChange={e => setNewTxn(prev => ({ ...prev, alias: e.target.value }))}>
                    <option value="">{selectedMemberForAdd.firstName} {selectedMemberForAdd.lastName} (Primary)</option>
                    {selectedMemberAliases.map((alias, i) => (
                      <option key={i} value={alias}>{alias}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Payment Type</label>
                <select value={newTxn.paymentType} onChange={e => setNewTxn(prev => ({ ...prev, paymentType: e.target.value, productId: '', pledgeId: '' }))}>
                  <option value="donation">Donation</option>
                  <option value="pledge">Pledge Payment</option>
                  <option value="purchase">Purchase</option>
                </select>
              </div>

              {newTxn.paymentType === 'purchase' && (
                <div className="form-group">
                  <label>Product</label>
                  <select value={newTxn.productId} onChange={e => {
                    const prod = products.find(p => p.id === e.target.value)
                    setNewTxn(prev => ({
                      ...prev,
                      productId: e.target.value,
                      amount: prod ? String(prod.price) : prev.amount,
                      description: prod ? prod.name : prev.description,
                    }))
                  }}>
                    <option value="">Select product...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (${p.price})</option>
                    ))}
                  </select>
                </div>
              )}

              {newTxn.paymentType === 'pledge' && newTxn.memberId && (
                <div className="form-group">
                  <label>Link to Pledge (optional)</label>
                  <select value={newTxn.pledgeId} onChange={e => setNewTxn(prev => ({ ...prev, pledgeId: e.target.value }))}>
                    <option value="">No specific pledge</option>
                    {unpaidPledges.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.description} - ${(p.amount - p.paidAmount).toLocaleString()} remaining
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={newTxn.description}
                  onChange={e => setNewTxn(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Transaction description"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newTxn.amount}
                    onChange={e => setNewTxn(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={newTxn.date}
                    onChange={e => setNewTxn(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select value={newTxn.method} onChange={e => setNewTxn(prev => ({ ...prev, method: e.target.value }))}>
                  {paymentMethods.map(m => (
                    <option key={m.id} value={m.label}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newTxn.applyToCredit} onChange={e => setNewTxn(prev => ({ ...prev, applyToCredit: e.target.checked }))} />
                  Apply amount to member's available credit
                </label>
              </div>
              <button
                className="pay-btn modal-pay-btn"
                onClick={handleAddTransaction}
                disabled={!newTxn.memberId || !newTxn.amount}
              >
                Create Transaction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {showEditModal && editTarget && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            <h2 className="modal-title">Edit Transaction</h2>
            <div className="modal-body">
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={editTarget.description}
                  onChange={e => setEditTarget(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Payment Type</label>
                <select value={editTarget.paymentType || ''} onChange={e => setEditTarget(prev => ({ ...prev, paymentType: e.target.value }))}>
                  <option value="membership">Membership</option>
                  <option value="pledge">Pledge</option>
                  <option value="donation">Donation</option>
                  <option value="purchase">Purchase</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editTarget.amount}
                    onChange={e => setEditTarget(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={editTarget.date}
                    onChange={e => setEditTarget(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select value={editTarget.method} onChange={e => setEditTarget(prev => ({ ...prev, method: e.target.value }))}>
                  {paymentMethods.map(m => (
                    <option key={m.id} value={m.label}>{m.label}</option>
                  ))}
                </select>
              </div>
              {(() => {
                const editMember = allMembers.find(m => String(m.id) === String(editTarget.memberId))
                const editAliases = editMember?.aliases || []
                return editAliases.length > 0 ? (
                  <div className="form-group">
                    <label>Paying As (Alias)</label>
                    <select value={editTarget.alias || ''} onChange={e => setEditTarget(prev => ({ ...prev, alias: e.target.value }))}>
                      <option value="">{editMember.firstName} {editMember.lastName} (Primary)</option>
                      {editAliases.map((alias, i) => (
                        <option key={i} value={alias}>{alias}</option>
                      ))}
                    </select>
                  </div>
                ) : null
              })()}
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button className="pay-btn" style={{ padding: '10px 24px' }} onClick={handleSaveEdit}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
