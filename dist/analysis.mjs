// All calculations use the observed sample, never an inferred full-market history.
export function groupTransactions(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.hash ? `${row.network}:${row.hash.toLowerCase().startsWith('0x') ? row.hash.toLowerCase() : row.hash}` : `${row.network}:event:${row.id}`;
    if (!groups.has(key)) groups.set(key, {key, hash: row.hash, network: row.network, time: row.time, rows: [], buy: 0, sell: 0});
    const group = groups.get(key);
    group.rows.push(row); group[row.side] += row.usd; group.time = Math.max(group.time, row.time);
  }
  return [...groups.values()].sort((a,b) => b.time-a.time);
}

export function filterTrades(rows, {side = 'all', min = 0, wallet = ''} = {}) {
  const query = wallet.trim();
  return rows.filter(row => (side === 'all' || row.side === side) && row.usd >= Math.max(0, Number(min) || 0)
    && (!query || (query.startsWith('0x') ? row.wallet.toLowerCase().includes(query.toLowerCase()) : row.wallet.includes(query))));
}

export function flowTimeline(rows, minutes, now) {
  const stepMinutes = minutes <= 60 ? 1 : 60;
  const start = now - minutes*60000, step = stepMinutes*60000;
  const bins = Array.from({length: Math.ceil(minutes/stepMinutes)}, (_, i) => ({start: start+i*step, end: Math.min(now,start+(i+1)*step), buy: 0, sell: 0, count: 0, cumulative: 0}));
  for (const row of rows) {
    if (row.time < start || row.time > now) continue;
    const bin = bins[Math.min(bins.length-1, Math.floor((row.time-start)/step))];
    bin[row.side] += row.usd; bin.count++;
  }
  let cumulative = 0;
  for (const bin of bins) { cumulative += bin.buy-bin.sell; bin.cumulative = cumulative; }
  return {bins, stepMinutes, start, end: now};
}
