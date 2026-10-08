export const CLASSES={F1:'Finder class 1',F2:'Finder class 2',Dev:'Developer',C1:'Clipper fast',C2:'Clipper slow',N1:'Nurture slow',N2:'Nurture fast',L1:'Long holder',L2:'Short holder'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={F:'<circle cx="9" cy="9" r="5"/><path d="m13 13 5 5"/>',C:'<path d="m12 2-7 11h6l-1 7 9-12h-7z"/>',N:'<path d="M12 20V10M12 14C4 14 3 9 3 4c6 0 9 3 9 10Zm0-4c0-5 4-7 9-7 0 5-3 9-9 9"/>',L:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',D:'<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"/>'};
const icon=code=>`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[code[0]]||paths.D}</svg>`;
export function walletState(row,now=Date.now()){
 if(!row.checkedAt)return 'unavailable';
 return row.status==='ok'&&now>=row.checkedAt&&now-row.checkedAt<=10*60000?'fresh':'stale';
}
export function holdingsFor(coin,report,now=Date.now()){
 if(coin.network!=='solana'&&coin.chain!=='Solana'&&!String(coin.id).startsWith('solana:'))return [];
 return (report?.wallets||[]).filter(row=>CLASSES[row.code]&&walletState(row,now)!=='unavailable'&&row.mints?.includes(coin.contract_address));
}
export function walletBadges(coin,report,now=Date.now()){
 const groups=new Map();
 for(const row of holdingsFor(coin,report,now)){if(!groups.has(row.code))groups.set(row.code,[]);groups.get(row.code).push(row)}
 if(!groups.size)return '';
 return `<span class="wallet-badges">${[...groups].map(([code,rows])=>{
  const stale=rows.some(row=>walletState(row,now)!=='fresh');
  const label=`${code} · ${CLASSES[code]} · ${rows.map(row=>`${row.name} (${walletState(row,now)})`).join(', ')}`;
  return `<details class="wallet-badge wallet-${code[0]}${stale?' wallet-stale':''}"><summary title="${esc(label)}" aria-label="${esc(label)}">${icon(code)}${esc(code)}${stale?' · !':''}</summary><span class="wallet-popup"><strong>${esc(CLASSES[code])}</strong>${rows.map(row=>`<a href="https://solscan.io/account/${esc(row.address)}" target="_blank" rel="noopener noreferrer">${esc(row.name)} ↗</a><small>${walletState(row,now)==='fresh'?'Checked':'Stale · last checked'} ${esc(new Date(row.checkedAt).toLocaleString())}</small>`).join('')}</span></details>`;
 }).join('')}</span>`;
}
export function walletCoverage(report,now=Date.now()){
 const rows=report?.wallets||[],fresh=rows.filter(row=>walletState(row,now)==='fresh').length;
 return `Followed wallets: ${fresh}/${rows.length||8} fresh${rows.length-fresh>0?' · stale / unavailable':''}`;
}
export function walletRegistry(report,now=Date.now()){
 return `<details class="wallet-registry"><summary>${esc(walletCoverage(report,now))}</summary><p>Solana token balances sampled every 5m. Badges match exact contracts with a positive balance. Labels are assigned by you; Dev does not verify token creation. Absence of a badge is inconclusive when checks are stale or unavailable.</p><div class="wallet-legend">${Object.entries(CLASSES).map(([code,label])=>`<span>${icon(code)} <b>${code}</b> ${esc(label)}</span>`).join('')}</div>${(report?.wallets||[]).map(row=>`<div class="wallet-registry-row"><b>${esc(row.code)}</b><a href="https://solscan.io/account/${esc(row.address)}" target="_blank" rel="noopener noreferrer">${esc(row.name)} ↗</a><span>${walletState(row,now)}${row.checkedAt?` · ${esc(new Date(row.checkedAt).toLocaleString())}`:''}</span></div>`).join('')}</details>`;
}
