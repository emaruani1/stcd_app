import { useState, useMemo } from 'react'
import * as api from '../../api'

export default function AdminTransactions({
  allMembers, setAllMembers,
  adminTransactions, setAdminTransactions,
  paymentMethods, products,
  refreshData,
}) {
  const [search, setSearch] = useState('')
  const [memberFilter, setMemberFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [toast, setToast] = useState('')

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
    if (search && !`${t.description} ${t.memberName}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

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
        description: '', date: new Date().toISOString().split('T')[0], productId: '', pledgeId: '', applyToCredit: false,
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

  const selectedMemberForAdd = allMembers.find(m => m.id === Number(newTxn.memberId))
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
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="admin-filter-select" value={memberFilter} onChange={e => setMemberFilter(e.target.value)}>
          <option value="all">All Members</option>
          {allMembers.map(m => (
            <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
          ))}
        </select>
        <select className="admin-filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          <option value="membership">Membership</option>
          <option value="pledge">Pledge</option>
          <option value="donation">Donation</option>
          <option value="purchase">Purchase</option>
        </select>
        <button className="pay-btn" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowAddModal(true)}>
          + Add Transaction
        </button>
      </div>

      <div className="dashboard-section">
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Date</th>
                <th>Description</th>
                <th>Product</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="8" className="empty-row">No transactions found</td></tr>
              ) : (
                filtered.map((t, idx) => (
                  <tr key={`${t.source}-${t.id}-${idx}`}>
                    <td><strong>{t.memberName}</strong></td>
                    <td>{formatDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td style={{ fontSize: '0.82rem' }}>{t.productName || t.productId || '—'}</td>
                    <td>{paymentTypeBadge(t.paymentType)}</td>
                    <td className="amount-cell">${(t.amount || 0).toLocaleString()}</td>
                    <td>{t.method}</td>
                    <td>
                      <div className="action-btns">
                        <button className="action-btn action-btn-pay" onClick={() => handleStartEdit(t)}>Edit</button>
                        <button className="action-btn action-btn-delete" onClick={() => handleDelete(t)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
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
                <select value={newTxn.memberId} onChange={e => setNewTxn(prev => ({ ...prev, memberId: e.target.value, pledgeId: '' }))}>
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                  ))}
                </select>
              </div>
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
