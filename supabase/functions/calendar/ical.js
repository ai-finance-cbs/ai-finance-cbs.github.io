const TITLES = ['AI Economics','AI Infrastructure','Processing Information with AI','Predicting Outcomes with AI','Persuading Stakeholders with AI','The Future of Finance with AI'];
const zone = 'America/New_York';
const escapeText = value => String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
const utc = value => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
function local(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}
// RFC 5545 lines are folded by UTF-8 octets, never through a Unicode character.
function fold(line) {
  const encoder = new TextEncoder(); let result='', length=0;
  for (const char of line) {
    const size=encoder.encode(char).length;
    if (length+size > 75) {result+='\r\n ';length=1;}
    result+=char;length+=size;
  }
  return result;
}
export function calendarFeed(data, {location='',now=new Date()} = {}) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CBS//B8403 Course Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    'X-WR-CALNAME:B8403 Finance in the Age of AI',`X-WR-TIMEZONE:${zone}`,
    'BEGIN:VTIMEZONE',`TZID:${zone}`,
    'BEGIN:DAYLIGHT','DTSTART:20070311T020000','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','TZOFFSETFROM:-0500','TZOFFSETTO:-0400','TZNAME:EDT','END:DAYLIGHT',
    'BEGIN:STANDARD','DTSTART:20071104T020000','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','TZOFFSETFROM:-0400','TZOFFSETTO:-0500','TZNAME:EST','END:STANDARD','END:VTIMEZONE'];
  function event(id,summary,start,end,deadline=false) {
    lines.push('BEGIN:VEVENT',`UID:${encodeURIComponent(data.term_id)}-${id}@b8403.cbs`, `DTSTAMP:${utc(now)}`,
      `DTSTART;TZID=${zone}:${local(start)}`,`DTEND;TZID=${zone}:${local(end)}`,`SUMMARY:${escapeText(summary)}`);
    if (location && !deadline) lines.push(`LOCATION:${escapeText(location)}`);
    if (deadline) lines.push('BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY',`DESCRIPTION:${escapeText(summary)}`,'END:VALARM');
    lines.push('END:VEVENT');
  }
  for (const s of data?.sessions || []) if (s.week >= 1 && s.week <= 6 && s.starts_at && s.ends_at)
    event(`week-${s.week}`,`B8403 Week ${s.week}: ${TITLES[s.week-1]}`,s.starts_at,s.ends_at);
  for (const i of data?.items || []) if (i.due_at)
    event(`item-${i.id}`,`Due: ${i.code} · ${i.title}`,i.due_at,new Date(new Date(i.due_at).getTime()+15*60000),true);
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n')+'\r\n';
}
