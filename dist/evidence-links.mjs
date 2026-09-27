import {addressMatches} from './public-radar.mjs';

const ALIASES=new Map([
 ['solana:CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU',['e/acc']],
 ['solana:98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump',['UsePaid']],
 ['robinhood:0x1cdb289befdfac8af945a288bcdccc382cb34d32',['xl.money','xLinkMoney']],
]);
const GENERIC=new Set(['paid','money','bitcoin','ethereum','solana','crypto','token','coin','base','stock','stocks','x']);
const normalize=value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
const phrase=(text,term)=>{
 const at=text.indexOf(term);
 if(at<0)return false;
 for(let start=at;start>=0;start=text.indexOf(term,start+1)){
  const before=text[start-1],after=text[start+term.length];
  if((!before||!/[a-z0-9]/i.test(before))&&(!after||!/[a-z0-9]/i.test(after)))return true;
 }
 return false;
};
const unique=(coins,field,value)=>coins.filter(c=>normalize(c[field])===normalize(value)).length===1;

export function matchNewsToCoin(narrative,coin,coins){
 if(addressMatches(narrative,[coin]).length)return {level:'exact',reason:'Article includes this exact contract address'};
 const text=normalize(narrative.posts.map(p=>`${p.title} ${p.summary}`).join(' '));
 for(const alias of ALIASES.get(coin.id)||[]){
  if(phrase(text,normalize(alias)))return {level:'lead',reason:`Configured alias “${alias}” in article; contract link unverified`};
 }
 const name=normalize(coin.name);
 if(name.length>=6&&!GENERIC.has(name)&&unique(coins,'name',coin.name)&&phrase(text,name))
  return {level:'lead',reason:'Distinct token name in article; contract link unverified'};
 const symbol=normalize(coin.symbol);
 if(symbol.length>=3&&!GENERIC.has(symbol)&&unique(coins,'symbol',coin.symbol)&&phrase(text,'$'+symbol))
  return {level:'lead',reason:'Cashtag in article; contract link unverified'};
 return null;
}

export function buildEvidenceLinks(narratives,coins){
 const links=[];
 for(const narrative of narratives)for(const coin of coins){
  const match=matchNewsToCoin(narrative,coin,coins);
  if(match)links.push({id:`${narrative.id}:${coin.id}`,narrative,coin,...match});
 }
 return links.sort((a,b)=>Number(b.level==='exact')-Number(a.level==='exact')||b.narrative.latest-a.narrative.latest);
}
