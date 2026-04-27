import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as api from '../../api'

const HEBREW_MONTHS = [
  'Nisan', 'Iyyar', 'Sivan', 'Tammuz', 'Av', 'Elul',
  'Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Adar II',
]

const PARSHIYOT = [
  'Bereishit', 'Noach', 'Lech Lecha', 'Vayera', 'Chayei Sarah', 'Toldot', 'Vayetzei', 'Vayishlach', 'Vayeshev', 'Miketz', 'Vayigash', 'Vayechi',
  'Shemot', 'Vaera', 'Bo', 'Beshalach', 'Yitro', 'Mishpatim', 'Terumah', 'Tetzaveh', 'Ki Tisa', 'Vayakhel', 'Pekudei',
  'Vayikra', 'Tzav', 'Shemini', 'Tazria', 'Metzora', 'Acharei Mot', 'Kedoshim', 'Emor', 'Behar', 'Bechukotai',
  'Bamidbar', 'Naso', 'Behaalotcha', 'Shelach', 'Korach', 'Chukat', 'Balak', 'Pinchas', 'Matot', 'Masei',
  'Devarim', 'Vaetchanan', 'Eikev', 'Re\'eh', 'Shoftim', 'Ki Teitzei', 'Ki Tavo', 'Nitzavim', 'Vayeilech', 'Haazinu', 'V\'Zot HaBrachah',
]

const emptyYahrzeit = () => ({ name: '', gender: '', relationship: '', date: '', useHebrew: false, hebrewDay: '', hebrewMonth: '', hebrewYear: '' })
const emptyChild = () => ({ name: '', gender: '', dob: '', useHebrew: false, hebrewDay: '', hebrewMonth: '', hebrewYear: '', parasha: '', barBatMitzvahDate: '' })

