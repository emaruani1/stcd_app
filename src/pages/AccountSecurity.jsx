import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { changePassword, setupMfa, verifyMfa, disableMfa, getMfaStatus } from '../auth'

const PASSWORD_RULES = [
  { test: (p) => p.length >= 8,   label: 'At least 8 characters' },
  { test: (p) => /[A-Z]/.test(p), label: 'One uppercase letter' },
  { test: (p) => /[a-z]/.test(p), label: 'One lowercase letter' },
  { test: (p) => /[0-9]/.test(p), label: 'One number' },
]
const passwordMeetsPolicy = (p) => PASSWORD_RULES.every((r) => r.test(p))

function PasswordRules({ value }) {
  return (
    <ul style={{
      listStyle: 'none', padding: 0, margin: '6px 0 0',
      fontSize: '0.78rem', display: 'grid',
      gridTemplateColumns: '1fr 1fr', gap: '2px 12px',
    }}>
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value)
        return (
          <li key={rule.label} style={{ color: ok ? 'var(--success)' : 'var(--text-muted)' }}>
            {ok ? '✓' : '○'} {rule.label}
          </li>
        )
      })}
    </ul>
  )
}

function PasswordField({ value, onChange, placeholder, autoComplete, id }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{ paddingRight: '52px', width: '100%' }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', right: '8px', top: '50%',
          transform: 'translateY(-50%)', background: 'none', border: 'none',
          color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px 8px',
        }}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

/**
 * Renders the change-password form and TOTP MFA enrollment cards.
 * `embedded` mode skips the page-level title row so it can be used inline
 * inside the Profile page.
 */
