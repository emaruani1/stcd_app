import { useEffect, useState } from 'react'
import IFieldsCardForm from '../components/IFieldsCardForm'
import * as api from '../api'

const IFIELDS_KEY = import.meta.env.VITE_SOLA_IFIELDS_KEY || ''

const brandLogo = (brand = '') => {
  const b = brand.toLowerCase()
  if (b.includes('visa')) return '💳 Visa'
  if (b.includes('master')) return '💳 Mastercard'
  if (b.includes('amex') || b.includes('american')) return '💳 Amex'
  if (b.includes('discover')) return '💳 Discover'
  return '💳 Card'
}

export default function SavedCards({ currentMember }) {
  const memberId = currentMember?.id || currentMember?.memberId
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // One-off charge UI
  const [chargeOpen, setChargeOpen] = useState(null) // paymentMethodId
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeNote, setChargeNote] = useState('')
  const [charging, setCharging] = useState(false)

  const load = async () => {
    if (!memberId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.fetchPaymentMethods(memberId)
      setCards(res.paymentMethods || [])
    } catch (e) {
      setError(e.message || 'Could not load cards')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [memberId])

  const handleSaveTokens = async ({ xCardNum, xCVV, xExp, xName, xZip }) => {
    setSaving(true)
    setError('')
    setInfo('')
    try {
      const res = await api.savePaymentMethod({
        memberId,
        xCardNum, xCVV, xExp, xName, xZip,
        setAsDefault: cards.length === 0,
      })
      setInfo(`Card ending in ${res.last4} added.`)
      setShowAdd(false)
      await load()
    } catch (e) {
      setError(e.message || 'Could not save card')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (paymentMethodId, last4) => {
    if (!window.confirm(`Remove the card ending in ${last4}?`)) return
    setError('')
    setInfo('')
    try {
      await api.deletePaymentMethod({ memberId, paymentMethodId })
      setInfo('Card removed.')
      await load()
    } catch (e) {
      setError(e.message || 'Could not delete card')
    }
  }

  const handleCharge = async (paymentMethodId, last4) => {
    const amt = parseFloat(chargeAmount)
    if (!amt || amt <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }
    setCharging(true)
    setError('')
    setInfo('')
    try {
      const res = await api.chargeSavedCard({
        memberId,
        paymentMethodId,
        amount: amt,
        description: chargeNote || 'STCD payment',
        idempotencyKey: api.newIdempotencyKey(),
      })
      setInfo(`Charged $${amt.toFixed(2)} to •••• ${last4}. Auth: ${res.authCode || res.gatewayRefNum}`)
      setChargeOpen(null)
      setChargeAmount('')
      setChargeNote('')
    } catch (e) {
      setError(e.message || 'Charge failed')
    } finally {
      setCharging(false)
    }
  }

  if (!memberId) {
    return <div style={wrap}><p>Member context missing.</p></div>
  }

  return (
    <div style={wrap}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Saved Cards</h1>
          <p style={{ color: '#71717a', margin: '4px 0 0' }}>
            Use any saved card to pay dues, donations, or sponsorships.
          </p>
        </div>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)} style={primaryBtn}>＋ Add a card</button>
        )}
      </header>
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#065f46',
          padding: '12px 16px',
          borderRadius: 12,
          marginBottom: 24,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <strong>🔒 Your card information is fully secure.</strong> We do not store your card number, expiration date, or CVV in the synagogue&apos;s database — that data lives only inside the bank&apos;s certified payment processor (PCI-DSS Level 1). The portal only keeps a token that lets the processor recognize your card next time you choose to pay.
      </div>

      {error && <div style={alertErr}>{error}</div>}
      {info && <div style={alertOk}>{info}</div>}

      {showAdd && (
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Add a new card</h2>
            <button onClick={() => setShowAdd(false)} style={ghostBtn}>Cancel</button>
          </div>
          <IFieldsCardForm
            iFieldsKey={IFIELDS_KEY}
            softwareName="STCD-App"
            softwareVersion="1.0.0"
            onTokens={handleSaveTokens}
            onError={setError}
            submitting={saving}
            submitLabel="Save card on file"
          />
        </section>
      )}

      <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <header style={{ padding: 16, borderBottom: '1px solid #e4e4e7' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Your cards</h2>
        </header>

        {loading && <div style={{ padding: 32, textAlign: 'center', color: '#71717a' }}>Loading…</div>}
        {!loading && cards.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#71717a' }}>
            <p style={{ margin: 0 }}>No cards saved yet.</p>
            {!showAdd && (
              <button onClick={() => setShowAdd(true)} style={{ ...primaryBtn, marginTop: 16 }}>
                Add your first card
              </button>
            )}
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {cards.map((c) => (
            <li key={c.paymentMethodId} style={{ borderTop: '1px solid #f4f4f5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>
                    {brandLogo(c.cardBrand)} •••• {c.last4}
                    {c.isDefault && <span style={defaultBadge}>Default</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#71717a' }}>
                    Exp {c.expMonth}/{c.expYear}
                    {c.cardholderName ? ` · ${c.cardholderName}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setChargeOpen(c.paymentMethodId)} style={primaryBtn}>Charge</button>
                  <button onClick={() => handleDelete(c.paymentMethodId, c.last4)} style={dangerBtn}>Remove</button>
                </div>
              </div>

              {chargeOpen === c.paymentMethodId && (
                <div style={{ padding: 16, background: '#fafafa', borderTop: '1px solid #f4f4f5', display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8 }}>
                    <input
                      placeholder="Amount"
                      type="number" min="0" step="0.01"
                      value={chargeAmount}
                      onChange={(e) => setChargeAmount(e.target.value)}
                      style={inputBox}
                    />
                    <input
                      placeholder="Description (optional)"
                      value={chargeNote}
                      onChange={(e) => setChargeNote(e.target.value)}
                      style={inputBox}
                    />
                    <button
                      onClick={() => handleCharge(c.paymentMethodId, c.last4)}
                      disabled={charging}
                      style={primaryBtn}
                    >
                      {charging ? 'Charging…' : `Charge •••• ${c.last4}`}
                    </button>
                  </div>
                  <button onClick={() => { setChargeOpen(null); setChargeAmount(''); setChargeNote('') }} style={ghostBtn}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const wrap = { padding: 24, maxWidth: 880, margin: '0 auto' }
const card = { background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: 20, marginBottom: 18 }
const primaryBtn = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 600, cursor: 'pointer' }
const ghostBtn = { padding: '6px 10px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', cursor: 'pointer', fontSize: 13 }
const dangerBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontWeight: 600, cursor: 'pointer' }
const alertErr = { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 12, borderRadius: 10, marginBottom: 16 }
const alertOk = { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: 12, borderRadius: 10, marginBottom: 16 }
const defaultBadge = { marginLeft: 8, padding: '2px 8px', borderRadius: 999, background: '#eef2ff', color: '#3730a3', fontSize: 11, fontWeight: 600 }
const inputBox = { padding: '8px 12px', border: '1px solid #d4d4d8', borderRadius: 8, fontFamily: 'inherit', fontSize: 14 }
