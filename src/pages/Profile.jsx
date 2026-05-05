import { useState, useEffect } from 'react'
import AccountSecurity from './AccountSecurity'

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

export default function Profile({ currentMember, profileData, setProfileData, userRole }) {
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [form, setForm] = useState(() => profileData || {
    firstName: currentMember.firstName,
    lastName: currentMember.lastName,
    gender: currentMember.gender || '',
    email: currentMember.email,
    phone: currentMember.phone,
    address: '',
    city: '',
    state: '',
    zip: '',
    dob: '',
    dobIsHebrew: false,
    dobHebrew: { day: '', month: '', year: '' },
    marriageDate: '',
    marriageDateIsHebrew: false,
    marriageDateHebrew: { day: '', month: '', year: '' },
    spouseName: '',
    spouseGender: '',
    yahrzeits: [],
    children: [],
  })

  useEffect(() => {
    if (profileData) setForm(profileData)
  }, [profileData])

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

  const handleSave = () => {
    setProfileData(form)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
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
          <p className="page-subtitle">Manage your personal information</p>
        </div>
      </div>

      {saveSuccess && (
        <div className="success-toast">Profile saved successfully!</div>
      )}

      {/* Personal Info */}
      <div className="profile-section">
        <h2 className="profile-section-title">Personal Information</h2>
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
      </div>

      {/* Address */}
      <div className="profile-section">
        <h2 className="profile-section-title">Address</h2>
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
      </div>

      {/* Parents Yahrzeit */}
      <div className="profile-section">
        <h2 className="profile-section-title">Parents Yahrzeit Dates</h2>
        <p className="donation-desc" style={{ marginBottom: '16px' }}>
          Record yahrzeit dates for departed parents or loved ones.
        </p>
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
      </div>

      {/* Children */}
      <div className="profile-section">
        <h2 className="profile-section-title">Children&apos;s Birthdays</h2>
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
      </div>

      {/* Save */}
      <div className="profile-save-row">
        <button className="pay-btn" onClick={handleSave}>
          Save Profile
        </button>
      </div>

      <AccountSecurity userRole={userRole} embedded />
    </div>
  )
}