export default function AdminMemberEdit({ allMembers, refreshData }) {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const member = allMembers.find(m => String(m.id) === String(memberId))

  const [form, setForm] = useState(null)
  const [originalForm, setOriginalForm] = useState(null)
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(false)

  // Cognito user state
  const [cognitoUser, setCognitoUser] = useState(null) // null=loading, {found:false}, or user object
  const [cognitoLoading, setCognitoLoading] = useState(false)
  const [cognitoAction, setCognitoAction] = useState('') // 'creating', 'disabling', etc.
  const [newUserRole, setNewUserRole] = useState('member') // role for new user creation

  useEffect(() => {
    if (member) {
      const initial = {
        firstName: member.firstName || '',
        lastName: member.lastName || '',
        gender: member.gender || '',
        email: member.email || '',
        phone: member.phone || '',
        dob: member.dob || '',
        dobIsHebrew: false,
        dobHebrew: { day: '', month: '', year: '' },
        address: member.address || '',
        addressLine2: member.addressLine2 || '',
        city: member.city || '',
        state: member.state || '',
        zip: member.zip || '',
        spouseName: member.spouseName || '',
        spouseGender: member.spouseGender || '',
        spouseDob: member.spouseDob || '',
        spouseDobIsHebrew: false,
        spouseDobHebrew: { day: '', month: '', year: '' },
        marriageDate: member.marriageDate || '',
        marriageDateIsHebrew: false,
        marriageDateHebrew: { day: '', month: '', year: '' },
        contactType: member.contactType || '',
        membershipType: member.membershipType || '',
        membershipPlan: member.membershipPlan || '',
        memberSince: member.memberSince || '',
        formalSalutation: member.formalSalutation || '',
        dearWho: member.dearWho || '',
        yahrzeits: (member.yahrzeits || []).map(y => ({ ...y, useHebrew: false })),
        children: (member.children || []).map(c => ({ ...c, useHebrew: false })),
      }
      setForm(initial)
      setOriginalForm(JSON.parse(JSON.stringify(initial)))
    }
  }, [member])

  // Look up Cognito user by member email
  const lookupCognitoUser = useCallback(async () => {
    if (!member?.email) {
      setCognitoUser({ found: false, noEmail: true })
      return
    }
    setCognitoLoading(true)
    try {
      const result = await api.lookupUser(member.email)
      setCognitoUser(result)
    } catch {
      setCognitoUser({ found: false, error: true })
    } finally {
      setCognitoLoading(false)
    }
  }, [member?.email])

  useEffect(() => {
    if (member) lookupCognitoUser()
  }, [member, lookupCognitoUser])

  const handleCreateUser = async () => {
    if (!member?.email) return
    setCognitoAction('creating')
    try {
      await api.createUser({ email: member.email, role: newUserRole, memberId: String(member.id) })
      setToast('User account created — temporary password sent via email')
      lookupCognitoUser()
    } catch (err) {
      setToast('Error: ' + err.message)
    } finally {
      setCognitoAction('')
    }
  }

  const handleDisableUser = async () => {
    if (!member?.email || !confirm('Disable this user account? They will not be able to log in.')) return
    setCognitoAction('disabling')
    try {
      await api.disableUser(member.email)
      setToast('User account disabled')
      lookupCognitoUser()
    } catch (err) {
      setToast('Error: ' + err.message)
    } finally {
      setCognitoAction('')
    }
  }

  const handleEnableUser = async () => {
    if (!member?.email) return
    setCognitoAction('enabling')
    try {
      await api.enableUser(member.email)
      setToast('User account enabled')
      lookupCognitoUser()
    } catch (err) {
      setToast('Error: ' + err.message)
    } finally {
      setCognitoAction('')
    }
  }

  const handleResetPassword = async () => {
    if (!member?.email || !confirm('Send a password reset email to this user?')) return
    setCognitoAction('resetting')
    try {
      await api.resetUserPassword(member.email)
      setToast('Password reset email sent')
    } catch (err) {
      setToast('Error: ' + err.message)
    } finally {
      setCognitoAction('')
    }
  }

  const handleRoleChange = async (newRole) => {
    if (!member?.email) return
    setCognitoAction('updatingRole')
    try {
      await api.updateUserRole(member.email, newRole)
      setToast(`Role updated to ${newRole}`)
      lookupCognitoUser()
    } catch (err) {
      setToast('Error: ' + err.message)
    } finally {
      setCognitoAction('')
    }
  }

  if (!member) {
    return (
      <div className="dashboard-page">
        <h1 className="page-title">Member not found</h1>
        <button className="pay-btn" onClick={() => navigate('/admin/members')}>Back to Members</button>
      </div>
    )
  }

  if (!form) return null

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }))
  const updateHebrewDate = (field, part, value) => setForm(prev => ({ ...prev, [field]: { ...prev[field], [part]: value } }))

  // Yahrzeits
  const addYahrzeit = () => setForm(prev => ({ ...prev, yahrzeits: [...prev.yahrzeits, emptyYahrzeit()] }))
  const removeYahrzeit = (idx) => setForm(prev => ({ ...prev, yahrzeits: prev.yahrzeits.filter((_, i) => i !== idx) }))
  const updateYahrzeit = (idx, field, value) => setForm(prev => ({
    ...prev, yahrzeits: prev.yahrzeits.map((y, i) => i === idx ? { ...y, [field]: value } : y),
  }))

  // Children
  const addChild = () => setForm(prev => ({ ...prev, children: [...prev.children, emptyChild()] }))
  const removeChild = (idx) => setForm(prev => ({ ...prev, children: prev.children.filter((_, i) => i !== idx) }))
  const updateChild = (idx, field, value) => setForm(prev => ({
    ...prev, children: prev.children.map((c, i) => i === idx ? { ...c, [field]: value } : c),
  }))

  const handleSave = async () => {
    setSaving(true)
    try {
      // Build a diff: only send fields that actually changed
      const uiOnlyKeys = ['dobIsHebrew', 'dobHebrew', 'spouseDobIsHebrew', 'spouseDobHebrew', 'marriageDateIsHebrew', 'marriageDateHebrew']
      const changes = {}

      // Compare simple fields
      const simpleFields = [
        'firstName', 'lastName', 'gender', 'email', 'phone', 'dob',
        'address', 'addressLine2', 'city', 'state', 'zip',
        'spouseName', 'spouseGender', 'spouseDob', 'marriageDate',
        'contactType', 'membershipType', 'membershipPlan', 'memberSince',
        'formalSalutation', 'dearWho',
      ]
      for (const key of simpleFields) {
        if (form[key] !== originalForm[key]) {
          changes[key] = form[key]
        }
      }

      // Always send yahrzeits/children if they changed (compare by JSON)
      const yahrzeits = form.yahrzeits.map(({ useHebrew, ...y }) => y)
      const origYahrzeits = originalForm.yahrzeits.map(({ useHebrew, ...y }) => y)
      if (JSON.stringify(yahrzeits) !== JSON.stringify(origYahrzeits)) {
        changes.yahrzeits = yahrzeits
      }

      const children = form.children.map(({ useHebrew, ...c }) => c)
      const origChildren = originalForm.children.map(({ useHebrew, ...c }) => c)
      if (JSON.stringify(children) !== JSON.stringify(origChildren)) {
        changes.children = children
      }

      if (Object.keys(changes).length === 0) {
        setToast('No changes to save')
        setTimeout(() => setToast(''), 2000)
        setSaving(false)
        return
      }

      await api.updateMember(String(memberId), changes)
      setToast('Profile saved successfully!')
      setOriginalForm(JSON.parse(JSON.stringify(form)))
      setTimeout(() => setToast(''), 3000)
      if (refreshData) refreshData()
    } catch (err) {
      setToast('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const renderDateInput = (label, dateField, hebrewToggleField, hebrewField, showYear = true) => {
    const isHebrew = form[hebrewToggleField]
    const hebrewVal = form[hebrewField] || { day: '', month: '', year: '' }
    return (
      <div className="form-group">
        <div className="date-label-row">
          <label>{label}</label>
          <button type="button" className={`date-mode-btn ${isHebrew ? 'hebrew' : ''}`} onClick={() => updateField(hebrewToggleField, !isHebrew)}>
            {isHebrew ? 'Hebrew' : 'Gregorian'}
          </button>
        </div>
        {isHebrew ? (
          <div className="hebrew-date-inputs">
            <input type="number" min="1" max="30" placeholder="Day" value={hebrewVal.day} onChange={e => updateHebrewDate(hebrewField, 'day', e.target.value)} />
            <select value={hebrewVal.month} onChange={e => updateHebrewDate(hebrewField, 'month', e.target.value)}>
              <option value="">Month</option>
              {HEBREW_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {showYear && <input type="number" min="5000" max="6000" placeholder="Year" value={hebrewVal.year} onChange={e => updateHebrewDate(hebrewField, 'year', e.target.value)} />}
          </div>
        ) : (
          <input type="date" value={form[dateField]} onChange={e => updateField(dateField, e.target.value)} />
        )}
      </div>
    )
  }

  const renderItemDateInput = (label, item, idx, updateFn, showYear = true) => {
    const isHebrew = item.useHebrew
    return (
      <div className="form-group">
        <div className="date-label-row">
          <label>{label}</label>
          <button type="button" className={`date-mode-btn ${isHebrew ? 'hebrew' : ''}`} onClick={() => updateFn(idx, 'useHebrew', !isHebrew)}>
            {isHebrew ? 'Hebrew' : 'Gregorian'}
          </button>
        </div>
        {isHebrew ? (
          <div className="hebrew-date-inputs">
            <input type="number" min="1" max="30" placeholder="Day" value={item.hebrewDay || ''} onChange={e => updateFn(idx, 'hebrewDay', e.target.value)} />
            <select value={item.hebrewMonth || ''} onChange={e => updateFn(idx, 'hebrewMonth', e.target.value)}>
              <option value="">Month</option>
              {HEBREW_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {showYear && <input type="number" min="5000" max="6000" placeholder="Year" value={item.hebrewYear || ''} onChange={e => updateFn(idx, 'hebrewYear', e.target.value)} />}
          </div>
        ) : (
          <input type="date" value={item.date || item.dob || ''} onChange={e => updateFn(idx, item.dob !== undefined ? 'dob' : 'date', e.target.value)} />
        )}
      </div>
    )
  }

  return (
    <div className="profile-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Edit: {member.firstName} {member.lastName}</h1>
          <p className="page-subtitle">Member ID: {member.memberId || member.id}</p>
        </div>
        <button className="modal-btn-secondary" style={{ padding: '10px 20px' }} onClick={() => navigate('/admin/members')}>
          Back to Members
        </button>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      {/* Duplicate email warning */}
      {member.email && (() => {
        const dupes = allMembers.filter(other => other.id !== member.id && other.email && other.email.toLowerCase() === member.email.toLowerCase())
        return dupes.length > 0 ? (
          <div style={{
            background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 'var(--radius-sm)',
            padding: '12px 16px', marginBottom: '1rem', fontSize: '0.9rem', color: '#856404',
          }}>
            <strong>Duplicate email detected:</strong> {member.email} is also used by{' '}
            {dupes.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                <strong>{d.firstName} {d.lastName}</strong> (ID: {d.memberId || d.id})
              </span>
            ))}
            {' '}&mdash;{' '}
            <button
              onClick={() => navigate(`/admin/merge?member=${member.id}`)}
              style={{
                background: 'none', border: 'none', color: '#856404', cursor: 'pointer',
                textDecoration: 'underline', fontWeight: 600, padding: 0, fontSize: 'inherit',
              }}
            >
              Merge accounts
            </button>
          </div>
        ) : null
      })()}

      {/* User Account (Cognito) */}
      <div className="profile-section">
        <h2 className="profile-section-title">User Account</h2>
        {cognitoLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading user info...</p>
        ) : cognitoUser?.noEmail ? (
          <div style={{
            background: 'var(--bg-warm)', borderRadius: 'var(--radius-sm)',
            padding: '16px 20px', fontSize: '0.9rem', color: 'var(--text-muted)',
          }}>
            <strong>No email on file.</strong> Add an email address to this member before creating a login account.
          </div>
        ) : cognitoUser?.found === false ? (
          <div style={{
            background: 'var(--bg-warm)', borderRadius: 'var(--radius-sm)',
            padding: '16px 20px', fontSize: '0.9rem',
          }}>
            <div style={{ marginBottom: '12px', color: 'var(--text-muted)' }}>
              <strong>No login account linked.</strong> This member ({member.email}) does not have a user account for the portal.
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '8px' }}>
              <div className="form-group" style={{ margin: 0, minWidth: '140px' }}>
                <label style={{ fontSize: '0.82rem' }}>Role</label>
                <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                className="pay-btn"
                style={{ padding: '8px 20px', fontSize: '0.85rem', alignSelf: 'flex-end' }}
                onClick={handleCreateUser}
                disabled={!!cognitoAction}
              >
                {cognitoAction === 'creating' ? 'Creating...' : 'Create Login Account'}
              </button>
            </div>
            <p style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              A temporary password will be sent to {member.email}. The member will be prompted to set a new password on first login.
            </p>
          </div>
        ) : cognitoUser?.found ? (
          <div>
            <div className="profile-form-grid">
              <div className="form-group">
                <label>Login Email</label>
                <input type="text" value={cognitoUser.email} readOnly style={{ background: 'var(--bg-warm)' }} />
              </div>
              <div className="form-group">
                <label>Account Status</label>
                <div style={{ padding: '8px 0' }}>
                  <span className={`badge ${cognitoUser.enabled ? 'badge-active' : 'badge-canceled'}`} style={{ fontSize: '0.85rem' }}>
                    {cognitoUser.enabled ? 'Active' : 'Disabled'}
                  </span>
                  {' '}
                  <span className={`badge ${
                    cognitoUser.status === 'CONFIRMED' ? 'badge-paid' :
                    cognitoUser.status === 'FORCE_CHANGE_PASSWORD' ? 'badge-pending' :
                    'badge-pending'
                  }`} style={{ fontSize: '0.85rem' }}>
                    {cognitoUser.status === 'CONFIRMED' ? 'Confirmed' :
                     cognitoUser.status === 'FORCE_CHANGE_PASSWORD' ? 'Pending Password Change' :
                     cognitoUser.status === 'RESET_REQUIRED' ? 'Reset Required' :
                     cognitoUser.status}
                  </span>
                </div>
              </div>
              <div className="form-group">
                <label>Role</label>
                <select
                  value={cognitoUser.role || 'member'}
                  onChange={e => handleRoleChange(e.target.value)}
                  disabled={!!cognitoAction}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label>Linked Member ID</label>
                <input type="text" value={cognitoUser.memberId || '—'} readOnly style={{ background: 'var(--bg-warm)' }} />
              </div>
              <div className="form-group">
                <label>Created</label>
                <input type="text" value={new Date(cognitoUser.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} readOnly style={{ background: 'var(--bg-warm)' }} />
              </div>
              <div className="form-group">
                <label>Email Verified</label>
                <input type="text" value={cognitoUser.emailVerified === 'true' ? 'Yes' : 'No'} readOnly style={{ background: 'var(--bg-warm)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button
                className="modal-btn-secondary"
                style={{ padding: '8px 18px' }}
                onClick={handleResetPassword}
                disabled={!!cognitoAction}
              >
                {cognitoAction === 'resetting' ? 'Sending...' : 'Reset Password'}
              </button>
              {cognitoUser.enabled ? (
                <button
                  className="modal-btn-secondary"
                  style={{ padding: '8px 18px', color: 'var(--danger, #dc3545)', borderColor: 'var(--danger, #dc3545)' }}
                  onClick={handleDisableUser}
                  disabled={!!cognitoAction}
                >
                  {cognitoAction === 'disabling' ? 'Disabling...' : 'Disable Account'}
                </button>
              ) : (
                <button
                  className="pay-btn"
                  style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                  onClick={handleEnableUser}
                  disabled={!!cognitoAction}
                >
                  {cognitoAction === 'enabling' ? 'Enabling...' : 'Enable Account'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Unable to check user account status.</p>
        )}
      </div>

      {/* Personal Info */}
      <div className="profile-section">
        <h2 className="profile-section-title">Personal Information</h2>
        <div className="profile-form-grid">
          <div className="form-group">
            <label>First Name</label>
            <input type="text" value={form.firstName} onChange={e => updateField('firstName', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Last Name</label>
            <input type="text" value={form.lastName} onChange={e => updateField('lastName', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Gender</label>
            <select value={form.gender} onChange={e => updateField('gender', e.target.value)}>
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={form.email} onChange={e => updateField('email', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input type="tel" value={form.phone} onChange={e => updateField('phone', e.target.value)} />
          </div>
          {renderDateInput('Date of Birth', 'dob', 'dobIsHebrew', 'dobHebrew')}
          <div className="form-group">
            <label>Formal Salutation</label>
            <input type="text" value={form.formalSalutation} onChange={e => updateField('formalSalutation', e.target.value)} placeholder="e.g. Mr. and Mrs. Cohen" />
          </div>
          <div className="form-group">
            <label>Dear Who</label>
            <input type="text" value={form.dearWho} onChange={e => updateField('dearWho', e.target.value)} placeholder="e.g. David" />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="profile-section">
        <h2 className="profile-section-title">Address</h2>
        <div className="profile-form-grid">
          <div className="form-group full-width">
            <label>Street Address</label>
            <input type="text" value={form.address} onChange={e => updateField('address', e.target.value)} />
          </div>
          <div className="form-group full-width">
            <label>Address Line 2</label>
            <input type="text" value={form.addressLine2} onChange={e => updateField('addressLine2', e.target.value)} />
          </div>
          <div className="form-group">
            <label>City</label>
            <input type="text" value={form.city} onChange={e => updateField('city', e.target.value)} />
          </div>
          <div className="form-group">
            <label>State</label>
            <input type="text" value={form.state} onChange={e => updateField('state', e.target.value)} maxLength="2" />
          </div>
          <div className="form-group">
            <label>Zip Code</label>
            <input type="text" value={form.zip} onChange={e => updateField('zip', e.target.value)} maxLength="10" />
          </div>
        </div>
      </div>

      {/* Spouse */}
      <div className="profile-section">
        <h2 className="profile-section-title">Spouse</h2>
        <div className="profile-form-grid">
          <div className="form-group">
            <label>Spouse Name</label>
            <input type="text" value={form.spouseName} onChange={e => updateField('spouseName', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Spouse Gender</label>
            <select value={form.spouseGender} onChange={e => updateField('spouseGender', e.target.value)}>
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          {renderDateInput('Spouse DOB', 'spouseDob', 'spouseDobIsHebrew', 'spouseDobHebrew')}
          {renderDateInput('Marriage Date', 'marriageDate', 'marriageDateIsHebrew', 'marriageDateHebrew')}
        </div>
      </div>

      {/* Membership */}
      <div className="profile-section">
        <h2 className="profile-section-title">Membership</h2>
        <div className="profile-form-grid">
          <div className="form-group">
            <label>Contact Type</label>
            <select value={form.contactType} onChange={e => updateField('contactType', e.target.value)}>
              <option value="">—</option>
              <option value="MEMBER">Member</option>
              <option value="REGULAR">Regular</option>
              <option value="FRIEND OF STCD">Friend of STCD</option>
              <option value="OCCASIONAL DONOR">Occasional Donor</option>
            </select>
          </div>
          <div className="form-group">
            <label>Membership Type</label>
            <select value={form.membershipType} onChange={e => updateField('membershipType', e.target.value)}>
              <option value="">—</option>
              <option value="full">Full Member</option>
              <option value="associate">Associate Member</option>
            </select>
          </div>
          <div className="form-group">
            <label>Membership Plan</label>
            <select value={form.membershipPlan} onChange={e => updateField('membershipPlan', e.target.value)}>
              <option value="">—</option>
              <option value="single">Single</option>
              <option value="couple">Couple</option>
              <option value="family">Family</option>
            </select>
          </div>
          <div className="form-group">
            <label>Member Since</label>
            <input type="date" value={form.memberSince} onChange={e => updateField('memberSince', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Yahrzeits */}
      <div className="profile-section">
        <h2 className="profile-section-title">Yahrzeit Dates</h2>
        <div className="dynamic-list">
          {form.yahrzeits.map((y, idx) => (
            <div key={idx} className="dynamic-list-item">
              <div className="form-group" style={{ flex: 2 }}>
                <label>Name</label>
                <input type="text" value={y.name} onChange={e => updateYahrzeit(idx, 'name', e.target.value)} placeholder="e.g. Avraham ben Yitzhak" />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select value={y.gender} onChange={e => updateYahrzeit(idx, 'gender', e.target.value)}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="form-group">
                <label>Relationship</label>
                <select value={y.relationship} onChange={e => updateYahrzeit(idx, 'relationship', e.target.value)}>
                  <option value="">Select</option>
                  <option value="father">Father</option>
                  <option value="mother">Mother</option>
                  <option value="father-in-law">Father-in-law</option>
                  <option value="mother-in-law">Mother-in-law</option>
                  <option value="spouse">Spouse</option>
                  <option value="sibling">Sibling</option>
                  <option value="child">Child</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {renderItemDateInput('Date', y, idx, updateYahrzeit, false)}
              <button className="remove-item-btn" onClick={() => removeYahrzeit(idx)} title="Remove">&times;</button>
            </div>
          ))}
        </div>
        <button className="add-item-btn" onClick={addYahrzeit}>+ Add Yahrzeit</button>
      </div>

      {/* Children */}
      <div className="profile-section">
        <h2 className="profile-section-title">Children</h2>
        <div className="dynamic-list">
          {form.children.map((c, idx) => (
            <div key={idx} className="dynamic-list-item">
              <div className="form-group" style={{ flex: 2 }}>
                <label>Name</label>
                <input type="text" value={c.name} onChange={e => updateChild(idx, 'name', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select value={c.gender} onChange={e => updateChild(idx, 'gender', e.target.value)}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              {renderItemDateInput('Birthday', c, idx, updateChild)}
              <div className="form-group">
                <label>Bar/Bat Mitzvah Date</label>
                <input type="date" value={c.barBatMitzvahDate || ''} onChange={e => updateChild(idx, 'barBatMitzvahDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Parasha</label>
                <select value={c.parasha || ''} onChange={e => updateChild(idx, 'parasha', e.target.value)}>
                  <option value="">Select Parasha</option>
                  {PARSHIYOT.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <button className="remove-item-btn" onClick={() => removeChild(idx)} title="Remove">&times;</button>
            </div>
          ))}
        </div>
        <button className="add-item-btn" onClick={addChild}>+ Add Child</button>
      </div>

      {/* Save */}
      <div className="profile-save-row">
        <button className="modal-btn-secondary" style={{ padding: '12px 24px', marginRight: '0.75rem' }} onClick={() => navigate('/admin/members')}>
          Cancel
        </button>
        <button className="pay-btn" style={{ padding: '12px 32px' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
