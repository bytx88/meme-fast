import test from 'node:test';
import assert from 'node:assert/strict';
import {BasketDraft,MAX_MEMBERS,memberIdentity,normalizeMember,quoteState,renderComparison,renderMembers,renderSuggestions,mountBasket} from '../dist/meme-basket.mjs';

const evm=(index,network='base')=>({network,contract_address:`0x${index.toString(16).padStart(40,'0')}`,symbol:`T${index}`,name:`Token ${index}`});
const solana={network:'solana',contract_address:'BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy',symbol:'BP',name:'Backpack'};
const config=()=>({version:1,revision:'0123456789abcdef',updatedAt:1900000000000,members:[solana,evm(1)]});

test('basket edits remain a draft with fixed equal weights until a saved revision is loaded',()=>{
  const saved=config(),draft=new BasketDraft(saved);
  assert.equal(draft.dirty,false);assert.equal(draft.weight,50);
  draft.add(evm(2));assert.equal(draft.weight,100/3);assert.equal(draft.dirty,true);
  assert.equal(saved.members.length,2);assert.equal(draft.saved.length,2);
  assert.deepEqual(draft.payload(),{revision:saved.revision,members:[solana,evm(1),evm(2)]});
  draft.remove(memberIdentity(solana));assert.equal(draft.weight,50);
  draft.reset();assert.equal(draft.dirty,false);assert.deepEqual(draft.members,saved.members);
  draft.load({...saved,revision:'second',members:[solana]});assert.equal(draft.weight,100);assert.equal(draft.revision,'second');assert.equal(draft.dirty,false);
});

test('identity validation preserves Solana case, normalizes EVM, prevents duplicates and empty baskets',()=>{
  assert.equal(normalizeMember(solana).contract_address,solana.contract_address);
  assert.equal(normalizeMember({...evm(1),contract_address:'0x'+'AB'.repeat(20)}).contract_address,'0x'+'ab'.repeat(20));
  const draft=new BasketDraft(config());
  assert.throws(()=>draft.add({...evm(1),symbol:'Different symbol'}),/already in the draft/);
  assert.throws(()=>draft.add({...solana,contract_address:'Not a contract'}),/valid Solana/);
  assert.throws(()=>draft.add({...evm(2),network:'unknown'}),/supported chain/);
  draft.remove(memberIdentity(evm(1)));
  assert.throws(()=>draft.remove(memberIdentity(solana)),/at least one member/);
  assert.equal(draft.members.length,1);
  for(let index=1;index<MAX_MEMBERS;index++)draft.add(evm(index));
  assert.throws(()=>draft.add(evm(99)),/up to 30 members/);
});

test('saved config rejects duplicates and invalid responses',()=>{
  assert.throws(()=>new BasketDraft({...config(),members:[]}),/saved basket is invalid/);
  assert.throws(()=>new BasketDraft({...config(),members:[evm(1),evm(1)]}),/saved basket is invalid/);
  assert.throws(()=>new BasketDraft({members:[solana]}),/response is incomplete/);
});

test('basket and suggestions escape source text and retain unavailable member weights',()=>{
  const draft=new BasketDraft({...config(),members:[{...solana,symbol:'<script>alert(1)</script>',name:'A & B'}]});
  const html=renderMembers(draft,new Map([[memberIdentity(solana),{eligible:false,exclusionReason:'missing_quote'}]]));
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/A &amp; B/);assert.match(html,/100\.00%/);assert.match(html,/No matching quote/);
  const candidate={...evm(2),name:'<img src=x>',source:'<svg onload=x>',rank:7,holders:12345,observedAt:1900007200000,priceChange1h:1.5};
  const suggestions=renderSuggestions([candidate],draft,1900007200000);
  assert.ok(!suggestions.includes('<img'));assert.ok(!suggestions.includes('<svg'));assert.match(suggestions,/&lt;svg onload=x&gt;/);assert.match(suggestions,/#7/);assert.match(suggestions,/12,345/);assert.match(suggestions,/\+1\.50%/);
});

