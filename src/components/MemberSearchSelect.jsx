import { useState, useRef, useEffect } from 'react'

export default function MemberSearchSelect({ allMembers, value, onChange, placeholder = 'Search by name, email, or alias...' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const selected = allMembers.find(m => String(m.id) === String(value))

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.trim()
    ? allMembers.filter(m => {
        const q = query.toLowerCase()
        const aliasStr = (m.aliases || []).join(' ').toLowerCase()
        return `${m.firstName} ${m.lastName}`.toLowerCase().includes(q)
          || (m.email || '').toLowerCase().includes(q)
          || aliasStr.includes(q)
      })
    : allMembers.slice().sort((a, b) => {
        const nameA = `${a.lastName} ${a.firstName}`.toLowerCase()
        const nameB = `${b.lastName} ${b.firstName}`.toLowerCase()
        return nameA < nameB ? -1 : nameA > nameB ? 1 : 0
      })

  const handleSelect = (m) => {
    onChange(String(m.id))
    setQuery('')
    setOpen(false)
  }

  const handleClear = () => {
    onChange('')
    setQuery('')
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {selected && !open ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg)', cursor: 'pointer', fontSize: '0.9rem',
          }}
          onClick={() => setOpen(true)}
        >
          <span><strong>{selected.firstName} {selected.lastName}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{selected.email}</span></span>
          <button type="button" onClick={(e) => { e.stopPropagation(); handleClear() }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)', padding: '0 4px' }}>&times;</button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          style={{ width: '100%' }}
        />
      )}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          maxHeight: '220px', overflowY: 'auto',
          background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No members found</div>
          ) : (
            filtered.slice(0, 50).map(m => (
              <div
                key={m.id}
                onClick={() => handleSelect(m)}
                style={{
                  padding: '8px 14px', cursor: 'pointer', fontSize: '0.88rem',
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f5f5f5)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <strong>{m.firstName} {m.lastName}</strong>
                {m.email && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.82rem' }}>{m.email}</span>}
                {(m.aliases || []).length > 0 && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.78rem' }}>
                    (aka {m.aliases.join(', ')})
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
