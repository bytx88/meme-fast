import test from 'node:test';
import assert from 'node:assert/strict';
import {setupMCDetail} from '../dist/mc-detail-view.mjs';

test('MC bars preserve volume shares, unknown wick tiers, and swap mode when switching windows',()=>{
  const element=()=>({children:[],attributes:{},style:{},textContent:'',className:'',
    classList:{toggle(){}},append(...items){this.children.push(...items)},prepend(...items){this.children.unshift(...items)},
    replaceChildren(){this.children=[]},setAttribute(k,v){this.attributes[k]=v},addEventListener(){},closest(){return table}});
  const table=element(),ids=['mc-metric','mc-tiers','mc-net-heading','mc-buy-heading','mc-sell-heading','mc-detail-pane','mc-detail-note'];
  const elements=new Map(ids.map(id=>[id,element()]));
  const selector=elements.get('mc-metric');selector.value='count';selector.options=['value','count','average'].map(value=>({value}));
  const old=globalThis.document;globalThis.document={getElementById:id=>elements.get(id),querySelectorAll:()=>[],createElement:element};
  try{
    const render=setupMCDetail(),snapshot={value:500000,price:.5,tokenKey:'solana:ABC'};
    const candles=[{time:1000,open:.5,close:.5,low:.5,high:.9,volume:300},{time:2000,open:.4,close:.4,low:.4,high:.4,volume:100}];
    render([],snapshot,false,true,false,{status:'loaded',candles});
    assert.equal(selector.value,'value');assert.ok(selector.options.slice(1).every(o=>o.disabled));
    assert.equal(elements.get('mc-buy-heading').hidden,true);assert.equal(elements.get('mc-sell-heading').hidden,true);
    const tiers=elements.get('mc-tiers').children;
    assert.ok(tiers.every(row=>row.children.length===3));
    const current=tiers.find(row=>row.className==='mc-current');assert.ok(current);
    assert.equal(current.children[0].children[0].textContent,'Current MC');
    assert.equal(current.children[1].children[0].children[0].textContent,'75.0%');
    assert.equal(current.children[1].children[1].children[0].style.width,'100%');
    assert.equal(current.children[2].children[0].textContent,'Busiest by volume');
    assert.ok(tiers.some(row=>row.children[1].textContent==='—'&&row.children[1].children.length===0));
    const rows=[{tokenKey:'solana:ABC',price:.5,usd:300,side:'buy'},{tokenKey:'solana:ABC',price:.5,usd:100,side:'sell'}];
    render(rows,snapshot,false,true,false);
    assert.ok(selector.options.every(o=>!o.disabled));assert.equal(elements.get('mc-buy-heading').hidden,false);
    const swap=elements.get('mc-tiers').children[0];assert.equal(swap.children.length,5);
    assert.equal(swap.children[2].children[0].children[0].textContent,'75.0%');
    assert.equal(swap.children[3].children[0].children[0].textContent,'25.0%');
    assert.ok(Math.abs(parseFloat(swap.children[3].children[1].children[0].style.width)-100/3)<1e-10);
    selector.value='average';render(rows.slice(0,1),snapshot,false,true,false);
    const average=elements.get('mc-tiers').children[0];
    assert.equal(average.children[3].children.length,1); // Unknown side has no bar or percentage.
    assert.equal(average.children[2].children[0].children.length,0);
    render([],snapshot,false,false,false,{status:'loading',candles:[]});
    assert.equal(elements.get('mc-tiers').children[0].children[0].colSpan,3);
  }finally{globalThis.document=old}
});
