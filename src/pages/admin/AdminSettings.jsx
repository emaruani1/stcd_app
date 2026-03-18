import { useState } from 'react'

export default function AdminSettings({
  pledgeTypes, setPledgeTypes,
  occasions, setOccasions,
  paymentMethods, setPaymentMethods,
  products, setProducts,
  kiddushPricing, setKiddushPricing,
  seudaPricing, setSeudaPricing,
}) {
  const [activeTab, setActiveTab] = useState('pledgeTypes')
  const [toast, setToast] = useState('')

  // Pledge type form
  const [editingPledgeType, setEditingPledgeType] = useState(null)
  const [ptLabel, setPtLabel] = useState('')
  const [ptOccasions, setPtOccasions] = useState([])

  // Occasion form
  const [editingOccasion, setEditingOccasion] = useState(null)
  const [occLabel, setOccLabel] = useState('')

  // Payment method form
  const [editingMethod, setEditingMethod] = useState(null)
  const [methodLabel, setMethodLabel] = useState('')

  // Product form
  const [editingProduct, setEditingProduct] = useState(null)
  const [prodName, setProdName] = useState('')
  const [prodPrice, setProdPrice] = useState('')

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const tabs = [
    { key: 'pledgeTypes', label: 'Pledge Types' },
    { key: 'occasions', label: 'Occasions' },
    { key: 'paymentMethods', label: 'Payment Methods' },
    { key: 'products', label: 'Products' },
    { key: 'sponsorship', label: 'Sponsorship Pricing' },
  ]

  // ===== PLEDGE TYPES =====
  const startAddPledgeType = () => {
    setEditingPledgeType('new')
    setPtLabel('')
    setPtOccasions(occasions.map(o => o.label))
  }

  const startEditPledgeType = (pt) => {
    setEditingPledgeType(pt.id)
    setPtLabel(pt.label)
    setPtOccasions([...pt.occasions])
  }

  const savePledgeType = () => {
    if (!ptLabel.trim()) return
    if (editingPledgeType === 'new') {
      const newPt = {
        id: ptLabel.trim().toLowerCase().replace(/\s+/g, '_'),
        label: ptLabel.trim(),
        occasions: ptOccasions,
      }
      setPledgeTypes(prev => [...prev, newPt])
      showToast('Pledge type added')
    } else {
      setPledgeTypes(prev => prev.map(pt =>
        pt.id === editingPledgeType ? { ...pt, label: ptLabel.trim(), occasions: ptOccasions } : pt
      ))
      showToast('Pledge type updated')
    }
    setEditingPledgeType(null)
  }

  const deletePledgeType = (id) => {
    if (!confirm('Delete this pledge type?')) return
    setPledgeTypes(prev => prev.filter(pt => pt.id !== id))
    showToast('Pledge type deleted')
  }

  const togglePtOccasion = (occLabel) => {
    setPtOccasions(prev =>
      prev.includes(occLabel) ? prev.filter(o => o !== occLabel) : [...prev, occLabel]
    )
  }

  const selectAllOccasions = () => setPtOccasions(occasions.map(o => o.label))
  const clearAllOccasions = () => setPtOccasions([])

  // ===== OCCASIONS =====
  const startAddOccasion = () => {
    setEditingOccasion('new')
    setOccLabel('')
  }

  const startEditOccasion = (occ) => {
    setEditingOccasion(occ.id)
    setOccLabel(occ.label)
  }

  const saveOccasion = () => {
    if (!occLabel.trim()) return
    if (editingOccasion === 'new') {
      const newOcc = {
        id: occLabel.trim().toLowerCase().replace(/\s+/g, '_'),
        label: occLabel.trim(),
      }
      setOccasions(prev => [...prev, newOcc])
      showToast('Occasion added')
    } else {
      const oldLabel = occasions.find(o => o.id === editingOccasion)?.label
      setOccasions(prev => prev.map(o =>
        o.id === editingOccasion ? { ...o, label: occLabel.trim() } : o
      ))
      // Update pledge types that reference the old label
      if (oldLabel && oldLabel !== occLabel.trim()) {
        setPledgeTypes(prev => prev.map(pt => ({
          ...pt,
          occasions: pt.occasions.map(o => o === oldLabel ? occLabel.trim() : o),
        })))
      }
      showToast('Occasion updated')
    }
    setEditingOccasion(null)
  }

  const deleteOccasion = (id) => {
    const occ = occasions.find(o => o.id === id)
    if (!occ) return
    if (!confirm(`Delete "${occ.label}"? It will be removed from all pledge types.`)) return
    setOccasions(prev => prev.filter(o => o.id !== id))
    setPledgeTypes(prev => prev.map(pt => ({
      ...pt,
      occasions: pt.occasions.filter(o => o !== occ.label),
    })))
    showToast('Occasion deleted')
  }

  // ===== PAYMENT METHODS =====
  const startAddMethod = () => {
    setEditingMethod('new')
    setMethodLabel('')
  }

  const startEditMethod = (m) => {
    setEditingMethod(m.id)
    setMethodLabel(m.label)
  }

  const saveMethod = () => {
    if (!methodLabel.trim()) return
    if (editingMethod === 'new') {
      const newM = {
        id: methodLabel.trim().toLowerCase().replace(/\s+/g, '_'),
        label: methodLabel.trim(),
      }
      setPaymentMethods(prev => [...prev, newM])
      showToast('Payment method added')
    } else {
      setPaymentMethods(prev => prev.map(m =>
        m.id === editingMethod ? { ...m, label: methodLabel.trim() } : m
      ))
      showToast('Payment method updated')
    }
    setEditingMethod(null)
  }

  const deleteMethod = (id) => {
    if (!confirm('Delete this payment method?')) return
    setPaymentMethods(prev => prev.filter(m => m.id !== id))
    showToast('Payment method deleted')
  }

  // ===== PRODUCTS =====
  const startAddProduct = () => {
    setEditingProduct('new')
    setProdName('')
    setProdPrice('')
  }

  const startEditProduct = (p) => {
    setEditingProduct(p.id)
    setProdName(p.name)
    setProdPrice(String(p.price))
  }

  const saveProduct = () => {
    if (!prodName.trim() || !prodPrice) return
    if (editingProduct === 'new') {
      const newP = {
        id: prodName.trim().toLowerCase().replace(/\s+/g, '_'),
        name: prodName.trim(),
        price: parseFloat(prodPrice),
      }
      setProducts(prev => [...prev, newP])
      showToast('Product added')
    } else {
      setProducts(prev => prev.map(p =>
        p.id === editingProduct ? { ...p, name: prodName.trim(), price: parseFloat(prodPrice) } : p
      ))
      showToast('Product updated')
    }
    setEditingProduct(null)
  }

  const deleteProduct = (id) => {
    if (!confirm('Delete this product?')) return
    setProducts(prev => prev.filter(p => p.id !== id))
    showToast('Product deleted')
  }

  // ===== SPONSORSHIP PRICING =====
  const updateKiddushPrice = (id, price) => {
    setKiddushPricing(prev => prev.map(k =>
      k.id === id ? { ...k, price: parseFloat(price) || 0 } : k
    ))
  }

  const updateSeudaPrice = (id, price) => {
    setSeudaPricing(prev => prev.map(s =>
      s.id === id ? { ...s, price: parseFloat(price) || 0 } : s
    ))
  }

  return (
    <div className="dashboard-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage pledge types, occasions, payment methods, products, and pricing</p>
        </div>
      </div>

      {toast && <div className="success-toast">{toast}</div>}

      <div className="filter-bar">
        <div className="filter-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`filter-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== PLEDGE TYPES TAB ===== */}
      {activeTab === 'pledgeTypes' && (
        <div className="dashboard-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Pledge Types</h2>
            <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={startAddPledgeType}>
              + Add Pledge Type
            </button>
          </div>

          {editingPledgeType !== null && (
            <div className="settings-edit-form" style={{ background: 'var(--bg-warm)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
              <div className="form-group">
                <label>Label</label>
                <input type="text" value={ptLabel} onChange={e => setPtLabel(e.target.value)} placeholder="e.g. Aliyah 8" />
              </div>
              <div className="form-group">
                <label>
                  Associated Occasions
                  <span style={{ marginLeft: '1rem', fontSize: '0.8rem' }}>
                    <button type="button" className="action-btn action-btn-pay" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={selectAllOccasions}>All</button>
                    {' '}
                    <button type="button" className="action-btn action-btn-cancel" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={clearAllOccasions}>None</button>
                  </span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {occasions.map(o => (
                    <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ptOccasions.includes(o.label)}
                        onChange={() => togglePtOccasion(o.label)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={savePledgeType}>Save</button>
                <button className="modal-btn-secondary" onClick={() => setEditingPledgeType(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Occasions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pledgeTypes.map(pt => (
                  <tr key={pt.id}>
                    <td><strong>{pt.label}</strong></td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {pt.occasions.length === occasions.length
                        ? <span className="badge badge-active">All Occasions</span>
                        : pt.occasions.join(', ') || <span style={{ color: 'var(--text-muted)' }}>None</span>
                      }
                    </td>
                    <td>
                      <div className="action-btns">
                        <button className="action-btn action-btn-pay" onClick={() => startEditPledgeType(pt)}>Edit</button>
                        <button className="action-btn action-btn-delete" onClick={() => deletePledgeType(pt.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== OCCASIONS TAB ===== */}
      {activeTab === 'occasions' && (
        <div className="dashboard-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Occasions</h2>
            <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={startAddOccasion}>
              + Add Occasion
            </button>
          </div>

          {editingOccasion !== null && (
            <div style={{ background: 'var(--bg-warm)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
              <div className="form-group">
                <label>Label</label>
                <input type="text" value={occLabel} onChange={e => setOccLabel(e.target.value)} placeholder="e.g. Shavuot" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={saveOccasion}>Save</button>
                <button className="modal-btn-secondary" onClick={() => setEditingOccasion(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Used by Pledge Types</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {occasions.map(o => {
                  const usedBy = pledgeTypes.filter(pt => pt.occasions.includes(o.label))
                  return (
                    <tr key={o.id}>
                      <td><strong>{o.label}</strong></td>
                      <td style={{ fontSize: '0.82rem' }}>{usedBy.length} pledge type{usedBy.length !== 1 ? 's' : ''}</td>
                      <td>
                        <div className="action-btns">
                          <button className="action-btn action-btn-pay" onClick={() => startEditOccasion(o)}>Edit</button>
                          <button className="action-btn action-btn-delete" onClick={() => deleteOccasion(o.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== PAYMENT METHODS TAB ===== */}
      {activeTab === 'paymentMethods' && (
        <div className="dashboard-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Payment Methods</h2>
            <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={startAddMethod}>
              + Add Payment Method
            </button>
          </div>

          {editingMethod !== null && (
            <div style={{ background: 'var(--bg-warm)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
              <div className="form-group">
                <label>Label</label>
                <input type="text" value={methodLabel} onChange={e => setMethodLabel(e.target.value)} placeholder="e.g. Wire Transfer" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={saveMethod}>Save</button>
                <button className="modal-btn-secondary" onClick={() => setEditingMethod(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paymentMethods.map(m => (
                  <tr key={m.id}>
                    <td><strong>{m.label}</strong></td>
                    <td>
                      <div className="action-btns">
                        <button className="action-btn action-btn-pay" onClick={() => startEditMethod(m)}>Edit</button>
                        <button className="action-btn action-btn-delete" onClick={() => deleteMethod(m.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== PRODUCTS TAB ===== */}
      {activeTab === 'products' && (
        <div className="dashboard-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Products</h2>
            <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={startAddProduct}>
              + Add Product
            </button>
          </div>

          {editingProduct !== null && (
            <div style={{ background: 'var(--bg-warm)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
              <div className="form-row">
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={prodName} onChange={e => setProdName(e.target.value)} placeholder="e.g. Tallit" />
                </div>
                <div className="form-group">
                  <label>Price ($)</label>
                  <input type="number" min="0" step="0.01" value={prodPrice} onChange={e => setProdPrice(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="pay-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={saveProduct}>Save</button>
                <button className="modal-btn-secondary" onClick={() => setEditingProduct(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="pledges-table-wrap">
            <table className="pledges-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td className="amount-cell">${p.price.toLocaleString()}</td>
                    <td>
                      <div className="action-btns">
                        <button className="action-btn action-btn-pay" onClick={() => startEditProduct(p)}>Edit</button>
                        <button className="action-btn action-btn-delete" onClick={() => deleteProduct(p.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== SPONSORSHIP PRICING TAB ===== */}
      {activeTab === 'sponsorship' && (
        <div className="dashboard-section">
          <h2 className="section-title">Kiddush Pricing</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {kiddushPricing.map(k => (
              <div key={k.id} style={{ background: 'var(--bg-warm)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>{k.label}</h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem 0' }}>{k.description}</p>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={k.price}
                    onChange={e => updateKiddushPrice(k.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <h2 className="section-title">Seuda Shelishit Pricing</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
            {seudaPricing.map(s => (
              <div key={s.id} style={{ background: 'var(--bg-warm)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>{s.label}</h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem 0' }}>{s.description}</p>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={s.price}
                    onChange={e => updateSeudaPrice(s.id, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
