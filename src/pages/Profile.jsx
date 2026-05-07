import { useState, useEffect } from 'react'
import AccountSecurity from './AccountSecurity'
import * as api from '../api'

const HEBREW_MONTHS = [
  'Nisan', 'Iyyar', 'Sivan', 'Tammuz', 'Av', 'Elul',
  'Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Adar II',
]

const emptyYahrzeit = () => ({ name: '', gender: '', relationship: '', date: '', useHebrew: false, hebrewDay: '', hebrewMonth: '', hebrewYear: '' })
const PARSHIYOT = [
  'Bereishit', 'Noach', 'Lech Lecha', 'Vayera', 'Chayei Sarah', 'Toldot', 'Vayetzei', 'Vayishlach', 'Vayeshev', 'Miketz', 'Vayigash', 'Vayechi',
  'Shemot', 'Vaera', 'Bo', 'Beshalach', 'Yitro', 'Mishpatim', 'Terumah', 'Tetzaveh', 'Ki Tisa', 'Vayakhel', 'Pekudei',
  'Vayikra', 'Tzav', 'Shemini', 'Tazria', 'Metzora', 'Acharei Mot', 'Kedoshim', 'Emor', 'Behar', 'Bechukotai',
  'Bamidbar', 'Naso', 'Behaalotcha', 'Shelach', 'Korach', 'Chukat', 'Balak', 'Pinchas', 'Matot', 'Masei',
  'Devarim', 'Vaetchanan', 'Eikev', 'Re\'eh', 'Shoftim', 'Ki Teitzei', 'Ki Tavo', 'Nitzavim', 'Vayeilech', 'Haazinu', 'V\'Zot HaBrachah',
]

const emptyChild = () => ({ name: '', gender: '', date: '', useHebrew: false, hebrewDay: '', hebrewMonth: '', hebrewYear: '', parasha: '' })

const formFromMember = (m) => ({
  firstName: m.firstName || '',
  lastName: m.lastName || '',
  gender: m.gender || '',
  email: m.email || '',
  phone: m.phone || '',
  address: m.address || '',
  city: m.city || '',
  state: m.state || '',
  zip: m.zip || '',
  dob: m.dob || '',
  dobIsHebrew: false,
  dobHebrew: { day: '', month: '', year: '' },
  marriageDate: m.marriageDate || '',
  marriageDateIsHebrew: false,
  marriageDateHebrew: { day: '', month: '', year: '' },
  spouseName: m.spouseName || '',
  spouseGender: m.spouseGender || '',
  yahrzeits: (m.yahrzeits || []).map(y => ({ ...y, useHebrew: false })),
  children: (m.children || []).map(c => ({ ...c, useHebrew: false })),
})

