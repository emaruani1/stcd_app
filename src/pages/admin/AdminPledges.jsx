import { useState, useMemo } from 'react'
import * as api from '../../api'
import MemberSearchSelect from '../../components/MemberSearchSelect'
import IFieldsCardForm from '../../components/IFieldsCardForm'

const IFIELDS_KEY = import.meta.env.VITE_SOLA_IFIELDS_KEY || ''

export default function AdminPledges({
  allMembers, setAllMembers,
  pledgeTypes, occasions, paymentMethods,
  products,
  adminTransactions, setAdminTransactions,
  refreshData,
}) {
  const [memberFilter, setMemberFilter] = useState('all')
  const [aliasFilter, setAliasFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCanceled, setShowCanceled] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelingNow, setCancelingNow] = useState(false)
  const [showCreateTxnModal, setShowCreateTxnModal] = useState(false)
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [selectedPledge, setSelectedPledge] = useState(null)
  const [selectedMemberId, setSelectedMemberId] = useState(null)
  const [toast, setToast] = useState('')

  // Charge-card modal — pay a pledge or a sponsorship fee using a saved card
  // (or a new card the admin enters here on the spot). The same modal serves
  // both cases; the branch is on `selectedPledge.kind`.
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [chargeCards, setChargeCards] = useState([])
  const [chargeCardsLoading, setChargeCardsLoading] = useState(false)
  const [chargeSelectedCardId, setChargeSelectedCardId] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeDescription, setChargeDescription] = useState('')
  const [chargeAlias, setChargeAlias] = useState('')
  const [chargeAddNew, setChargeAddNew] = useState(false)
  const [chargeSaveOnFile, setChargeSaveOnFile] = useState(true)
  const [charging, setCharging] = useState(false)
  const [chargeError, setChargeError] = useState('')
  const [chargeReceipt, setChargeReceipt] = useState(null)

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
    alias: '',
    notes: '',
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
    applyToCredit: false,
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

  // Outstanding obligations: unpaid pledges PLUS unpaid sponsorship-fee rows.
  // A sponsorship-fee is "unpaid" when no sponsorship-payment with the same
  // pairId exists for that member.
  const allPledges = allMembers.flatMap(member => {
    const pledgeRows = member.pledges
      .filter(p => !p.paid && (showCanceled || !p.canceled))
      .map(p => ({
        ...p,
        kind: 'pledge',
        memberId: member.id,
        memberName: `${member.firstName} ${member.lastName}`,
      }))

    const fees = (member.paymentHistory || []).filter(t => t.paymentType === 'sponsorship-fee')
    const sponsorshipPayments = (member.paymentHistory || []).filter(t => t.paymentType === 'sponsorship-payment' && !t.canceled)
    const paidPairIds = new Set(sponsorshipPayments.map(t => t.pairId).filter(Boolean))
    const settledFeeIds = new Set(sponsorshipPayments.map(t => t.settlesTxnId).filter(Boolean))
    const sponsorshipRows = fees
      .filter(f => {
        // A fee is settled if either:
        //   - its pairId appears on a sponsorship-payment (member-paid via card), OR
        //   - some sponsorship-payment has settlesTxnId pointing at this fee (admin
        //     marked paid through the new settle-fee endpoint)
        if (f.pairId && paidPairIds.has(f.pairId)) return false
        if (settledFeeIds.has(f.id)) return false
        if (f.canceled && !showCanceled) return false
        return true
      })
      .map(f => ({
        kind: 'sponsorship',
        id: f.id,
        memberId: member.id,
        memberName: `${member.firstName} ${member.lastName}`,
        description: f.description || (f.category ? `${f.category} sponsorship` : 'Sponsorship'),
        pledgeType: '',
        occasion: '',
        amount: Number(f.amount) || 0,
        paidAmount: 0,
        date: f.date || '',
        paid: false,
        canceled: f.canceled || false,
        cancellationReason: f.cancellationReason || '',
        canceledBy: f.canceledBy || '',
        canceledByName: f.canceledByName || '',
        canceledByRole: f.canceledByRole || '',
        canceledAt: f.canceledAt || '',
        paymentMethod: '',
        category: f.category || 'Sponsorship',
        createdBy: f.createdBy || '',
        createdByName: f.createdByName || '',
        createdByRole: f.createdByRole || '',
        createdAt: f.createdAt || '',
      }))

    return [...pledgeRows, ...sponsorshipRows]
  })

  const filtered = allPledges.filter(p => {
    if (memberFilter !== 'all' && String(p.memberId) !== String(memberFilter)) return false
    if (aliasFilter !== 'all') {
      if (aliasFilter === '__primary__') { if (p.alias) return false }
      else if ((p.alias || '') !== aliasFilter) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const member = allMembers.find(m => String(m.id) === String(p.memberId))
      const aliasStr = member ? (member.aliases || []).join(' ').toLowerCase() : ''
      const email = member ? (member.email || '').toLowerCase() : ''
      const rowAlias = (p.alias || '').toLowerCase()
      if (!`${p.description} ${p.memberName}`.toLowerCase().includes(q) && !email.includes(q) && !aliasStr.includes(q) && !rowAlias.includes(q)) return false
    }
    return true
  }).sort((a, b) => new Date(b.date) - new Date(a.date))

  // When admin filters to a specific member, expose their aliases as quick-filter pills.
  const memberFilterAliases = (() => {
    if (memberFilter === 'all') return []
    const m = allMembers.find(x => String(x.id) === String(memberFilter))
    return m?.aliases || []
  })()

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

  const handleMarkPaid = (row, mId) => {
    setSelectedPledge(row)
    setSelectedMemberId(mId)
    setPaymentMethod(paymentMethods[0]?.label || 'Cash')
    const remaining = row.kind === 'sponsorship'
      ? row.amount
      : row.amount - row.paidAmount
    setPayAmount(String(remaining))
    setPayDate(new Date().toISOString().split('T')[0])
    setShowPayModal(true)
  }

  const confirmMarkPaid = async () => {
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) return

    try {
      if (selectedPledge.kind === 'sponsorship') {
        // Sponsorship-fee row — settle it via the new endpoint.
        await api.settleFee({
          memberId: String(selectedMemberId),
          feeTransactionId: selectedPledge.id,
          amount,
          method: paymentMethod,
          date: payDate,
        })
        showToast('Sponsorship marked as paid')
      } else {
        // Pledge — existing path.
        await api.payPledge({
          memberId: String(selectedMemberId),
          pledgeId: selectedPledge.id,
          amount,
          method: paymentMethod,
          date: payDate,
          idempotencyKey: api.newIdempotencyKey(),
        })
        showToast(amount < (selectedPledge.amount - selectedPledge.paidAmount) ? 'Partial payment recorded' : 'Pledge marked as paid')
      }
      setShowPayModal(false)
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleOpenCancel = (row, mId) => {
    setSelectedPledge(row)
    setSelectedMemberId(mId)
    setCancelReason('')
    setShowCancelModal(true)
  }

  const handleConfirmCancel = async () => {
    if (!selectedPledge) return
    const reason = cancelReason.trim()
    if (!reason) return
    setCancelingNow(true)
    try {
      if (selectedPledge.kind === 'sponsorship') {
        // Sponsorship-fee row — it's a transaction, not a pledge.
        await api.cancelTransaction({
          memberId: String(selectedMemberId),
          transactionId: selectedPledge.id,
          cancellationReason: reason,
        })
        showToast('Sponsorship fee canceled')
      } else {
        await api.updatePledge({
          memberId: String(selectedMemberId),
          pledgeId: selectedPledge.id,
          canceled: true,
          cancellationReason: reason,
        })
        showToast('Pledge canceled')
      }
      setShowCancelModal(false)
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    } finally {
      setCancelingNow(false)
    }
  }

  const handleAddPledge = async () => {
    if (!newPledge.memberId || !newPledge.amount) return

    const pledgeTypeObj = pledgeTypes.find(pt => pt.label === newPledge.pledgeType)
    const description = pledgeTypeObj ? pledgeTypeObj.label : 'Custom Pledge'

    const trimmedNotes = (newPledge.notes || '').trim()
    try {
      await api.createPledge({
        memberId: String(newPledge.memberId),
        description,
        pledgeType: newPledge.pledgeType,
        occasion: newPledge.occasion,
        amount: parseFloat(newPledge.amount),
        date: newPledge.date,
        category: 'pledge',
        ...(newPledge.alias ? { alias: newPledge.alias } : {}),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      })
      setNewPledge({ memberId: '', pledgeType: '', occasion: '', amount: '', date: new Date().toISOString().split('T')[0], alias: '', notes: '' })
      setShowAddModal(false)
      showToast('Pledge added successfully')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  const handleOpenCharge = async (row, mId) => {
    setSelectedPledge(row)
    setSelectedMemberId(mId)
    const remaining = row.kind === 'sponsorship'
      ? row.amount
      : row.amount - row.paidAmount
    setChargeAmount(remaining > 0 ? String(remaining) : '')
    setChargeDescription(row.description || (row.kind === 'sponsorship' ? 'Sponsorship' : 'Pledge'))
    setChargeAlias(row.alias || '')
    setChargeError('')
    setChargeReceipt(null)
    setChargeAddNew(false)
    setChargeSaveOnFile(true)
    setShowChargeModal(true)
    setChargeCardsLoading(true)
    setChargeCards([])
    setChargeSelectedCardId('')
    try {
      const res = await api.fetchPaymentMethods(mId)
      const list = res.paymentMethods || []
      setChargeCards(list)
      const def = list.find(c => c.isDefault) || list[0]
      setChargeSelectedCardId(def ? def.paymentMethodId : '')
      if (list.length === 0) setChargeAddNew(true)
    } catch (e) {
      setChargeError(e.message || 'Could not load saved cards')
    } finally {
      setChargeCardsLoading(false)
    }
  }

  const closeChargeModal = () => {
    if (charging) return
    setShowChargeModal(false)
    setChargeReceipt(null)
    setChargeError('')
  }

  // Common payload builder used by both saved-card and new-card paths.
  const buildChargeBody = (amt) => {
    const isFee = selectedPledge.kind === 'sponsorship'
    return {
      memberId: String(selectedMemberId),
      amount: amt,
      paymentType: isFee ? 'sponsorship-payment' : 'pledge',
      ...(isFee ? { settlesTxnId: selectedPledge.id } : { pledgeId: selectedPledge.id }),
      description: chargeDescription || (isFee ? 'Sponsorship payment' : 'Pledge payment'),
      ...(chargeAlias ? { alias: chargeAlias } : {}),
      idempotencyKey: api.newIdempotencyKey(),
    }
  }

  const handleChargeSavedCard = async () => {
    if (!selectedPledge || !chargeSelectedCardId) return
    const amt = parseFloat(chargeAmount)
    if (!amt || amt <= 0) {
      setChargeError('Enter an amount greater than 0.')
      return
    }
    setCharging(true)
    setChargeError('')
    try {
      const res = await api.chargeSavedCard({
        ...buildChargeBody(amt),
        paymentMethodId: chargeSelectedCardId,
      })
      const card = chargeCards.find(c => c.paymentMethodId === chargeSelectedCardId)
      setChargeReceipt({
        amount: amt,
        last4: card?.last4 || res.last4 || '',
        brand: card?.cardBrand || res.cardBrand || '',
        authCode: res.authCode || '',
        refNum: res.gatewayRefNum || '',
        idempotent: !!res.idempotent,
        chargedAt: new Date().toISOString(),
      })
      showToast(`Charged $${amt.toFixed(2)} to •••• ${card?.last4 || ''}`)
      if (refreshData) refreshData()
    } catch (e) {
      setChargeError(e.message || 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  const handleChargeNewCard = async ({ xCardNum, xCVV, xExp, xName, xZip }) => {
    if (!selectedPledge) return
    const amt = parseFloat(chargeAmount)
    if (!amt || amt <= 0) {
      setChargeError('Enter an amount greater than 0.')
      return
    }
    setCharging(true)
    setChargeError('')
    try {
      const res = await api.chargeSavedCard({
        ...buildChargeBody(amt),
        xCardNum, xCVV, xExp, xName, xZip,
        saveOnSuccess: chargeSaveOnFile,
      })
      setChargeReceipt({
        amount: amt,
        last4: res.last4 || '',
        brand: res.cardBrand || '',
        authCode: res.authCode || '',
        refNum: res.gatewayRefNum || '',
        idempotent: !!res.idempotent,
        chargedAt: new Date().toISOString(),
        savedNewCard: chargeSaveOnFile,
      })
      showToast(`Charged $${amt.toFixed(2)}${chargeSaveOnFile ? ' · card saved' : ''}`)
      if (refreshData) refreshData()
    } catch (e) {
      setChargeError(e.message || 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  const handleOpenNotes = (pledge, mId) => {
    setSelectedPledge(pledge)
    setSelectedMemberId(mId)
    setNotesDraft(pledge.notes || '')
    setShowNotesModal(true)
  }

  const handleSaveNotes = async () => {
    if (!selectedPledge) return
    const trimmed = notesDraft.trim()
    const willClear = trimmed === '' && (selectedPledge.notes || '') !== ''
    setSavingNotes(true)
    try {
      await api.updatePledge({
        memberId: String(selectedMemberId),
        pledgeId: selectedPledge.id,
        notes: trimmed,
      })
      setShowNotesModal(false)
      showToast(willClear ? 'Notes cleared' : 'Notes saved')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    } finally {
      setSavingNotes(false)
    }
  }

  const handleClearNotes = async () => {
    if (!selectedPledge) return
    if (!confirm('Clear notes on this pledge?')) return
    setSavingNotes(true)
    try {
      await api.updatePledge({
        memberId: String(selectedMemberId),
        pledgeId: selectedPledge.id,
        notes: '',
      })
      setShowNotesModal(false)
      showToast('Notes cleared')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    } finally {
      setSavingNotes(false)
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

    const idemKey = api.newIdempotencyKey()
    try {
      if (newTxn.paymentType === 'purchase') {
        await api.createChargePaymentPair({
          memberId: String(newTxn.memberId),
          date: newTxn.date,
          amount,
          kind: 'purchase',
          chargeDescription: description || 'Purchase',
          paymentDescription: `${description || 'Purchase'} payment`,
          method: newTxn.method,
          productId: newTxn.productId || '',
          idempotencyKey: idemKey,
        })
      } else {
        await api.createTransaction({
          memberId: String(newTxn.memberId),
          date: newTxn.date,
          description: description || 'Transaction',
          amount,
          method: newTxn.method,
          paymentType: newTxn.paymentType,
          idempotencyKey: idemKey,
        })
      }

      if (newTxn.applyToCredit) {
        const member = allMembers.find(m => String(m.id) === String(newTxn.memberId))
        const currentBal = member ? Number(member.balance) || 0 : 0
        await api.updateMember(String(newTxn.memberId), { balance: currentBal + amount })
      }

      setShowCreateTxnModal(false)
      setNewTxn({
        memberId: '', paymentType: 'donation', amount: '', method: paymentMethods[0]?.label || 'Cash',
        description: '', date: new Date().toISOString().split('T')[0], productId: '', applyToCredit: false,
      })
      showToast(newTxn.applyToCredit ? 'Transaction created & credit applied' : 'Transaction created')
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  return (
    <div className="dashboard-page admin-pledges-page">
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
          placeholder="Search by name, email, alias, or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ minWidth: '250px' }}>
          <MemberSearchSelect
            allMembers={allMembers}
            value={memberFilter === 'all' ? '' : memberFilter}
            onChange={v => { setMemberFilter(v || 'all'); setAliasFilter('all') }}
            placeholder="Filter by member..."
          />
        </div>
        <button className="pay-btn" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowAddModal(true)}>
          + Add Pledge
        </button>
        <button className="modal-btn-secondary" style={{ padding: '10px 20px', fontSize: '0.85rem' }} onClick={() => setShowCreateTxnModal(true)}>
          + Transaction
        </button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showCanceled}
            onChange={e => setShowCanceled(e.target.checked)}
          />
          Show canceled
        </label>
      </div>

      {memberFilterAliases.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', margin: '0 0 12px' }}>
          <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-muted)' }}>Paying As:</span>
          {[
            { key: 'all', label: 'All' },
            { key: '__primary__', label: 'Primary name only' },
            ...memberFilterAliases.map(a => ({ key: a, label: a })),
          ].map(f => (
            <button
              key={f.key}
              className={`filter-tab ${aliasFilter === f.key ? 'active' : ''}`}
              onClick={() => setAliasFilter(f.key)}
              style={{ padding: '6px 14px', fontSize: '0.82rem' }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Pledges Table */}
      <div className="dashboard-section">
        <div className="pledges-table-wrap pledges-table-wrap--pledges">
          <table className="pledges-table pledges-table--pledges">
            <thead>
              <tr>
                <th data-col="member">Member</th>
                <th data-col="description">Description</th>
                <th data-col="type">Type</th>
                <th data-col="occasion">Occasion</th>
                <th data-col="category">Category</th>
                <th data-col="date">Date</th>
                <th data-col="amount">Amount</th>
                <th data-col="status">Status</th>
                <th data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="9" className="empty-row">No pledges found</td></tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr key={`${p.memberId}-${p.id}-${idx}`}>
                    <td data-col="member">
                      <strong>{p.memberName}</strong>
                      {p.alias && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          paying as {p.alias}
                        </div>
                      )}
                    </td>
                    <td data-col="description">
                      {p.description}
                      {p.notes && (
                        <div style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-light)',
                          marginTop: 4,
                          padding: '6px 10px',
                          background: 'rgba(198, 151, 63, 0.08)',
                          borderLeft: '3px solid var(--accent)',
                          borderRadius: '3px',
                          whiteSpace: 'pre-wrap',
                          fontStyle: 'italic',
                        }}>
                          <strong style={{ fontStyle: 'normal', color: 'var(--accent-dark)' }}>Note:</strong> {p.notes}
                        </div>
                      )}
                      {p.canceled && (
                        <div style={{
                          fontSize: '0.78rem',
                          color: '#7f1d1d',
                          marginTop: 4,
                          padding: '6px 10px',
                          background: '#fef2f2',
                          borderLeft: '3px solid #dc2626',
                          borderRadius: '3px',
                          whiteSpace: 'pre-wrap',
                        }}>
                          <strong style={{ color: '#991b1b' }}>Canceled · admin only</strong>
                          {p.cancellationReason && (
                            <div style={{ marginTop: 2, fontStyle: 'italic' }}>{p.cancellationReason}</div>
                          )}
                          {(p.canceledBy || p.canceledAt) && (
                            <div style={{ fontSize: '0.7rem', color: '#9b3030', marginTop: 4 }}>
                              {(() => {
                                const by = p.canceledByName || p.canceledBy || ''
                                const role = p.canceledByRole || ''
                                const when = p.canceledAt
                                  ? new Date(p.canceledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                                  : ''
                                return `Canceled${when ? ' ' + when : ''}${by ? ' · ' + by : ''}${role ? ' (' + role + ')' : ''}`
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                      {(p.createdBy || p.modifiedBy) && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          Logged {(() => {
                            const at = p.createdAt || p.modifiedAt
                            const by = p.createdByName || p.modifiedByName || p.createdBy || p.modifiedBy
                            const role = p.createdByRole || p.modifiedByRole
                            const when = at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
                            const friendlyBy = by === 'system' ? 'System (auto)' : by
                            return `${when ? when + ' · ' : ''}${friendlyBy}${role ? ` (${role})` : ''}`
                          })()}
                        </div>
                      )}
                    </td>
                    <td data-col="type" style={{ fontSize: '0.82rem' }}>{p.pledgeType || '—'}</td>
                    <td data-col="occasion" style={{ fontSize: '0.82rem' }}>{p.occasion || '—'}</td>
                    <td data-col="category">{paymentTypeBadge(p.category)}</td>
                    <td data-col="date">{formatDate(p.date)}</td>
                    <td data-col="amount" className="amount-cell">
                      ${p.amount.toLocaleString()}
                      {p.paidAmount > 0 && p.paidAmount < p.amount && (
                        <span className="remaining-badge">${(p.amount - p.paidAmount).toLocaleString()} remaining</span>
                      )}
                    </td>
                    <td data-col="status">
                      {p.canceled ? (
                        <span className="badge badge-canceled">Canceled</span>
                      ) : p.paid ? (
                        <span className="badge badge-paid">Paid</span>
                      ) : (
                        <span className="badge badge-pending">Pending</span>
                      )}
                    </td>
                    <td data-col="actions">
                      {p.kind === 'sponsorship' ? (
                        <div className="action-btns">
                          {!p.canceled && (
                            <>
                              <button className="action-btn action-btn-pay" onClick={() => handleMarkPaid(p, p.memberId)}>
                                Mark Paid
                              </button>
                              <button className="action-btn" onClick={() => handleOpenCharge(p, p.memberId)}>
                                Charge Card
                              </button>
                              <button className="action-btn action-btn-cancel" onClick={() => handleOpenCancel(p, p.memberId)}>
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="action-btns">
                          {!p.paid && !p.canceled && (
                            <>
                              <button className="action-btn action-btn-pay" onClick={() => handleMarkPaid(p, p.memberId)}>
                                Mark Paid
                              </button>
                              <button className="action-btn" onClick={() => handleOpenCharge(p, p.memberId)}>
                                Charge Card
                              </button>
                            </>
                          )}
                          <button className="action-btn" onClick={() => handleOpenNotes(p, p.memberId)}>
                            {p.notes ? 'Edit Notes' : 'Add Notes'}
                          </button>
                          {!p.paid && !p.canceled && (
                            <button className="action-btn action-btn-cancel" onClick={() => handleOpenCancel(p, p.memberId)}>
                              Cancel
                            </button>
                          )}
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
                <MemberSearchSelect
                  allMembers={allMembers}
                  value={newPledge.memberId}
                  onChange={v => setNewPledge(prev => ({ ...prev, memberId: v, alias: '' }))}
                  placeholder="Search by name, email, or alias..."
                />
              </div>
              {(() => {
                const m = allMembers.find(x => String(x.id) === String(newPledge.memberId))
                const aliases = m?.aliases || []
                if (!m || aliases.length === 0) return null
                return (
                  <div className="form-group">
                    <label>Paying As</label>
                    <select
                      value={newPledge.alias}
                      onChange={e => setNewPledge(prev => ({ ...prev, alias: e.target.value }))}
                    >
                      <option value="">{m.firstName} {m.lastName}</option>
                      {aliases.map((a, i) => (
                        <option key={i} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                )
              })()}
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
              <div className="form-group">
                <label>Notes (optional)</label>
                <textarea
                  value={newPledge.notes}
                  onChange={e => setNewPledge(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Internal note about this pledge (e.g., in memory of, follow-up needed, payment plan details)..."
                  rows={3}
                  maxLength={1000}
                  className="pledge-notes-textarea"
                />
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

      {/* Cancel-with-Reason Modal */}
      {showCancelModal && selectedPledge && (
        <div className="modal-overlay" onClick={() => !cancelingNow && setShowCancelModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCancelModal(false)} disabled={cancelingNow}>&times;</button>
            <h2 className="modal-title">
              Cancel {selectedPledge.kind === 'sponsorship' ? 'Sponsorship Fee' : 'Pledge'}
            </h2>
            <div className="modal-body">
              <p className="modal-desc">
                The member will no longer see this item and their account balance will reflect the cancellation immediately.
                A reason is required and is visible only to admins.
              </p>
              <div className="modal-total">
                <span>{selectedPledge.description}</span>
                <span>${selectedPledge.amount.toLocaleString()}</span>
              </div>
              <div className="form-group">
                <label>Reason for cancellation (required)</label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="e.g., duplicate entry, member requested withdrawal, error in amount, etc."
                  rows={4}
                  maxLength={1000}
                  className="pledge-notes-textarea"
                  autoFocus
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                  {cancelReason.length} / 1000
                </div>
              </div>
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowCancelModal(false)} disabled={cancelingNow}>Keep</button>
                <button
                  className="modal-btn-danger"
                  onClick={handleConfirmCancel}
                  disabled={cancelingNow || !cancelReason.trim()}
                >
                  {cancelingNow ? 'Canceling...' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && selectedPledge && (
        <div className="modal-overlay" onClick={() => setShowNotesModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowNotesModal(false)}>&times;</button>
            <h2 className="modal-title">{selectedPledge.notes ? 'Edit Notes' : 'Add Notes'}</h2>
            <div className="modal-body">
              <div className="modal-total">
                <span>{selectedPledge.description}</span>
                <span>${selectedPledge.amount.toLocaleString()}</span>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                  placeholder="Internal note about this pledge..."
                  rows={5}
                  maxLength={1000}
                  className="pledge-notes-textarea"
                  autoFocus
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                  {notesDraft.length} / 1000
                </div>
              </div>
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowNotesModal(false)} disabled={savingNotes}>Cancel</button>
                {selectedPledge.notes && (
                  <button
                    className="modal-btn-danger"
                    onClick={handleClearNotes}
                    disabled={savingNotes}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="pay-btn"
                  style={{ padding: '10px 24px' }}
                  onClick={handleSaveNotes}
                  disabled={savingNotes || notesDraft.trim() === (selectedPledge.notes || '').trim()}
                >
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charge Card Modal — saved-card or one-off card, used by both unpaid
          pledge rows and unpaid sponsorship-fee rows. */}
      {showChargeModal && selectedPledge && (
        <div className="modal-overlay" onClick={closeChargeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <button className="modal-close" onClick={closeChargeModal} disabled={charging}>&times;</button>
            <h2 className="modal-title">
              Charge Card — {selectedPledge.memberName}
            </h2>
            <div className="modal-body">
              <div className="modal-total">
                <span>{selectedPledge.description}</span>
                <span>
                  ${(selectedPledge.kind === 'sponsorship'
                    ? selectedPledge.amount
                    : selectedPledge.amount - selectedPledge.paidAmount
                  ).toLocaleString()} {selectedPledge.kind === 'sponsorship' ? 'due' : 'remaining'}
                </span>
              </div>

              {chargeError && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                  padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: '0.85rem',
                }}>
                  {chargeError}
                </div>
              )}

              {chargeReceipt ? (
                <div style={{
                  background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#065f46',
                  padding: '14px 16px', borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: '0.88rem',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Charged ${chargeReceipt.amount.toFixed(2)}
                    {chargeReceipt.idempotent ? ' (idempotent retry)' : ''}
                  </div>
                  {chargeReceipt.brand && chargeReceipt.last4 && (
                    <div>{chargeReceipt.brand} •••• {chargeReceipt.last4}</div>
                  )}
                  {chargeReceipt.authCode && (
                    <div>Auth: <span style={{ fontFamily: 'monospace' }}>{chargeReceipt.authCode}</span></div>
                  )}
                  {chargeReceipt.refNum && (
                    <div>Gateway ref: <span style={{ fontFamily: 'monospace' }}>{chargeReceipt.refNum}</span></div>
                  )}
                  {chargeReceipt.savedNewCard && (
                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>Card saved on file for future charges.</div>
                  )}
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #bbf7d0', fontSize: '0.78rem' }}>
                    Logged {new Date(chargeReceipt.chargedAt).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                    })} under your admin account.
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button className="modal-btn-secondary" onClick={closeChargeModal}>Close</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Amount ($)</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={chargeAmount}
                        onChange={e => setChargeAmount(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Description</label>
                      <input
                        type="text"
                        value={chargeDescription}
                        onChange={e => setChargeDescription(e.target.value)}
                      />
                    </div>
                  </div>

                  {(() => {
                    const member = allMembers.find(m => String(m.id) === String(selectedMemberId))
                    const aliases = member?.aliases || []
                    if (aliases.length === 0) return null
                    return (
                      <div className="form-group">
                        <label>Paying As</label>
                        <select value={chargeAlias} onChange={e => setChargeAlias(e.target.value)}>
                          <option value="">{member.firstName} {member.lastName} (Primary)</option>
                          {aliases.map((a, i) => (
                            <option key={i} value={a}>{a}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })()}

                  <div style={{
                    background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e',
                    padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 16, fontSize: '0.78rem',
                  }}>
                    You're charging this card on behalf of <strong>{selectedPledge.memberName}</strong>.
                    The transaction will be logged with your admin account and a timestamp.
                  </div>

                  <h3 style={{ fontSize: '0.95rem', margin: '0 0 8px' }}>Choose a card</h3>

                  {chargeCardsLoading ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading saved cards...</p>
                  ) : chargeCards.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      No saved cards for this member. Enter a new card below.
                    </p>
                  ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, marginBottom: 12 }}>
                      {chargeCards.map(c => (
                        <li
                          key={c.paymentMethodId}
                          onClick={() => { setChargeSelectedCardId(c.paymentMethodId); setChargeAddNew(false) }}
                          style={{
                            border: `2px solid ${chargeSelectedCardId === c.paymentMethodId && !chargeAddNew ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 'var(--radius-sm)',
                            padding: '10px 12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            background: chargeSelectedCardId === c.paymentMethodId && !chargeAddNew ? 'rgba(198, 151, 63, 0.06)' : 'var(--bg-card)',
                          }}
                        >
                          <input
                            type="radio"
                            checked={chargeSelectedCardId === c.paymentMethodId && !chargeAddNew}
                            onChange={() => { setChargeSelectedCardId(c.paymentMethodId); setChargeAddNew(false) }}
                            style={{ width: 'auto' }}
                          />
                          <div style={{ flex: 1, fontSize: '0.88rem' }}>
                            <div style={{ fontWeight: 600 }}>
                              {c.cardBrand || 'Card'} •••• {c.last4}
                              {c.isDefault && (
                                <span style={{
                                  marginLeft: 8, padding: '1px 7px', borderRadius: 999,
                                  background: 'rgba(26, 54, 93, 0.1)', color: 'var(--primary)',
                                  fontSize: 10, fontWeight: 600,
                                }}>Default</span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                              Exp {c.expMonth}/{c.expYear}
                              {c.cardholderName ? ` · ${c.cardholderName}` : ''}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {chargeCards.length > 0 && !chargeAddNew && (
                    <button
                      className="modal-btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '0.82rem', marginBottom: 12 }}
                      onClick={() => setChargeAddNew(true)}
                    >
                      + Add a new card instead
                    </button>
                  )}

                  {chargeAddNew && (
                    <div style={{
                      border: '2px solid var(--accent)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 12,
                      background: 'rgba(198, 151, 63, 0.04)',
                      marginBottom: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong style={{ fontSize: '0.9rem' }}>New card</strong>
                        {chargeCards.length > 0 && (
                          <button
                            className="modal-btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                            onClick={() => setChargeAddNew(false)}
                            disabled={charging}
                          >
                            Use saved card instead
                          </button>
                        )}
                      </div>
                      <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                        Card details are tokenised inside the Cardknox iframe — they never touch this server.
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer', marginBottom: 10 }}>
                        <input
                          type="checkbox"
                          checked={chargeSaveOnFile}
                          onChange={e => setChargeSaveOnFile(e.target.checked)}
                          disabled={charging}
                        />
                        Save this card on file for future charges
                      </label>
                      <IFieldsCardForm
                        iFieldsKey={IFIELDS_KEY}
                        softwareName="STCD-App"
                        softwareVersion="1.0.0"
                        onTokens={handleChargeNewCard}
                        onError={setChargeError}
                        submitting={charging}
                        submitLabel={charging
                          ? 'Processing charge...'
                          : `Charge $${(parseFloat(chargeAmount) || 0).toFixed(2)}`}
                      />
                    </div>
                  )}

                  {!chargeAddNew && (
                    <div className="modal-actions">
                      <button className="modal-btn-secondary" onClick={closeChargeModal} disabled={charging}>
                        Cancel
                      </button>
                      <button
                        className="pay-btn"
                        style={{ padding: '10px 24px' }}
                        onClick={handleChargeSavedCard}
                        disabled={charging || !chargeSelectedCardId || !(parseFloat(chargeAmount) > 0)}
                      >
                        {charging
                          ? 'Processing...'
                          : `Charge $${(parseFloat(chargeAmount) || 0).toFixed(2)} to •••• ${chargeCards.find(c => c.paymentMethodId === chargeSelectedCardId)?.last4 || ''}`}
                      </button>
                    </div>
                  )}
                </>
              )}
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
                <MemberSearchSelect
                  allMembers={allMembers}
                  value={newTxn.memberId}
                  onChange={v => setNewTxn(prev => ({ ...prev, memberId: v }))}
                  placeholder="Search by name, email, or alias..."
                />
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
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newTxn.applyToCredit} onChange={e => setNewTxn(prev => ({ ...prev, applyToCredit: e.target.checked }))} />
                  Apply amount to member's available credit
                </label>
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
