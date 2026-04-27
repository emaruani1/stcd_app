import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import IFieldsCardForm from './IFieldsCardForm'
import * as api from '../api'

const IFIELDS_KEY = import.meta.env.VITE_SOLA_IFIELDS_KEY || ''

const brandLogo = (brand = '') => {
  const b = brand.toLowerCase()
  if (b.includes('visa')) return 'Visa'
  if (b.includes('master')) return 'Mastercard'
  if (b.includes('amex') || b.includes('american')) return 'Amex'
  if (b.includes('discover')) return 'Discover'
  return 'Card'
}

/**
 * PaymentChooser
 *
 * Renders saved cards (radio-pickable) plus an "Add a different card" option that
 * uses iFields to capture a fresh PAN. The parent calls `chooserRef.current.charge({...})`
 * to actually run the charge through the backend (/charge endpoint).
 *
 * Props:
 *   memberId         — required, used to load saved cards & to charge against
 *   currentBalance   — optional, used to disable card UI when paying entirely from balance
 *   amount           — total amount that will be charged (display only here)
 *
 * Imperative API (via ref):
 *   chooser.charge({ amount, paymentType, description, invoice, source, category,
 *                    pledgeId, productId, alias, groupId, skipRecord })
 *     -> resolves: {
 *           success, gatewayRefNum, authCode, last4, cardBrand, transactionId,
 *           savedPaymentMethodId, paymentMethodId (used)
 *        }
 *     -> rejects with Error on decline/error.
 */