test('FOMO candidates retain source order, source ranks and holder counts without requiring quotes',()=>{
  const draft=new BasketDraft(config());
  const rows=[{...evm(3),rank:8,holders:246,liquidity:1},{...evm(4),rank:2,holders:9876,liquidity:1000000}];
  const html=renderSuggestions(rows,draft);
  assert.ok(html.indexOf('#8')<html.indexOf('#2'));assert.match(html,/246/);assert.match(html,/9,876/);
  assert.match(html,/FOMO most-held/);assert.match(html,/Not collected/);assert.doesNotMatch(html,/Pool liquidity|1H volume|Pool age/);
  assert.match(html,/data-add-suggestion="0">Add to draft/);
  const missingHolders=renderSuggestions([{...evm(3),rank:1,holders:null}],draft);
  assert.match(missingHolders,/<dt>Holders<\/dt><dd>Not provided by FOMO<\/dd>/);
});

test('warming comparison retains a neutral contribution and initial reference for 24 hours',()=>{
  const now=1900000000000,comparison={status:'warming',delta:0,initialReturn:3.25,firstObservedAt:now,warmUntil:now+24*3600000};
  const html=renderComparison(comparison,now);
  assert.match(html,/Warming/);assert.match(html,/Neutral contribution: 0 pp/);assert.match(html,/Initial 1H reference: \+3\.25%/);assert.match(html,/24h remaining/);
  const elapsed=renderComparison(comparison,now+24*3600000);
  assert.match(elapsed,/Awaiting the next recorded 24H comparison/);assert.doesNotMatch(elapsed,/data-state="active"/);
});

test('active comparison shows recorded delta and reference without manufacturing missing values',()=>{
  const html=renderComparison({status:'active',delta:-1.25,baselineReturn:2.5,baselineSource:'recorded_history'});
  assert.match(html,/Active · -1\.25 pp/);assert.match(html,/24H reference: \+2\.50%/);assert.match(html,/recorded history/);
  assert.match(renderComparison({status:'unavailable',reason:'missing_quote'}),/Unavailable.*No matching quote/);
  assert.match(renderComparison(null),/Awaiting collection/);
  assert.match(renderComparison(null,Date.now(),false),/Not saved.*Reference begins after Save changes/);
});

test('warming members retain their equal weight alongside active members',()=>{
  const draft=new BasketDraft(config()),now=1900000000000;
  const comparisons=new Map([[memberIdentity(solana),{status:'active',delta:1,baselineReturn:2}],[memberIdentity(evm(1)),{status:'warming',initialReturn:4,warmUntil:now+24*3600000}]]);
  const html=renderMembers(draft,new Map(),now,comparisons);
  assert.equal((html.match(/50\.00%/g)||[]).length,2);assert.match(html,/Active · \+1\.00 pp/);assert.match(html,/Warming/);assert.match(html,/Neutral contribution: 0 pp/);
  assert.equal(draft.payload().members[1].comparison,undefined);
});

test('quote display describes the last collected reading and pending membership explicitly',()=>{
  const now=1900000000000;
  assert.deepEqual(quoteState(null),{state:'pending',label:'Awaiting quote',note:'Collected after the basket is saved'});
  assert.equal(quoteState({eligible:false,exclusionReason:'awaiting_collection'}).state,'pending');
  const collected=quoteState({eligible:true,priceChange1h:-.5,observedAt:now-60*60000},now);
  assert.equal(collected.state,'qualified');assert.equal(collected.label,'-0.50%');assert.match(collected.note,/Qualified at last reading/);
  assert.equal(quoteState({eligible:false,exclusionReason:'immature_pool'}).note,'Pool has less than one hour of history');
});

function documentFixture(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},listeners:{},addEventListener(name,callback){this.listeners[name]=callback},querySelectorAll(){return []}});
    return elements.get(id);
  };
  const root={querySelectorAll(){return []}};
  return {getElementById:element,querySelector:selector=>selector==='.meme-basket-page'?root:null,defaultView:{addEventListener(){}},element,async fire(id,type,event={}){await element(id).listeners[type]?.({preventDefault(){},...event})}};
}
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

