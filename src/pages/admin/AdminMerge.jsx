import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../../api'

export default function AdminMerge({
  allMembers, setAllMembers,
  memberBalances, setMemberBalances,
  adminTransactions, setAdminTransactions,
  refreshData,
}) {
  const [searchParams] = useSearchParams()
  const preselected = searchParams.get('member')

  const [primaryId, setPrimaryId] = useState(preselected || '')
  const [secondaryId, setSecondaryId] = useState('')
  const [precedence, setPrecedence] = useState('primary')
  const [showConfirm, setShowConfirm] = useState(false)
  const [toast, setToast] = useState('')
  const [merged, setMerged] = useState(false)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  const primaryMember = allMembers.find(m => m.id === Number(primaryId))
  const secondaryMember = allMembers.find(m => m.id === Number(secondaryId))

  const profileFields = [
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'membershipType', label: 'Membership Type' },
    { key: 'membershipPlan', label: 'Membership Plan' },
    { key: 'spouseName', label: 'Spouse Name' },
  ]

  // Per-field overrides (which account's value to use)
  const [fieldOverrides, setFieldOverrides] = useState({})

  const getFieldValue = (field) => {
    const source = fieldOverrides[field] || precedence
    if (source === 'primary') return primaryMember?.[field] || ''
    return secondaryMember?.[field] || ''
  }

  const toggleFieldOverride = (field, source) => {
    setFieldOverrides(prev => ({ ...prev, [field]: source }))
  }

  const handleMerge = async () => {
    if (!primaryMember || !secondaryMember) return

    // Build field values from overrides
    const fieldValues = {}
    for (const f of profileFields) {
      fieldValues[f.key] = getFieldValue(f.key)
    }

    try {
      await api.mergeMembers({
        primaryId: String(primaryMember.id),
        secondaryId: String(secondaryMember.id),
        fieldValues,
      })

      const secondaryName = `${secondaryMember.firstName} ${secondaryMember.lastName}`.trim()
      setShowConfirm(false)
      setMerged(true)
      showToast(`Accounts merged successfully. ${secondaryName} absorbed into ${primaryMember.firstName} ${primaryMember.lastName}.`)
      if (refreshData) refreshData()
    } catch (err) {
      showToast('Error: ' + err.message)
    }
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Merge Accounts</h1>
          <p className="page-subtitle">Combine two member accounts into one</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {merged ? (
        <div className="dashboard-section" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2>Merge Complete</h2>
          <p>The accounts have been successfully merged.</p>
          <button className="pay-btn" style={{ padding: '10px 24px', marginTop: '1rem' }} onClick={() => {
            setMerged(false)
            setPrimaryId('')
            setSecondaryId('')
            setFieldOverrides({})
          }}>
            Merge Another
          </button>
        </div>
      ) : (
        <>
          <div className="dashboard-section">
            <div className="form-row">
              <div className="form-group">
                <label>Primary Account (keeps ID)</label>
                <select value={primaryId} onChange={e => { setPrimaryId(e.target.value); setFieldOverrides({}) }}>
                  <option value="">Select member...</option>
                  {allMembers.filter(m => m.id !== Number(secondaryId)).map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.memberId})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Secondary Account (will be absorbed)</label>
                <select value={secondaryId} onChange={e => { setSecondaryId(e.target.value); setFieldOverrides({}) }}>
                  <option value="">Select member...</option>
                  {allMembers.filter(m => m.id !== Number(primaryId)).map(m => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.memberId})</option>
                  ))}
                </select>
              </div>
            </div>

            {primaryMember && secondaryMember && (
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Default Precedence</label>
                <select value={precedence} onChange={e => { setPrecedence(e.target.value); setFieldOverrides({}) }}>
                  <option value="primary">Primary: {primaryMember.firstName} {primaryMember.lastName}</option>
                  <option value="secondary">Secondary: {secondaryMember.firstName} {secondaryMember.lastName}</option>
                </select>
              </div>
            )}
          </div>

          {primaryMember && secondaryMember && (
            <>
              <div className="dashboard-section">
                <h2 className="section-title">Field-by-Field Comparison</h2>
                <div className="pledges-table-wrap">
                  <table className="pledges-table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>
                          Primary: {primaryMember.firstName}
                          <br /><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{primaryMember.memberId}</span>
                        </th>
                        <th>
                          Secondary: {secondaryMember.firstName}
                          <br /><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{secondaryMember.memberId}</span>
                        </th>
                        <th>Use</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profileFields.map(f => {
                        const pVal = primaryMember[f.key] || ''
                        const sVal = secondaryMember[f.key] || ''
                        const selected = fieldOverrides[f.key] || precedence
                        const isDiff = pVal !== sVal
                        return (
                          <tr key={f.key} style={isDiff ? { background: 'var(--bg-warm)' } : {}}>
                            <td><strong>{f.label}</strong></td>
                            <td style={selected === 'primary' ? { fontWeight: 600, color: 'var(--success)' } : {}}>{pVal || '—'}</td>
                            <td style={selected === 'secondary' ? { fontWeight: 600, color: 'var(--success)' } : {}}>{sVal || '—'}</td>
                            <td>
                              {isDiff ? (
                                <select
                                  value={selected}
                                  onChange={e => toggleFieldOverride(f.key, e.target.value)}
                                  style={{ padding: '4px 8px', fontSize: '0.82rem' }}
                                >
                                  <option value="primary">Primary</option>
                                  <option value="secondary">Secondary</option>
                                </select>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Same</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="dashboard-section">
                <h2 className="section-title">Data to Merge</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <h4>Primary: {primaryMember.firstName} {primaryMember.lastName}</h4>
                    <p>{primaryMember.pledges.length} pledges, {primaryMember.paymentHistory.length} payments</p>
                    <p>{primaryMember.yahrzeits.length} yahrzeits, {primaryMember.children.length} children</p>
                    <p>Credit: ${(memberBalances[primaryMember.id] || 0).toLocaleString()}</p>
                    <p>Aliases: {(primaryMember.aliases || []).join(', ') || 'None'}</p>
                  </div>
                  <div>
                    <h4>Secondary: {secondaryMember.firstName} {secondaryMember.lastName}</h4>
                    <p>{secondaryMember.pledges.length} pledges, {secondaryMember.paymentHistory.length} payments</p>
                    <p>{secondaryMember.yahrzeits.length} yahrzeits, {secondaryMember.children.length} children</p>
                    <p>Credit: ${(memberBalances[secondaryMember.id] || 0).toLocaleString()}</p>
                    <p>Aliases: {(secondaryMember.aliases || []).join(', ') || 'None'}</p>
                  </div>
                </div>
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fff3cd', borderRadius: 'var(--radius-md)', border: '1px solid #ffc107' }}>
                  <strong>After merge:</strong> All pledges, payments, yahrzeits, children, and aliases will be combined.
                  The secondary account's name will become an alias. Credits will be summed.
                  The secondary account will be permanently removed.
                </div>
                <button
                  className="pay-btn"
                  style={{ padding: '12px 32px', marginTop: '1.5rem', fontSize: '1rem' }}
                  onClick={() => setShowConfirm(true)}
                >
                  Merge Accounts
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Confirm Modal */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowConfirm(false)}>&times;</button>
            <h2 className="modal-title">Confirm Merge</h2>
            <div className="modal-body">
              <p className="modal-desc" style={{ marginBottom: '1rem' }}>
                This will permanently merge <strong>{secondaryMember?.firstName} {secondaryMember?.lastName}</strong> into{' '}
                <strong>{primaryMember?.firstName} {primaryMember?.lastName}</strong>.
                The secondary account will be deleted. This action cannot be undone.
              </p>
              <div className="modal-actions">
                <button className="modal-btn-secondary" onClick={() => setShowConfirm(false)}>Cancel</button>
                <button className="modal-btn-danger" onClick={handleMerge}>Confirm Merge</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
