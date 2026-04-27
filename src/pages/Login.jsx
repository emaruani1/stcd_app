import { useState } from 'react'
import { login, forgotPassword, confirmNewPassword } from '../auth'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot password flow
  const [mode, setMode] = useState('login') // 'login', 'forgot', 'confirm'
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const session = await login(email, password)
      onLogin(session)
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    if (!email) { setError('Please enter your email address'); return }
    setError('')
    setLoading(true)
    try {
      await forgotPassword(email)
      setSuccess('A verification code has been sent to your email.')
      setMode('confirm')
    } catch (err) {
      setError(err.message || 'Failed to send reset code')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmReset = async (e) => {
    e.preventDefault()
    if (newPassword !== confirmPwd) { setError('Passwords do not match'); return }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return }
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
      setError(err.message || 'Failed to reset password')
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
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
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

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="login-form">
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Enter your email address and we'll send you a verification code to reset your password.
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
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repeat your password"
                required
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
