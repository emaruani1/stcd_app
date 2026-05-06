import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../api'
import PaymentChooser from '../components/PaymentChooser'

const FALLBACK_PLANS = [
  { id: 'single', label: 'Single', price: 100, description: '1 person' },
  { id: 'couple', label: 'Couple', price: 150, description: '2 people' },
  { id: 'family', label: 'Family', price: 180, description: 'Family' },
]

export default function MakePayment({ currentMember, pledgePayments, setPledgePayments, extraPayments, setExtraPayments, currentBalance, setMemberBalances, currentMemberId, refreshData, membershipPlans }) {
  const plansToShow = (membershipPlans && membershipPlans.length > 0) ? membershipPlans : FALLBACK_PLANS
  const [searchParams] = useSearchParams()
  const showJoin = searchParams.get('join') === 'true'

  const [selectedPledges, setSelectedPledges] = useState([])
  const [paymentAmounts, setPaymentAmounts] = useState({})
  const [donationAmount, setDonationAmount] = useState('')
  const [donationNote, setDonationNote] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)
  const [payingType, setPayingType] = useState(null)
  const [paySuccess, setPaySuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState('Payment processed successfully!')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  const chooserRef = useRef(null)

  const [extraDonation, setExtraDonation] = useState(0)
  const [extraDonationChoice, setExtraDonationChoice] = useState(null)
  const [extraDonationCustom, setExtraDonationCustom] = useState('')

  // Alias state
  const [selectedAlias, setSelectedAlias] = useState('')
  const memberAliases = currentMember.aliases || []

  // Deposit state
  const [depositAmount, setDepositAmount] = useState('')
  const [depositPreset, setDepositPreset] = useState(null)

  // Payment method state
  const [paymentSource, setPaymentSource] = useState('card')

  const memberPledges = currentMember.pledges

  const getRemainingBalance = (p) => {
    const sessionPaid = pledgePayments[p.id] || 0
    return p.amount - p.paidAmount - sessionPaid
  }

  const allPledges = memberPledges.map(p => {
    const remaining = getRemainingBalance(p)
    return {
      ...p,
      remaining,
      fullyPaid: remaining <= 0,
    }
  })

  const today = new Date(new Date().setHours(0, 0, 0, 0))
  const unpaidPledges = allPledges
    .filter(p => !p.fullyPaid && !p.canceled)
    .map(p => ({
      ...p,
      isOverdue: new Date(p.date + 'T00:00:00') < today,
    }))
    .sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1
      if (!a.isOverdue && b.isOverdue) return 1
      return new Date(a.date) - new Date(b.date)
    })

  const getPaymentAmount = (pledgeId) => {
    if (paymentAmounts[pledgeId] !== undefined) return paymentAmounts[pledgeId]
    const p = unpaidPledges.find(x => x.id === pledgeId)
    return p ? p.remaining : 0
  }

  const selectedTotal = unpaidPledges
    .filter(p => selectedPledges.includes(p.id))
    .reduce((sum, p) => sum + getPaymentAmount(p.id), 0)

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const togglePledge = (id) => {
    setSelectedPledges(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id)
        setPaymentAmounts(pa => {
          const copy = { ...pa }
          delete copy[id]
          return copy
        })
        return next
      }
      return [...prev, id]
    })
  }

  const selectAll = () => {
    if (selectedPledges.length === unpaidPledges.length) {
      setSelectedPledges([])
      setPaymentAmounts({})
    } else {
      setSelectedPledges(unpaidPledges.map(p => p.id))
    }
  }

  const handlePaymentAmountChange = (pledgeId, value) => {
    const p = unpaidPledges.find(x => x.id === pledgeId)
    if (!p) return
    let num = parseFloat(value)
    if (isNaN(num) || num < 0) num = 0
    if (num > p.remaining) num = p.remaining
    setPaymentAmounts(prev => ({ ...prev, [pledgeId]: num }))
  }

  const handlePayPledges = () => {
    setPayingType('pledges')
    setExtraDonation(0)
    setExtraDonationChoice(null)
    setExtraDonationCustom('')
    setPaymentSource(currentBalance >= selectedTotal && currentBalance > 0 ? 'balance' : 'card')
    setShowPayModal(true)
  }

  const handleDonate = () => {
    if (!donationAmount || parseFloat(donationAmount) <= 0) return
    setPayingType('donation')
    const amt = parseFloat(donationAmount)
    setPaymentSource(currentBalance >= amt && currentBalance > 0 ? 'balance' : 'card')
    setShowPayModal(true)
  }

  const handleDeposit = () => {
    const amt = parseFloat(depositAmount)
    if (!amt || amt <= 0) return
    setPayingType('deposit')
    setShowPayModal(true)
  }

  const handleDepositPreset = (amt) => {
    if (depositPreset === amt) {
      setDepositPreset(null)
      setDepositAmount('')
    } else {
      setDepositPreset(amt)
      setDepositAmount(String(amt))
    }
  }

  const handleExtraDonationChoice = (choice) => {
    if (extraDonationChoice === choice) {
      setExtraDonationChoice(null)
      setExtraDonation(0)
      setExtraDonationCustom('')
      return
    }
    setExtraDonationChoice(choice)
    if (choice === 18 || choice === 52) {
      setExtraDonation(choice)
      setExtraDonationCustom('')
    } else if (choice === 'other') {
      setExtraDonation(0)
    }
  }

  const handleExtraDonationCustomChange = (value) => {
    setExtraDonationCustom(value)
    const num = parseFloat(value)
    setExtraDonation(isNaN(num) || num < 0 ? 0 : num)
  }

  const modalTotal = payingType === 'pledges'
    ? selectedTotal + extraDonation
    : payingType === 'deposit'
    ? parseFloat(depositAmount) || 0
    : parseFloat(donationAmount) || 0

  // Determine effective payment source for display
  const effectiveSource = (() => {
    if (paymentSource === 'balance' && currentBalance >= modalTotal) return 'balance'
    if (paymentSource === 'balance' && currentBalance > 0 && currentBalance < modalTotal) return 'split'
    return 'card'
  })()

  const balancePortionUsed = effectiveSource === 'balance' ? modalTotal : effectiveSource === 'split' ? currentBalance : 0
  const cardPortion = modalTotal - balancePortionUsed

  const getPaymentMethodLabel = () => {
    if (effectiveSource === 'balance') return 'Account Credit'
    if (effectiveSource === 'split') return 'Balance + Card'
    return 'Credit Card'
  }

  const confirmPayment = async () => {
    const now = new Date().toISOString().split('T')[0]
    const methodLabel = getPaymentMethodLabel()
    setPaying(true)
    setPayError('')

    // 1) Run the card charge first if any portion is on a card.
    //    `gw` carries gatewayRefNum / authCode / last4 / brand to attach to each ledger entry.
    let gw = {}
    if (cardPortion > 0) {
      try {
        const summary =
          payingType === 'deposit' ? 'Account deposit'
          : payingType === 'pledges' ? `STCD payment (${selectedPledges.length} pledge${selectedPledges.length !== 1 ? 's' : ''}${extraDonation > 0 ? ' + donation' : ''})`
          : 'STCD donation'
        const res = await chooserRef.current.charge({
          amount: cardPortion,
          paymentType: payingType === 'deposit' ? 'membership' : payingType === 'pledges' ? 'pledge' : 'donation',
          description: summary,
          skipRecord: true, // we'll record per-line below with gateway metadata
        })
        gw = {
          gatewayRefNum: res.gatewayRefNum,
          gatewayAuthCode: res.authCode,
          gatewayResult: 'A',
          gatewayStatus: 'Approved',
          cardLast4: res.last4,
          cardBrand: res.cardBrand,
          paymentMethodId: res.paymentMethodId || '',
        }
      } catch (e) {
        setPayError(e.message || 'Charge failed')
        setPaying(false)
        return
      }
    }

    if (payingType === 'deposit') {
      const amt = parseFloat(depositAmount)
      try {
        await api.createTransaction({
          memberId: String(currentMemberId),
          date: now,
          description: 'Account Deposit',
          amount: amt,
          method: 'Credit Card',
          paymentType: 'deposit',
          ...(selectedAlias ? { alias: selectedAlias } : {}),
          ...gw,
        })
      } catch (e) { console.error(e) }
      // Optimistically reflect locally; refreshData() will pull the persisted value next
      setMemberBalances(prev => ({ ...prev, [currentMemberId]: (prev[currentMemberId] || 0) + amt }))
      setDepositAmount('')
      setDepositPreset(null)
      setShowPayModal(false)
      setSuccessMessage(`$${amt.toLocaleString()} added to your account balance!`)
      setPaySuccess(true)
      setTimeout(() => setPaySuccess(false), 3000)
      setPaying(false)
      if (refreshData) await refreshData()
      return
    }

    // Optimistic local deduction; backend is authoritative via balanceApplied
    if (payingType !== 'deposit' && balancePortionUsed > 0) {
      setMemberBalances(prev => ({
        ...prev,
        [currentMemberId]: Math.max(0, (prev[currentMemberId] || 0) - balancePortionUsed)
      }))
    }

    const groupId = `grp-${Date.now()}`

    // Distribute balancePortionUsed proportionally across line items so the
    // backend can debit the member's stored credit by the correct amount per row.
    const balancePortionFor = (lineAmount) => {
      if (balancePortionUsed <= 0 || modalTotal <= 0) return 0
      return Math.round((lineAmount / modalTotal) * balancePortionUsed * 100) / 100
    }

    if (payingType === 'pledges') {
      const updates = {}
      for (const p of unpaidPledges.filter(p => selectedPledges.includes(p.id))) {
        const payAmt = getPaymentAmount(p.id)
        updates[p.id] = (pledgePayments[p.id] || 0) + payAmt
        try {
          await api.payPledge({
            memberId: String(currentMemberId),
            pledgeId: p.id,
            amount: payAmt,
            method: methodLabel,
            date: now,
            balanceApplied: balancePortionFor(payAmt),
            ...(selectedAlias ? { alias: selectedAlias } : {}),
            ...gw,
            groupId,
          })
        } catch (e) { console.error(e) }
      }
      setPledgePayments(prev => ({ ...prev, ...updates }))

      if (extraDonation > 0) {
        try {
          await api.createTransaction({
            memberId: String(currentMemberId),
            date: now,
            description: 'Donation - General Fund',
            amount: extraDonation,
            method: methodLabel,
            paymentType: 'donation',
            groupId,
            balanceApplied: balancePortionFor(extraDonation),
            ...(selectedAlias ? { alias: selectedAlias } : {}),
            ...gw,
          })
        } catch (e) { console.error(e) }
      }

      setSelectedPledges([])
      setPaymentAmounts({})
    } else {
      // Standalone donation
      try {
        await api.createTransaction({
          memberId: String(currentMemberId),
          date: now,
          description: donationNote ? `Donation - ${donationNote}` : 'Donation - General Fund',
          amount: parseFloat(donationAmount),
          method: methodLabel,
          paymentType: 'donation',
          balanceApplied: balancePortionFor(parseFloat(donationAmount)),
          ...(selectedAlias ? { alias: selectedAlias } : {}),
          ...gw,
        })
      } catch (e) { console.error(e) }
      setDonationAmount('')
      setDonationNote('')
    }
    setShowPayModal(false)
    setExtraDonation(0)
    setExtraDonationChoice(null)
    setExtraDonationCustom('')
    setSuccessMessage('Payment processed successfully!')
    setPaySuccess(true)
    setPaying(false)
    if (refreshData) await refreshData()
    setTimeout(() => setPaySuccess(false), 3000)
  }

  const renderPaymentMethodSelector = () => {
    if (currentBalance <= 0 || payingType === 'deposit') return null

    return (
      <div className="payment-method-selector">
        <div className="payment-method-selector-title">Payment Method</div>
        <div className="payment-method-options">
          <div
            className={`payment-method-option ${paymentSource === 'balance' ? 'selected' : ''}`}
            onClick={() => setPaymentSource('balance')}
          >
            <div className="payment-method-radio">
              <div className="payment-method-radio-dot"></div>
            </div>
            <div className="payment-method-info">
              <div className="payment-method-label">Account Credit</div>
              <div className="payment-method-desc">Available: ${currentBalance.toLocaleString()}</div>
            </div>
            <span className="payment-method-badge">${currentBalance.toLocaleString()}</span>
          </div>
          <div
            className={`payment-method-option ${paymentSource === 'card' ? 'selected' : ''}`}
            onClick={() => setPaymentSource('card')}
          >
            <div className="payment-method-radio">
              <div className="payment-method-radio-dot"></div>
            </div>
            <div className="payment-method-info">
              <div className="payment-method-label">Credit Card</div>
              <div className="payment-method-desc">Pay with your credit or debit card</div>
            </div>
          </div>
        </div>

        {paymentSource === 'balance' && currentBalance > 0 && currentBalance < modalTotal && (
          <div className="split-payment-notice">
            <span className="split-payment-notice-icon">&#9432;</span>
            <span>
              Your balance covers ${currentBalance.toLocaleString()}. The remaining ${(modalTotal - currentBalance).toLocaleString()} will be charged to your card.
            </span>
          </div>
        )}
      </div>
    )
  }

  const showCardForm = payingType === 'deposit' || paymentSource === 'card' || (paymentSource === 'balance' && currentBalance < modalTotal)

  return (
    <div className="payment-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Make a Payment</h1>
          <p className="page-subtitle">Pay your pledges, make a donation, or add funds to your account</p>
        </div>
      </div>

      {paySuccess && (
        <div className="success-toast">{successMessage}</div>
      )}

      {/* Membership Join Section */}
      {(showJoin || (!currentMember.membershipType && !currentMember.membershipPlan)) && (
        <MembershipJoinSection
          currentMemberId={currentMemberId}
          refreshData={refreshData}
          setPaySuccess={setPaySuccess}
          setSuccessMessage={setSuccessMessage}
          plans={plansToShow}
        />
      )}

      <div className="dashboard-section">
        <div className="section-title-row">
          <h2 className="section-title">Outstanding Pledges</h2>
          {unpaidPledges.length > 0 && (
            <button className="select-all-btn" onClick={selectAll}>
              {selectedPledges.length === unpaidPledges.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        <div className="pledges-table-wrap">
          <table className="pledges-table selectable">
            <thead>
              <tr>
                <th className="check-col"></th>
                <th>Description</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {unpaidPledges.length === 0 ? (
                <tr><td colSpan="5" className="empty-row">All pledges are paid! You're all caught up.</td></tr>
              ) : (
                unpaidPledges.map(p => (
                  <tr
                    key={p.id}
                    className={`${selectedPledges.includes(p.id) ? 'selected-row' : ''} ${p.isOverdue ? 'overdue-row' : ''}`}
                    onClick={() => togglePledge(p.id)}
                  >
                    <td className="check-col">
                      <div className={`custom-checkbox ${selectedPledges.includes(p.id) ? 'checked' : ''}`}>
                        {selectedPledges.includes(p.id) && <span>&#10003;</span>}
                      </div>
                    </td>
                    <td>{p.description}</td>
                    <td>{formatDate(p.date)}</td>
                    <td className="amount-cell">
                      ${p.amount.toLocaleString()}
                      {p.remaining < p.amount && (
                        <span className="remaining-badge">${p.remaining.toLocaleString()} remaining</span>
                      )}
                    </td>
                    <td>
                      {p.isOverdue
                        ? <span className="badge badge-overdue">Overdue</span>
                        : <span className="badge badge-pending">Pending</span>
                      }
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {selectedPledges.length > 0 && (
          <div className="pay-footer">
            <div className="pay-footer-details">
              {unpaidPledges.filter(p => selectedPledges.includes(p.id)).map(p => (
                <div key={p.id} className="pay-footer-line">
                  <span className="pay-footer-line-desc">{p.description}</span>
                  <div className="partial-amount-input" onClick={e => e.stopPropagation()}>
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      min="1"
                      max={p.remaining}
                      step="1"
                      value={paymentAmounts[p.id] !== undefined ? paymentAmounts[p.id] : p.remaining}
                      onChange={(e) => handlePaymentAmountChange(p.id, e.target.value)}
                      onBlur={(e) => {
                        let v = parseFloat(e.target.value)
                        if (isNaN(v) || v < 1) v = 1
                        if (v > p.remaining) v = p.remaining
                        handlePaymentAmountChange(p.id, v)
                      }}
                    />
                    <span className="partial-amount-max">of ${p.remaining.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pay-footer-bottom">
              <div className="pay-footer-info">
                <span>{selectedPledges.length} pledge{selectedPledges.length > 1 ? 's' : ''} selected</span>
                <span className="pay-footer-total">Total: ${selectedTotal.toLocaleString()}</span>
              </div>
              <button className="pay-btn" onClick={handlePayPledges}>
                Pay ${selectedTotal.toLocaleString()}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Funds Section */}
      <div className="dashboard-section balance-deposit-section">
        <h2 className="section-title">Add Funds to Your Account</h2>
        <div className="balance-display">
          <div className="balance-display-icon">&#128179;</div>
          <div className="balance-display-info">
            <span className="balance-display-label">Current Balance</span>
            <span className={`balance-display-amount ${currentBalance === 0 ? 'zero' : ''}`}>
              ${currentBalance.toLocaleString()}
            </span>
          </div>
        </div>
        <p className="deposit-desc">
          Deposit funds into your account to use for future payments. Pay pledges, donations, or sponsorships directly from your balance.
        </p>
        <div className="deposit-form">
          <div className="deposit-presets">
            {[100, 250, 500, 1000].map(amt => (
              <button
                key={amt}
                className={`preset-btn ${depositPreset === amt ? 'active' : ''}`}
                onClick={() => handleDepositPreset(amt)}
              >
                ${amt}
              </button>
            ))}
          </div>
          <div className="deposit-custom">
            <div className="form-group">
              <label>Custom Amount</label>
              <div className="input-with-prefix">
                <span className="input-prefix">$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={depositAmount}
                  onChange={(e) => {
                    setDepositAmount(e.target.value)
                    setDepositPreset(null)
                  }}
                  placeholder="Enter amount"
                />
              </div>
            </div>
          </div>
          <button
            className="pay-btn deposit-btn"
            onClick={handleDeposit}
            disabled={!depositAmount || parseFloat(depositAmount) <= 0}
          >
            Add Funds {depositAmount ? `$${parseFloat(depositAmount).toLocaleString()}` : ''}
          </button>
        </div>
      </div>

      <div className="dashboard-section donation-section">
        <h2 className="section-title">Make a Donation</h2>
        <p className="donation-desc">
          Want to contribute beyond your pledges? Make a tax-deductible donation to support the community.
        </p>
        <div className="donation-form">
          <div className="donation-presets">
            {[36, 72, 100, 180, 250, 500].map(amt => (
              <button
                key={amt}
                className={`preset-btn ${donationAmount === String(amt) ? 'active' : ''}`}
                onClick={() => setDonationAmount(String(amt))}
              >
                ${amt}
              </button>
            ))}
          </div>
          <div className="donation-custom">
            <div className="form-group">
              <label>Custom Amount</label>
              <div className="input-with-prefix">
                <span className="input-prefix">$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={donationAmount}
                  onChange={(e) => setDonationAmount(e.target.value)}
                  placeholder="Enter amount"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Note (optional)</label>
              <input
                type="text"
                value={donationNote}
                onChange={(e) => setDonationNote(e.target.value)}
                placeholder="e.g. In honor of..."
              />
            </div>
          </div>
          <button
            className="pay-btn donate-btn"
            onClick={handleDonate}
            disabled={!donationAmount || parseFloat(donationAmount) <= 0}
          >
            Donate {donationAmount ? `$${parseFloat(donationAmount).toLocaleString()}` : ''}
          </button>
        </div>
      </div>

      {showPayModal && (
        <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button>
            <h2 className="modal-title">
              {payingType === 'deposit' ? 'Add Funds' : 'Confirm Payment'}
            </h2>
            <div className="modal-body">
              {payingType === 'pledges' ? (
                <>
                  <p className="modal-desc">You are about to pay the following pledges:</p>
                  <div className="modal-items">
                    {unpaidPledges.filter(p => selectedPledges.includes(p.id)).map(p => {
                      const payAmt = getPaymentAmount(p.id)
                      const isPartial = payAmt < p.remaining
                      return (
                        <div key={p.id} className="modal-line-item">
                          <div className="modal-line-item-desc">
                            <span>{p.description}</span>
                            {isPartial && <span className="modal-partial-note">Partial payment</span>}
                          </div>
                          <span>${payAmt.toLocaleString()}</span>
                        </div>
                      )
                    })}
                    {extraDonation > 0 && (
                      <div className="modal-line-item modal-line-item-donation">
                        <span>Donation - General Fund</span>
                        <span>${extraDonation.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                  <div className="modal-total">
                    <span>Total</span>
                    <span>${modalTotal.toLocaleString()}</span>
                  </div>

                  <div className="extra-donation-section">
                    <h3 className="extra-donation-title">Would you like to add to your donation?</h3>
                    <div className="extra-donation-presets">
                      <button
                        className={`preset-btn ${extraDonationChoice === 18 ? 'active' : ''}`}
                        onClick={() => handleExtraDonationChoice(18)}
                      >
                        $18
                      </button>
                      <button
                        className={`preset-btn ${extraDonationChoice === 52 ? 'active' : ''}`}
                        onClick={() => handleExtraDonationChoice(52)}
                      >
                        $52
                      </button>
                      <button
                        className={`preset-btn ${extraDonationChoice === 'other' ? 'active' : ''}`}
                        onClick={() => handleExtraDonationChoice('other')}
                      >
                        Other
                      </button>
                    </div>
                    {extraDonationChoice === 'other' && (
                      <div className="extra-donation-custom">
                        <div className="input-with-prefix">
                          <span className="input-prefix">$</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={extraDonationCustom}
                            onChange={(e) => handleExtraDonationCustomChange(e.target.value)}
                            placeholder="Enter amount"
                          />
                        </div>
                      </div>
                    )}
                    {extraDonationChoice && (
                      <button
                        className="extra-donation-skip"
                        onClick={() => handleExtraDonationChoice(extraDonationChoice)}
                      >
                        No thanks, skip donation
                      </button>
                    )}
                  </div>
                </>
              ) : payingType === 'deposit' ? (
                <>
                  <p className="modal-desc">You are adding funds to your account:</p>
                  <div className="modal-total">
                    <span>Account Deposit</span>
                    <span>${(parseFloat(depositAmount) || 0).toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="modal-desc">You are about to make a donation:</p>
                  <div className="modal-total">
                    <span>{donationNote || 'General Fund Donation'}</span>
                    <span>${parseFloat(donationAmount).toLocaleString()}</span>
                  </div>
                </>
              )}

              {memberAliases.length > 0 && (
                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem', display: 'block' }}>Paying As</label>
                  <select
                    value={selectedAlias}
                    onChange={e => setSelectedAlias(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                  >
                    <option value="">{currentMember.firstName} {currentMember.lastName} (Primary)</option>
                    {memberAliases.map((alias, i) => (
                      <option key={i} value={alias}>{alias}</option>
                    ))}
                  </select>
                </div>
              )}

              {renderPaymentMethodSelector()}

              {showCardForm && cardPortion > 0 && (
                <div className="modal-payment-form" style={{ padding: 16, background: '#fafafa', borderRadius: 12 }}>
                  <PaymentChooser
                    ref={chooserRef}
                    memberId={String(currentMemberId)}
                    amount={cardPortion}
                  />
                </div>
              )}

              {payError && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                  padding: 10, borderRadius: 8, marginTop: 12, fontSize: 13,
                }}>
                  {payError}
                </div>
              )}

              <button
                className="pay-btn modal-pay-btn"
                onClick={confirmPayment}
                disabled={paying}
              >
                {paying
                  ? 'Processing…'
                  : payingType === 'deposit'
                  ? `Add $${(parseFloat(depositAmount) || 0).toLocaleString()} to Balance`
                  : `Confirm & Pay $${modalTotal.toLocaleString()}`
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MembershipJoinSection({ currentMemberId, refreshData, setPaySuccess, setSuccessMessage, plans }) {
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [processing, setProcessing] = useState(false)

  const handleJoin = async () => {
    if (!selectedPlan) return
    setProcessing(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      // Membership join writes a fee + payment pair so the Account Balance
      // shows -$X / +$X (net 0) at the moment of approval.
      await api.createChargePaymentPair({
        memberId: String(currentMemberId),
        date: today,
        amount: selectedPlan.price,
        kind: 'membership',
        chargeDescription: `Membership — ${selectedPlan.label}`,
        paymentDescription: `Membership payment — ${selectedPlan.label}`,
        method: 'Credit Card',
        category: 'Membership',
      })
      // Persist membership selection on the member so the monthly cron picks them up.
      await api.updateMember(String(currentMemberId), {
        membershipType: 'full',
        membershipPlan: selectedPlan.id,
        memberSince: today,
      })
      setSuccessMessage(`Welcome! Your ${selectedPlan.label} membership ($${selectedPlan.price}/mo) has been submitted.`)
      setPaySuccess(true)
      setTimeout(() => setPaySuccess(false), 5000)
      if (refreshData) refreshData()
    } catch (err) {
      console.error(err)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="dashboard-section" style={{ background: 'linear-gradient(135deg, rgba(198,151,63,0.08), rgba(198,151,63,0.02))', border: '2px solid var(--accent)', borderRadius: 'var(--radius-lg)' }}>
      <h2 className="section-title" style={{ color: 'var(--accent-dark)' }}>Become a Member</h2>
      <p style={{ color: 'var(--text-light)', marginBottom: '1rem' }}>
        Support the Sephardic Torah Center of Dallas with a monthly membership. Choose a plan that fits your household:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {plans.map(plan => (
          <div
            key={plan.id}
            onClick={() => setSelectedPlan(plan)}
            style={{
              padding: '1.25rem',
              borderRadius: 'var(--radius-md)',
              border: selectedPlan?.id === plan.id ? '2px solid var(--accent)' : '2px solid var(--border)',
              background: selectedPlan?.id === plan.id ? 'rgba(198,151,63,0.08)' : 'var(--bg-card)',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{plan.label}</h3>
            <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-dark)' }}>
              ${plan.price}<span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span>
            </p>
          </div>
        ))}
      </div>
      <button
        className="pay-btn"
        style={{ padding: '12px 32px', fontSize: '0.95rem' }}
        onClick={handleJoin}
        disabled={!selectedPlan || processing}
      >
        {processing ? 'Processing...' : selectedPlan ? `Join as ${selectedPlan.label} - $${selectedPlan.price}/mo` : 'Select a Plan'}
      </button>
    </div>
  )
}
