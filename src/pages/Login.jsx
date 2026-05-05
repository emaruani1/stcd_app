import { useState } from 'react'
import { login, forgotPassword, confirmNewPassword } from '../auth'

const PASSWORD_RULES = [
  { test: (p) => p.length >= 8,        label: 'At least 8 characters' },
  { test: (p) => /[A-Z]/.test(p),      label: 'One uppercase letter' },
  { test: (p) => /[a-z]/.test(p),      label: 'One lowercase letter' },
  { test: (p) => /[0-9]/.test(p),      label: 'One number' },
]

const passwordMeetsPolicy = (p) => PASSWORD_RULES.every((r) => r.test(p))

function PasswordInput({ id, value, onChange, placeholder, autoComplete, required = true, minLength }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        style={{ paddingRight: '52px', width: '100%' }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.8rem',
          padding: '4px 8px',
        }}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function PasswordRules({ value }) {
  return (
    <ul style={{
      listStyle: 'none',
      padding: 0,
      margin: '6px 0 0',
      fontSize: '0.78rem',
      color: 'var(--text-muted)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2px 12px',
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

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  // 'login' | 'newPassword' | 'mfa' | 'forgot' | 'confirm'
  const [mode, setMode] = useState('login')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [mfaCode, setMfaCode] = useState('')

  // Pending challenge handle (returned by login() when not a direct session)
  const [pendingChallenge, setPendingChallenge] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result.kind === 'session') {
        onLogin(result.session)
      } else if (result.kind === 'newPassword') {
        setPendingChallenge(result)
        setMode('newPassword')
        setSuccess('Set a permanent password for your account.')
      } else if (result.kind === 'mfa') {
        setPendingChallenge(result)
        setMode('mfa')
      }
    } catch (err) {
      const code = err?.code || err?.name || ''
      if (code === 'PasswordResetRequiredException') {
        setError('Your password needs to be reset. Click "Forgot your password?" below.')
      } else if (code === 'InvalidPasswordException') {
        setError(err.message || 'Password does not meet requirements.')
      } else {
        setError('Email or password is incorrect.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleNewPasswordSubmit = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPwd) { setError('Passwords do not match'); return }
    if (!passwordMeetsPolicy(newPassword)) {
      setError('Password does not meet the requirements below.')
      return
    }
    if (!pendingChallenge?.complete) {
      setError('Session expired. Please sign in again.')
      setMode('login')
      return
    }
    setError('')
    setLoading(true)
    try {
      const session = await pendingChallenge.complete(newPassword)
      onLogin(session)
    } catch (err) {
      const code = err?.code || err?.name || ''
      if (code === 'InvalidPasswordException') {
        setError(err.message || 'Password does not meet requirements.')
      } else {
        setError('Could not set new password. Please try signing in again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleMfaSubmit = async (e) => {
    e.preventDefault()
    if (!pendingChallenge?.verify) {
      setError('Session expired. Please sign in again.')
      setMode('login')
      return
    }
    setError('')
    setLoading(true)
    try {
      const session = await pendingChallenge.verify(mfaCode.trim())
      onLogin(session)
    } catch (err) {
      const code = err?.code || err?.name || ''
      if (code === 'CodeMismatchException' || code === 'EnableSoftwareTokenMFAException') {
        setError('That code is incorrect. Please try again.')
      } else if (code === 'ExpiredCodeException') {
        setError('That code has expired. Try the next one from your app.')
      } else {
        setError('Unable to verify code. Please try again.')
      }
      setMfaCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    if (!email) { setError('Please enter your email address'); return }
    setError('')
    setLoading(true)
    try { await forgotPassword(email) } catch { /* never leak existence */ }
    setSuccess('If this email is linked to an account, you will receive a verification code shortly. Enter it below to set a new password.')
    setMode('confirm')
    setLoading(false)
  }

  const handleConfirmReset = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPwd) { setError('Passwords do not match'); return }
    if (!passwordMeetsPolicy(newPassword)) {
      setError('Password does not meet the requirements below.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await confirmNewPassword(email, resetCode, newPassword)
      setSuccess('Password reset successfully! You can now sign in.')
      setMode('login')
      setPassword('')
      setResetCode('')
      setNewPassword('')
      setConfirmPwd('')
    } catch (err) {
      const code = err?.code || err?.name || ''
      if (code === 'CodeMismatchException' || code === 'ExpiredCodeException') {
        setError('That code is invalid or has expired. Please try again.')
      } else if (code === 'InvalidPasswordException') {
        setError(err.message || 'Password does not meet requirements.')
      } else {
        setError('Unable to reset password. Please check your code and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const goBack = () => {
    setMode('login')
    setError('')
    setSuccess('')
    setResetCode('')
    setNewPassword('')
    setConfirmPwd('')
    setMfaCode('')
    setPendingChallenge(null)
  }

  return (
    <div className="login-page">
      <div className="login-bg-pattern"></div>
      <div className="login-card">
        <div className="login-header">
          <img src="/stcd_logo.png" alt="STCD Logo" className="login-logo" />
          <h1>Sephardic Torah Center</h1>
          <p className="login-subtitle">of Dallas</p>
          <p className="login-desc">Member Portal</p>
        </div>

        {error && <div style={{ color: 'var(--danger)', background: 'var(--danger-bg, #fee)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '0.85rem' }}>{error}</div>}
        {success && <div style={{ color: 'var(--success)', background: '#f0fdf4', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '12px', fontSize: '0.85rem' }}>{success}</div>}

        {mode === 'login' && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setSuccess('') }}
                placeholder="your@email.com"
                autoComplete="username"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}
              style={{
                background: 'none', border: 'none', color: 'var(--primary)',
                cursor: 'pointer', fontSize: '0.85rem', marginTop: '12px',
                textDecoration: 'underline', padding: 0, width: '100%', textAlign: 'center',
              }}
            >
              Forgot your password?
            </button>
          </form>
        )}

        {mode === 'newPassword' && (
          <form onSubmit={handleNewPasswordSubmit} className="login-form">
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Welcome! Choose a permanent password to finish setting up your account.
            </p>
            <div className="form-group">
              <label htmlFor="np-new">New Password</label>
              <PasswordInput
                id="np-new"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Choose a password"
                autoComplete="new-password"
                minLength={8}
              />
              <PasswordRules value={newPassword} />
            </div>
            <div className="form-group">
              <label htmlFor="np-confirm">Confirm Password</label>
              <PasswordInput
                id="np-confirm"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Setting password...' : 'Set Password & Sign In'}
            </button>
            <button
              type="button"
              onClick={goBack}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.85rem', marginTop: '12px',
                textDecoration: 'underline', padding: 0, width: '100%', textAlign: 'center',
              }}
            >
              Back to Sign In
            </button>
          </form>
        )}

        {mode === 'mfa' && (
          <form onSubmit={handleMfaSubmit} className="login-form">
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Enter the 6-digit code from your authenticator app.
            </p>
            <div className="form-group">
              <label htmlFor="mfa-code">Authentication Code</label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                required
                autoFocus
                autoComplete="one-time-code"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading || mfaCode.length !== 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={goBack}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.85rem', marginTop: '12px',
                textDecoration: 'underline', padding: 0, width: '100%', textAlign: 'center',
              }}
            >
              Back to Sign In
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="login-form">
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Enter your email address. If it&apos;s linked to an account, you&apos;ll receive a verification code you can paste below to set a new password.
            </p>
            <div className="form-group">
              <label htmlFor="reset-email">Email Address</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Code'}
            </button>
            <button
              type="button"
              onClick={goBack}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.85rem', marginTop: '12px',
                textDecoration: 'underline', padding: 0, width: '100%', textAlign: 'center',
              }}
            >
              Back to Sign In
            </button>
          </form>
        )}

        {mode === 'confirm' && (
          <form onSubmit={handleConfirmReset} className="login-form">
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Enter the verification code sent to <strong>{email}</strong> and choose a new password.
            </p>
            <div className="form-group">
              <label htmlFor="code">Verification Code</label>
              <input
                id="code"
                type="text"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="Enter 6-digit code"
                required
                autoComplete="one-time-code"
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <PasswordInput
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Choose a password"
                autoComplete="new-password"
                minLength={8}
              />
              <PasswordRules value={newPassword} />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Password</label>
              <PasswordInput
                id="confirm-password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
            <button
              type="button"
              onClick={goBack}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.85rem', marginTop: '12px',
                textDecoration: 'underline', padding: 0, width: '100%', textAlign: 'center',
              }}
            >
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
