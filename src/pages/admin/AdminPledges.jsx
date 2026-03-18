import { useState, useMemo } from 'react'
import * as api from '../../api'

export default function AdminPledges({
  allMembers, setAllMembers,
  pledgeTypes, occasions, paymentMethods,
  products,
  adminTransactions, setAdminTransactions,
  refreshData,
}) {
  const [memberFilter, setMemberFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showCreateTxnModal, setShowCreateTxnModal] = useState(false)
  const [selectedPledge, setSelectedPledge] = useState(null)
  const [selectedMemberId, setSelectedMemberId] = useState(null)
  const [toast, setToast] = useState('')

  // Mark Paid form
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]?.label || 'Cash')
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])

  // New pledge form
  const [newPledge, setNewPledge] = useState({
    memberId: '',
    pledgeType: '',
    occasion: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
  })

  // Create transaction form
  const [newTxn, setNewTxn] = useState({
    memberId: '',
    paymentType: 'donation',
    amount: '',
    method: paymentMethods[0]?.label || 'Cash',
    description: '',
    date: new Date().toISOString().split('T')[0],
    productId: '',
  })

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Filter pledge types by selected occasion
  const filteredPledgeTypes = useMemo(() => {
    if (!newPledge.occasion) return pledgeTypes
    return pledgeTypes.filter(pt => pt.occasions.includes(newPledge.occasion))
  }, [pledgeTypes, newPledge.occasion])

  // Flatten all pledges with member info
  const allPledges = allMembers.flatMap(member =>
    member.pledges.map(p => ({
      ...p,
      memberId: member.id,
      memberName: `${member.firstName} ${member.lastName}`,
    }))
  )

  const filtered = allPledges.filter(p => {
    if (memberFilter !== 'all' && String(p.memberId) !== String(memberFilter)) return false
    if (statusFilter === 'unpaid' && (p.paid || p.canceled)) return false
    if (statusFilter === 'paid' && !p.paid) return false
    if (statusFilter === 'canceled' && !p.canceled) return false
    if (search && !`${p.description} ${p.memberName}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).sort((a, b) => new Date(b.date) - new Date(a.date))

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const paymentTypeBadge = (category) => {
    const cls = {
      membership: 'badge-membership',
      pledge: 'badge-pledge',
      donation: 'badge-donation',
      purchase: 'badge-purchase',
    }[category] || 'badge-pending'
    return <span className={`badge ${cls}`} style={{ fontSize: '0.72rem' }}>{category ? category.charAt(0).toUpperCase() + category.slice(1) : '—'}</span>
  }

  const handleMarkPaid = (pledge, mId) => {
    setSelectedPledge(pledge)
    setSelectedMemberId(mId)
    setPaymentMethod(paymentMethods[0]?.label || 'Cash')
    setPayAmount(String(pledge.amount - pledge.paidAmount))
    setPayDate(new Date().toISOString().split('T')[0])
    setShowPayModal(true)
  }

  const confirmMarkPaid = async () => {
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) return

    try {
      await api.payPledge({
        memberId: String(selectedMemberId),
        pledgeId: selectedPledge.id,
        amount,
        method: paymentMethod,
        date: payDate,
      })
      setShowPayModal(false)
      showToast(amount < (selectedPledge.amount - selectedPledge.paidAmount) ? 'Partial payment recorded' : 'Pledge marked as paid')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleCancel = async (pledge, mId) => {
    if (!confirm('Cancel this pledge?')) return
    try {
      await api.updatePledge({
        memberId: String(mId),
        pledgeId: pledge.id,
        canceled: true,
      })
      showToast('Pledge canceled')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleDelete = (pledge, mId) => {
    setSelectedPledge(pledge)
    setSelectedMemberId(mId)
    setShowDeleteModal(true)
  }

  const confirmDelete = async () => {
    try {
      await api.deletePledge({
        memberId: String(selectedMemberId),
        pledgeId: selectedPledge.id,
      })
      setShowDeleteModal(false)
      showToast('Pledge deleted')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleAddPledge = async () => {
    if (!newPledge.memberId || !newPledge.amount) return

    const pledgeTypeObj = pledgeTypes.find(pt => pt.label === newPledge.pledgeType)
    const description = pledgeTypeObj ? pledgeTypeObj.label : 'Custom Pledge'

    try {
      await api.createPledge({
        memberId: String(newPledge.memberId),
        description,
        pledgeType: newPledge.pledgeType,
        occasion: newPledge.occasion,
        amount: parseFloat(newPledge.amount),
        date: newPledge.date,
        category: 'pledge',
      })
      setNewPledge({ memberId: '', pledgeType: '', occasion: '', amount: '', date: new Date().toISOString().split('T')[0] })
      setShowAddModal(false)
      showToast('Pledge added successfully')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleCreateTransaction = async () => {
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
      })
      setShowCreateTxnModal(false)
      setNewTxn({
        memberId: '', paymentType: 'donation', amount: '', method: paymentMethods[0]?.label || 'Cash',
        description: '', date: new Date().toISOString().split('T')[0], productId: '',
      })
      showToast('Transaction created')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Pledges & Payments</h1>
          <p className="page-subtitle">Manage all member pledges and create transactions</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {/* Filters */}
      <div className="admin-filter-bar">
        <input
          type="text"
          className="admin-search-input"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="admin-filter-select"
          value={memberFilter}
          onChange={e => setMemberFilter(e.target.value)}
        >
          <option value="all">All Members</option>
          {allMembers.map(m => (
            <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
          ))}
        </select>
        <select
          className="admin-filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="canceled">Canceled</option>
        </select>
        <button className="pay-btn" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowAddModal(true)}>
          + Add Pledge
        </button>
        <button className="modal-btn-secondary" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowCreateTxnModal(true)}>
          + Transaction
        </button>
      </div>

      {/* Pledges Table */}
      <div className="dashboard-section">
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Description</th>
                <th>Type</th>
                <th>Occasion</th>
                <th>Category</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="9" className="empty-row">No pledges found</td></tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr key={`${p.memberId}-${p.id}-${idx}`}>
                    <td><strong>{p.memberName}</strong></td>
                    <td>{p.description}</td>
                    <td style={{ fontSize: '0.82rem' }}>{p.pledgeType || '—'}</td>
                    <td style={{ fontSize: '0.82rem' }}>{p.occasion || '—'}</td>
                    <td>{paymentTypeBadge(p.category)}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="amount-cell">
                      ${p.amount.toLocaleString()}
                      {p.paidAmount > 0 && p.paidAmount < p.amount && (
                        <span className="remaining-badge">${(p.amount - p.paidAmount).toLocaleString()} remaining</span>
                      )}
                    </td>
                    <td>
                      {p.canceled ? (
                        <span className="badge badge-canceled">Canceled</span>
                      ) : p.paid ? (
                        <span className="badge badge-paid">Paid</span>
                      ) : (
                        <span className="badge badge-pending">Pending</span>
                      )}
                    </td>
                    <td>
                      {!p.paid && !p.canceled && (
                        <div className="action-btns">
                          <button className="action-btn action-btn-pay" onClick={() => handleMarkPaid(p, p.memberId)}>
                            Mark Paid
                          </button>
                          <button className="action-btn action-btn-cancel" onClick={() => handleCancel(p, p.memberId)}>
                            Cancel
                          </button>
                          <button className="action-btn action-btn-delete" onClick={() => handleDelete(p, p.memberId)}>
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Pledge Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            <h2 className="modal-title">Add New Pledge</h2>
            <div className="modal-body">
              <div className="form-group">
                <label>Member</label>
                <select
                  value={newPledge.memberId}
                  onChange={e => setNewPledge(prev => ({ ...prev, memberId: e.target.value }))}
                >
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Occasion</label>
                <select
                  value={newPledge.occasion}
                  onChange={e => setNewPledge(prev => ({ ...prev, occasion: e.target.value, pledgeType: '' }))}
                >
                  <option value="">All occasions...</option>
                  {occasions.map(o => (
                    <option key={o.id} value={o.label}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Pledge Type</label>
                <select
                  value={newPledge.pledgeType}
                  onChange={e => setNewPledge(prev => ({ ...prev, pledgeType: e.target.value }))}
                >
                  <option value="">Select type...</option>
                  {filteredPledgeTypes.map(t => (
                    <option key={t.id} value={t.label}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount ($)</label>
                  <input
                    type="number"
                    min="1"
                    value={newPledge.amount}
                    onChange={e => setNewPledge(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="150"
                  />
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={newPledge.date}
                    onChange={e => setNewPledge(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
              </div>
              <button
                className="pay-btn modal-pay-btn"
                onClick={handleAddPledge}
                disabled={!newPledge.memberId || !newPledge.amount}
              >
                Add Pledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Paid Modal */}
      {showPayModal && selectedPledge && (
        <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button>
            <h2 className="modal-title">Record Payment</h2>
            <div className="modal-body">
              <div className="modal-total">
                <span>{selectedPledge.description}</span>
                <span>${(selectedPledge.amount - selectedPledge.paidAmount).toLocaleString()} remaining</span>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Payment Amount ($)</label>
                  <input
                    type="number"
                    min="0.01"
                    max={selectedPledge.amount - selectedPledge.paidAmount}
                    step="0.01"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Transaction Date</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  {paymentMethods.map(m => (
                    <option key={m.id} value={m.label}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowPayModal(false)}>Cancel</button>
                <button className="pay-btn" style={{ padding: '10px 24px' }} onClick={confirmMarkPaid}>Confirm Payment</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedPledge && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowDeleteModal(false)}>&times;</button>
            <h2 className="modal-title">Delete Pledge</h2>
            <div className="modal-body">
              <p className="modal-desc">
                Are you sure you want to permanently delete this pledge?
              </p>
              <div className="modal-total">
                <span>{selectedPledge.description}</span>
                <span>${selectedPledge.amount.toLocaleString()}</span>
              </div>
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowDeleteModal(false)}>Cancel</button>
                <button className="modal-btn-danger" onClick={confirmDelete}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Transaction Modal */}
      {showCreateTxnModal && (
        <div className="modal-overlay" onClick={() => setShowCreateTxnModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreateTxnModal(false)}>&times;</button>
            <h2 className="modal-title">Create Transaction</h2>
            <div className="modal-body">
              <div className="form-group">
                <label>Member</label>
                <select value={newTxn.memberId} onChange={e => setNewTxn(prev => ({ ...prev, memberId: e.target.value }))}>
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={newTxn.paymentType} onChange={e => setNewTxn(prev => ({ ...prev, paymentType: e.target.value, productId: '' }))}>
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
              <div className="form-group">
                <label>Description</label>
                <input type="text" value={newTxn.description} onChange={e => setNewTxn(prev => ({ ...prev, description: e.target.value }))} placeholder="Description" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount ($)</label>
                  <input type="number" min="0" step="0.01" value={newTxn.amount} onChange={e => setNewTxn(prev => ({ ...prev, amount: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={newTxn.date} onChange={e => setNewTxn(prev => ({ ...prev, date: e.target.value }))} />
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
              <button
                className="pay-btn modal-pay-btn"
                onClick={handleCreateTransaction}
                disabled={!newTxn.memberId || !newTxn.amount}
              >
                Create Transaction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
