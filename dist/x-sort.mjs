const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=ms=>Number.isFinite(ms)?new Date(ms).toLocaleString():'unknown';
const safePost=url=>/^https:\/\/x\.com\/i\/status\/\d+$/.test(url||'')?url:'#';

export function renderXSort(report){
 const themes=Array.isArray(report?.themes)?report.themes:[];
 const ranked=themes.filter(t=>t.posts24h>0);
 const status=report?.cacheStatus==='stale'?'Cached result is stale. XFlux refresh failed.':report?.status==='error'?`XFlux unavailable: ${report.message||'request failed'}`:report?.status==='no-evidence'?'No matching posts were found in the tracked 24-hour sample.':`Sampled ${themes.length} tracked themes at ${when(report.sampledAt)}. ${report.cacheStatus==='fresh'?'Next XFlux read after '+when(report.nextRefreshAt)+'.':''}`;
 const cards=ranked.map((theme,index)=>`<article class="x-sort-card"><div class="x-sort-card-head"><span class="rank">${String(index+1).padStart(2,'0')}</span><h3>${esc(theme.name)}</h3><strong>${Number(theme.posts24h)||0} posts</strong></div><p>Matching XFlux search posts in 24H${theme.sampleCapped?' · Search reached the 100-post cap':''}</p><div class="x-sort-evidence">${(theme.evidence||[]).map(post=>`<a href="${esc(safePost(post.url))}" target="_blank" rel="noopener noreferrer">${esc(post.author||'X post')}: ${esc(post.text||'View post')} ↗</a>`).join('')}</div></article>`).join('');
 return `<p class="x-sort-status">${esc(status)}</p>${cards||'<p class="empty-state">No ranked X themes in this sample.</p>'}<p class="x-sort-foot">Ranked by matching post count in four tracked keyword searches. This is a sampled XFlux result, not X-wide trending or independent-account reach. ${report?.errors?.length?`${report.errors.length} search${report.errors.length===1?'':'es'} failed.`:''}</p>`;
}

export function bindXSort(button,panel,content,fetcher=fetch){
 button.addEventListener('click',async()=>{
  panel.hidden=false;button.disabled=true;button.textContent='X Sort loading…';
  content.innerHTML='<p class="x-sort-status">Reading X Sort cache or refreshing the sample…</p>';
  try{
   const response=await fetcher('/api/x-sort',{method:'POST',cache:'no-store'});
   if(!response.ok)throw new Error(`Server ${response.status}`);
   content.innerHTML=renderXSort(await response.json());
  }catch(error){content.innerHTML=`<p class="x-sort-status">X Sort is unavailable: ${esc(error.message||'request failed')}.</p>`}
  finally{button.disabled=false;button.textContent='X Sort';panel.scrollIntoView({behavior:'smooth',block:'start'})}
 });
}