test('opening Admin never requests suggestions and manual edits send no mutation until Save',async()=>{
  const document=documentFixture(),calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(options?.method==='PUT'){const body=JSON.parse(options.body);return response({...config(),revision:'next',members:body.members})}
    return response(config());
  };
  const mounted=mountBasket(document,fetcher);await mounted.ready;
  assert.deepEqual(calls.map(call=>call.url),['/api/meme-preset']);
  assert.equal(document.element('basket-save').disabled,true);
  document.element('basket-network').value='base';document.element('basket-contract').value=evm(2).contract_address;
  document.element('basket-symbol').value='T2';document.element('basket-name').value='Token 2';
  await document.fire('basket-add-form','submit');
  assert.equal(calls.length,1);assert.equal(mounted.getDraft().members.length,3);assert.equal(document.element('basket-save').disabled,false);
  await document.fire('basket-save','click');
  assert.equal(calls.length,2);assert.equal(calls[1].options.method,'PUT');assert.equal(JSON.parse(calls[1].options.body).revision,config().revision);assert.equal(mounted.getDraft().dirty,false);
});

test('Suggest is explicit; adding a suggested token only edits the draft',async()=>{
  const document=documentFixture(),calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return response(url.endsWith('/suggest')?{suggestions:[{...evm(3),rank:8,holders:246}],source:'FOMO most-held',observedAt:1900000000000,note:'Original source ranking.'}:config())};
  const mounted=mountBasket(document,fetcher);await mounted.ready;
  assert.equal(calls.length,1);
  await document.fire('basket-suggest','click');
  assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/meme-preset/suggest');assert.equal(calls[1].options.method,'POST');assert.equal(mounted.getDraft().dirty,false);
  assert.match(document.element('basket-suggestion-status').textContent,/FOMO most-held.*Source order preserved.*Original source ranking/);
  assert.match(document.element('basket-suggestions').innerHTML,/#8/);assert.match(document.element('basket-suggestions').innerHTML,/246/);
  await document.fire('basket-suggestions','click',{target:{closest:()=>({dataset:{addSuggestion:'0'}})}});
  assert.equal(calls.length,2);assert.equal(mounted.getDraft().dirty,true);assert.equal(mounted.getDraft().members.length,3);
  assert.match(document.element('basket-suggestions').innerHTML,/In draft basket/);
});

test('conflicting saves preserve the full draft and show a useful recovery message',async()=>{
  const document=documentFixture();
  const fetcher=async(url,options)=>options?.method==='PUT'?response({detail:'Basket changed in another session.',current:config()},409):response(config());
  const mounted=mountBasket(document,fetcher);await mounted.ready;
  mounted.getDraft().add(evm(2));
  await document.fire('basket-save','click');
  assert.equal(mounted.getDraft().members.length,3);assert.equal(mounted.getDraft().dirty,true);
  assert.match(document.element('basket-status').textContent,/another session.*draft is preserved.*Reload this page/i);
  assert.equal(document.element('basket-save').disabled,false);
});

test('a persisted save reports when immediate refresh could not be requested',async()=>{
  const document=documentFixture();
  const fetcher=async(url,options)=>options?.method==='PUT'?response({...config(),revision:'new',members:JSON.parse(options.body).members,refreshRequested:false}):response(config());
  const mounted=mountBasket(document,fetcher);await mounted.ready;
  mounted.getDraft().add(evm(2));await document.fire('basket-save','click');
  assert.equal(mounted.getDraft().dirty,false);
  assert.match(document.element('basket-status').textContent,/Basket saved.*immediate refresh could not be requested.*next hourly collection/);
});

test('status refresh updates comparison evidence while preserving unsaved membership and never fetching FOMO',async()=>{
  const document=documentFixture(),calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    const body=config();
    if(calls.length>1)body.members[1]={...body.members[1],comparison:{status:'warming',initialReturn:2,warmUntil:Date.now()+24*3600000}};
    return response(body);
  };
  const mounted=mountBasket(document,fetcher);await mounted.ready;
  mounted.getDraft().add(evm(3));await document.fire('basket-refresh','click');
  assert.equal(mounted.getDraft().members.length,3);assert.equal(mounted.getDraft().dirty,true);
  assert.match(document.element('basket-members').innerHTML,/Warming/);assert.match(document.element('basket-status').textContent,/unsaved draft is preserved/);
  assert.deepEqual(calls.map(call=>call.url),['/api/meme-preset','/api/meme-preset']);
});
