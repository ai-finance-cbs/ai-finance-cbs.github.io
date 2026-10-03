export function calendarLinks(url) {
  const feed = `${url.replace(/\/$/,'')}/functions/v1/calendar`;
  const webcal = feed.replace(/^https?:/, 'webcal:');
  const row = document.createElement('p'); row.className='calendar-links';
  row.append('Add to calendar: ');
  for (const [index,[text,href]] of [
    ['Google',`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`],
    ['Apple',webcal],['Download (.ics)',feed],
  ].entries()) {
    if (index) row.append(' · ');
    const a=document.createElement('a');a.textContent=text;a.href=href;row.append(a);
  }
  return row;
}