const PaymentChooser = forwardRef(function PaymentChooser(
  { memberId, amount = 0 },
  ref
) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('') // '' = use new card
  const [saveForFuture, setSaveForFuture] = useState(true)
  const [error, setError] = useState('')
  const newCardTokensRef = useRef(null) // holds last { xCardNum, xCVV, xExp, xName, xZip }

  // Load saved cards
  useEffect(() => {
    let cancelled = false
    if (!memberId) {
      setLoading(false)
      return
    }
    setLoading(true)
    api.fetchPaymentMethods(memberId)
      .then((res) => {
        if (cancelled) return
        const list = res.paymentMethods || []
        setCards(list)
        // Auto-select the default card (or first), if any
        const def = list.find((c) => c.isDefault) || list[0]
        if (def) setSelectedId(def.paymentMethodId)
      })
      .catch((e) => !cancelled && setError(e.message || 'Could not load saved cards'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [memberId])

  // iFields gives us tokens via onTokens; we just stash them for charge time.
  const handleNewCardTokens = (payload) => {
    newCardTokensRef.current = payload
  }

  // Force the iFields form to tokenize, then resolve with the token payload.
  const tokenizeNewCard = () => {
    return new Promise((resolve, reject) => {
      const form = document.getElementById('payment-chooser-new-card-form')
      if (!form) return reject(new Error('Card form is not visible — switch to "Use a different card".'))
      newCardTokensRef.current = null
      // The IFieldsCardForm component listens for native submit and calls onTokens(payload)
      // We submit the form, then poll briefly for the tokens to land.
      form.requestSubmit()
      let tries = 0
      const tick = setInterval(() => {
        tries++
        if (newCardTokensRef.current) {
          clearInterval(tick)
          resolve(newCardTokensRef.current)
        } else if (tries > 60) { // ~30s
          clearInterval(tick)
          reject(new Error('Card tokenization timed out. Please re-enter the card.'))
        }
      }, 500)
    })
  }

  // ---------- imperative charge() ----------
  useImperativeHandle(ref, () => ({
    /**
     * Run the charge. Returns the /charge response on success, throws on decline/error.
     * Callers pass the amount + any metadata to record on the transaction.
     */
    async charge({
      amount: chargeAmount,
      paymentType, description, invoice,
      source, category, pledgeId, productId, alias, groupId,
      skipRecord = false,
      requireCvvForSaved = false,  // future-proof
    }) {
      setError('')
      if (!memberId) throw new Error('Missing memberId')
      if (!chargeAmount || chargeAmount <= 0) throw new Error('Amount must be greater than zero')

      const meta = { paymentType, description, invoice, source, category, pledgeId, productId, alias, groupId }
      const cleanMeta = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== ''))

      let body
      if (selectedId) {
        // Saved-card mode (Mode A in the backend)
        body = {
          memberId,
          paymentMethodId: selectedId,
          amount: chargeAmount,
          skipRecord,
          ...cleanMeta,
        }
      } else {
        // New-card mode (Mode B). Tokenize first, then charge.
        let tokens
        try {
          tokens = await tokenizeNewCard()
        } catch (e) {
          setError(e.message)
          throw e
        }
        body = {
          memberId,
          xCardNum: tokens.xCardNum,
          xCVV: tokens.xCVV,
          xExp: tokens.xExp,
          xName: tokens.xName,
          xZip: tokens.xZip,
          amount: chargeAmount,
          saveOnSuccess: saveForFuture,
          skipRecord,
          ...cleanMeta,
        }
      }

      let res
      try {
        res = await api.chargeSavedCard(body)
      } catch (e) {
        setError(e.message || 'Charge failed')
        throw e
      }

      if (!res?.success) {
        const msg = res?.error || 'Charge declined'
        setError(msg)
        throw new Error(msg)
      }

      // If a new card was just saved, reload the list so the picker shows it.
      if (res.savedPaymentMethodId) {
        try {
          const fresh = await api.fetchPaymentMethods(memberId)
          setCards(fresh.paymentMethods || [])
          setSelectedId(res.savedPaymentMethodId)
        } catch { /* noop */ }
      }
      return { ...res, paymentMethodId: selectedId || res.savedPaymentMethodId || null }
    },
  }), [memberId, selectedId, saveForFuture])

  return (
    <div style={wrap}>
      <div style={{ marginBottom: 10, color: '#52525b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
        Pay with
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading && <div style={{ color: '#71717a', fontSize: 13 }}>Loading saved cards…</div>}

      {!loading && cards.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {cards.map((c) => (
            <label key={c.paymentMethodId} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid',
              borderColor: selectedId === c.paymentMethodId ? '#1e3a8a' : '#e5e7eb',
              borderRadius: 10,
              background: selectedId === c.paymentMethodId ? '#eff6ff' : '#fff',
              cursor: 'pointer',
            }}>
              <input
                type="radio"
                name="payment-chooser-card"
                checked={selectedId === c.paymentMethodId}
                onChange={() => setSelectedId(c.paymentMethodId)}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: '#18181b' }}>
                  {brandLogo(c.cardBrand)} •••• {c.last4}
                  {c.isDefault && (
                    <span style={defaultPill}>Default</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#71717a' }}>
                  Exp {c.expMonth}/{c.expYear}{c.cardholderName ? ` · ${c.cardholderName}` : ''}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        border: '1px solid',
        borderColor: !selectedId ? '#1e3a8a' : '#e5e7eb',
        borderRadius: 10,
        background: !selectedId ? '#eff6ff' : '#fff',
        cursor: 'pointer',
        marginBottom: !selectedId ? 12 : 0,
      }}>
        <input
          type="radio"
          name="payment-chooser-card"
          checked={!selectedId}
          onChange={() => setSelectedId('')}
        />
        <div>
          <div style={{ fontWeight: 600, color: '#18181b' }}>＋ Use a different card</div>
          <div style={{ fontSize: 12, color: '#71717a' }}>One-time, or save it for next time.</div>
        </div>
      </label>

      {!selectedId && (
        <div style={{ marginTop: 8, padding: 14, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa' }}>
          <div id="payment-chooser-new-card-form-wrap">
            {/* The form id allows requestSubmit() from the imperative charge() */}
            <form
              id="payment-chooser-new-card-form"
              onSubmit={(e) => e.preventDefault()}
              style={{ display: 'contents' }}
            >
              <IFieldsCardForm
                iFieldsKey={IFIELDS_KEY}
                softwareName="STCD-App"
                softwareVersion="1.0.0"
                onTokens={handleNewCardTokens}
                onError={setError}
                submitting={false}
                submitLabel="Tokenize card"
              />
            </form>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: '#3f3f46' }}>
            <input
              type="checkbox"
              checked={saveForFuture}
              onChange={(e) => setSaveForFuture(e.target.checked)}
            />
            Save this card for future payments
          </label>
        </div>
      )}

      {amount > 0 && (
        <div style={{ marginTop: 14, padding: 12, background: '#f4f4f5', borderRadius: 10, fontSize: 13, color: '#3f3f46' }}>
          Charging <strong>${Number(amount).toFixed(2)}</strong> to{' '}
          {selectedId
            ? (() => {
              const c = cards.find((x) => x.paymentMethodId === selectedId)
              return c ? `${brandLogo(c.cardBrand)} •••• ${c.last4}` : 'selected card'
            })()
            : 'a new card'}
        </div>
      )}
    </div>
  )
})

const wrap = { padding: 0 }
const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 13 }
const defaultPill = { marginLeft: 8, padding: '1px 8px', borderRadius: 999, background: '#eef2ff', color: '#3730a3', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }

export default PaymentChooser