export default function Profile({ currentMember, userRole, refreshData }) {
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const [form, setForm] = useState(() => formFromMember(currentMember))
  const [originalForm, setOriginalForm] = useState(() => formFromMember(currentMember))

  // Re-hydrate when the underlying member record changes (e.g. after refreshData)
  // and we're not actively editing — never clobber an in-progress edit.
  useEffect(() => {
    if (!isEditing) {
      const fresh = formFromMember(currentMember)
      setForm(fresh)
      setOriginalForm(fresh)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMember])

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const updateHebrewDate = (field, part, value) => {
    setForm(prev => ({
      ...prev,
      [field]: { ...prev[field], [part]: value },
    }))
  }

  // Yahrzeit management
  const addYahrzeit = () => {
    setForm(prev => ({ ...prev, yahrzeits: [...prev.yahrzeits, emptyYahrzeit()] }))
  }
  const removeYahrzeit = (idx) => {
    setForm(prev => ({ ...prev, yahrzeits: prev.yahrzeits.filter((_, i) => i !== idx) }))
  }
  const updateYahrzeit = (idx, field, value) => {
    setForm(prev => ({
      ...prev,
      yahrzeits: prev.yahrzeits.map((y, i) => i === idx ? { ...y, [field]: value } : y),
    }))
  }

  // Children management
  const addChild = () => {
    setForm(prev => ({ ...prev, children: [...prev.children, emptyChild()] }))
  }
  const removeChild = (idx) => {
    setForm(prev => ({ ...prev, children: prev.children.filter((_, i) => i !== idx) }))
  }
  const updateChild = (idx, field, value) => {
    setForm(prev => ({
      ...prev,
      children: prev.children.map((c, i) => i === idx ? { ...c, [field]: value } : c),
    }))
  }

  const handleEdit = () => {
    setOriginalForm(JSON.parse(JSON.stringify(form)))
    setIsEditing(true)
    setSaveError('')
    setSaveSuccess(false)
  }

  const handleCancel = () => {
    setForm(JSON.parse(JSON.stringify(originalForm)))
    setIsEditing(false)
    setSaveError('')
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        gender: form.gender,
        email: form.email,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        zip: form.zip,
        dob: form.dob,
        marriageDate: form.marriageDate,
        spouseName: form.spouseName,
        spouseGender: form.spouseGender,
        yahrzeits: form.yahrzeits.map(({ useHebrew, ...y }) => y),
        children: form.children.map(({ useHebrew, ...c }) => c),
      }
      await api.updateMember(String(currentMember.id || currentMember.memberId), payload)
      setSaveSuccess(true)
      setIsEditing(false)
      setOriginalForm(JSON.parse(JSON.stringify(form)))
      setTimeout(() => setSaveSuccess(false), 3000)
      if (refreshData) refreshData()
    } catch (err) {
      setSaveError(err.message || 'Could not save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Reusable per-field date input with its own Hebrew/Gregorian toggle
  const renderDateInput = (label, dateField, hebrewToggleField, hebrewField, showYear = true) => {
    const isHebrew = form[hebrewToggleField]
    const hebrewVal = form[hebrewField] || { day: '', month: '', year: '' }
    return (
      <div className="form-group">
        <div className="date-label-row">
          <label>{label}</label>
          <button
            type="button"
            className={`date-mode-btn ${isHebrew ? 'hebrew' : ''}`}
            onClick={() => updateField(hebrewToggleField, !isHebrew)}
          >
            {isHebrew ? 'Hebrew' : 'Gregorian'}
          </button>
        </div>
        {isHebrew ? (
          <div className="hebrew-date-inputs">
            <input
              type="number"
              min="1"
              max="30"
              placeholder="Day"
              value={hebrewVal.day}
              onChange={(e) => updateHebrewDate(hebrewField, 'day', e.target.value)}
            />
            <select
              value={hebrewVal.month}
              onChange={(e) => updateHebrewDate(hebrewField, 'month', e.target.value)}
            >
              <option value="">Month</option>
              {HEBREW_MONTHS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {showYear && (
              <input
                type="number"
                min="5000"
                max="6000"
                placeholder="Year"
                value={hebrewVal.year}
                onChange={(e) => updateHebrewDate(hebrewField, 'year', e.target.value)}
              />
            )}
          </div>
        ) : (
          <input
            type="date"
            value={form[dateField]}
            onChange={(e) => updateField(dateField, e.target.value)}
          />
        )}
      </div>
    )
  }

  // Per-item date input for dynamic lists (yahrzeit / children)
  const renderItemDateInput = (label, item, idx, updateFn, showYear = true) => {
    const isHebrew = item.useHebrew
    return (
      <div className="form-group">
        <div className="date-label-row">
          <label>{label}</label>
          <button
            type="button"
            className={`date-mode-btn ${isHebrew ? 'hebrew' : ''}`}
            onClick={() => updateFn(idx, 'useHebrew', !isHebrew)}
          >
            {isHebrew ? 'Hebrew' : 'Gregorian'}
          </button>
        </div>
        {isHebrew ? (
          <div className="hebrew-date-inputs">
            <input
              type="number"
              min="1"
              max="30"
              placeholder="Day"
              value={item.hebrewDay || ''}
              onChange={(e) => updateFn(idx, 'hebrewDay', e.target.value)}
            />
            <select
              value={item.hebrewMonth || ''}
              onChange={(e) => updateFn(idx, 'hebrewMonth', e.target.value)}
            >
              <option value="">Month</option>
              {HEBREW_MONTHS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {showYear && (
              <input
                type="number"
                min="5000"
                max="6000"
                placeholder="Year"
                value={item.hebrewYear || ''}
                onChange={(e) => updateFn(idx, 'hebrewYear', e.target.value)}
              />
            )}
          </div>
        ) : (
          <input
            type="date"
            value={item.date}
            onChange={(e) => updateFn(idx, 'date', e.target.value)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="profile-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-subtitle">
            {isEditing ? 'Edit your information, then click Save.' : 'Manage your personal information'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {!isEditing ? (
            <button className="pay-btn" style={{ padding: '10px 22px' }} onClick={handleEdit}>
              Edit
            </button>
          ) : (
            <>
              <button
                className="modal-btn-secondary"
                style={{ padding: '10px 22px' }}
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="pay-btn"
                style={{ padding: '10px 22px' }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {saveSuccess && (
        <div className="success-toast">Profile saved successfully!</div>
      )}
      {saveError && (
        <div style={{
          padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '0.85rem',
          color: 'var(--danger)', background: 'var(--danger-bg, #fee)',
        }}>{saveError}</div>
      )}

      {/* Personal Info */}
      <div className="profile-section">
        <h2 className="profile-section-title">Personal Information</h2>
        <fieldset disabled={!isEditing} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="profile-form-grid">
          <div className="form-group">
            <label>First Name</label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Last Name</label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Gender</label>
            <select
              value={form.gender}
              onChange={(e) => updateField('gender', e.target.value)}
            >
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
            />
          </div>
          {renderDateInput('Date of Birth', 'dob', 'dobIsHebrew', 'dobHebrew')}
          <div className="form-group">
            <label>Spouse Name</label>
            <input
              type="text"
              value={form.spouseName}
              onChange={(e) => updateField('spouseName', e.target.value)}
              placeholder="e.g. Sarah Cohen"
            />
          </div>
          <div className="form-group">
            <label>Spouse Gender</label>
            <select
              value={form.spouseGender}
              onChange={(e) => updateField('spouseGender', e.target.value)}
            >
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          {renderDateInput('Marriage Date', 'marriageDate', 'marriageDateIsHebrew', 'marriageDateHebrew')}
        </div>
        </fieldset>
      </div>

      {/* Address */}
      <div className="profile-section">
        <h2 className="profile-section-title">Address</h2>
        <fieldset disabled={!isEditing} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="profile-form-grid">
          <div className="form-group full-width">
            <label>Street Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => updateField('address', e.target.value)}
              placeholder="123 Main Street"
            />
          </div>
          <div className="form-group">
            <label>City</label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => updateField('city', e.target.value)}
              placeholder="Dallas"
            />
          </div>
          <div className="form-group">
            <label>State</label>
            <input
              type="text"
              value={form.state}
              onChange={(e) => updateField('state', e.target.value)}
              placeholder="TX"
              maxLength="2"
            />
          </div>
          <div className="form-group">
            <label>Zip Code</label>
            <input
              type="text"
              value={form.zip}
              onChange={(e) => updateField('zip', e.target.value)}
              placeholder="75001"
              maxLength="10"
            />
          </div>
        </div>
        </fieldset>
      </div>

      {/* Parents Yahrzeit */}
      <div className="profile-section">
        <h2 className="profile-section-title">Parents Yahrzeit Dates</h2>
        <p className="donation-desc" style={{ marginBottom: '16px' }}>
          Record yahrzeit dates for departed parents or loved ones.
        </p>
        <fieldset disabled={!isEditing} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="dynamic-list">
          {form.yahrzeits.map((y, idx) => (
            <div key={idx} className="dynamic-list-item">
              <div className="form-group" style={{ flex: 2 }}>
                <label>Name</label>
                <input
                  type="text"
                  value={y.name}
                  onChange={(e) => updateYahrzeit(idx, 'name', e.target.value)}
                  placeholder="e.g. Avraham ben Yitzhak"
                />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select
                  value={y.gender}
                  onChange={(e) => updateYahrzeit(idx, 'gender', e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="form-group">
                <label>Relationship</label>
                <select
                  value={y.relationship}
                  onChange={(e) => updateYahrzeit(idx, 'relationship', e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="father">Father</option>
                  <option value="mother">Mother</option>
                  <option value="father-in-law">Father-in-law</option>
                  <option value="mother-in-law">Mother-in-law</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {renderItemDateInput('Date', y, idx, updateYahrzeit, false)}
              <button
                className="remove-item-btn"
                onClick={() => removeYahrzeit(idx)}
                title="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <button className="add-item-btn" onClick={addYahrzeit}>
          + Add Yahrzeit
        </button>
        </fieldset>
      </div>

      {/* Children */}
      <div className="profile-section">
        <h2 className="profile-section-title">Children&apos;s Birthdays</h2>
        <fieldset disabled={!isEditing} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="dynamic-list">
          {form.children.map((c, idx) => (
            <div key={idx} className="dynamic-list-item">
              <div className="form-group" style={{ flex: 2 }}>
                <label>Name</label>
                <input
                  type="text"
                  value={c.name}
                  onChange={(e) => updateChild(idx, 'name', e.target.value)}
                  placeholder="e.g. Yosef"
                />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select
                  value={c.gender}
                  onChange={(e) => updateChild(idx, 'gender', e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              {renderItemDateInput('Birthday', c, idx, updateChild)}
              <div className="form-group">
                <label>Bar/Bat Mitzvah Parasha</label>
                <select
                  value={c.parasha}
                  onChange={(e) => updateChild(idx, 'parasha', e.target.value)}
                >
                  <option value="">Select Parasha</option>
                  {PARSHIYOT.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <button
                className="remove-item-btn"
                onClick={() => removeChild(idx)}
                title="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <button className="add-item-btn" onClick={addChild}>
          + Add Child
        </button>
        </fieldset>
      </div>

      {/* Save (mirrored at bottom for long forms) */}
      {isEditing && (
        <div className="profile-save-row" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            className="modal-btn-secondary"
            style={{ padding: '10px 22px' }}
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="pay-btn"
            style={{ padding: '10px 22px' }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      <MembershipAutoPay currentMember={currentMember} />

      <AccountSecurity userRole={userRole} embedded />
    </div>
  )
}

function MembershipAutoPay({ currentMember }) {
  const [enabled, setEnabled] = useState(!!currentMember?.autopayEnabled)
  const [paymentMethodId, setPaymentMethodId] = useState(currentMember?.autopayPaymentMethodId || '')
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState({ kind: '', text: '' })

  useEffect(() => {
    let cancelled = false
    if (!currentMember?.id) return
    api.fetchPaymentMethods(currentMember.id)
      .then(res => {
        if (cancelled) return
        const list = res?.paymentMethods || []
        setMethods(list)
        // If autopay is enabled but the saved card no longer exists, clear it.
        if (paymentMethodId && !list.some(m => m.paymentMethodId === paymentMethodId)) {
          setPaymentMethodId('')
        }
        // If no method picked yet, default to the member's default-card.
        if (!paymentMethodId) {
          const def = list.find(m => m.isDefault) || list[0]
          if (def) setPaymentMethodId(def.paymentMethodId)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMember?.id])

  const handleSave = async () => {
    setMsg({ kind: '', text: '' })
    if (enabled && !paymentMethodId) {
      setMsg({ kind: 'error', text: 'Pick a saved card to use for auto-pay.' })
      return
    }
    setLoading(true)
    try {
      await api.setAutopay(currentMember.id, { enabled, paymentMethodId: enabled ? paymentMethodId : '' })
      setMsg({ kind: 'success', text: enabled ? 'Preferred card saved.' : 'Preferred card cleared.' })
    } catch (e) {
      setMsg({ kind: 'error', text: e.message || 'Could not update preferred card.' })
    } finally {
      setLoading(false)
    }
  }

  const planLabel = currentMember?.membershipPlan
    ? `${currentMember.membershipType ? currentMember.membershipType.charAt(0).toUpperCase() + currentMember.membershipType.slice(1) + ' ' : ''}${currentMember.membershipPlan.charAt(0).toUpperCase() + currentMember.membershipPlan.slice(1)}`
    : ''

  return (
    <div className="profile-section">
      <h2 className="profile-section-title">Membership Billing</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
        The synagogue posts a monthly membership fee on the 1st and runs payments shortly after. Pre-authorize a saved card here so we know which card to use when collecting your fee; you'll see the charge on your statement and a matching payment on your Account Balance.
      </p>

      {planLabel && (
        <p style={{ fontSize: '0.85rem', marginBottom: '12px' }}>
          <strong>Current plan:</strong> {planLabel}
        </p>
      )}

      {msg.text && (
        <div style={{
          padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '0.85rem',
          color: msg.kind === 'error' ? 'var(--danger)' : 'var(--success)',
          background: msg.kind === 'error' ? 'var(--danger-bg, #fee)' : '#f0fdf4',
        }}>{msg.text}</div>
      )}

      <div className="profile-form-grid">
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span>Pre-authorize a card for membership billing</span>
          </label>
        </div>
        <div className="form-group">
          <label htmlFor="autopay-card">Preferred card</label>
          <select
            id="autopay-card"
            value={paymentMethodId}
            onChange={(e) => setPaymentMethodId(e.target.value)}
            disabled={!enabled || methods.length === 0}
          >
            {methods.length === 0 ? (
              <option value="">No saved cards — add one in Saved Cards first</option>
            ) : (
              <>
                <option value="">Select a card...</option>
                {methods.map(m => (
                  <option key={m.paymentMethodId} value={m.paymentMethodId}>
                    {m.cardBrand || 'Card'} •••• {m.last4} (exp {m.expMonth}/{m.expYear})
                    {m.isDefault ? ' — default' : ''}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
        <div className="form-group full-width">
          <button className="pay-btn" onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Auto-Pay Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
