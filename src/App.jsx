import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import PaymentHistory from './pages/PaymentHistory'
import MakePayment from './pages/MakePayment'
import Sponsor from './pages/Sponsor'
import Profile from './pages/Profile'
import AccountStatements from './pages/AccountStatements'
import SavedCards from './pages/SavedCards'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminMembers from './pages/admin/AdminMembers'
import AdminPledges from './pages/admin/AdminPledges'
import AdminSponsorship from './pages/admin/AdminSponsorship'
import AdminYahrzeits from './pages/admin/AdminYahrzeits'
import AdminBirthdays from './pages/admin/AdminBirthdays'
import AdminEmails from './pages/admin/AdminEmails'
import AdminSettings from './pages/admin/AdminSettings'
import AdminTransactions from './pages/admin/AdminTransactions'
import AdminMerge from './pages/admin/AdminMerge'
import AdminMemberEdit from './pages/admin/AdminMemberEdit'
import AdminMembershipBilling from './pages/admin/AdminMembershipBilling'
import AccountSecurity from './pages/AccountSecurity'
import PledgerPledges from './pages/PledgerPledges'
import { logout, getCurrentSession } from './auth'
import * as api from './api'
import { computeAccountBalance } from './ledger'
import './App.css'

const defaultTemplates = {
  yahrzeit: { subject: 'Yahrzeit Reminder - {deceasedName}', body: 'Dear {memberName},\n\nThis is a reminder that the yahrzeit of your {relationship}, {deceasedName}, is approaching on {date}.\n\nMay their memory be a blessing.\n\nWarm regards,\nSephardic Torah Center of Dallas' },
  birthday: { subject: 'Happy Birthday, {celebrantName}!', body: 'Dear {memberName},\n\nWishing a very Happy Birthday to {celebrantName}!\n\nMay this year be filled with health, happiness, and blessings.\n\nWarm regards,\nSephardic Torah Center of Dallas' },
  barBatMitzvah: { subject: 'Mazal Tov - Upcoming Bar/Bat Mitzvah for {childName}', body: 'Dear {memberName},\n\nMazal Tov on the upcoming Bar/Bat Mitzvah of {childName} on {date}!\n\nParashat {parasha} - What a wonderful occasion.\n\nWe look forward to celebrating with your family.\n\nWarm regards,\nSephardic Torah Center of Dallas' },
}

