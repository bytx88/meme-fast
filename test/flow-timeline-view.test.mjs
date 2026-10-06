import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTimeline} from '../dist/views.mjs';

test('MC rendering connects isolated observations across missing bins without inventing prices',()=>{
  const element=()=>({children:[],attributes:{},textContent:'',clientWidth:900,
    append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},
    setAttribute(key,value){this.attributes[key]=value},addEventListener(){}});
  const elements=new Map(['timeline','coverage-tooltip','mc-legend','timeline-detail'].map(id=>[id,element()]));
  const previousDocument=globalThis.document;
  globalThis.document={getElementById:id=>elements.get(id),querySelector:()=>element(),
    createElement:element,createElementNS:(_,tag)=>({...element(),tag})};
  try{
    const rows=[0,1,3,5].map((minute,i)=>({id:String(i),tokenKey:'solana:ABC',time:minute*60000+1000,price:1+i*.1,usd:100,side:'buy'}));
    renderTimeline(rows,6,360000,true,false,{tokenKey:'solana:ABC',value:1000,price:1});
    const svg=elements.get('timeline').children[0];
    const circles=svg.children.filter(el=>el.tag==='circle');
    const connections=svg.children.filter(el=>el.tag==='line'&&el.attributes['stroke-width']==='2');
    assert.equal(circles.length,4);
    assert.equal(connections.length,3);
    assert.equal(connections.filter(el=>el.attributes['stroke-dasharray']==='4 4').length,2);
    assert.match(elements.get('coverage-tooltip').textContent,/Dashed connections/);
  }finally{globalThis.document=previousDocument}
});
