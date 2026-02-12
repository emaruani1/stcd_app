import { useState } from 'react'
import { pledges } from '../data/fakeData'

export default function MakePayment({ paidPledges, setPaidPledges, extraPayments, setExtraPayments }) {
  const [selectedPledges, setSelectedPledges] = useState([])
  const [donationAmount, setDonationAmount] = useState('')
  const [donationNote, setDonationNote] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)
  const [payingType, setPayingType] = useState(null) // 'pledges' or 'donation'
  const [paySuccess, setPaySuccess] = useState(false)

  const allPledges = pledges.map(p => ({
    ...p,
    paid: p.paid || paidPledges.includes(p.id),
  }))

  const today = new Date(new Date().setHours(0, 0, 0, 0))
  const unpaidPledges = allPledges
    .filter(p => !p.paid)
    .map(p => ({
      ...p,
      isOverdue: new Date(p.date + 'T00:00:00') < today,
    }))
    .sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1
      if (!a.isOverdue && b.isOverdue) return 1
      return new Date(a.date) - new Date(b.date)
    })
  const selectedTotal = unpaidPledges
    .filter(p => selectedPledges.includes(p.id))
    .reduce((sum, p) => sum + p.amount, 0)

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const togglePledge = (id) => {
    setSelectedPledges(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const selectAll = () => {
    if (selectedPledges.length === unpaidPledges.length) {
      setSelectedPledges([])
    } else {
      setSelectedPledges(unpaidPledges.map(p => p.id))
    }
  }

  const handlePayPledges = () => {
    setPayingType('pledges')
    setShowPayModal(true)
  }

  const handleDonate = () => {
    if (!donationAmount || parseFloat(donationAmount) <= 0) return
    setPayingType('donation')
    setShowPayModal(true)
  }

  const confirmPayment = () => {
    if (payingType === 'pledges') {
      setPaidPledges(prev => [...prev, ...selectedPledges])
      const now = new Date().toISOString().split('T')[0]
      const newPayments = unpaidPledges
        .filter(p => selectedPledges.includes(p.id))
        .map(p => ({
          id: Date.now() + p.id,
          date: now,
          description: p.description,
          amount: p.amount,
          method: 'Credit Card',
        }))
      setExtraPayments(prev => [...prev, ...newPayments])
      setSelectedPledges([])
    } else {
      const now = new Date().toISOString().split('T')[0]
      setExtraPayments(prev => [...prev, {
        id: Date.now(),
        date: now,
        description: donationNote ? `Donation - ${donationNote}` : 'Donation - General Fund',
        amount: parseFloat(donationAmount),
        method: 'Credit Card',
      }])
      setDonationAmount('')
      setDonationNote('')
    }
    setShowPayModal(false)
    setPaySuccess(true)
    setTimeout(() => setPaySuccess(false), 3000)
  }

  return (
    <div className="payment-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Make a Payment</h1>
          <p className="page-subtitle">Pay your pledges or make a donation</p>
        </div>
      </div>

      {paySuccess && (
        <div className="success-toast">Payment processed successfully!</div>
      )}

      {/* Pay Pledges Section */}
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
                    <td className="amount-cell">${p.amount.toLocaleString()}</td>
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
            <div className="pay-footer-info">
              <span>{selectedPledges.length} pledge{selectedPledges.length > 1 ? 's' : ''} selected</span>
              <span className="pay-footer-total">Total: ${selectedTotal.toLocaleString()}</span>
            </div>
            <button className="pay-btn" onClick={handlePayPledges}>
              Pay ${selectedTotal.toLocaleString()}
            </button>
          </div>
        )}
      </div>

      {/* Donation Section */}
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

      {/* Payment Modal */}
      {showPayModal && (
        <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button>
            <h2 className="modal-title">Confirm Payment</h2>
            <div className="modal-body">
              {payingType === 'pledges' ? (
                <>
                  <p className="modal-desc">You are about to pay the following pledges:</p>
                  <div className="modal-items">
                    {unpaidPledges.filter(p => selectedPledges.includes(p.id)).map(p => (
                      <div key={p.id} className="modal-item">
                        <span>{p.description}</span>
                        <span>${p.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="modal-total">
                    <span>Total</span>
                    <span>${selectedTotal.toLocaleString()}</span>
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

              <div className="modal-payment-form">
                <div className="form-group">
                  <label>Card Number</label>
                  <input type="text" placeholder="4242 4242 4242 4242" maxLength="19" />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Expiry</label>
                    <input type="text" placeholder="MM/YY" maxLength="5" />
                  </div>
                  <div className="form-group">
                    <label>CVV</label>
                    <input type="text" placeholder="123" maxLength="4" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Name on Card</label>
                  <input type="text" placeholder="David Cohen" />
                </div>
              </div>

              <button className="pay-btn modal-pay-btn" onClick={confirmPayment}>
                Confirm &amp; Pay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
