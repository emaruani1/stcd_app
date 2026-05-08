import { useRef, useState, useMemo } from 'react'
import { sponsorshipCalendar } from '../data/fakeData'
import * as api from '../api'
import PaymentChooser from '../components/PaymentChooser'

export default function Sponsor({ bookedSponsors, setBookedSponsors, extraPayments, setExtraPayments, blockedDatesState = [], currentBalance, setMemberBalances, currentMemberId, kiddushPricing, seudaPricing, refreshData }) {
  const kiddushOptions = kiddushPricing || []
  const seudaOptions = seudaPricing || []
  const [selectedDate, setSelectedDate] = useState(null)
  const [sponsorType, setSponsorType] = useState(null) // 'kiddush' or 'seuda'
  const [selectedOption, setSelectedOption] = useState(null)
  const [occasion, setOccasion] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)
  const [paySuccess, setPaySuccess] = useState(false)
  const [paymentSource, setPaymentSource] = useState('card')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  const chooserRef = useRef(null)
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const calendar = useMemo(() => {
    return sponsorshipCalendar.map(entry => {
      const key = entry.date
      return {
        ...entry,
        kiddush: bookedSponsors[`kiddush-${key}`] || entry.kiddush,
        seuda: bookedSponsors[`seuda-${key}`] || entry.seuda,
      }
    })
  }, [bookedSponsors])

  // Build calendar grid
  const { year, month } = calMonth
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // Get all Saturdays in this month from our calendar data
  const saturdaysThisMonth = calendar.filter(entry => {
    const d = new Date(entry.date + 'T00:00:00')
    return d.getFullYear() === year && d.getMonth() === month
  })

  // Build full grid
  const daysInMonth = lastDay.getDate()
  const startDow = firstDay.getDay()
  const calendarDays = []
  for (let i = 0; i < startDow; i++) calendarDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d)

  const prevMonth = () => {
    setCalMonth(prev => {
      if (prev.month === 0) return { year: prev.year - 1, month: 11 }
      return { ...prev, month: prev.month - 1 }
    })
  }

  const nextMonth = () => {
    setCalMonth(prev => {
      if (prev.month === 11) return { year: prev.year + 1, month: 0 }
      return { ...prev, month: prev.month + 1 }
    })
  }

  const getSaturdayEntry = (day) => {
    if (!day) return null
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return calendar.find(e => e.date === dateStr)
  }

  const isSaturday = (day) => {
    if (!day) return false
    return new Date(year, month, day).getDay() === 6
  }

  const handleDateClick = (entry) => {
    setSelectedDate(entry)
    setSponsorType(null)
    setSelectedOption(null)
    setOccasion('')
  }

  const handleSelectSponsor = (type, option) => {
    setSponsorType(type)
    setSelectedOption(option)
    setPaymentSource(currentBalance >= option.price && currentBalance > 0 ? 'balance' : 'card')
    setShowPayModal(true)
  }

  const sponsorTotal = selectedOption ? selectedOption.price : 0
  const effectiveSource = (() => {
    if (paymentSource === 'balance' && currentBalance >= sponsorTotal) return 'balance'
    if (paymentSource === 'balance' && currentBalance > 0 && currentBalance < sponsorTotal) return 'split'
    return 'card'
  })()
  const balancePortionUsed = effectiveSource === 'balance' ? sponsorTotal : effectiveSource === 'split' ? currentBalance : 0
  const cardPortion = sponsorTotal - balancePortionUsed
  const showCardForm = paymentSource === 'card' || (paymentSource === 'balance' && currentBalance < sponsorTotal)

  const getPaymentMethodLabel = () => {
    if (effectiveSource === 'balance') return 'Account Credit'
    if (effectiveSource === 'split') return 'Balance + Card'
    return 'Credit Card'
  }

  const confirmPayment = async () => {
    const key = `${sponsorType}-${selectedDate.date}`
    const methodLabel = getPaymentMethodLabel()
    const now = new Date().toISOString().split('T')[0]
    setPaying(true)
    setPayError('')

    // One base idempotency key for the whole sponsorship intent.
    const idemBase = api.newIdempotencyKey()

    // 1) Charge the card portion first
    let gw = {}
    if (cardPortion > 0) {
      try {
        const res = await chooserRef.current.charge({
          amount: cardPortion,
          paymentType: 'donation',
          description: `${selectedOption.label} sponsorship — ${formatDate(selectedDate.date)}`,
          category: sponsorType === 'kiddush' ? 'Kiddush' : 'Seuda Shelishit',
          skipRecord: true, // recorded below as a donation transaction with gateway fields
          idempotencyKey: `${idemBase}::charge`,
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

    // 2) Deduct from balance if applicable
    if (balancePortionUsed > 0) {
      setMemberBalances(prev => ({
        ...prev,
        [currentMemberId]: Math.max(0, (prev[currentMemberId] || 0) - balancePortionUsed)
      }))
    }

    // 3) Save sponsorship
    try {
      await api.updateSponsorship(selectedDate.date, {
        [sponsorType]: {
          sponsor: 'You',
          type: selectedOption.id,
          occasion: occasion || 'Sponsorship',
          memberId: String(currentMemberId),
        }
      })
    } catch (e) { console.error(e) }

    // 4) Record the ledger as a sponsorship-fee + sponsorship-payment pair so the
    //    Account Balance shows -$X then +$X (net 0) at the moment of approval.
    try {
      const label = selectedOption.label
      const dateLabel = formatDate(selectedDate.date)
      await api.createChargePaymentPair({
        memberId: String(currentMemberId),
        date: now,
        amount: selectedOption.price,
        kind: 'sponsorship',
        chargeDescription: `${label} sponsorship — ${dateLabel}`,
        paymentDescription: `${label} sponsorship payment — ${dateLabel}`,
        method: methodLabel,
        category: sponsorType === 'kiddush' ? 'Kiddush' : 'Seuda Shelishit',
        balanceApplied: balancePortionUsed > 0 ? balancePortionUsed : 0,
        idempotencyKey: `${idemBase}::pair`,
        ...gw,
      })
    } catch (e) { console.error(e) }

    setBookedSponsors(prev => ({
      ...prev,
      [key]: {
        sponsor: 'You',
        type: selectedOption.id,
        occasion: occasion || 'Sponsorship',
      }
    }))
    setShowPayModal(false)
    setPaySuccess(true)
    setSelectedDate(null)
    setPaying(false)
    setTimeout(() => setPaySuccess(false), 3000)
    if (refreshData) await refreshData()
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  const formatDateShort = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="sponsor-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Sponsor a Shabbat</h1>
          <p className="page-subtitle">Sponsor a Kiddush or Seuda Shelishit for the community</p>
        </div>
      </div>

      {paySuccess && (
        <div className="success-toast">Sponsorship booked successfully! Thank you!</div>
      )}

      {/* Pricing Cards */}
      <div className="sponsor-pricing">
        <div className="pricing-group">
          <h3 className="pricing-group-title">Kiddush (Saturday Lunch)</h3>
          <div className="pricing-cards">
            {kiddushOptions.map(opt => (
              <div key={opt.id} className="pricing-card">
                <h4>{opt.label}</h4>
                <p className="pricing-price">${opt.price}</p>
                <p className="pricing-desc">{opt.description}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="pricing-group">
          <h3 className="pricing-group-title">Seuda Shelishit</h3>
          <div className="pricing-cards">
            {seudaOptions.map(opt => (
              <div key={opt.id} className="pricing-card">
                <h4>{opt.label}</h4>
                <p className="pricing-price">${opt.price}</p>
                <p className="pricing-desc">{opt.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="dashboard-section">
        <h2 className="section-title">Select a Shabbat</h2>
        <div className="sponsor-calendar">
          <div className="cal-header">
            <button className="cal-nav-btn" onClick={prevMonth}>&lsaquo;</button>
            <h3 className="cal-month">{monthName}</h3>
            <button className="cal-nav-btn" onClick={nextMonth}>&rsaquo;</button>
          </div>
          <div className="cal-grid">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="cal-day-header">{d}</div>
            ))}
            {calendarDays.map((day, idx) => {
              const satEntry = day ? getSaturdayEntry(day) : null
              const isSat = isSaturday(day)
              const dateStr = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
              const isBlockedDate = blockedDatesState.includes(dateStr)
              const kiddushTaken = satEntry?.kiddush
              const seudaTaken = satEntry?.seuda
              const bothTaken = kiddushTaken && seudaTaken
              const isPast = day && new Date(year, month, day) < new Date(new Date().setHours(0,0,0,0))
              const isClickable = satEntry && !bothTaken && !isPast && !isBlockedDate

              return (
                <div
                  key={idx}
                  className={`cal-day ${!day ? 'empty' : ''} ${isSat ? 'saturday' : ''} ${isClickable ? 'available' : ''} ${bothTaken ? 'fully-booked' : ''} ${isPast ? 'past' : ''} ${isBlockedDate ? 'blocked' : ''}`}
                  onClick={() => {
                    if (isClickable) handleDateClick(satEntry)
                  }}
                >
                  {day && (
                    <>
                      <span className="cal-day-num">{day}</span>
                      {isSat && satEntry && (
                        <div className="cal-day-badges">
                          {kiddushTaken
                            ? <span className="cal-badge taken">K</span>
                            : <span className="cal-badge open">K</span>
                          }
                          {seudaTaken
                            ? <span className="cal-badge taken">S</span>
                            : <span className="cal-badge open">S</span>
                          }
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="cal-legend">
            <span className="cal-legend-item"><span className="cal-badge open">K</span> Kiddush Available</span>
            <span className="cal-legend-item"><span className="cal-badge taken">K</span> Kiddush Taken</span>
            <span className="cal-legend-item"><span className="cal-badge open">S</span> Seuda Available</span>
            <span className="cal-legend-item"><span className="cal-badge taken">S</span> Seuda Taken</span>
          </div>
        </div>
      </div>

      {/* Upcoming Sponsorships List */}
      <div className="dashboard-section">
        <h2 className="section-title">Upcoming Sponsorships</h2>
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Kiddush</th>
                <th>Seuda Shelishit</th>
              </tr>
            </thead>
            <tbody>
              {calendar
                .filter(e => new Date(e.date + 'T00:00:00') >= new Date(new Date().setHours(0,0,0,0)))
                .slice(0, 12)
                .map(entry => (
                <tr key={entry.date}>
                  <td className="date-cell">{formatDateShort(entry.date)}</td>
                  <td>
                    {entry.kiddush ? (
                      <div className="sponsor-info">
                        <span className="sponsor-name">{entry.kiddush.sponsor}</span>
                        <span className="sponsor-occasion">{entry.kiddush.occasion}</span>
                      </div>
                    ) : (
                      <span className="available-tag">Available</span>
                    )}
                  </td>
                  <td>
                    {entry.seuda ? (
                      <div className="sponsor-info">
                        <span className="sponsor-name">{entry.seuda.sponsor}</span>
                        <span className="sponsor-occasion">{entry.seuda.occasion}</span>
                      </div>
                    ) : (
                      <span className="available-tag">Available</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Date Selection Modal */}
      {selectedDate && !showPayModal && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal-content sponsor-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedDate(null)}>&times;</button>
            <h2 className="modal-title">Shabbat {formatDate(selectedDate.date)}</h2>
            <div className="modal-body">
              <div className="form-group">
                <label>Occasion / Dedication (optional)</label>
                <input
                  type="text"
                  value={occasion}
                  onChange={e => setOccasion(e.target.value)}
                  placeholder="e.g. In honor of a birthday, In memory of..."
                />
              </div>

              {!selectedDate.kiddush && (
                <div className="sponsor-option-group">
                  <h3>Kiddush</h3>
                  <div className="sponsor-options">
                    {kiddushOptions.map(opt => (
                      <button
                        key={opt.id}
                        className="sponsor-option-btn"
                        onClick={() => handleSelectSponsor('kiddush', opt)}
                      >
                        <span className="sponsor-option-label">{opt.label}</span>
                        <span className="sponsor-option-price">${opt.price}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedDate.kiddush && (
                <div className="sponsor-taken-notice">
                  Kiddush already sponsored by <strong>{selectedDate.kiddush.sponsor}</strong>
                </div>
              )}

              {!selectedDate.seuda && (
                <div className="sponsor-option-group">
                  <h3>Seuda Shelishit</h3>
                  <div className="sponsor-options">
                    {seudaOptions.map(opt => (
                      <button
                        key={opt.id}
                        className="sponsor-option-btn"
                        onClick={() => handleSelectSponsor('seuda', opt)}
                      >
                        <span className="sponsor-option-label">{opt.label}</span>
                        <span className="sponsor-option-price">${opt.price}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedDate.seuda && (
                <div className="sponsor-taken-notice">
                  Seuda Shelishit already sponsored by <strong>{selectedDate.seuda.sponsor}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayModal && (
        <div className="modal-overlay" onClick={() => setShowPayModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowPayModal(false)}>&times;</button>
            <h2 className="modal-title">Confirm Sponsorship</h2>
            <div className="modal-body">
              <div className="modal-total">
                <span>{selectedOption.label}</span>
                <span>${selectedOption.price}</span>
              </div>
              <p className="modal-desc">
                {formatDate(selectedDate.date)}
                {occasion && <><br /><em>{occasion}</em></>}
              </p>

              {currentBalance > 0 && (
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

                  {paymentSource === 'balance' && currentBalance > 0 && currentBalance < sponsorTotal && (
                    <div className="split-payment-notice">
                      <span className="split-payment-notice-icon">&#9432;</span>
                      <span>
                        Your balance covers ${currentBalance.toLocaleString()}. The remaining ${cardPortion.toLocaleString()} will be charged to your card.
                      </span>
                    </div>
                  )}
                </div>
              )}

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
                {paying ? 'Processing…' : `Confirm & Pay $${selectedOption.price}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
