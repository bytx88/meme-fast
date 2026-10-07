import {buildPublicView,addressMatches} from './public-radar.mjs';
import {xFactorReading,xFactorBadge} from './x-factor.mjs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Show publisher excerpts, rather than substituting article-count boilerplate.
export function newsExcerpt(narrative){
  const excerpts=[];
  for(const post of narrative.posts||[]){
    const text=String(post.summary||'').replace(/\s+/g,' ').trim();
    if(!text||text.toLowerCase()===String(post.title||'').toLowerCase())continue;
    const words=new Set(text.toLowerCase().split(/\W+/).filter(w=>w.length>3));
    if(excerpts.some(e=>e.text.toLowerCase().includes(text.toLowerCase())||text.toLowerCase().includes(e.text.toLowerCase())||
      [...words].filter(w=>e.words.has(w)).length/Math.max(1,Math.min(words.size,e.words.size))>.8))continue;
    excerpts.push({text,words,post});
    if(excerpts.length===2)break;
  }
  return {text:excerpts.map(e=>e.text).join(' '),sources:excerpts.map(e=>e.post)};
}

export function tweetCoinMetrics(coin){
  const finite=value=>Number.isFinite(value)?value:null;
  return {mc:finite(coin.mc),liquidity:finite(coin.liquidity),change24h:finite(coin.priceChange),
    volume24h:finite(coin.volume),buyers24h:finite(coin.buyers),buys24h:finite(coin.buys),sells24h:finite(coin.sells),
    volume5m:finite(coin.volume5m),buys5m:finite(coin.buys5m),sells5m:finite(coin.sells5m)};
}

// News filters never change the independently ranked 24H coin sample.
export function buildTweetView(dataset,{hours=24,topic='all',chain='all',stage='all',query=''}={},now=Date.now()){
  const base=buildPublicView(dataset,{hours,group:chain,query},now),q=query.trim().toLowerCase();
  const trends=base.all.filter(n=>n.mentions&&(topic==='all'||n.group===topic)&&
    (stage==='all'||stage==='single'&&n.stage===0||stage==='multiple'&&n.stage===1)&&
    (!q||`${n.title} ${n.summary} ${addressMatches(n,dataset.coins).map(c=>c.symbol+' '+c.name).join(' ')}`.toLowerCase().includes(q)))
    .sort((a,b)=>b.score-a.score).slice(0,20).map((n,i)=>({...n,rank:i+1}));
  return {...base,trends,crossovers:trends.flatMap(n=>addressMatches(n,base.coins).map(c=>({id:n.id+':'+c.id,narrative:n,coin:c})))};
}

export function tweetSocialBadge(report,id,cached,now=Date.now()){
  if(cached?.value&&cached.value.status!=='error'&&Number.isSafeInteger(cached.value.posts6h)&&cached.value.posts6h>=0&&cached.until>now){
    const value=cached.value;
    // On-demand evidence has its own four-hour cache; keep stale status explicit.
    if(value.cacheStatus==='stale')return '<span class="x-sample-note" title="A previous indexed sample was retained after a failed refresh">X RSS · stale</span>';
    return `<button type="button" class="x-factor-badge rss" data-coin-evidence="${esc(id)}" title="Cached on-demand Google News RSS index of x.com posts in the last 6h; incomplete sample">X RSS <strong>${value.posts6h}</strong></button>`;
  }
  const reading=xFactorReading(report,id,now);
  if(['ready','rss','stale'].includes(reading.status))return xFactorBadge(report,id,now);
  const name=report?.source==='google-news-rss'?'X RSS':'X';
  return `<span class="x-sample-note" title="Open View evidence to check indexed X posts">${name} · ${reading.status==='error'?'unavailable':'not sampled'}</span>`;
}
