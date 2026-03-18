import { useState, useMemo } from 'react'

export default function AdminBirthdays({ allMembers, sentEmails, setSentEmails, templates }) {
  const [tab, setTab] = useState('birthdays')
  const [selected, setSelected] = useState([])
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const currentYear = today.getFullYear()

  // Collect all birthdays
  const allBirthdays = useMemo(() => {
    const bdays = []
    allMembers.forEach(member => {
      const parentName = `${member.firstName} ${member.lastName}`
      if (member.dob) {
        const d = new Date(member.dob + 'T00:00:00')
        const thisYear = new Date(currentYear, d.getMonth(), d.getDate())
        const nextBday = thisYear >= today ? thisYear : new Date(currentYear + 1, d.getMonth(), d.getDate())
        const age = nextBday.getFullYear() - d.getFullYear()
        const daysUntil = Math.ceil((nextBday - today) / (1000 * 60 * 60 * 24))
        bdays.push({
          name: parentName,
          parent: '—',
          dob: member.dob,
          age,
          daysUntil,
          memberId: member.id,
          memberName: parentName,
          memberEmail: member.email,
          type: 'member',
        })
      }
      if (member.spouseName && member.spouseDob) {
        const d = new Date(member.spouseDob + 'T00:00:00')
        const thisYear = new Date(currentYear, d.getMonth(), d.getDate())
        const nextBday = thisYear >= today ? thisYear : new Date(currentYear + 1, d.getMonth(), d.getDate())
        const age = nextBday.getFullYear() - d.getFullYear()
        const daysUntil = Math.ceil((nextBday - today) / (1000 * 60 * 60 * 24))
        bdays.push({
          name: member.spouseName,
          parent: parentName,
          dob: member.spouseDob,
          age,
          daysUntil,
          memberId: member.id,
          memberName: parentName,
          memberEmail: member.email,
          type: 'spouse',
        })
      }
      member.children.forEach(child => {
        if (child.dob) {
          const d = new Date(child.dob + 'T00:00:00')
          const thisYear = new Date(currentYear, d.getMonth(), d.getDate())
          const nextBday = thisYear >= today ? thisYear : new Date(currentYear + 1, d.getMonth(), d.getDate())
          const age = nextBday.getFullYear() - d.getFullYear()
          const daysUntil = Math.ceil((nextBday - today) / (1000 * 60 * 60 * 24))
          bdays.push({
            name: child.name,
            parent: parentName,
            dob: child.dob,
            age,
            daysUntil,
            memberId: member.id,
            memberName: parentName,
            memberEmail: member.email,
            type: 'child',
          })
        }
      })
    })
    return bdays.sort((a, b) => a.daysUntil - b.daysUntil)
  }, [allMembers])

  // Collect Bar/Bat Mitzvah
  const allBneiMitzvah = useMemo(() => {
    const items = []
    allMembers.forEach(member => {
      const parentName = `${member.firstName} ${member.lastName}`
      member.children.forEach(child => {
        if (child.barBatMitzvahDate) {
          const d = new Date(child.barBatMitzvahDate + 'T00:00:00')
          if (d >= today) {
            const daysUntil = Math.ceil((d - today) / (1000 * 60 * 60 * 24))
            items.push({
              childName: child.name,
              childGender: child.gender,
              parent: parentName,
              date: child.barBatMitzvahDate,
              parasha: child.parasha || '—',
              daysUntil,
              memberId: member.id,
              memberName: parentName,
              memberEmail: member.email,
            })
          }
        }
      })
    })
    return items.sort((a, b) => a.daysUntil - b.daysUntil)
  }, [allMembers])

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const currentItems = tab === 'birthdays' ? allBirthdays : allBneiMitzvah

  const toggleSelect = (key) => {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const selectAll = () => {
    const keys = currentItems.map((_, i) => `${tab}-${i}`)
    if (selected.length === keys.length) setSelected([])
    else setSelected(keys)
  }

  const getSelectedItems = () => {
    return currentItems.filter((_, i) => selected.includes(`${tab}-${i}`))
  }

  const handleSendEmails = () => {
    const items = getSelectedItems()
    const now = new Date().toISOString()

    const emails = items.map(item => {
      if (tab === 'birthdays') {
        const tmpl = templates.birthday
        return {
          id: Date.now() + Math.random(),
          date: now,
          type: 'birthday',
          recipients: [item.memberEmail],
          subject: tmpl.subject.replace('{celebrantName}', item.name),
          body: tmpl.body
            .replace('{memberName}', item.memberName)
            .replace('{celebrantName}', item.name),
          memberName: item.memberName,
        }
      } else {
        const tmpl = templates.barBatMitzvah
        return {
          id: Date.now() + Math.random(),
          date: now,
          type: 'barBatMitzvah',
          recipients: [item.memberEmail],
          subject: tmpl.subject.replace('{childName}', item.childName),
          body: tmpl.body
            .replace('{memberName}', item.memberName)
            .replace('{childName}', item.childName)
            .replace('{date}', formatDate(item.date))
            .replace('{parasha}', item.parasha),
          memberName: item.memberName,
        }
      }
    })

    setSentEmails(prev => [...prev, ...emails])
    setShowEmailModal(false)
    setSelected([])
    showToast(`${emails.length} email(s) sent`)
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Birthdays & B'nei Mitzvah</h1>
          <p className="page-subtitle">Track celebrations and send greetings</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {/* Tabs */}
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'birthdays' ? 'active' : ''}`} onClick={() => { setTab('birthdays'); setSelected([]) }}>
          Birthdays
        </button>
        <button className={`admin-tab ${tab === 'bneiMitzvah' ? 'active' : ''}`} onClick={() => { setTab('bneiMitzvah'); setSelected([]) }}>
          Bar/Bat Mitzvah
        </button>
      </div>

      <div className="dashboard-section">
        <div className="section-title-row">
          <h2 className="section-title">
            {tab === 'birthdays' ? `Upcoming Birthdays (${allBirthdays.length})` : `Upcoming B'nei Mitzvah (${allBneiMitzvah.length})`}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="select-all-btn" onClick={selectAll}>
              {selected.length === currentItems.length && currentItems.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            {selected.length > 0 && (
              <button className="pay-btn" style={{ padding: '6px 16px', fontSize: '0.82rem' }} onClick={() => setShowEmailModal(true)}>
                {tab === 'birthdays' ? 'Send Birthday Wishes' : 'Send Congratulations'} ({selected.length})
              </button>
            )}
          </div>
        </div>

        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th className="check-col"></th>
                {tab === 'birthdays' ? (
                  <>
                    <th>Name</th>
                    <th>Parent/Member</th>
                    <th>Date</th>
                    <th>Age</th>
                    <th>Days Until</th>
                  </>
                ) : (
                  <>
                    <th>Child</th>
                    <th>Parent</th>
                    <th>Date</th>
                    <th>Parasha</th>
                    <th>Days Until</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {currentItems.length === 0 ? (
                <tr><td colSpan="6" className="empty-row">No upcoming events</td></tr>
              ) : (
                currentItems.map((item, i) => {
                  const key = `${tab}-${i}`
                  return (
                    <tr key={key} onClick={() => toggleSelect(key)} style={{ cursor: 'pointer' }} className={selected.includes(key) ? 'selected-row' : ''}>
                      <td className="check-col">
                        <div className={`custom-checkbox ${selected.includes(key) ? 'checked' : ''}`}>
                          {selected.includes(key) && <span>&#10003;</span>}
                        </div>
                      </td>
                      {tab === 'birthdays' ? (
                        <>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.parent}</td>
                          <td>{formatDate(item.dob)}</td>
                          <td>{item.age}</td>
                          <td>
                            {item.daysUntil === 0 ? (
                              <span className="badge badge-active">Today!</span>
                            ) : item.daysUntil <= 7 ? (
                              <span className="badge badge-overdue">{item.daysUntil} days</span>
                            ) : (
                              `${item.daysUntil} days`
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td><strong>{item.childName}</strong> ({item.childGender === 'male' ? 'Bar' : 'Bat'} Mitzvah)</td>
                          <td>{item.parent}</td>
                          <td>{formatDate(item.date)}</td>
                          <td>{item.parasha}</td>
                          <td>
                            {item.daysUntil <= 30 ? (
                              <span className="badge badge-overdue">{item.daysUntil} days</span>
                            ) : (
                              `${item.daysUntil} days`
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="modal-overlay" onClick={() => setShowEmailModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEmailModal(false)}>&times;</button>
            <h2 className="modal-title">
              {tab === 'birthdays' ? 'Send Birthday Wishes' : 'Send Congratulations'}
            </h2>
            <div className="modal-body">
              <p className="modal-desc">Sending to {selected.length} recipient(s):</p>
              <div className="email-recipients">
                {getSelectedItems().map((item, i) => (
                  <span key={i} className="email-recipient-chip">
                    {item.memberName || item.parent} ({item.memberEmail})
                  </span>
                ))}
              </div>
              {getSelectedItems()[0] && (
                <div className="email-preview">
                  {tab === 'birthdays' ? (
                    <>
                      <div className="email-preview-subject">
                        {templates.birthday.subject.replace('{celebrantName}', getSelectedItems()[0].name)}
                      </div>
                      <div className="email-preview-body">
                        {templates.birthday.body
                          .replace('{memberName}', getSelectedItems()[0].memberName)
                          .replace('{celebrantName}', getSelectedItems()[0].name)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="email-preview-subject">
                        {templates.barBatMitzvah.subject.replace('{childName}', getSelectedItems()[0].childName)}
                      </div>
                      <div className="email-preview-body">
                        {templates.barBatMitzvah.body
                          .replace('{memberName}', getSelectedItems()[0].memberName)
                          .replace('{childName}', getSelectedItems()[0].childName)
                          .replace('{date}', formatDate(getSelectedItems()[0].date))
                          .replace('{parasha}', getSelectedItems()[0].parasha)}
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowEmailModal(false)}>Cancel</button>
                <button className="pay-btn" style={{ padding: '10px 24px' }} onClick={handleSendEmails}>
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
