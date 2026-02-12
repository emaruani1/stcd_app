// ========== MEMBERSHIP TIERS ==========
export const membershipTiers = {
  full: {
    label: 'Full Member',
    plans: {
      single: { label: 'Single', monthly: 120 },
      couple: { label: 'Couple', monthly: 150 },
      family: { label: 'Family', monthly: 180 },
    },
  },
  associate: {
    label: 'Associate Member',
    plans: {
      single: { label: 'Single', monthly: 60 },
      couple: { label: 'Couple', monthly: 75 },
      family: { label: 'Family', monthly: 90 },
    },
  },
};

// ========== USER DATA ==========
export const currentUser = {
  id: 1,
  firstName: 'David',
  lastName: 'Cohen',
  email: 'david.cohen@email.com',
  phone: '(214) 555-1234',
  memberId: 'STCD-2024-001',
  memberSince: '2022-03-15',
  membershipType: 'full',   // 'full' or 'associate'
  membershipPlan: 'couple',  // 'single', 'couple', or 'family'
};

// ========== PLEDGES ==========
export const pledges = [
  // Monthly membership dues (Full Member - Couple @ $150/mo)
  { id: 101, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-01-01', paid: true, category: 'dues' },
  { id: 102, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-02-01', paid: true, category: 'dues' },
  { id: 103, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-03-01', paid: false, category: 'dues' },
  { id: 104, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-04-01', paid: false, category: 'dues' },
  { id: 105, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-05-01', paid: false, category: 'dues' },
  { id: 106, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-06-01', paid: false, category: 'dues' },
  { id: 107, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-07-01', paid: false, category: 'dues' },
  { id: 108, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-08-01', paid: false, category: 'dues' },
  { id: 109, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-09-01', paid: false, category: 'dues' },
  { id: 110, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-10-01', paid: false, category: 'dues' },
  { id: 111, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-11-01', paid: false, category: 'dues' },
  { id: 112, description: 'Monthly Dues - Full Member (Couple)', amount: 150, date: '2026-12-01', paid: false, category: 'dues' },
  // Synagogue pledges
  { id: 1, description: 'Opening of Ark', amount: 150, date: '2026-01-02', paid: false, category: 'pledge' },
  { id: 2, description: 'Taking out Torah', amount: 100, date: '2026-01-09', paid: false, category: 'pledge' },
  { id: 3, description: 'Aliyah 1', amount: 90, date: '2026-01-10', paid: false, category: 'pledge' },
  { id: 4, description: 'Aliyah 2', amount: 90, date: '2026-01-17', paid: false, category: 'pledge' },
  { id: 5, description: 'Aliyah 3 (Shelishi)', amount: 120, date: '2026-01-24', paid: false, category: 'pledge' },
  { id: 6, description: 'Maftir', amount: 180, date: '2026-01-31', paid: true, category: 'pledge' },
  { id: 7, description: 'Haftarah', amount: 200, date: '2026-02-07', paid: false, category: 'pledge' },
  { id: 8, description: 'Opening of Ark', amount: 150, date: '2026-02-14', paid: false, category: 'pledge' },
  { id: 9, description: 'Hagbaha (Lifting Torah)', amount: 75, date: '2026-02-21', paid: true, category: 'pledge' },
  { id: 10, description: 'Gelila (Dressing Torah)', amount: 60, date: '2026-02-28', paid: true, category: 'pledge' },
  { id: 11, description: 'Aliyah 4 (Revii)', amount: 100, date: '2026-03-07', paid: false, category: 'pledge' },
  { id: 12, description: 'Aliyah 5 (Chamishi)', amount: 100, date: '2026-03-14', paid: false, category: 'pledge' },
  { id: 13, description: 'Aliyah 6 (Shishi)', amount: 110, date: '2026-03-21', paid: false, category: 'pledge' },
  { id: 14, description: 'Peticha (Ark Opening) - Yom Tov', amount: 250, date: '2026-03-28', paid: false, category: 'pledge' },
  { id: 16, description: 'Building Fund Pledge', amount: 1000, date: '2026-06-01', paid: false, category: 'pledge' },
];

// ========== PAYMENT HISTORY ==========
export const paymentHistory = [
  { id: 1, date: '2026-01-01', description: 'Monthly Dues - Full Member (Couple)', amount: 150, method: 'Auto-Pay' },
  { id: 2, date: '2026-02-01', description: 'Monthly Dues - Full Member (Couple)', amount: 150, method: 'Auto-Pay' },
  { id: 3, date: '2026-01-31', description: 'Maftir', amount: 180, method: 'Credit Card' },
  { id: 4, date: '2026-02-21', description: 'Hagbaha (Lifting Torah)', amount: 75, method: 'Check' },
  { id: 5, date: '2026-02-28', description: 'Gelila (Dressing Torah)', amount: 60, method: 'Credit Card' },
  { id: 6, date: '2025-12-15', description: 'Donation - Chanukah Campaign', amount: 250, method: 'Credit Card' },
  { id: 7, date: '2025-12-01', description: 'Monthly Dues - Full Member (Couple)', amount: 150, method: 'Auto-Pay' },
  { id: 8, date: '2025-11-20', description: 'Kiddush Sponsorship - Standard', amount: 350, method: 'Credit Card' },
  { id: 9, date: '2025-11-01', description: 'Monthly Dues - Full Member (Couple)', amount: 150, method: 'Auto-Pay' },
  { id: 10, date: '2025-10-05', description: 'Aliyah 2', amount: 90, method: 'Zelle' },
  { id: 11, date: '2025-09-12', description: 'High Holiday Seat', amount: 400, method: 'Check' },
  { id: 12, date: '2025-08-01', description: 'Donation - General Fund', amount: 100, method: 'Credit Card' },
  { id: 13, date: '2025-07-15', description: 'Seuda Shelishit Sponsorship', amount: 250, method: 'Credit Card' },
];

// ========== SPONSORSHIP CALENDAR ==========
// Generate Saturdays for the next 6 months
function getSaturdays(startDate, count) {
  const saturdays = [];
  const d = new Date(startDate + 'T00:00:00');
  // Move to next Saturday
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  for (let i = 0; i < count; i++) {
    saturdays.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return saturdays;
}

const saturdays = getSaturdays('2026-02-01', 26);

// Some dates are already taken
const takenKiddush = {
  '2026-02-14': { sponsor: 'The Azoulay Family', type: 'sit-down', occasion: 'In honor of a new baby' },
  '2026-02-28': { sponsor: 'The Benveniste Family', type: 'standard', occasion: 'Shabbat Zachor' },
  '2026-03-14': { sponsor: 'The Dweck Family', type: 'deluxe', occasion: 'Bar Mitzvah' },
  '2026-04-04': { sponsor: 'The Elmaleh Family', type: 'standard', occasion: 'Anniversary' },
  '2026-05-02': { sponsor: 'The Fassi Family', type: 'sit-down', occasion: 'Birthday celebration' },
};

const takenSeuda = {
  '2026-02-14': { sponsor: 'The Gabay Family', type: 'regular', occasion: 'Yahrzeit' },
  '2026-03-07': { sponsor: 'The Hadad Family', type: 'deluxe', occasion: 'In memory of a loved one' },
  '2026-03-28': { sponsor: 'The Israel Family', type: 'regular', occasion: 'Shabbat HaGadol' },
  '2026-04-18': { sponsor: 'The Jablon Family', type: 'deluxe', occasion: 'Birthday' },
};

export const sponsorshipCalendar = saturdays.map(sat => {
  const dateStr = sat.toISOString().split('T')[0];
  return {
    date: dateStr,
    kiddush: takenKiddush[dateStr] || null,
    seuda: takenSeuda[dateStr] || null,
  };
});

// ========== SPONSORSHIP PRICING ==========
export const kiddushOptions = [
  { id: 'standard', label: 'Standard Kiddush', price: 350, description: 'Stand-up kiddush with traditional spread' },
  { id: 'sit-down', label: 'Sit-Down Kiddush', price: 500, description: 'Full sit-down kiddush meal' },
  { id: 'deluxe', label: 'Deluxe Kiddush', price: 700, description: 'Premium deluxe kiddush experience' },
];

export const seudaOptions = [
  { id: 'regular', label: 'Regular Seuda Shelishit', price: 250, description: 'Traditional Seuda Shelishit' },
  { id: 'deluxe', label: 'Deluxe Seuda Shelishit', price: 400, description: 'Enhanced Seuda Shelishit spread' },
];
