const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const MAX_SAMPLE_AGE_MS=30*60_000;

export function xFactorReading(report,id,now=Date.now()){
 const row=report?.coins?.[id];
 if(report?.status!=='connected'||!row)return {status:report?.status==='connected'?'unobserved':report?.status==='error'?'error':'disconnected'};
 const sampledAt=Number(row.sampledAt);
 if(!Number.isFinite(sampledAt)||sampledAt>now+60_000||now-sampledAt>MAX_SAMPLE_AGE_MS)return {status:'stale',sampledAt};
 if(!Number.isInteger(row.score)||row.score<0||row.score>100)return {status:'unobserved'};
 return {...row,sampledAt,status:'ready'};
}

export function xFactorBadge(report,id,now=Date.now()){
 const reading=xFactorReading(report,id,now),safeId=escapeHtml(id);
 const delta=Number.isFinite(reading.delta6h)?` <span class="x-factor-delta">${reading.delta6h>0?'+':''}${reading.delta6h} pts / 6h</span>`:'';
 const label=reading.status==='ready'?`X Factor <strong>${reading.score}</strong>${delta}`:reading.status==='stale'?'X Factor · stale':'X Factor · —';
 const title=reading.status==='ready'?`X Factor sampled ${new Date(reading.sampledAt).toLocaleString()}`:reading.status==='stale'?'X sample is older than 30 minutes':reading.status==='error'?'X collection failed':reading.status==='disconnected'?'X collection is not connected':'No X sample for this contract';
 return `<button type="button" class="x-factor-badge ${reading.status}" data-x-factor="${safeId}" title="${escapeHtml(title)}" aria-label="Inspect ${escapeHtml(label.replace(/<[^>]*>/g,''))}">${label}</button>`;
}

export function xFactorDetail(report,id,now=Date.now()){
 const reading=xFactorReading(report,id,now);
 if(reading.status!=='ready'){
  const message=reading.status==='disconnected'?'X collection is not connected. This coin has no measured social score yet.':reading.status==='error'?'X collection failed. No social score is shown until a complete sample succeeds.':reading.status==='stale'?'The last X sample is older than 30 minutes. Its score is withheld until collection resumes.':'No X posts have been measured for this contract yet.';
  return `<p class="x-factor-note">${message}</p>`;
 }
 const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('en-US'):'—';
 const posts=Array.isArray(reading.posts)?reading.posts.slice(0,10).filter(post=>{
  try{const url=new URL(post.url);return url.protocol==='https:'&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)&&/^\/[A-Za-z0-9_]{1,15}\/status\/\d+/.test(url.pathname)}catch{return false}
 }):[];
 const sampleAge=Math.max(0,Math.floor((now-reading.sampledAt)/60_000));
 return `<div class="x-factor-summary"><strong>${reading.score} / 100</strong><span>${Number.isFinite(reading.delta6h)?`${reading.delta6h>0?'+':''}${reading.delta6h} points over 6h · `:''}sampled ${sampleAge}m ago</span></div><dl class="x-factor-parts"><div><dt>Unique accounts · 6h</dt><dd>${count(reading.uniqueAccounts6h)}</dd></div><div><dt>Relevant posts · 6h</dt><dd>${count(reading.posts6h)}</dd></div><div><dt>Key account posts · 6h</dt><dd>${count(reading.keyInteractions6h)}</dd></div></dl><p class="x-factor-note">Coverage: ${escapeHtml(reading.coverage||'unspecified')}. Key account posts show — until handles are configured. This experimental social score excludes market cap and price.</p>${posts.length?`<h4>Observed X posts</h4><ul class="x-factor-posts">${posts.map(post=>`<li><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.author||'View post')} ↗</a>${post.reason?`<small>${escapeHtml(post.reason)}</small>`:''}</li>`).join('')}</ul>`:'<p class="x-factor-note">No matching X posts were returned in this sample.</p>'}`;
}

export async function loadXFactor(fetcher=fetch){
 try{const response=await fetcher('/api/x-factor',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(response.ok){const report=await response.json();if(report?.version===1&&report.coins&&typeof report.coins==='object')return report}}catch{}
 return {version:1,status:'disconnected',coins:{}};
}
