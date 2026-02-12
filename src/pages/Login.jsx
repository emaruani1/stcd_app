import { useState } from 'react'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    // Fake login — accept anything
    onLogin()
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
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
          <button type="submit" className="login-btn">
            Sign In
          </button>
          <p className="login-hint">Demo: enter any email/password to continue</p>
        </form>
      </div>
    </div>
  )
}
