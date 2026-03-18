import { useState, Fragment } from 'react'

export default function AdminEmails({ sentEmails, templates, setTemplates, defaultTemplates }) {
  const [tab, setTab] = useState('sent')
  const [expandedId, setExpandedId] = useState(null)
  const [toast, setToast] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const formatDateTime = (dateStr) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const typeLabels = {
    yahrzeit: 'Yahrzeit Reminder',
    birthday: 'Birthday Wishes',
    barBatMitzvah: 'Bar/Bat Mitzvah',
  }

  const handleTemplateChange = (key, field, value) => {
    setTemplates(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  const handleResetTemplate = (key) => {
    setTemplates(prev => ({
      ...prev,
      [key]: { ...defaultTemplates[key] },
    }))
    showToast('Template reset to default')
  }

  const sortedEmails = [...sentEmails].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Email Center</h1>
          <p className="page-subtitle">View sent emails and manage templates</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {/* Tabs */}
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'sent' ? 'active' : ''}`} onClick={() => setTab('sent')}>
          Sent Emails ({sentEmails.length})
        </button>
        <button className={`admin-tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
          Templates
        </button>
      </div>

      {tab === 'sent' && (
        <div className="dashboard-section">
          <h2 className="section-title">Sent Email Log</h2>
          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmails.length === 0 ? (
                  <tr><td colSpan="4" className="empty-row">No emails sent yet</td></tr>
                ) : (
                  sortedEmails.map((email, idx) => (
                    <Fragment key={email.id || idx}>
                      <tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === idx ? null : idx)}
                        className={expandedId === idx ? 'selected-row' : ''}
                      >
                        <td>{formatDateTime(email.date)}</td>
                        <td>
                          <span className={`badge ${email.type === 'yahrzeit' ? 'badge-pending' : email.type === 'birthday' ? 'badge-active' : 'badge-paid'}`}>
                            {typeLabels[email.type] || email.type}
                          </span>
                        </td>
                        <td>{email.memberName || email.recipients?.join(', ')}</td>
                        <td>{email.subject}</td>
                      </tr>
                      {expandedId === idx && (
                        <tr>
                          <td colSpan="4" className="expanded-row-content">
                            <h4>Recipients</h4>
                            <div className="email-recipients">
                              {email.recipients?.map((r, i) => (
                                <span key={i} className="email-recipient-chip">{r}</span>
                              ))}
                            </div>
                            <h4>Email Body</h4>
                            <div className="email-preview">
                              <div className="email-preview-subject">{email.subject}</div>
                              <div className="email-preview-body">{email.body}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div>
          {Object.entries(templates).map(([key, tmpl]) => (
            <div key={key} className="template-card">
              <h3>{typeLabels[key] || key} Template</h3>
              <div className="form-group">
                <label>Subject</label>
                <input
                  type="text"
                  value={tmpl.subject}
                  onChange={e => handleTemplateChange(key, 'subject', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Body</label>
                <textarea
                  value={tmpl.body}
                  onChange={e => handleTemplateChange(key, 'body', e.target.value)}
                  rows={6}
                />
              </div>
              <div className="template-actions">
                <button className="modal-btn-secondary" onClick={() => handleResetTemplate(key)}>
                  Reset to Default
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
