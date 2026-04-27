import { useEffect, useId, useRef, useState } from 'react'

/**
 * iFields card form — drops two Sola iframes (card number + CVV) onto the page.
 * Card data goes from the browser straight to Sola; this app never sees it.
 *
 * On submit, calls the global `getTokens(success, error, timeoutMs)` Sola exposes,
 * which fills the hidden xCardNum / xCVV inputs with single-use tokens (SUTs).
 * We then call props.onTokens({ xCardNum, xCVV, xExp, ... }) so the parent
 * can POST to /payment-methods.
 *
 * Props:
 *   iFieldsKey      — public iFields key (VITE_SOLA_IFIELDS_KEY)
 *   softwareName    — e.g. "STCD-App"
 *   softwareVersion — e.g. "1.0.0"
 *   onTokens(payload)  — called with { xCardNum, xCVV, xExp, xName, xZip }
 *   onError(msg)
 *   submitting      — boolean (parent disables UI while saving)
 */
// Latest stable per https://cdn.cardknox.com/ifields/versions.htm
const IFIELDS_VERSION = '3.4.2602.2001'
const IFIELDS_SCRIPT = `https://cdn.cardknox.com/ifields/${IFIELDS_VERSION}/ifields.min.js`
// Both card-number and CVV use the same iframe URL — the type is inferred from
// the iframe's data-ifields-id attribute by the loaded JS.
const IFIELD_FRAME = `https://cdn.cardknox.com/ifields/${IFIELDS_VERSION}/ifield.html`

let scriptPromise = null
function loadIFieldsScript() {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.setAccount && window.getTokens) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = IFIELDS_SCRIPT
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Sola iFields script'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export default function IFieldsCardForm({
  iFieldsKey,
  softwareName = 'STCD-App',
  softwareVersion = '1.0.0',
  onTokens,
  onError,
  submitting = false,
  submitLabel = 'Save Card',
}) {
  const formId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [exp, setExp] = useState('') // MMYY
  const [zip, setZip] = useState('')
  const [validity, setValidity] = useState({ cardNumberIsValid: false, cvvIsValid: false })

  const xCardRef = useRef(null)
  const xCvvRef = useRef(null)

  // Load the script + register the iFields key on mount
  useEffect(() => {
    let cancelled = false
    if (!iFieldsKey) {
      setError('iFields key is missing (set VITE_SOLA_IFIELDS_KEY).')
      return
    }
    loadIFieldsScript()
      .then(() => {
        if (cancelled) return
        try {
          window.setAccount(iFieldsKey, softwareName, softwareVersion)
          setReady(true)
        } catch (e) {
          setError('Could not initialise Sola iFields: ' + (e.message || e))
        }
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [iFieldsKey, softwareName, softwareVersion])

  // Validity callback (so we can enable/disable the button)
  useEffect(() => {
    if (!ready || typeof window.addIfieldKeyPressCallback !== 'function') return
    const handler = (data) => {
      setValidity({
        cardNumberIsValid: !!data.cardNumberIsValid,
        cvvIsValid: !!data.cvvIsValid,
      })
    }
    try { window.addIfieldKeyPressCallback(handler) } catch { /* noop */ }
  }, [ready])

  // Style the iframe inputs to match the rest of the form
  useEffect(() => {
    if (!ready || typeof window.setIfieldStyle !== 'function') return
    const style = {
      width: '100%', 'box-sizing': 'border-box',
      padding: '10px 12px',
      border: '1px solid #d4d4d8', 'border-radius': '8px',
      'font-family': 'inherit', 'font-size': '15px', color: '#18181b',
      outline: 'none', background: '#fff',
    }
    try {
      window.setIfieldStyle('card-number', style)
      window.setIfieldStyle('cvv', style)
      if (typeof window.enableAutoFormatting === 'function') {
        window.enableAutoFormatting(' ')
      }
    } catch { /* noop */ }
  }, [ready])

  const handleExpChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
    setExp(digits)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    if (!ready) {
      setError('Card form is still loading…')
      return
    }
    if (!validity.cardNumberIsValid || !validity.cvvIsValid) {
      setError('Please enter a valid card number and CVV.')
      return
    }
    if (exp.length !== 4) {
      setError('Expiration must be MMYY (e.g., 1227).')
      return
    }

    // getTokens() reads the iframes and writes SUTs into the hidden inputs
    try {
      window.getTokens(
        () => {
          const xCardNum = xCardRef.current?.value || ''
          const xCVV = xCvvRef.current?.value || ''
          if (!xCardNum) {
            setError('Could not generate a card token. Please try again.')
            return
          }
          onTokens?.({ xCardNum, xCVV, xExp: exp, xName: name, xZip: zip })
        },
        (err) => {
          const msg = (err && (err.message || err.error)) || 'Tokenization failed.'
          setError(msg)
          onError?.(msg)
        },
        30000
      )
    } catch (err) {
      setError('Could not call iFields: ' + (err.message || err))
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#52525b', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Cardholder name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name on card"
          autoComplete="cc-name"
          style={inputStyle}
        />
      </label>

      <div style={{ display: 'grid', gap: 6 }}>
        <span style={labelStyle}>Card number</span>
        <iframe
          title="Card number"
          src={IFIELD_FRAME}
          data-ifields-id="card-number"
          data-ifields-placeholder="•••• •••• •••• ••••"
          style={{ width: '100%', height: 44, border: 'none' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>Exp (MMYY)</span>
          <input
            value={exp}
            onChange={handleExpChange}
            placeholder="1227"
            inputMode="numeric"
            autoComplete="cc-exp"
            style={inputStyle}
          />
        </label>
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>CVV</span>
          <iframe
            title="CVV"
            src={IFIELD_FRAME}
            data-ifields-id="cvv"
            data-ifields-placeholder="123"
            style={{ width: '100%', height: 44, border: 'none' }}
          />
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>Billing ZIP</span>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/[^0-9-]/g, '').slice(0, 10))}
            placeholder="75201"
            inputMode="numeric"
            autoComplete="postal-code"
            style={inputStyle}
          />
        </label>
      </div>

      {/* Hidden inputs that iFields writes the SUTs into */}
      <input ref={xCardRef} type="hidden" name="xCardNum" data-ifields-id="card-number-token" />
      <input ref={xCvvRef} type="hidden" name="xCVV" data-ifields-id="cvv-token" />

      {/* Error label that iFields writes to as well as our own errors */}
      <label
        data-ifields-id="card-data-error"
        style={{ color: '#b91c1c', fontSize: 13, minHeight: 18 }}
      >
        {error}
      </label>

      <button
        type="submit"
        disabled={submitting || !ready}
        style={{
          padding: '11px 16px',
          borderRadius: 10,
          border: 'none',
          background: submitting || !ready ? '#a1a1aa' : '#1e3a8a',
          color: 'white',
          fontWeight: 600,
          cursor: submitting || !ready ? 'wait' : 'pointer',
        }}
      >
        {submitting ? 'Saving…' : submitLabel}
      </button>

      <p style={{ fontSize: 11, color: '#71717a', margin: 0 }}>
        🔒 Card details are entered directly into a secure Sola/FideliPay iframe. STCD never sees or stores your full card number.
      </p>
    </form>
  )
}

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: '#52525b',
  textTransform: 'uppercase', letterSpacing: '.05em',
}
const inputStyle = {
  padding: '10px 12px',
  border: '1px solid #d4d4d8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 15,
  outline: 'none',
}
