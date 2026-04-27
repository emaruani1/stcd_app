import { getCurrentSession } from './auth'

const API_BASE = import.meta.env.VITE_API_URL

async function getAuthToken() {
  const session = await getCurrentSession()
  return session?.token || ''
}

async function request(path, options = {}) {
  const token = await getAuthToken()
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API error ${res.status}`)
  }
  return res.json()
}

// ===== MEMBERS =====
export const fetchMembers = () => request('/members')
export const fetchMember = (id) => request(`/members/${id}`)
export const createMember = (data) => request('/members', { method: 'POST', body: JSON.stringify(data) })
export const updateMember = (id, data) => request(`/members/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const mergeMembers = (data) => request('/members/merge', { method: 'POST', body: JSON.stringify(data) })

// ===== TRANSACTIONS =====
export const fetchAllTransactions = () => request('/transactions')
export const fetchMemberTransactions = (memberId) => request(`/transactions/member/${memberId}`)
export const createTransaction = (data) => request('/transactions', { method: 'POST', body: JSON.stringify(data) })
export const updateTransaction = (data) => request('/transactions', { method: 'PUT', body: JSON.stringify(data) })
export const deleteTransaction = (data) => request('/transactions', { method: 'DELETE', body: JSON.stringify(data) })

// ===== PLEDGES =====
export const fetchAllPledges = () => request('/pledges')
export const fetchMemberPledges = (memberId) => request(`/pledges/member/${memberId}`)
export const createPledge = (data) => request('/pledges', { method: 'POST', body: JSON.stringify(data) })
export const updatePledge = (data) => request('/pledges', { method: 'PUT', body: JSON.stringify(data) })
export const payPledge = (data) => request('/pledges/pay', { method: 'POST', body: JSON.stringify(data) })
export const deletePledge = (data) => request('/pledges', { method: 'DELETE', body: JSON.stringify(data) })

// ===== SETTINGS =====
export const fetchSettings = () => request('/settings')
export const updateSetting = (key, items) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ items }) })

// ===== SPONSORSHIPS =====
export const fetchSponsorships = () => request('/sponsorships')
export const updateSponsorship = (dateKey, data) => request(`/sponsorships/${dateKey}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteSponsorship = (dateKey, data) => request(`/sponsorships/${dateKey}`, { method: 'DELETE', body: JSON.stringify(data) })

// ===== EMAILS =====
export const fetchEmails = () => request('/emails')
export const createEmail = (data) => request('/emails', { method: 'POST', body: JSON.stringify(data) })

// ===== PAYMENT METHODS (Sola / FideliPay card vault) =====
export const fetchPaymentMethods = (memberId) =>
  request(`/payment-methods/member/${memberId}`)
export const savePaymentMethod = (data) =>
  request('/payment-methods', { method: 'POST', body: JSON.stringify(data) })
export const deletePaymentMethod = (data) =>
  request('/payment-methods/' + (data.paymentMethodId || ''), {
    method: 'DELETE',
    body: JSON.stringify(data),
  })
export const chargeSavedCard = (data) =>
  request('/charge', { method: 'POST', body: JSON.stringify(data) })

// ===== COGNITO USER MANAGEMENT =====
export const lookupUser = (email) => request('/users/lookup', { method: 'POST', body: JSON.stringify({ email }) })
export const createUser = (data) => request('/users/create', { method: 'POST', body: JSON.stringify(data) })
export const disableUser = (email) => request('/users/disable', { method: 'POST', body: JSON.stringify({ email }) })
export const enableUser = (email) => request('/users/enable', { method: 'POST', body: JSON.stringify({ email }) })
export const resetUserPassword = (email) => request('/users/reset-password', { method: 'POST', body: JSON.stringify({ email }) })
export const updateUserRole = (email, role) => request('/users/update-role', { method: 'POST', body: JSON.stringify({ email, role }) })
