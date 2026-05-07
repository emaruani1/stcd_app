import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { withRunningBalance, neutralReason, paymentTypeLabel, formatAttribution } from '../ledger'

export default function AccountStatements({
  allMembers,
  adminTransactions,
  getTransactionsForMember,
  isAdmin,
  currentMemberId,
}) {
  const params = useParams()
  const memberId = isAdmin ? Number(params.memberId) : currentMemberId

  const member = allMembers.find(m => m.id === memberId)

  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  const [startDate, setStartDate] = useState(startOfMonth)
  const [endDate, setEndDate] = useState(todayStr)
  const ALL_TYPE_FILTERS = [
    'pledge-charge', 'pledge', 'membership-fee', 'membership-payment',
    'sponsorship-fee', 'sponsorship-payment', 'purchase-fee', 'purchase-payment',
    'charge', 'payment', 'donation', 'deposit',
  ]
  const [typeFilters, setTypeFilters] = useState(ALL_TYPE_FILTERS)
  const [aliasFilter, setAliasFilter] = useState('all')
  const [preset, setPreset] = useState('mtd')

  const memberAliases = member?.aliases || []

  const allTransactions = useMemo(() => {
    if (!memberId) return []
    return getTransactionsForMember(memberId)
  }, [memberId, allMembers, adminTransactions])

  const applyPreset = (key) => {
    setPreset(key)
    const now = new Date()
    if (key === 'mtd') {
      setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0])
      setEndDate(now.toISOString().split('T')[0])
      setTypeFilters(ALL_TYPE_FILTERS)
    } else if (key === 'ytd') {
      setStartDate(new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0])
      setEndDate(now.toISOString().split('T')[0])
      setTypeFilters(ALL_TYPE_FILTERS)
    } else if (key === 'eoy') {
      const year = now.getFullYear() - 1
      setStartDate(`${year}-01-01`)
      setEndDate(`${year}-12-31`)
      setTypeFilters(['donation'])
    } else if (key === 'payments') {
      setStartDate('')
      setEndDate('')
      setTypeFilters(ALL_TYPE_FILTERS)
    }
  }


  // Annotate ALL transactions with running balance first (so the running balance
  // reflects the member's full history), then filter for display.
  const annotatedAll = useMemo(
    () => withRunningBalance(allTransactions),
    [allTransactions],
  )

  const filtered = useMemo(() => {
    return annotatedAll.filter(t => {
      if (typeFilters.length && !typeFilters.includes(t.paymentType)) return false
      if (startDate) {
        const td = new Date(t.date + 'T00:00:00')
        if (td < new Date(startDate + 'T00:00:00')) return false
      }
      if (endDate) {
        const td = new Date(t.date + 'T00:00:00')
        if (td > new Date(endDate + 'T23:59:59')) return false
      }
      if (aliasFilter !== 'all') {
        if (aliasFilter === '__primary__') { if (t.alias) return false }
        else { if (t.alias !== aliasFilter) return false }
      }
      return true
    })
  }, [annotatedAll, typeFilters, aliasFilter, startDate, endDate])

  const totals = useMemo(() => {
    const t = { charges: 0, payments: 0, neutral: 0, total: 0 }
    filtered.forEach(txn => {
      const amt = Number(txn.amount) || 0
      if (txn.balanceImpact === 'charge') t.charges += amt
      else if (txn.balanceImpact === 'payment') t.payments += amt
      else t.neutral += amt
      t.total += amt
    })
    return t
  }, [filtered])

  const accountBalance = member?.accountBalance ?? 0
  const accountCredit = member?.accountCredit ?? member?.balance ?? 0

  // Pledge summary: total pledged vs paid
  const pledgeSummary = useMemo(() => {
    if (!member) return { totalPledged: 0, totalPaid: 0 }
    const pledges = member.pledges.filter(p => p.category === 'pledge' && !p.canceled)
    return {
      totalPledged: pledges.reduce((s, p) => s + p.amount, 0),
      totalPaid: pledges.reduce((s, p) => s + p.paidAmount, 0),
    }
  }, [member])

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const paymentTypeBadge = (type) => {
    const root = type?.split('-')[0]
    const cls = {
      membership: 'badge-membership',
      pledge: 'badge-pledge',
      donation: 'badge-donation',
      purchase: 'badge-purchase',
      sponsorship: 'badge-purchase',
      charge: 'badge-pending',
      payment: 'badge-paid',
      deposit: 'badge-membership',
    }[root] || 'badge-pending'
    return <span className={`badge ${cls}`}>{paymentTypeLabel(type)}</span>
  }

  // Helpers used by both CSV + PDF exports.
  const csvCell = (v) => {
    const s = (v ?? '').toString()
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const signedAmount = (t) => {
    const sign = t.balanceImpact === 'charge' ? -1 : t.balanceImpact === 'payment' ? 1 : 0
    if (sign === 0) return Number(t.amount).toFixed(2)
    return (sign * Number(t.amount)).toFixed(2)
  }
  const runningBalanceCell = (t) =>
    t.balanceImpact === 'neutral' ? '' : Number(t.runningBalance).toFixed(2)

  const downloadCSV = () => {
    const hasAliases = memberAliases.length > 0
    const headers = [
      'Date', 'Description',
      ...(hasAliases ? ['Paying As'] : []),
      'Type', 'Amount', 'Running Balance', 'Method', 'Gateway Ref', 'Auth Code', 'Logged By', 'Logged At',
    ]
    const rows = filtered.map(t => [
      t.date,
      csvCell(t.description),
      ...(hasAliases ? [csvCell(t.alias || `${member.firstName} ${member.lastName}`)] : []),
      csvCell(paymentTypeLabel(t.paymentType)),
      signedAmount(t),
      runningBalanceCell(t),
      csvCell(t.method || ''),
      csvCell(t.gatewayRefNum || ''),
      csvCell(t.gatewayAuthCode || ''),
      csvCell(t.createdByName || t.createdBy || ''),
      csvCell(t.createdAt || ''),
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement_${member?.firstName || 'member'}_${startDate || 'all'}_${endDate || 'present'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadPDF = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Pop-ups are blocked. Please allow pop-ups for this site to download the PDF.')
      return
    }
    const memberName = member ? `${member.firstName} ${member.lastName}` : 'Member'
    const escapeHTML = (s) => (s ?? '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    const fmtMoney = (n) => {
      const v = Number(n) || 0
      return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    const colCount = memberAliases.length > 0 ? 7 : 6
    const periodLabel = `${startDate ? formatDate(startDate) : 'All time'} – ${endDate ? formatDate(endDate) : 'Present'}`

    const rowsHtml = filtered.map(t => {
      const sign = t.balanceImpact === 'charge' ? '-' : t.balanceImpact === 'payment' ? '+' : ''
      const amtClass = t.balanceImpact === 'charge' ? 'neg' : t.balanceImpact === 'payment' ? 'pos' : ''
      const runningHtml = t.balanceImpact === 'neutral'
        ? '—'
        : (Number(t.runningBalance) < 0
            ? `-$${Math.abs(Number(t.runningBalance)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `$${Number(t.runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      const runningClass = t.balanceImpact === 'neutral' ? 'muted' : (Number(t.runningBalance) < 0 ? 'neg' : 'pos')
      return `<tr>
        <td>${formatDate(t.date)}</td>
        <td>${escapeHTML(t.description)}</td>
        ${memberAliases.length > 0 ? `<td>${escapeHTML(t.alias || `${member.firstName} ${member.lastName}`)}</td>` : ''}
        <td>${escapeHTML(paymentTypeLabel(t.paymentType))}</td>
        <td class="amount ${amtClass}">${sign}${fmtMoney(t.amount).replace('-', '')}</td>
        <td class="amount ${runningClass}">${runningHtml}</td>
        <td>${escapeHTML(t.method || '')}</td>
      </tr>`
    }).join('')

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Account Statement - ${escapeHTML(memberName)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #2d3748; }
          h1 { font-size: 18px; margin: 0 0 4px; color: #1a365d; }
          h2 { font-size: 13px; color: #5a6577; margin: 0 0 16px; font-weight: 500; }
          .summary { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
          .summary-item { background: #f5f0e8; padding: 8px 14px; border-radius: 8px; border-left: 3px solid #c6973f; min-width: 140px; }
          .summary-item .label { font-size: 11px; color: #5a6577; text-transform: uppercase; letter-spacing: 0.5px; }
          .summary-item strong { display: block; font-size: 16px; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #ddd; font-size: 11px; }
          th { background: #1a365d; color: #fff; font-weight: 600; }
          .amount { text-align: right; font-variant-numeric: tabular-nums; }
          .pos { color: #2f855a; font-weight: 600; }
          .neg { color: #c53030; font-weight: 600; }
          .muted { color: #8896a8; }
          .footer { margin-top: 20px; font-size: 10px; color: #8896a8; border-top: 1px solid #ddd; padding-top: 10px; }
          @media print { body { padding: 0; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <h1>Sephardic Torah Center of Dallas</h1>
        <h2>Account Statement — ${escapeHTML(memberName)}</h2>
        <p style="font-size: 12px; color: #5a6577; margin: 0 0 12px;">Period: ${escapeHTML(periodLabel)}</p>
        <div class="summary">
          <div class="summary-item">
            <div class="label">Account Balance</div>
            <strong style="color: ${accountBalance < 0 ? '#c53030' : '#2f855a'}">${fmtMoney(accountBalance)}</strong>
          </div>
          <div class="summary-item">
            <div class="label">Account Credit</div>
            <strong>${fmtMoney(accountCredit)}</strong>
          </div>
          <div class="summary-item">
            <div class="label">Period Charges</div>
            <strong class="neg">-${fmtMoney(totals.charges)}</strong>
          </div>
          <div class="summary-item">
            <div class="label">Period Payments</div>
            <strong class="pos">+${fmtMoney(totals.payments)}</strong>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              ${memberAliases.length > 0 ? '<th>Paying As</th>' : ''}
              <th>Type</th>
              <th class="amount">Amount</th>
              <th class="amount">Running Balance</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="${colCount}" style="text-align:center;color:#8896a8;padding:20px;">No transactions in this period</td></tr>`}
          </tbody>
        </table>
        <div class="footer">Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      </body>
      </html>
    `
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.print()
  }

  if (!member) {
    return (
      <div className="dashboard-page">
        <div className="page-title-row">
          <h1 className="page-title">Account Statements</h1>
        </div>
        <div className="dashboard-section" style={{ textAlign: 'center', padding: '3rem' }}>
          <p>No member selected.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Account Statement</h1>
          <p className="page-subtitle">{member.firstName} {member.lastName} ({member.memberId})</p>
        </div>
      </div>

      {/* Presets */}
      <div className="filter-bar">
        <div className="filter-tabs">
          {[
            { key: 'mtd', label: 'Month to Date' },
            { key: 'ytd', label: 'Year to Date' },
            { key: 'eoy', label: 'End of Year Report' },
            { key: 'payments', label: 'All Payments' },
            { key: 'custom', label: 'Custom' },
          ].map(p => (
            <button
              key={p.key}
              className={`filter-tab ${preset === p.key ? 'active' : ''}`}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date range + type filters */}
      <div className="dashboard-section" style={{ padding: '1rem' }}>
        <div className="form-row" style={{ marginBottom: '1rem' }}>
          <div className="form-group">
            <label>From</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPreset('custom') }} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPreset('custom') }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Show:</span>
          {[
            { types: ['pledge-charge', 'pledge'], label: 'Pledges' },
            { types: ['membership-fee', 'membership-payment'], label: 'Membership' },
            { types: ['sponsorship-fee', 'sponsorship-payment'], label: 'Sponsorships' },
            { types: ['purchase-fee', 'purchase-payment'], label: 'Purchases' },
            { types: ['donation'], label: 'Donations' },
            { types: ['deposit'], label: 'Account Deposits' },
            { types: ['charge', 'payment'], label: 'Other' },
          ].map(group => {
            const allOn = group.types.every(t => typeFilters.includes(t))
            return (
              <label key={group.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => {
                    setTypeFilters(prev => allOn
                      ? prev.filter(t => !group.types.includes(t))
                      : [...new Set([...prev, ...group.types])]
                    )
                    setPreset('custom')
                  }}
                />
                {group.label}
              </label>
            )
          })}
        </div>
        {memberAliases.length > 0 && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.75rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Paying As:</span>
            <select
              value={aliasFilter}
              onChange={e => setAliasFilter(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: '0.85rem' }}
            >
              <option value="all">All</option>
              <option value="__primary__">{member.firstName} {member.lastName} (Primary)</option>
              {memberAliases.map((a, i) => (
                <option key={i} value={a}>{a}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="summary-cards" style={{ marginBottom: '1.5rem' }}>
        <div className="summary-card">
          <div
            className="summary-card-icon"
            style={{
              background: accountBalance < 0 ? '#e53e3e22' : '#38a16922',
              color: accountBalance < 0 ? 'var(--danger)' : 'var(--success)',
            }}
          >
            B
          </div>
          <div className="summary-card-info">
            <p className="summary-card-label">Account Balance</p>
            <p className="summary-card-value" style={{ color: accountBalance < 0 ? 'var(--danger)' : 'inherit' }}>
              {accountBalance < 0 ? '-' : ''}${Math.abs(accountBalance).toLocaleString()}
            </p>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {accountBalance < 0 ? 'Owes the synagogue' : accountBalance > 0 ? 'Credit toward future charges' : 'Account is current'}
            </p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon balance-icon">$</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Account Credit</p>
            <p className="summary-card-value">${accountCredit.toLocaleString()}</p>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Available prepaid funds</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#c6973f22', color: 'var(--accent)' }}>P</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Pledges</p>
            <p className="summary-card-value">${pledgeSummary.totalPledged.toLocaleString()}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>${pledgeSummary.totalPaid.toLocaleString()} paid</p>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-icon" style={{ background: '#38a16922', color: 'var(--success)' }}>D</div>
          <div className="summary-card-info">
            <p className="summary-card-label">Donations (filtered)</p>
            <p className="summary-card-value">${totals.neutral.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Download buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <button className="pay-btn" style={{ padding: '8px 20px', fontSize: '0.85rem' }} onClick={downloadCSV}>
          Download CSV
        </button>
        <button className="modal-btn-secondary" style={{ padding: '8px 20px' }} onClick={downloadPDF}>
          Download PDF
        </button>
      </div>

      {/* Transactions Table */}
      <div className="dashboard-section">
        <div className="pledges-table-wrap">
          <table className="pledges-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                {memberAliases.length > 0 && <th>Paying As</th>}
                <th>Type</th>
                <th>Amount</th>
                <th>Running Balance</th>
                <th>Method</th>
                <th>Gateway Ref</th>
                <th>Auth</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={memberAliases.length > 0 ? 9 : 8} className="empty-row">No transactions found for this period</td></tr>
              ) : (
                filtered.map((t, idx) => {
                  const impact = t.balanceImpact
                  const isNeutral = impact === 'neutral'
                  const noteText = isNeutral ? neutralReason(t.paymentType) : ''
                  const signedAmount = impact === 'charge' ? `-$${t.amount.toLocaleString()}` :
                                       impact === 'payment' ? `+$${t.amount.toLocaleString()}` :
                                       `$${t.amount.toLocaleString()}`
                  const amountColor = impact === 'charge' ? 'var(--danger)' :
                                      impact === 'payment' ? 'var(--success)' :
                                      'var(--text)'
                  const runningSigned = t.runningBalance < 0
                    ? `-$${Math.abs(t.runningBalance).toLocaleString()}`
                    : `$${t.runningBalance.toLocaleString()}`
                  return (
                    <tr key={t.id || idx}>
                      <td>{formatDate(t.date)}</td>
                      <td>
                        {t.description}
                        {noteText && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '2px' }}>
                            {noteText}
                          </div>
                        )}
                        {(() => {
                          const attr = formatAttribution(t)
                          return attr ? (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              Logged {attr}
                            </div>
                          ) : null
                        })()}
                      </td>
                      {memberAliases.length > 0 && (
                        <td style={{ fontSize: '0.82rem' }}>{t.alias || `${member.firstName} ${member.lastName}`}</td>
                      )}
                      <td>{paymentTypeBadge(t.paymentType)}</td>
                      <td className="amount-cell" style={{ color: amountColor, fontWeight: 600 }}>{signedAmount}</td>
                      <td className="amount-cell" style={{ color: t.runningBalance < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {isNeutral ? '—' : runningSigned}
                      </td>
                      <td>{t.method}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {t.gatewayRefNum || '—'}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {t.gatewayAuthCode || '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
