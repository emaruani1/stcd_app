import { useState, useMemo } from 'react'
import { sponsorshipCalendar } from '../../data/fakeData'
import * as api from '../../api'

export default function AdminSponsorship({ allMembers, bookedSponsors, setBookedSponsors, blockedDatesState, setBlockedDatesState, kiddushPricing, seudaPricing, refreshData }) {
  const kiddushOptions = kiddushPricing || []
  const seudaOptions = seudaPricing || []
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selectedDate, setSelectedDate] = useState(null)
  const [showReserveModal, setShowReserveModal] = useState(false)
  const [reserveType, setReserveType] = useState('kiddush')
  const [reserveMember, setReserveMember] = useState('')
  const [reserveOption, setReserveOption] = useState('')
  const [reserveOccasion, setReserveOccasion] = useState('')
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

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

  const { year, month } = calMonth
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const monthName = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

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

  const isBlocked = (dateStr) => blockedDatesState.includes(dateStr)

  const getDateStr = (day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const handleDateClick = (entry, day) => {
    setSelectedDate({ ...entry, day })
    setShowReserveModal(false)
  }

  const toggleBlock = (dateStr) => {
    if (isBlocked(dateStr)) {
      setBlockedDatesState(prev => prev.filter(d => d !== dateStr))
      showToast('Date unblocked')
    } else {
      setBlockedDatesState(prev => [...prev, dateStr])
      showToast('Date blocked')
    }
    setSelectedDate(null)
  }

  const [createTxn, setCreateTxn] = useState(true)

  const handleReserve = (type) => {
    setReserveType(type)
    setReserveMember('')
    setReserveOption('')
    setReserveOccasion('')
    setCreateTxn(true)
    setShowReserveModal(true)
  }

  const confirmReserve = async () => {
    if (!reserveMember || !reserveOption) return
    const member = allMembers.find(m => String(m.id) === String(reserveMember))
    if (!member) return

    const key = `${reserveType}-${selectedDate.date}`
    const options = reserveType === 'kiddush' ? kiddushOptions : seudaOptions
    const opt = options.find(o => o.id === reserveOption)

    // Save sponsorship to API
    try {
      await api.updateSponsorship(selectedDate.date, {
        [reserveType]: {
          sponsor: `The ${member.lastName} Family`,
          type: reserveOption,
          occasion: reserveOccasion || 'Sponsorship',
          memberId: String(member.id),
        }
      })
    } catch (e) { console.error(e) }

    // Optionally create donation transaction
    if (createTxn && opt) {
      try {
        await api.createTransaction({
          memberId: String(member.id),
          date: new Date().toISOString().split('T')[0],
          description: `${opt.label} - ${selectedDate.date}`,
          amount: opt.price,
          method: '',
          paymentType: 'donation',
          category: reserveType === 'kiddush' ? 'Kiddush' : 'Seuda Shelishit',
        })
      } catch (e) { console.error(e) }
    }

    setBookedSponsors(prev => ({
      ...prev,
      [key]: {
        sponsor: `The ${member.lastName} Family`,
        type: reserveOption,
        occasion: reserveOccasion || 'Sponsorship',
        memberId: member.id,
      },
    }))

    setShowReserveModal(false)
    setSelectedDate(null)
    showToast(`${opt.label} reserved for ${member.firstName} ${member.lastName}`)
    if (refreshData) refreshData()
  }

  const handleRemove = async (type) => {
    const key = `${type}-${selectedDate.date}`
    try {
      await api.deleteSponsorship(selectedDate.date, { field: type })
    } catch (e) { console.error(e) }
    setBookedSponsors(prev => {
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
    showToast('Sponsorship removed')
    setSelectedDate(null)
    if (refreshData) refreshData()
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
          <h1 className="page-title">Sponsorship Management</h1>
          <p className="page-subtitle">Manage Kiddush and Seuda sponsorships</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {/* Calendar */}
      <div className="dashboard-section">
        <h2 className="section-title">Sponsorship Calendar</h2>
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
              const dateStr = day ? getDateStr(day) : ''
              const blocked = isBlocked(dateStr)
              const kiddushTaken = satEntry?.kiddush
              const seudaTaken = satEntry?.seuda
              const isPast = day && new Date(year, month, day) < new Date(new Date().setHours(0, 0, 0, 0))

              return (
                <div
                  key={idx}
                  className={`cal-day ${!day ? 'empty' : ''} ${isSat ? 'saturday' : ''} ${satEntry && !isPast ? 'available' : ''} ${blocked ? 'blocked' : ''} ${isPast ? 'past' : ''}`}
                  onClick={() => {
                    if (satEntry && isSat && !isPast) handleDateClick(satEntry, day)
                  }}
                  style={satEntry && isSat && !isPast ? { cursor: 'pointer' } : {}}
                >
                  {day && (
                    <>
                      <span className="cal-day-num">{day}</span>
                      {isSat && satEntry && (
                        <div className="cal-day-badges">
                          {blocked ? (
                            <span className="cal-badge blocked">B</span>
                          ) : (
                            <>
                              {kiddushTaken
                                ? <span className="cal-badge taken">K</span>
                                : <span className="cal-badge open">K</span>
                              }
                              {seudaTaken
                                ? <span className="cal-badge taken">S</span>
                                : <span className="cal-badge open">S</span>
                              }
                            </>
                          )}
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
            <span className="cal-legend-item"><span className="cal-badge blocked">B</span> Blocked</span>
          </div>
        </div>
      </div>

      {/* Upcoming Sponsorships Table */}
      <div className="dashboard-section">
        <h2 className="section-title">Upcoming Sponsorships</h2>
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Kiddush</th>
                <th>Seuda Shelishit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {calendar
                .filter(e => new Date(e.date + 'T00:00:00') >= new Date(new Date().setHours(0, 0, 0, 0)))
                .slice(0, 12)
                .map(entry => (
                  <tr key={entry.date} className={isBlocked(entry.date) ? 'overdue-row' : ''}>
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
                    <td>
                      {isBlocked(entry.date) ? (
                        <span className="badge badge-canceled">Blocked</span>
                      ) : (
                        <span className="badge badge-active">Open</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Date Detail Modal */}
      {selectedDate && !showReserveModal && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal-content sponsor-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedDate(null)}>&times;</button>
            <h2 className="modal-title">Shabbat {formatDate(selectedDate.date)}</h2>
            <div className="modal-body">
              {/* Block/Unblock */}
              <button
                className={`action-btn ${isBlocked(selectedDate.date) ? 'action-btn-pay' : 'action-btn-cancel'}`}
                style={{ marginBottom: 16 }}
                onClick={() => toggleBlock(selectedDate.date)}
              >
                {isBlocked(selectedDate.date) ? 'Unblock Date' : 'Block Date'}
              </button>

              {/* Kiddush */}
              {selectedDate.kiddush ? (
                <div className="sponsor-taken-notice">
                  <strong>Kiddush:</strong> {selectedDate.kiddush.sponsor} — {selectedDate.kiddush.occasion}
                  <br />
                  <button className="action-btn action-btn-delete" style={{ marginTop: 8 }} onClick={() => handleRemove('kiddush')}>
                    Remove
                  </button>
                </div>
              ) : (
                !isBlocked(selectedDate.date) && (
                  <div className="sponsor-option-group">
                    <h3>Kiddush — Available</h3>
                    <button className="action-btn action-btn-pay" onClick={() => handleReserve('kiddush')}>
                      Reserve Kiddush
                    </button>
                  </div>
                )
              )}

              {/* Seuda */}
              {selectedDate.seuda ? (
                <div className="sponsor-taken-notice" style={{ marginTop: 16 }}>
                  <strong>Seuda:</strong> {selectedDate.seuda.sponsor} — {selectedDate.seuda.occasion}
                  <br />
                  <button className="action-btn action-btn-delete" style={{ marginTop: 8 }} onClick={() => handleRemove('seuda')}>
                    Remove
                  </button>
                </div>
              ) : (
                !isBlocked(selectedDate.date) && (
                  <div className="sponsor-option-group">
                    <h3>Seuda Shelishit — Available</h3>
                    <button className="action-btn action-btn-pay" onClick={() => handleReserve('seuda')}>
                      Reserve Seuda
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reserve Modal */}
      {showReserveModal && selectedDate && (
        <div className="modal-overlay" onClick={() => setShowReserveModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowReserveModal(false)}>&times;</button>
            <h2 className="modal-title">Reserve {reserveType === 'kiddush' ? 'Kiddush' : 'Seuda'}</h2>
            <div className="modal-body">
              <p className="modal-desc">{formatDate(selectedDate.date)}</p>
              <div className="form-group">
                <label>Member</label>
                <select value={reserveMember} onChange={e => setReserveMember(e.target.value)}>
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={reserveOption} onChange={e => setReserveOption(e.target.value)}>
                  <option value="">Select option...</option>
                  {(reserveType === 'kiddush' ? kiddushOptions : seudaOptions).map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label} — ${opt.price}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Occasion (optional)</label>
                <input
                  type="text"
                  value={reserveOccasion}
                  onChange={e => setReserveOccasion(e.target.value)}
                  placeholder="e.g. Birthday celebration"
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={createTxn} onChange={e => setCreateTxn(e.target.checked)} />
                  Create donation transaction for this sponsorship
                </label>
              </div>
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowReserveModal(false)}>Cancel</button>
                <button className="pay-btn" style={{ padding: '10px 24px' }} onClick={confirmReserve} disabled={!reserveMember || !reserveOption}>
                  Reserve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
