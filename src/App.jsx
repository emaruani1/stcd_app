import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import PaymentHistory from './pages/PaymentHistory'
import MakePayment from './pages/MakePayment'
import Sponsor from './pages/Sponsor'
import './App.css'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [paidPledges, setPaidPledges] = useState([])
  const [extraPayments, setExtraPayments] = useState([])
  const [bookedSponsors, setBookedSponsors] = useState({})

  const handleLogin = () => setIsLoggedIn(true)
  const handleLogout = () => {
    setIsLoggedIn(false)
  }

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <Layout onLogout={handleLogout}>
      <Routes>
        <Route
          path="/"
          element={
            <Dashboard
              paidPledges={paidPledges}
              extraPayments={extraPayments}
            />
          }
        />
        <Route
          path="/history"
          element={
            <PaymentHistory
              paidPledges={paidPledges}
              extraPayments={extraPayments}
            />
          }
        />
        <Route
          path="/pay"
          element={
            <MakePayment
              paidPledges={paidPledges}
              setPaidPledges={setPaidPledges}
              extraPayments={extraPayments}
              setExtraPayments={setExtraPayments}
            />
          }
        />
        <Route
          path="/sponsor"
          element={
            <Sponsor
              bookedSponsors={bookedSponsors}
              setBookedSponsors={setBookedSponsors}
              extraPayments={extraPayments}
              setExtraPayments={setExtraPayments}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
