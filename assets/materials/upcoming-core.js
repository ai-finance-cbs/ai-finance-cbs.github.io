// Class dates follow Columbia's calendar, even when a student travels.
export function courseToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function nextSession(sessions, today = courseToday()) {
  const dated = sessions.filter(s => s.date);
  if (!dated.length) return sessions.find(s => s.week === 1) || { week: 1, date: null };
  return dated.filter(s => s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week)[0] || null;
}

export function classDate(date) {
  if (!date) return '';
  // Noon avoids shifting a date-only value to the previous day.
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function readingMinutes(length) {
  const hours = Number(String(length).match(/(\d+)\s*hr/)?.[1] || 0);
  const minutes = Number(String(length).match(/(\d+)\s*min/)?.[1] || 0);
  return hours * 60 + minutes;
}

export function announcementText(row) {
  const title = String(row.title || '').trim(), body = String(row.body || '').trim();
  if (title.length > 200 || !body || body.length > 2000)
    throw new Error('Use a title of at most 200 characters and a body of 1–2,000 characters.');
  return { title, body };
}
