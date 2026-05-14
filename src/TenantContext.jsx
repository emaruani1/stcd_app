import { createContext, useCallback, useContext, useState } from 'react'
import * as api from './api'

// Fallback record so first-render components don't crash before the fetch
// resolves. Values mirror the STCD defaults from `stcd_tenants`. Once the
// real tenant row loads we replace this entirely.
const FALLBACK_TENANT = {
  tenantId: '',
  displayName: 'Member Portal',
  legalName: '',
  primaryColor: '#1a365d',
  secondaryColor: '#2a4a7f',
  accentColor: '#c6973f',
  logoS3Key: '',
  fromEmail: '',
  replyToEmail: '',
  emailFooterSignature: '',
  taxId: '',
  address: '',
  timezone: 'America/Chicago',
  currency: 'USD',
  status: 'active',
}

const TenantContext = createContext({
  tenant: FALLBACK_TENANT,
  refreshTenant: () => Promise.resolve(),
  setTenantLocal: () => {},
})

// Derive a logo URL from the tenant record. Falls back to the bundled
// default if the tenant hasn't uploaded one yet. Once we put the
// stcd-saas-tenant-assets bucket behind CloudFront (Phase 4 followup),
// swap this to construct the CDN URL from logoS3Key.
export function logoUrlFromTenant(tenant) {
  if (!tenant) return '/stcd_logo.png'
  // TODO Phase 4 followup: return `${CDN}/${tenant.logoS3Key}` once OAC is wired.
  return '/stcd_logo.png'
}

function applyBranding(tenant) {
  if (!tenant) return
  const root = document.documentElement
  if (tenant.primaryColor)  root.style.setProperty('--primary',   tenant.primaryColor)
  if (tenant.secondaryColor) root.style.setProperty('--secondary', tenant.secondaryColor)
  if (tenant.accentColor)   root.style.setProperty('--accent',    tenant.accentColor)
  if (tenant.displayName) {
    document.title = `${tenant.displayName} Member Portal`
  }
}

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(FALLBACK_TENANT)

  const refreshTenant = useCallback(async () => {
    try {
      const t = await api.fetchTenant()
      if (t && t.tenantId) {
        setTenant(t)
        applyBranding(t)
      }
    } catch (e) {
      // Likely 401 pre-login — silently keep the fallback so the Login
      // page still renders with the bundled defaults. App.jsx calls
      // refreshTenant() after successful auth to pull the real values.
      if (e && !/401|403/.test(String(e.message))) {
        console.error('Failed to load tenant:', e)
      }
    }
  }, [])

  return (
    <TenantContext.Provider value={{ tenant, refreshTenant, setTenantLocal: setTenant }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}
