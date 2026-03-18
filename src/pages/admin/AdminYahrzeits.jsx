import { useState, useMemo } from 'react'

export default function AdminYahrzeits({ allMembers, sentEmails, setSentEmails, templates }) {
  const [filter, setFilter] = useState('week')
  const [selected, setSelected] = useState([])
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const allYahrzeits = useMemo(() => {
    return allMembers.flatMap(member =>
      member.yahrzeits.map(y => ({
        ...y,
        memberId: member.id,
        memberName: `${member.firstName} ${member.lastName}`,
        memberEmail: member.email,
      }))
    )
  }, [allMembers])

  const getFilterDate = () => {
    const end = new Date(today)
    if (filter === 'week') end.setDate(end.getDate() + 7)
    else if (filter === 'month') end.setMonth(end.getMonth() + 1)
    else if (filter === '3months') end.setMonth(end.getMonth() + 3)
    else return null // 'all'
    return end
  }

  const filtered = useMemo(() => {
    const end = getFilterDate()
    return allYahrzeits
      .filter(y => {
        if (!end) return true
        const d = new Date(y.date + 'T00:00:00')
        return d >= today && d <= end
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
  }, [allYahrzeits, filter])

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const toggleSelect = (key) => {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const selectAllFiltered = () => {
    const keys = filtered.map((y, i) => `${y.memberId}-${i}`)
    if (selected.length === keys.length) {
      setSelected([])
    } else {
      setSelected(keys)
    }
  }

  const getSelectedYahrzeits = () => {
    return filtered.filter((y, i) => selected.includes(`${y.memberId}-${i}`))
  }

  const fillTemplate = (y) => {
    const tmpl = templates.yahrzeit
    return {
      subject: tmpl.subject.replace('{deceasedName}', y.name),
      body: tmpl.body
        .replace('{memberName}', y.memberName)
        .replace('{deceasedName}', y.name)
        .replace('{relationship}', y.relationship)
        .replace('{date}', formatDate(y.date)),
    }
  }

  const handleSendAll = () => {
    const selectedItems = getSelectedYahrzeits()
    const now = new Date().toISOString()
    const emails = selectedItems.map(y => {
      const tmpl = fillTemplate(y)
      return {
        id: Date.now() + Math.random(),
        date: now,
        type: 'yahrzeit',
        recipients: [y.memberEmail],
        subject: tmpl.subject,
        body: tmpl.body,
        memberName: y.memberName,
      }
    })
    setSentEmails(prev => [...prev, ...emails])
    setShowEmailModal(false)
    setSelected([])
    showToast(`${emails.length} yahrzeit reminder(s) sent`)
  }

  const previewYahrzeit = getSelectedYahrzeits()[0]

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Yahrzeits</h1>
          <p className="page-subtitle">Track and send yahrzeit reminders</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {/* Filter Tabs */}
      <div className="filter-tabs" style={{ marginBottom: 24 }}>
        {[
          { key: 'week', label: 'This Week' },
          { key: 'month', label: 'This Month' },
          { key: '3months', label: 'Next 3 Months' },
          { key: 'all', label: 'All' },
        ].map(f => (
          <button
            key={f.key}
            className={`filter-tab ${filter === f.key ? 'active' : ''}`}
            onClick={() => { setFilter(f.key); setSelected([]) }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="dashboard-section">
        <div className="section-title-row">
          <h2 className="section-title">Yahrzeit List ({filtered.length})</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="select-all-btn" onClick={selectAllFiltered}>
              {selected.length === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            {selected.length > 0 && (
              <button className="pay-btn" style={{ padding: '6px 16px', fontSize: '0.82rem' }} onClick={() => setShowEmailModal(true)}>
                Send Reminder ({selected.length})
              </button>
            )}
          </div>
        </div>
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th className="check-col"></th>
                <th>Member</th>
                <th>Deceased Name</th>
                <th>Gender</th>
                <th>Relationship</th>
                <th>Date</th>
                <th>Hebrew Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="7" className="empty-row">No yahrzeits found for this period</td></tr>
              ) : (
                filtered.map((y, i) => {
                  const key = `${y.memberId}-${i}`
                  return (
                    <tr key={key} onClick={() => toggleSelect(key)} style={{ cursor: 'pointer' }} className={selected.includes(key) ? 'selected-row' : ''}>
                      <td className="check-col">
                        <div className={`custom-checkbox ${selected.includes(key) ? 'checked' : ''}`}>
                          {selected.includes(key) && <span>&#10003;</span>}
                        </div>
                      </td>
                      <td><strong>{y.memberName}</strong></td>
                      <td>{y.name}</td>
                      <td style={{ textTransform: 'capitalize' }}>{y.gender}</td>
                      <td style={{ textTransform: 'capitalize' }}>{y.relationship}</td>
                      <td>{formatDate(y.date)}</td>
                      <td>{y.hebrewDay} {y.hebrewMonth}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email Preview Modal */}
      {showEmailModal && (
        <div className="modal-overlay" onClick={() => setShowEmailModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEmailModal(false)}>&times;</button>
            <h2 className="modal-title">Send Yahrzeit Reminders</h2>
            <div className="modal-body">
              <p className="modal-desc">Sending to {selected.length} recipient(s):</p>
              <div className="email-recipients">
                {getSelectedYahrzeits().map((y, i) => (
                  <span key={i} className="email-recipient-chip">{y.memberName} ({y.memberEmail})</span>
                ))}
              </div>
              {previewYahrzeit && (
                <div className="email-preview">
                  <div className="email-preview-subject">{fillTemplate(previewYahrzeit).subject}</div>
                  <div className="email-preview-body">{fillTemplate(previewYahrzeit).body}</div>
                </div>
              )}
              {selected.length > 1 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Preview shows first email. Each recipient gets a personalized version.
                </p>
              )}
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowEmailModal(false)}>Cancel</button>
                <button className="pay-btn" style={{ padding: '10px 24px' }} onClick={handleSendAll}>
                  Send All ({selected.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
