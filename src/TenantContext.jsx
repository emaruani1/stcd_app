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

// Derive a logo URL from the tenant record. The backend returns a 1-hour
// presigned S3 GET URL in `tenant.logoUrl` whenever a logo has been
// uploaded; falls back to the bundled default. A future CloudFront + OAC
// migration would replace `tenant.logoUrl` with a stable CDN URL; this
// helper's contract stays the same.
export function logoUrlFromTenant(tenant) {
  return tenant?.logoUrl || '/stcd_logo.png'
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
  // Favicon — point at the tenant's logo so the browser tab shows the right
  // crest. Falls back to whatever logoUrlFromTenant returns, which today is
  // the bundled stcd_logo.png; once the CloudFront pipeline is wired this
  // automatically picks up per-tenant logos uploaded to S3.
  const favicon = document.getElementById('favicon')
  if (favicon) {
    favicon.href = logoUrlFromTenant(tenant)
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
