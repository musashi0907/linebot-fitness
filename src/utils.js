// Date helpers, always in JST (the assumed timezone of the bot's user)
// regardless of what timezone the hosting server itself runs in.

export function todayKeyJST() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // en-CA formats as YYYY-MM-DD
}

export function isValidDateKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

export function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function fmtDateJP(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = ['日', '月', '火', '水', '木', '金', '土'][dt.getUTCDay()];
  return `${m}/${d}(${dow})`;
}

export function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}
