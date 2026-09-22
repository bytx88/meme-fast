export const stages = ['Raw signal','Trend','Meme formation','Early conversion','Crowd expansion','Saturation','Decay / rotation'];
export const stageDescriptions = ['A new phrase, image, event, or idea appears. One source can be enough.','Multiple independent accounts begin discussing the same topic.','People repeat, remix, and adapt the idea. A token is not required.','A narrative gains a token, or a coin gains attention outside its launch group.','The idea spreads into different communities and account categories.','Attention is high, but new sources and participants are slowing.','New participation and attention decline as the crowd rotates.'];
// Fictional fixtures only. Ages are relative to a fixed example snapshot, never the live clock.
export const narratives = [
 {id:'frog',title:'Purple Frog',stage:3,group:'Meme Coins',first:142,latest:2,velocity:380,direction:'rising',sources:31,mentions:144,diversity:4,coin:'FROG',origin:'narrative_first',summary:'A purple frog image is spreading through remixes. A token has appeared after the idea reached unrelated accounts.',keys:['pixelpond','memeobserver','onchainfield'],evidence:['This purple frog keeps appearing in completely different corners of my feed.','Made a version of the frog for every market mood.','The frog meme now has a token. The image was circulating well before launch.'],timeline:[['142m ago','First image detected'],['107m ago','Independent accounts start remixing'],['37m ago','First example token detected']],previousRank:4},
 {id:'reflection',title:'Reflection / revenue sharing',stage:2,group:'Meme Coins',first:620,latest:6,velocity:164,direction:'rising',sources:26,mentions:98,diversity:5,coin:null,origin:'unknown',summary:'Traders and developers are revisiting tokens that distribute revenue. The shared idea is gaining ground across different communities.',keys:['yieldnotes','buildledger','marketlens'],evidence:['Revenue distribution is showing up in several new launch discussions.','Different designs, same question: where does the distribution actually come from?','Seeing independent builders revisit reflection mechanics this week.'],timeline:[['10h 20m ago','First discussion detected'],['3h ago','Developers and traders join'],['56m ago','Phrase begins appearing without the original post']],previousRank:7},
 {id:'dogai',title:'AI pets with personalities',stage:4,group:'AI',first:210,latest:4,velocity:92,direction:'rising',sources:19,mentions:76,diversity:4,coin:'DOGAI',origin:'coin_first',summary:'An AI pet token is reaching creators outside its launch community. Character remixes are now driving some of the discussion.',keys:['agentdiary','characterlab','outsideview'],evidence:['The pet’s personality is becoming the meme, separate from the ticker.','Tried making a character variation after seeing it in a creator group.','This started with a token launch; outside accounts are now making their own versions.'],timeline:[['5h ago','Example coin launches'],['3h 30m ago','First social discussion detected'],['28m ago','Outside-community activity accelerates']],previousRank:2},
 {id:'pizza',title:'Mars Pizza',stage:1,group:'Meme Coins',first:47,latest:3,velocity:210,direction:'rising',sources:12,mentions:32,diversity:3,coin:null,origin:'unknown',summary:'An imaginary pizza delivery to Mars is turning into a recurring joke. Independent mentions are growing; no token has been matched.',keys:['orbitalhumor','cosmicnotes','memeobserver'],evidence:['Estimated delivery: six months. Pizza still somehow arrives cold.','Mars Pizza is the first space joke I have seen cross three different groups.','People are making delivery receipts for the red planet.'],timeline:[['47m ago','Original joke detected'],['21m ago','Unrelated accounts repeat the phrase']],previousRank:null},
 {id:'treasury',title:'Treasury-backed memes',stage:3,group:'Macro Crypto',first:960,latest:17,velocity:43,direction:'rising',sources:14,mentions:55,diversity:3,coin:'VAULT',origin:'narrative_first',summary:'Discussion is shifting from the joke to what sits in a token’s treasury. One example coin is attracting buyers around that theme.',keys:['treasurynotes','marketlens','buildledger'],evidence:['A meme treasury only means something if its assets are transparent.','More discussion of treasury mechanics across unrelated trading groups.','The VAULT example followed the treasury narrative, rather than starting it.'],timeline:[['16h ago','Narrative first detected'],['9h ago','Example token detected'],['2h ago','Research accounts join the discussion']],previousRank:5},
 {id:'mooncat',title:'Moon Cat remix cycle',stage:5,group:'Meme Coins',first:2800,latest:12,velocity:-18,direction:'fading',sources:9,mentions:88,diversity:2,coin:'MCAT',origin:'coin_first',summary:'Posting remains frequent, but most repeats come from the same group. New-account participation has started to slow.',keys:['catcommunity','memearchive','marketlens'],evidence:['Another familiar cat edit from the same group.','Still plenty of posts, but fewer new accounts joining today.','Remixes are mostly reinforcing an already-established meme.'],timeline:[['46h 40m ago','First social detection'],['18h ago','Participation broadens'],['2h ago','New-source growth slows']],previousRank:3},
 {id:'sleep',title:'The sleep-trading joke',stage:0,group:'Meme Coins',first:18,latest:18,velocity:0,direction:'stable',sources:1,mentions:1,diversity:1,coin:null,origin:'unknown',summary:'One creator jokes about a trading bot that only works while asleep. A raw signal; independent spread has not been established.',keys:['nightshiftlab'],evidence:['My best strategy is apparently to close the laptop and go to sleep.'],timeline:[['18m ago','One original post detected']],previousRank:null},
 {id:'robot',title:'Robot delivery dogs',stage:6,group:'AI',first:3600,latest:260,velocity:-64,direction:'fading',sources:4,mentions:19,diversity:2,coin:null,origin:'unknown',summary:'The delivery-dog clip is still being reposted, but fresh voices have largely moved on. No related token has been verified.',keys:['robotnotes','memearchive'],evidence:['Another repost of the original delivery-dog clip.','Not seeing many new versions of this one today.'],timeline:[['60h ago','Video detected'],['30h ago','Remix activity peaks'],['4h 20m ago','Latest example mention']],previousRank:1}
];
export const coins = [
 {symbol:'FROG',name:'Purple Frog',narrative:'frog',chain:'Solana',age:37,mc:420000,volume:180000,liquidity:68000,buyers:390,holders:612,growth:84,strength:'Medium',buyCount:512,sellCount:224},
 {symbol:'DOGAI',name:'Dog AI',narrative:'dogai',chain:'Base',age:300,mc:1800000,volume:640000,liquidity:210000,buyers:724,holders:1830,growth:31,strength:'Growing',buyCount:1024,sellCount:638},
 {symbol:'VAULT',name:'Meme Vault',narrative:'treasury',chain:'Solana',age:540,mc:920000,volume:260000,liquidity:105000,buyers:286,holders:972,growth:18,strength:'Medium',buyCount:388,sellCount:291},
 {symbol:'MCAT',name:'Moon Cat',narrative:'mooncat',chain:'Solana',age:3100,mc:3400000,volume:780000,liquidity:320000,buyers:212,holders:5410,growth:-3,strength:'Saturated',buyCount:327,sellCount:492},
 {symbol:'DRIFTX',name:'Drift Experiment',narrative:null,group:'Meme Coins',stage:null,origin:'unknown',chain:'Solana',age:85,mc:310000,volume:96000,liquidity:42000,buyers:305,holders:418,growth:22,strength:'Unestablished',buyCount:374,sellCount:168}
].map((coin,i)=>({...coin,id:`example-coin-${i}`,contract_address:null,contract_verified:false}));
export const crossoverEvents = [
 {narrative:'frog',symbol:'FROG',type:'trend_to_coin',age:37,lead:105,competing:3,title:'Purple Frog → $FROG',description:'The meme spread first. A token appeared 1h 45m later, with 390 buyers in the example snapshot.'},
 {narrative:'dogai',symbol:'DOGAI',type:'coin_to_trend',age:28,lead:90,outside:12,title:'$DOGAI → AI pet narrative',description:'The coin launched first. Character remixes are now reaching accounts outside the original community.'},
 {narrative:'treasury',symbol:'VAULT',type:'trend_to_coin',age:540,lead:420,competing:1,title:'Treasury memes → $VAULT',description:'Treasury discussion preceded the example token by seven hours.'}
];
// Generate deterministic example observations so windows genuinely filter source and mention counts.
export const observations = narratives.flatMap((n,index)=>Array.from({length:n.mentions},(_,i)=>({narrative:n.id,account:`${n.id}-source-${i%n.sources}`,category:(i%n.sources)%n.diversity,age:n.latest+(n.first-n.latest)*(i/Math.max(1,n.mentions-1))**(n.direction==='rising'?1.8:0.75),id:`example-${index}-${i}`})));
// Measure before applying display filters. Cards and detail dialogs share this result.
export function narrativeInWindow(id,hours=4) {
 const n=narratives.find(n=>n.id===id);
 if(!n)return null;
 const rows=observations.filter(p=>p.narrative===id&&p.age<=hours*60);
 const sources=new Set(rows.map(r=>r.account)).size,diversity=new Set(rows.map(r=>r.category)).size;
 return {...n,sources,mentions:rows.length,score:sources*(1+diversity/5)*(1+Math.max(-90,n.velocity)/200)};
}
export function coinContext(c,hours=4) {
 const narrative=narrativeInWindow(c.narrative,hours);
 return {narrative,stage:c.stage??narrative?.stage??null,group:c.group??narrative?.group??'Other',origin:c.origin??narrative?.origin??'unknown',sources:narrative?.sources??null};
}
function matchesStage(value,filter) {
 if(filter==='all')return true;
 if(filter==='unclassified')return value===null;
 if(value===null)return false;
 return filter==='early'?value<=2:filter==='conversion'?value>=3&&value<=4:value>=5;
}
export function buildView({hours=4,group='all',stage='all',query=''}={}) {
 const q=query.trim().toLowerCase();
 const selected=narratives.map(n=>narrativeInWindow(n.id,hours)).filter(n=>{
  const related=coins.filter(c=>c.narrative===n.id).map(c=>`${c.symbol} ${c.name}`).join(' ');
  return n.mentions>0&&(group==='all'||n.group===group)&&matchesStage(n.stage,stage)&&(!q||`${n.title} ${n.coin||''} ${n.summary} ${related}`.toLowerCase().includes(q));
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).map((n,i)=>({...n,rank:i+1}));
 const ids=new Set(selected.map(n=>n.id));
 const marketCoins=coins.filter(c=>{
  const context=coinContext(c,hours),n=context.narrative;
  return (group==='all'||context.group===group)&&matchesStage(context.stage,stage)&&(!q||`${c.symbol} ${c.name} ${n?.title||''} ${n?.summary||''}`.toLowerCase().includes(q));
 }).sort((a,b)=>b.buyers-a.buyers).map((c,i)=>({...c,rank:i+1}));
 return {trends:selected.slice(0,20),coins:marketCoins,crossovers:crossoverEvents.filter(c=>ids.has(c.narrative)&&c.age<=hours*60)};
}
export function ageLabel(minutes){return minutes<60?`${minutes}m`:`${Math.floor(minutes/60)}h${minutes%60?' '+minutes%60+'m':''}`;}
