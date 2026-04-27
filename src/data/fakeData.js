// ========== MEMBERSHIP TIERS (used for display labels) ==========
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

// ========== ADMIN USER (for display) ==========
export const adminUser = { id: 'admin', firstName: 'Admin', lastName: '', email: 'admin@stcd.org', role: 'admin' };

// ========== BLOCKED DATES (local until API supports it) ==========
export const blockedDates = [];

// ========== EMAIL TEMPLATES ==========
export const emailTemplates = {
  yahrzeit: {
    subject: 'Yahrzeit Reminder - {deceasedName}',
    body: 'Dear {memberName},\n\nThis is a reminder that the yahrzeit of your {relationship}, {deceasedName}, is approaching on {date}.\n\nMay their memory be a blessing.\n\nWarm regards,\nSephardic Torah Center of Dallas',
  },
  birthday: {
    subject: 'Happy Birthday, {celebrantName}!',
    body: 'Dear {memberName},\n\nWishing a very Happy Birthday to {celebrantName}!\n\nMay this year be filled with health, happiness, and blessings.\n\nWarm regards,\nSephardic Torah Center of Dallas',
  },
  barBatMitzvah: {
    subject: 'Mazal Tov - Upcoming Bar/Bat Mitzvah for {childName}',
    body: 'Dear {memberName},\n\nMazal Tov on the upcoming Bar/Bat Mitzvah of {childName} on {date}!\n\nParashat {parasha} - What a wonderful occasion.\n\nWe look forward to celebrating with your family.\n\nWarm regards,\nSephardic Torah Center of Dallas',
  },
};

// ========== SPONSORSHIP CALENDAR ==========
// The calendar is just a list of *upcoming Saturdays* — it carries no booking data
// itself. Actual sponsorship records (kiddush / seuda) come from the API
// (stcd_sponsorships table) and are merged in by the Sponsor / AdminSponsorship pages.
function getUpcomingSaturdays(count = 52, fromDate = new Date()) {
  const saturdays = [];
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  // Roll forward to the next Saturday (today if today is Saturday)
  const offset = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  for (let i = 0; i < count; i++) {
    saturdays.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return saturdays;
}

export const sponsorshipCalendar = getUpcomingSaturdays(52).map(sat => ({
  date: sat.toISOString().split('T')[0],
  kiddush: null,
  seuda: null,
}));
