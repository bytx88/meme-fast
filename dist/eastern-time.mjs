const zone = 'America/New_York';
const date = new Intl.DateTimeFormat('en-US', {timeZone: zone, month: 'short', day: 'numeric', year: 'numeric'});
const time = new Intl.DateTimeFormat('en-US', {timeZone: zone, hour: 'numeric', minute: '2-digit'});
const timeWithSeconds = new Intl.DateTimeFormat('en-US', {timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit'});

export const easternDate = value => date.format(new Date(value));
export const easternTime = value => time.format(new Date(value));
export const easternTimeWithSeconds = value => timeWithSeconds.format(new Date(value));
export const easternDateTime = value => `${easternDate(value)}, ${easternTime(value)} ET`;
export const easternRange = (start, end) => easternDate(start) === easternDate(end)
  ? `${easternDate(start)}, ${easternTime(start)}–${easternTime(end)} ET`
  : `${easternDateTime(start)}–${easternDateTime(end)}`;
