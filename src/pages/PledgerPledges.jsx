import { useState } from 'react'
import * as api from '../api'
import MemberSearchSelect from '../components/MemberSearchSelect'

/** Returns YYYY-MM-DD for the most recent Saturday (today if it is Saturday). */
function previousOrCurrentSaturday(d = new Date()) {
  const day = d.getDay() // 0=Sun ... 6=Sat
  const offset = day === 6 ? 0 : day + 1
  const result = new Date(d)
  result.setDate(d.getDate() - offset)
  return result.toISOString().split('T')[0]
}

const blankRow = () => ({
  memberId: '',
  pledgeType: '',
  occasion: '',
  amount: '',
  date: previousOrCurrentSaturday(),
})

export default function PledgerPledges({ allMembers, pledgeTypes, occasions }) {
  const [rows, setRows] = useState([blankRow()])
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState({ kind: '', text: '' })
  const [perRowError, setPerRowError] = useState({}) // { idx: 'reason' }

  const updateRow = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, [field]: value }
      // When pledge type changes, reset occasion if not allowed for the new type.
      if (field === 'pledgeType') {
        const pt = pledgeTypes.find(p => p.id === value)
        if (pt && next.occasion && !pt.occasions.includes(next.occasion)) {
          next.occasion = ''
        }
      }
      return next
    }))
    // Clear any stale validation note for this row on edit.
    setPerRowError(prev => {
      if (!prev[idx]) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  const addRow = () => {
    // New rows inherit the date from the last row if it was set, otherwise default.
    const lastDate = rows[rows.length - 1]?.date || previousOrCurrentSaturday()
    setRows(prev => [...prev, { ...blankRow(), date: lastDate }])
  }

  const removeRow = (idx) => {
    setRows(prev => prev.length === 1 ? [blankRow()] : prev.filter((_, i) => i !== idx))
  }

  const validate = () => {
    const errs = {}
    rows.forEach((r, i) => {
      if (!r.memberId) errs[i] = 'Pick a member'
      else if (!r.pledgeType) errs[i] = 'Pick a pledge type'
      else if (!r.occasion) errs[i] = 'Pick an occasion'
      else if (!r.amount || Number(r.amount) <= 0) errs[i] = 'Enter an amount > 0'
      else if (!r.date) errs[i] = 'Pick a date'
    })
    setPerRowError(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmitClick = () => {
    if (!validate()) {
      setToast({ kind: 'error', text: 'Fix the highlighted rows before submitting.' })
      return
    }
    setShowConfirm(true)
  }

  const handleConfirm = async () => {
    setSubmitting(true)
    setToast({ kind: '', text: '' })
    let successCount = 0
    const failures = []
    for (const r of rows) {
      const pt = pledgeTypes.find(p => p.id === r.pledgeType)
      const description = pt ? `${pt.label} — ${r.occasion}` : r.occasion
      try {
        await api.createPledge({
          memberId: String(r.memberId),
          description,
          pledgeType: r.pledgeType,
          occasion: r.occasion,
          amount: Number(r.amount),
          date: r.date,
          category: 'pledge',
        })
        successCount++
      } catch (e) {
        failures.push({ row: r, message: e?.message || 'Failed' })
      }
    }
    setSubmitting(false)
    setShowConfirm(false)
    if (failures.length === 0) {
      setRows([blankRow()])
      setToast({ kind: 'success', text: `${successCount} pledge${successCount !== 1 ? 's' : ''} submitted.` })
    } else {
      setToast({
        kind: 'error',
        text: `${successCount} submitted, ${failures.length} failed: ${failures.map(f => f.message).join('; ')}`,
      })
    }
  }

  const occasionsForType = (typeId) => {
    const pt = pledgeTypes.find(p => p.id === typeId)
    if (!pt) return []
    return occasions.filter(o => pt.occasions.includes(o.label))
  }

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const memberLabel = (id) => {
    const m = allMembers.find(mm => String(mm.id) === String(id))
    return m ? `${m.firstName} ${m.lastName}` : '—'
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Pledges</h1>
          <p className="page-subtitle">Log this week&apos;s pledges. Once submitted they cannot be edited.</p>
        </div>
      </div>

      {toast.text && (
        <div
          className={toast.kind === 'success' ? 'success-toast' : ''}
          style={toast.kind === 'error' ? {
            padding: '12px 16px', borderRadius: 'var(--radius-sm)',
            background: 'var(--danger-bg, #fee)', color: 'var(--danger)',
            marginBottom: '1rem', fontSize: '0.9rem',
          } : undefined}
        >
          {toast.text}
        </div>
      )}

      <div className="dashboard-section">
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th style={{ minWidth: '240px' }}>Member</th>
                <th>Pledge Type</th>
                <th>Occasion</th>
                <th style={{ minWidth: '110px' }}>Amount</th>
                <th>Date</th>
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const err = perRowError[idx]
                const occList = occasionsForType(r.pledgeType)
                return (
                  <tr key={idx} style={err ? { background: 'var(--danger-bg, #fee)' } : undefined}>
                    <td>
                      <MemberSearchSelect
                        allMembers={allMembers}
                        value={r.memberId}
                        onChange={(v) => updateRow(idx, 'memberId', v)}
                        placeholder="Search member..."
                      />
                    </td>
                    <td>
                      <select
                        value={r.pledgeType}
                        onChange={e => updateRow(idx, 'pledgeType', e.target.value)}
                      >
                        <option value="">— Type —</option>
                        {pledgeTypes.map(pt => (
                          <option key={pt.id} value={pt.id}>{pt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={r.occasion}
                        onChange={e => updateRow(idx, 'occasion', e.target.value)}
                        disabled={!r.pledgeType}
                      >
                        <option value="">{r.pledgeType ? '— Occasion —' : 'Pick a type first'}</option>
                        {occList.map(o => (
                          <option key={o.id} value={o.label}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.amount}
                        onChange={e => updateRow(idx, 'amount', e.target.value)}
                        placeholder="0.00"
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={r.date}
                        onChange={e => updateRow(idx, 'date', e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        className="remove-item-btn"
                        onClick={() => removeRow(idx)}
                        title="Remove row"
                        type="button"
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button className="add-item-btn" onClick={addRow} type="button">
            + Add another pledge
          </button>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {rows.length} row{rows.length !== 1 ? 's' : ''} · Total ${totalAmount.toLocaleString()}
            </span>
            <button
              className="pay-btn"
              onClick={handleSubmitClick}
              disabled={submitting}
              style={{ padding: '10px 24px' }}
            >
              {submitting ? 'Submitting…' : `Submit ${rows.length} Pledge${rows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="modal-overlay" onClick={() => !submitting && setShowConfirm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <h2 className="modal-title">Submit pledges?</h2>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>
                You&apos;re about to submit <strong>{rows.length}</strong> pledge{rows.length !== 1 ? 's' : ''} totaling <strong>${totalAmount.toLocaleString()}</strong>.
              </p>
              <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>
                Once submitted you cannot make changes. Are you sure?
              </p>
              <div style={{ background: 'var(--bg-warm)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.82rem', maxHeight: '200px', overflowY: 'auto' }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none', padding: '4px 0' }}>
                    <strong>{memberLabel(r.memberId)}</strong> · {pledgeTypes.find(p => p.id === r.pledgeType)?.label || r.pledgeType} · {r.occasion} · ${Number(r.amount).toLocaleString()} · {r.date}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button
                  className="modal-btn-secondary"
                  onClick={() => setShowConfirm(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  className="pay-btn"
                  onClick={handleConfirm}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Yes, Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