function App() {
  const [session, setSession] = useState(null) // { email, role, memberId, token }
  const [loading, setLoading] = useState(true)

  // Data from API
  const [allMembers, setAllMembers] = useState([])
  const [allPledges, setAllPledges] = useState([])
  const [allTransactions, setAllTransactions] = useState([])

  // Settings from API
  const [pledgeTypes, setPledgeTypes] = useState([])
  const [occasions, setOccasions] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [products, setProducts] = useState([])
  const [kiddushPricing, setKiddushPricing] = useState([])
  const [seudaPricing, setSeudaPricing] = useState([])
  const [membershipPlans, setMembershipPlans] = useState([
    { id: 'single', label: 'Single', price: 100, description: '1 person' },
    { id: 'couple', label: 'Couple', price: 150, description: '2 people' },
    { id: 'family', label: 'Family', price: 180, description: 'Family' },
  ])

  // State from API
  const [blockedDatesState, setBlockedDatesState] = useState([])
  const [sentEmails, setSentEmails] = useState([])
  const [templates, setTemplates] = useState({})
  const [bookedSponsors, setBookedSponsors] = useState({})
  const [profileData, setProfileData] = useState(null)
  const [memberBalances, setMemberBalances] = useState({})

  // Admin impersonation
  const [impersonateId, setImpersonateId] = useState(null)

  // Session-only payment tracking (for member self-service payments before they hit the API)
  const [pledgePayments, setPledgePayments] = useState({})
  const [extraPayments, setExtraPayments] = useState([])

  // Check for existing session on mount
  useEffect(() => {
    getCurrentSession().then(s => {
      if (s) setSession(s)
      setLoading(false)
    })
  }, [])

  // Fetch all data when session is established
  const refreshData = useCallback(async () => {
    try {
      const [membersData, pledgesData, txnsData, settingsData, sponsorshipsData, emailsData] = await Promise.all([
        api.fetchMembers(),
        api.fetchAllPledges(),
        api.fetchAllTransactions(),
        api.fetchSettings(),
        api.fetchSponsorships(),
        api.fetchEmails(),
      ])

      // Build members with embedded pledges and paymentHistory for component compatibility
      const pledgesByMember = {}
      for (const p of pledgesData) {
        if (!pledgesByMember[p.memberId]) pledgesByMember[p.memberId] = []
        pledgesByMember[p.memberId].push({
          id: p.pledgeId,
          description: p.description || p.pledgeType || 'Pledge',
          pledgeType: p.pledgeType || '',
          occasion: p.occasion || '',
          amount: Number(p.amount) || 0,
          paidAmount: Number(p.paidAmount) || 0,
          date: p.date || '',
          paid: p.paid || false,
          canceled: p.canceled || false,
          paymentMethod: p.paymentMethod || '',
          category: p.category || 'pledge',
        })
      }

      const txnsByMember = {}
      for (const t of txnsData) {
        if (!txnsByMember[t.memberId]) txnsByMember[t.memberId] = []
        txnsByMember[t.memberId].push({
          id: t.transactionId,
          date: t.date || '',
          description: t.description || '',
          amount: Number(t.amount) || 0,
          method: t.method || t.source || '',
          paymentType: t.paymentType || '',
          groupId: t.groupId || '',
          productId: t.productId || '',
          pledgeId: t.pledgeId || '',
          pairId: t.pairId || '',
          category: t.category || '',
          alias: t.alias || '',
          cardLast4: t.cardLast4 || '',
          cardBrand: t.cardBrand || '',
          gatewayRefNum: t.gatewayRefNum || '',
          gatewayAuthCode: t.gatewayAuthCode || '',
          gatewayResult: t.gatewayResult || '',
          gatewayStatus: t.gatewayStatus || '',
        })
      }

      const enrichedMembers = membersData.map(m => ({
        id: m.memberId,
        memberId: m.memberId,
        firstName: m.firstName || '',
        lastName: m.lastName || '',
        email: m.email || '',
        phone: m.phone || '',
        balance: Number(m.balance) || 0,
        accountCredit: Number(m.balance) || 0,
        accountBalance: computeAccountBalance(txnsByMember[m.memberId] || []),
        autopayEnabled: !!m.autopayEnabled,
        autopayPaymentMethodId: m.autopayPaymentMethodId || '',
        memberSince: m.memberSince || '',
        membershipType: m.membershipType || '',
        membershipPlan: m.membershipPlan || '',
        membershipPriceOverride: m.membershipPriceOverride === undefined || m.membershipPriceOverride === null
          ? null : Number(m.membershipPriceOverride),
        gender: m.gender || '',
        address: m.address || '',
        addressLine2: m.addressLine2 || '',
        city: m.city || '',
        state: m.state || '',
        zip: m.zip || '',
        dob: m.dob || '',
        spouseName: m.spouseName || '',
        spouseGender: m.spouseGender || '',
        spouseDob: m.spouseDob || '',
        marriageDate: m.marriageDate || '',
        contactType: m.contactType || '',
        formalSalutation: m.formalSalutation || '',
        dearWho: m.dearWho || '',
        aliases: m.aliases || [],
        yahrzeits: m.yahrzeits || [],
        children: m.children || [],
        pledges: pledgesByMember[m.memberId] || [],
        paymentHistory: (txnsByMember[m.memberId] || []).sort((a, b) => new Date(b.date) - new Date(a.date)),
      }))

      setAllMembers(enrichedMembers)
      setAllPledges(pledgesData)
      setAllTransactions(txnsData)

      // Build balances
      const bals = {}
      enrichedMembers.forEach(m => { bals[m.id] = m.balance })
      setMemberBalances(bals)

      // Settings
      if (settingsData.pledgeTypes) setPledgeTypes(settingsData.pledgeTypes)
      if (settingsData.occasions) setOccasions(settingsData.occasions)
      if (settingsData.paymentMethods) setPaymentMethods(settingsData.paymentMethods)
      if (settingsData.products) setProducts(settingsData.products.map(p => ({ ...p, price: Number(p.price) || 0 })))
      if (settingsData.kiddushPricing) setKiddushPricing(settingsData.kiddushPricing.map(p => ({ ...p, price: Number(p.price) || 0 })))
      if (settingsData.seudaPricing) setSeudaPricing(settingsData.seudaPricing.map(p => ({ ...p, price: Number(p.price) || 0 })))
      if (settingsData.membershipPlans && settingsData.membershipPlans.length > 0) {
        setMembershipPlans(settingsData.membershipPlans.map(p => ({ ...p, price: Number(p.price) || 0 })))
      }
      if (settingsData.blockedDates) setBlockedDatesState(settingsData.blockedDates)
      if (settingsData.emailTemplates) setTemplates(settingsData.emailTemplates)

      // Build sponsorships lookup: { "kiddush-2026-03-14": {...}, "seuda-2026-03-14": {...} }
      const sponsors = {}
      for (const s of sponsorshipsData) {
        if (s.kiddush) sponsors[`kiddush-${s.dateKey}`] = s.kiddush
        if (s.seuda) sponsors[`seuda-${s.dateKey}`] = s.seuda
      }
      setBookedSponsors(sponsors)

      // Sent emails
      setSentEmails(emailsData.map(e => ({
        id: e.emailId,
        date: e.date,
        type: e.type,
        subject: e.subject,
        body: e.body,
        recipients: e.recipients || [],
        memberIds: e.memberIds || [],
      })))
    } catch (err) {
      console.error('Failed to fetch data:', err)
    }
  }, [])

  useEffect(() => {
    if (session) refreshData()
  }, [session, refreshData])

  const handleLogin = (sessionData) => {
    setSession(sessionData)
  }

  const handleLogout = () => {
    logout()
    setSession(null)
    setAllMembers([])
    setPledgePayments({})
    setExtraPayments([])
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    )
  }

  if (!session) {
    return <Login onLogin={handleLogin} />
  }

  // Show loading while data is being fetched after login
  if (allMembers.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Loading data...</p>
      </div>
    )
  }

  const isImpersonating = session.role === 'admin' && impersonateId
  const userRole = isImpersonating ? 'member' : session.role
  const currentMemberId = isImpersonating ? impersonateId : session.memberId
  const currentMember = allMembers.find(m => String(m.id) === String(currentMemberId)) || allMembers[0]
  const currentBalance = memberBalances[currentMemberId] || 0

  // Wrappers that persist changes to API then refresh
  const setAllMembersAndSync = (updater) => {
    // For now, apply local state update — API sync happens via specific action handlers
    setAllMembers(typeof updater === 'function' ? updater : () => updater)
  }

  // Helper for admin transactions (we read from allTransactions now)
  const adminTransactions = allTransactions
    .filter(t => t.source !== undefined)
    .map(t => ({
      id: t.transactionId,
      memberId: t.memberId,
      date: t.date || '',
      description: t.description || '',
      amount: Number(t.amount) || 0,
      method: t.method || t.source || '',
      paymentType: t.paymentType || '',
      cardLast4: t.cardLast4 || '',
      cardBrand: t.cardBrand || '',
      gatewayRefNum: t.gatewayRefNum || '',
      gatewayAuthCode: t.gatewayAuthCode || '',
      gatewayResult: t.gatewayResult || '',
      gatewayStatus: t.gatewayStatus || '',
      gatewayError: t.gatewayError || '',
      gatewayErrorCode: t.gatewayErrorCode || '',
    }))

  const getTransactionsForMember = (memberId) => {
    const member = allMembers.find(m => m.id === memberId)
    return member ? member.paymentHistory : []
  }

  // Settings update wrappers that persist to API
  const setPledgeTypesAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(pledgeTypes) : updater
    setPledgeTypes(newVal)
    try { await api.updateSetting('pledgeTypes', newVal) } catch (e) { console.error(e) }
  }
  const setOccasionsAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(occasions) : updater
    setOccasions(newVal)
    try { await api.updateSetting('occasions', newVal) } catch (e) { console.error(e) }
  }
  const setPaymentMethodsAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(paymentMethods) : updater
    setPaymentMethods(newVal)
    try { await api.updateSetting('paymentMethods', newVal) } catch (e) { console.error(e) }
  }
  const setProductsAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(products) : updater
    setProducts(newVal)
    try { await api.updateSetting('products', newVal.map(p => ({ ...p, price: String(p.price) }))) } catch (e) { console.error(e) }
  }
  const setKiddushPricingAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(kiddushPricing) : updater
    setKiddushPricing(newVal)
    try { await api.updateSetting('kiddushPricing', newVal.map(p => ({ ...p, price: String(p.price) }))) } catch (e) { console.error(e) }
  }
  const setSeudaPricingAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(seudaPricing) : updater
    setSeudaPricing(newVal)
    try { await api.updateSetting('seudaPricing', newVal.map(p => ({ ...p, price: String(p.price) }))) } catch (e) { console.error(e) }
  }
  const setMembershipPlansAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(membershipPlans) : updater
    setMembershipPlans(newVal)
    try { await api.updateSetting('membershipPlans', newVal.map(p => ({ ...p, price: String(p.price) }))) } catch (e) { console.error(e) }
  }

  // Blocked dates sync
  const setBlockedDatesAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(blockedDatesState) : updater
    setBlockedDatesState(newVal)
    try { await api.updateSetting('blockedDates', newVal) } catch (e) { console.error(e) }
  }

  // Templates sync
  const setTemplatesAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(templates) : updater
    setTemplates(newVal)
    try { await api.updateSetting('emailTemplates', newVal) } catch (e) { console.error(e) }
  }

  // Sent emails sync
  const setSentEmailsAndSync = async (newEmails) => {
    // newEmails is the full array after addition — find newly added ones and POST them
    const existingIds = new Set(sentEmails.map(e => e.id))
    const added = newEmails.filter(e => !existingIds.has(e.id))
    for (const e of added) {
      try {
        await api.createEmail({
          date: e.date,
          type: e.type,
          subject: e.subject,
          body: e.body,
          recipients: e.recipients || [],
          memberIds: e.memberIds || [],
        })
      } catch (err) { console.error(err) }
    }
    setSentEmails(newEmails)
  }

  // Sponsorship sync
  const setBookedSponsorsAndSync = async (updater) => {
    const newVal = typeof updater === 'function' ? updater(bookedSponsors) : updater
    setBookedSponsors(newVal)
    // Find changes and sync to API
    const allKeys = new Set([...Object.keys(bookedSponsors), ...Object.keys(newVal)])
    for (const key of allKeys) {
      const [type, ...dateParts] = key.split('-')
      const dateKey = dateParts.join('-')
      if (newVal[key] && !bookedSponsors[key]) {
        // Added
        try { await api.updateSponsorship(dateKey, { [type]: newVal[key] }) } catch (e) { console.error(e) }
      } else if (!newVal[key] && bookedSponsors[key]) {
        // Removed
        try { await api.deleteSponsorship(dateKey, { field: type }) } catch (e) { console.error(e) }
      }
    }
  }

  if (userRole === 'pledger') {
    return (
      <Layout onLogout={handleLogout} userRole={userRole} currentMember={null}>
        <Routes>
          <Route
            path="/pledges"
            element={
              <PledgerPledges
                allMembers={allMembers}
                pledgeTypes={pledgeTypes}
                occasions={occasions}
              />
            }
          />
          <Route path="*" element={<Navigate to="/pledges" replace />} />
        </Routes>
      </Layout>
    )
  }

  if (userRole === 'admin') {
    return (
      <Layout onLogout={handleLogout} userRole={userRole} currentMember={null}>
        <Routes>
          <Route
            path="/admin"
            element={<AdminDashboard allMembers={allMembers} memberBalances={memberBalances} />}
          />
          <Route
            path="/admin/members"
            element={
              <AdminMembers
                allMembers={allMembers}
                setAllMembers={setAllMembersAndSync}
                memberBalances={memberBalances}
                adminTransactions={adminTransactions}
                refreshData={refreshData}
                onImpersonate={setImpersonateId}
              />
            }
          />
          <Route
            path="/admin/pledges"
            element={
              <AdminPledges
                allMembers={allMembers}
                setAllMembers={setAllMembersAndSync}
                pledgeTypes={pledgeTypes}
                occasions={occasions}
                paymentMethods={paymentMethods}
                products={products}
                adminTransactions={adminTransactions}
                setAdminTransactions={() => {}}
                refreshData={refreshData}
              />
            }
          />
          <Route
            path="/admin/sponsorship"
            element={
              <AdminSponsorship
                allMembers={allMembers}
                bookedSponsors={bookedSponsors}
                setBookedSponsors={setBookedSponsorsAndSync}
                blockedDatesState={blockedDatesState}
                setBlockedDatesState={setBlockedDatesAndSync}
                kiddushPricing={kiddushPricing}
                seudaPricing={seudaPricing}
                refreshData={refreshData}
              />
            }
          />
          <Route
            path="/admin/yahrzeits"
            element={
              <AdminYahrzeits
                allMembers={allMembers}
                sentEmails={sentEmails}
                setSentEmails={setSentEmailsAndSync}
                templates={templates}
              />
            }
          />
          <Route
            path="/admin/birthdays"
            element={
              <AdminBirthdays
                allMembers={allMembers}
                sentEmails={sentEmails}
                setSentEmails={setSentEmailsAndSync}
                templates={templates}
              />
            }
          />
          <Route
            path="/admin/emails"
            element={
              <AdminEmails
                sentEmails={sentEmails}
                templates={templates}
                setTemplates={setTemplatesAndSync}
                defaultTemplates={defaultTemplates}
              />
            }
          />
          <Route
            path="/admin/settings"
            element={
              <AdminSettings
                pledgeTypes={pledgeTypes}
                setPledgeTypes={setPledgeTypesAndSync}
                occasions={occasions}
                setOccasions={setOccasionsAndSync}
                paymentMethods={paymentMethods}
                setPaymentMethods={setPaymentMethodsAndSync}
                products={products}
                setProducts={setProductsAndSync}
                kiddushPricing={kiddushPricing}
                setKiddushPricing={setKiddushPricingAndSync}
                seudaPricing={seudaPricing}
                setSeudaPricing={setSeudaPricingAndSync}
                membershipPlans={membershipPlans}
                setMembershipPlans={setMembershipPlansAndSync}
              />
            }
          />
          <Route
            path="/admin/transactions"
            element={
              <AdminTransactions
                allMembers={allMembers}
                setAllMembers={setAllMembersAndSync}
                adminTransactions={adminTransactions}
                setAdminTransactions={() => {}}
                paymentMethods={paymentMethods}
                products={products}
                refreshData={refreshData}
              />
            }
          />
          <Route
            path="/admin/merge"
            element={
              <AdminMerge
                allMembers={allMembers}
                setAllMembers={setAllMembersAndSync}
                memberBalances={memberBalances}
                setMemberBalances={setMemberBalances}
                adminTransactions={adminTransactions}
                setAdminTransactions={() => {}}
                refreshData={refreshData}
              />
            }
          />
          <Route
            path="/admin/members/:memberId/edit"
            element={
              <AdminMemberEdit
                allMembers={allMembers}
                refreshData={refreshData}
                membershipPlans={membershipPlans}
              />
            }
          />
          <Route
            path="/admin/statements/:memberId"
            element={
              <AccountStatements
                allMembers={allMembers}
                adminTransactions={adminTransactions}
                getTransactionsForMember={getTransactionsForMember}
                isAdmin={true}
              />
            }
          />
          <Route
            path="/admin/billing"
            element={<AdminMembershipBilling allMembers={allMembers} refreshData={refreshData} />}
          />
          <Route
            path="/admin/security"
            element={<AccountSecurity userRole="admin" />}
          />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Layout>
    )
  }

  return (
    <Layout onLogout={handleLogout} userRole={userRole} currentMember={currentMember}>
      {isImpersonating && (
        <div style={{
          background: 'linear-gradient(135deg, var(--primary-dark), var(--primary))',
          color: '#fff',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.9rem',
          borderRadius: 'var(--radius-md)',
          margin: '0 0 1rem',
        }}>
          <span>
            Viewing as <strong>{currentMember?.firstName} {currentMember?.lastName}</strong> (ID: {currentMemberId})
          </span>
          <button
            onClick={() => setImpersonateId(null)}
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.4)',
              padding: '6px 16px',
              borderRadius: '50px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.82rem',
            }}
          >
            Back to Admin
          </button>
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <Dashboard
              currentMember={currentMember}
              pledgePayments={pledgePayments}
              extraPayments={extraPayments}
              currentBalance={currentBalance}
              membershipPlans={membershipPlans}
            />
          }
        />
        <Route
          path="/history"
          element={
            <PaymentHistory
              currentMember={currentMember}
              pledgePayments={pledgePayments}
              extraPayments={extraPayments}
              adminTransactions={[]}
            />
          }
        />
        <Route
          path="/pay"
          element={
            <MakePayment
              currentMember={currentMember}
              pledgePayments={pledgePayments}
              setPledgePayments={setPledgePayments}
              extraPayments={extraPayments}
              setExtraPayments={setExtraPayments}
              currentBalance={currentBalance}
              setMemberBalances={setMemberBalances}
              currentMemberId={currentMemberId}
              refreshData={refreshData}
              membershipPlans={membershipPlans}
            />
          }
        />
        <Route
          path="/sponsor"
          element={
            <Sponsor
              bookedSponsors={bookedSponsors}
              setBookedSponsors={setBookedSponsorsAndSync}
              extraPayments={extraPayments}
              setExtraPayments={setExtraPayments}
              blockedDatesState={blockedDatesState}
              currentBalance={currentBalance}
              setMemberBalances={setMemberBalances}
              currentMemberId={currentMemberId}
              kiddushPricing={kiddushPricing}
              seudaPricing={seudaPricing}
              refreshData={refreshData}
            />
          }
        />
        <Route
          path="/cards"
          element={<SavedCards currentMember={currentMember} />}
        />
        <Route
          path="/profile"
          element={
            <Profile
              currentMember={currentMember}
              profileData={profileData}
              setProfileData={setProfileData}
              userRole={userRole}
            />
          }
        />
        <Route
          path="/statements"
          element={
            <AccountStatements
              allMembers={allMembers}
              adminTransactions={[]}
              getTransactionsForMember={getTransactionsForMember}
              isAdmin={false}
              currentMemberId={currentMemberId}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
