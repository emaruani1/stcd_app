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

// ========== SPONSORSHIP CALENDAR (local until API supports it) ==========
function getSaturdays(startDate, count) {
  const saturdays = [];
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  for (let i = 0; i < count; i++) {
    saturdays.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return saturdays;
}

const saturdays = getSaturdays('2026-02-01', 26);

export const sponsorshipCalendar = saturdays.map(sat => {
  const dateStr = sat.toISOString().split('T')[0];
  return {
    date: dateStr,
    kiddush: null,
    seuda: null,
  };
});
