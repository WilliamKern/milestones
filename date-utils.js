/** Calendar-date arithmetic in UTC; avoids DST and iPhone timezone surprises. */
const DAY = 86400000;
export function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) throw new Error('Please enter a valid date.');
  const [y,m,d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m-1 || dt.getUTCDate() !== d) throw new Error('That date does not exist.');
  return dt;
}
export function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function utcISO(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
export function todayISO() { return isoDate(new Date()); }
export function datePlusDays(iso, days) { return utcISO(new Date(parseDate(iso).getTime() + days * DAY)); }
export function daysBetween(a,b) { return Math.round((parseDate(b) - parseDate(a))/DAY); }
function addMonths(iso, months) {
  const d = parseDate(iso);
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  const first = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(),lastDay));
  return utcISO(first);
}
export function calendarSpan(start, end, inclusive = true) {
  const a = parseDate(start), b = parseDate(end);
  if (b < a) throw new Error('End date must be on or after the start date.');
  const until = inclusive ? datePlusDays(end,1) : end;
  let months = (parseDate(until).getUTCFullYear()-a.getUTCFullYear())*12 + parseDate(until).getUTCMonth()-a.getUTCMonth();
  if (addMonths(start,months) > until) months--;
  while (addMonths(start,months+1) <= until) months++;
  const remainder = daysBetween(addMonths(start,months),until);
  return {years:Math.floor(months/12), months:months%12, totalMonths:months, days:remainder, totalDays:daysBetween(start,end) + (inclusive?1:0)};
}
export function eventStatus(event, today=todayISO()) {
  if (event.deletedAt) return 'deleted';
  if (event.endDate && event.endDate <= today) return 'completed';
  if (!event.endDate && event.afterBehavior === 'complete' && event.startDate <= today) return 'completed';
  if (event.startDate > today) return 'upcoming';
  return 'ongoing';
}
export function eventSpan(event,today=todayISO()) {
  const status=eventStatus(event,today);
  if (status==='upcoming') return calendarSpan(today,event.startDate,false);
  return calendarSpan(event.startDate,status==='completed'?(event.endDate || event.startDate):today,true);
}
export function readableParts(parts, unit='calendar') {
  const n=(count,name)=>`${count} ${name}${count===1?'':'s'}`;
  if(unit==='days') return n(parts.totalDays,'day');
  if(unit==='weeks') { const weeks=Math.floor(parts.totalDays/7), days=parts.totalDays%7; return [weeks&&n(weeks,'week'),days&&n(days,'day')].filter(Boolean).join(', ') || '0 days'; }
  if(unit==='months') return [parts.totalMonths&&n(parts.totalMonths,'month'),parts.days&&n(parts.days,'day')].filter(Boolean).join(', ') || '0 days';
  return [parts.years&&n(parts.years,'year'),parts.months&&n(parts.months,'month'),parts.days&&n(parts.days,'day')].filter(Boolean).join(', ') || '0 days';
}
export function dateLabel(iso) { return parseDate(iso).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}); }
export function progress(event,today=todayISO()) {
  if (!event.endDate) return null;
  const total=daysBetween(event.startDate,event.endDate)+1;
  const elapsed=today<event.startDate?0:today>=event.endDate?total:daysBetween(event.startDate,today)+1;
  return {total,elapsed,percent:Math.min(100,Math.max(0,Math.round(100*elapsed/total)))};
}