export default function AccountSecurity({ userRole, embedded = false }) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdMsg, setPwdMsg] = useState({ kind: '', text: '' })
  const [pwdLoading, setPwdLoading] = useState(false)

  const [mfaStatus, setMfaStatus] = useState('LOADING')
  const [mfaSetup, setMfaSetup] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaMsg, setMfaMsg] = useState({ kind: '', text: '' })
  const [mfaLoading, setMfaLoading] = useState(false)

  useEffect(() => {
    getMfaStatus()
      .then(setMfaStatus)
      .catch(() => setMfaStatus('NONE'))
  }, [])

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPwdMsg({ kind: '', text: '' })
    if (newPwd !== confirmPwd) {
      setPwdMsg({ kind: 'error', text: 'New passwords do not match.' })
      return
    }
    if (!passwordMeetsPolicy(newPwd)) {
      setPwdMsg({ kind: 'error', text: 'New password does not meet the requirements.' })
      return
    }
    setPwdLoading(true)
    try {
      await changePassword(oldPwd, newPwd)
      setPwdMsg({ kind: 'success', text: 'Password updated successfully.' })
      setOldPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch (err) {
      const code = err?.code || err?.name || ''
      if (code === 'NotAuthorizedException') {
        setPwdMsg({ kind: 'error', text: 'Current password is incorrect.' })
      } else if (code === 'InvalidPasswordException') {
        setPwdMsg({ kind: 'error', text: err.message || 'New password does not meet requirements.' })
      } else if (code === 'LimitExceededException') {
        setPwdMsg({ kind: 'error', text: 'Too many attempts. Please try again later.' })
      } else {
        setPwdMsg({ kind: 'error', text: 'Could not change password. Please try again.' })
      }
    } finally {
      setPwdLoading(false)
    }
  }

  const beginMfaSetup = async () => {
    setMfaMsg({ kind: '', text: '' })
    setMfaLoading(true)
    try {
      const setup = await setupMfa()
      setMfaSetup(setup)
    } catch {
      setMfaMsg({ kind: 'error', text: 'Could not start MFA setup. Please try again.' })
    } finally {
      setMfaLoading(false)
    }
  }

  const handleVerifyMfa = async (e) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(mfaCode)) {
      setMfaMsg({ kind: 'error', text: 'Enter the 6-digit code from your app.' })
      return
    }
    setMfaLoading(true)
    setMfaMsg({ kind: '', text: '' })
    try {
      await verifyMfa(mfaCode)
      setMfaStatus('TOTP')
      setMfaSetup(null)
      setMfaCode('')
      setMfaMsg({ kind: 'success', text: 'Two-factor authentication is now enabled.' })
    } catch (err) {
      const code = err?.code || err?.name || ''
      if (code === 'EnableSoftwareTokenMFAException' || code === 'CodeMismatchException') {
        setMfaMsg({ kind: 'error', text: 'That code is incorrect. Try the next one from your app.' })
      } else {
        setMfaMsg({ kind: 'error', text: 'Could not verify code. Please try again.' })
      }
    } finally {
      setMfaLoading(false)
    }
  }

  const handleDisableMfa = async () => {
    if (!window.confirm('Turn off two-factor authentication? This makes your account less secure.')) return
    setMfaLoading(true)
    setMfaMsg({ kind: '', text: '' })
    try {
      await disableMfa()
      setMfaStatus('NONE')
      setMfaMsg({ kind: 'success', text: 'Two-factor authentication has been disabled.' })
    } catch {
      setMfaMsg({ kind: 'error', text: 'Could not disable MFA. Please try again.' })
    } finally {
      setMfaLoading(false)
    }
  }

  const cancelMfaSetup = () => {
    setMfaSetup(null)
    setMfaCode('')
    setMfaMsg({ kind: '', text: '' })
  }

  const sections = (
    <>
      {userRole === 'admin' && mfaStatus === 'NONE' && (
        <div className="profile-section" style={{ borderLeft: '4px solid var(--danger)' }}>
          <h2 className="profile-section-title" style={{ color: 'var(--danger)' }}>
            Two-factor authentication recommended
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Your account has admin access. Please enable two-factor authentication below to protect member data.
          </p>
        </div>
      )}

      <div className="profile-section">
        <h2 className="profile-section-title">Change Password</h2>
        {pwdMsg.text && (
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '0.85rem',
            color: pwdMsg.kind === 'error' ? 'var(--danger)' : 'var(--success)',
            background: pwdMsg.kind === 'error' ? 'var(--danger-bg, #fee)' : '#f0fdf4',
          }}>{pwdMsg.text}</div>
        )}
        <form onSubmit={handleChangePassword} className="profile-form-grid">
          <div className="form-group">
            <label htmlFor="cp-old">Current Password</label>
            <PasswordField
              id="cp-old"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              placeholder="Enter current password"
              autoComplete="current-password"
            />
          </div>
          <div className="form-group">
            <label htmlFor="cp-new">New Password</label>
            <PasswordField
              id="cp-new"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="Choose a new password"
              autoComplete="new-password"
            />
            <PasswordRules value={newPwd} />
          </div>
          <div className="form-group">
            <label htmlFor="cp-confirm">Confirm New Password</label>
            <PasswordField
              id="cp-confirm"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="Repeat new password"
              autoComplete="new-password"
            />
          </div>
          <div className="form-group full-width">
            <button type="submit" className="pay-btn" disabled={pwdLoading || !oldPwd || !newPwd || !confirmPwd}>
              {pwdLoading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

      <div className="profile-section">
        <h2 className="profile-section-title">Two-Factor Authentication</h2>
        {mfaMsg.text && (
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '0.85rem',
            color: mfaMsg.kind === 'error' ? 'var(--danger)' : 'var(--success)',
            background: mfaMsg.kind === 'error' ? 'var(--danger-bg, #fee)' : '#f0fdf4',
          }}>{mfaMsg.text}</div>
        )}

        {mfaStatus === 'LOADING' && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading...</p>
        )}

        {mfaStatus === 'TOTP' && (
          <div>
            <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '50px', background: '#f0fdf4', color: 'var(--success)', fontSize: '0.8rem', fontWeight: 600 }}>
                Enabled
              </span>
              <span style={{ marginLeft: '12px', color: 'var(--text-muted)' }}>
                You&apos;ll be asked for a code from your authenticator app on each sign-in.
              </span>
            </p>
            <button
              className="pay-btn"
              onClick={handleDisableMfa}
              disabled={mfaLoading}
              style={{ background: 'var(--danger)', color: '#fff' }}
            >
              {mfaLoading ? 'Disabling...' : 'Disable Two-Factor Authentication'}
            </button>
          </div>
        )}

        {mfaStatus === 'NONE' && !mfaSetup && (
          <div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Add an extra layer of security by requiring a code from an authenticator app (Google Authenticator, Authy, 1Password, etc.) when you sign in.
            </p>
            <button
              className="pay-btn"
              onClick={beginMfaSetup}
              disabled={mfaLoading}
            >
              {mfaLoading ? 'Loading...' : 'Enable Two-Factor Authentication'}
            </button>
          </div>
        )}

        {mfaStatus === 'NONE' && mfaSetup && (
          <div>
            <ol style={{ fontSize: '0.9rem', paddingLeft: '20px', marginBottom: '16px' }}>
              <li>Open your authenticator app (Google Authenticator, Authy, 1Password, etc.).</li>
              <li>Scan this QR code, or enter the secret manually.</li>
              <li>Type the 6-digit code your app shows below.</li>
            </ol>
            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div style={{ background: '#fff', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <QRCodeSVG value={mfaSetup.otpauthUri} size={180} />
              </div>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Manual entry secret</label>
                <code style={{
                  display: 'block', padding: '10px', background: 'var(--bg-warm)',
                  borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', wordBreak: 'break-all',
                  marginTop: '4px',
                }}>
                  {mfaSetup.secret}
                </code>
              </div>
            </div>
            <form onSubmit={handleVerifyMfa} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '1 1 200px', minWidth: '200px' }}>
                <label htmlFor="setup-mfa">Verification Code</label>
                <input
                  id="setup-mfa"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                />
              </div>
              <button type="submit" className="pay-btn" disabled={mfaLoading || mfaCode.length !== 6}>
                {mfaLoading ? 'Verifying...' : 'Verify & Enable'}
              </button>
              <button type="button" className="add-item-btn" onClick={cancelMfaSetup} disabled={mfaLoading}>
                Cancel
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  )

  if (embedded) return sections

  return (
    <div className="profile-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Account Security</h1>
          <p className="page-subtitle">Manage your password and two-factor authentication</p>
        </div>
      </div>
      {sections}
    </div>
  )
}
