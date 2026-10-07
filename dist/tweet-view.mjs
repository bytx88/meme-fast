import {buildPublicView,addressMatches} from './public-radar.mjs';
import {xFactorReading,xFactorBadge} from './x-factor.mjs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
