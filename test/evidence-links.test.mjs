import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceLinks} from '../dist/evidence-links.mjs';

const paid={id:'solana:98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump',name:'Paid',symbol:'PAID',chain:'Solana',contract_address:'98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump'};
const duplicate={...paid,id:'solana:ABCD',contract_address:'ABCD'};
const eacc={id:'solana:CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU',name:'Effective Accelerationism',symbol:'e/acc',chain:'Solana',contract_address:'CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU'};
const xlink={id:'robinhood:0x1cdb289befdfac8af945a288bcdccc382cb34d32',name:'XLINK',symbol:'XLINK',chain:'Robinhood Chain',contract_address:'0x1cdb289befdfac8af945a288bcdccc382cb34d32'};
const story=(id,title)=>({id,title,latest:1,posts:[{title,summary:'',url:'https://decrypt.co/story'}]});

test('evidence links distinguish exact contracts from configured alias leads',()=>{
 const links=buildEvidenceLinks([
  story('p','UsePaid joins a new payment campaign'),
  story('e','e/acc community discusses the launch'),
  story('x','xLinkMoney expands its wallet'),
  story('ca',`Pool details ${paid.contract_address}`)
 ],[paid,duplicate,eacc,xlink]);
 assert.equal(links.find(l=>l.narrative.id==='p'&&l.coin.id===paid.id)?.level,'lead');
 assert.equal(links.find(l=>l.narrative.id==='e'&&l.coin.id===eacc.id)?.level,'lead');
 assert.equal(links.find(l=>l.narrative.id==='x'&&l.coin.id===xlink.id)?.level,'lead');
 assert.equal(links.find(l=>l.narrative.id==='ca'&&l.coin.id===paid.id)?.level,'exact');
 assert.equal(links.some(l=>l.narrative.id==='p'&&l.coin.id===duplicate.id),false);
});

test('generic paid wording and duplicate ticker do not imply a token link',()=>{
 const links=buildEvidenceLinks([story('generic','Traders paid lower fees'),story('ticker','The $PAID token gains volume')],[paid,duplicate]);
 assert.equal(links.length,0);
});
