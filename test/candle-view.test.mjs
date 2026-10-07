import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCandleHistory} from '../dist/candle-view.mjs';
import {HISTORY_MS} from '../dist/candle-history.mjs';

test('five-day MC line connects observed closes across empty intervals without adding data',()=>{
  const element=()=>({children:[],attributes:{},textContent:'',clientWidth:900,
    append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},
    setAttribute(key,value){this.attributes[key]=String(value)},addEventListener(){}});
  const elements=new Map(['timeline','coverage-tooltip','timeline-title','timeline-detail'].map(id=>[id,element()]));
  const previousDocument=globalThis.document;
  globalThis.document={getElementById:id=>elements.get(id),querySelector:()=>element(),
    createElement:element,createElementNS:(_,tag)=>({...element(),tag})};
  try{
    const now=1800000000000,step=4*60*60*1000;
    const candles=[1,2,4,8].map((bin,i)=>({time:now-HISTORY_MS+bin*step,
      open:1+i,close:1+i,low:1+i,high:1+i,volume:100}));
    renderCandleHistory({status:'loaded',candles},{value:1000,price:1},now);
    const descendants=node=>[node,...node.children.flatMap(descendants)];
    const nodes=descendants(elements.get('timeline'));
    const connections=nodes.filter(el=>el.tag==='line'&&el.attributes['stroke-width']==='2');
    const points=nodes.filter(el=>el.tag==='circle');
    assert.equal(points.length,4);
    assert.equal(connections.length,3);
    assert.equal(connections.filter(el=>el.attributes['stroke-dasharray']==='4 4').length,2);
    assert.equal(nodes.filter(el=>el.tag==='rect'&&el.attributes.fill==='url(#flow-total)').length,4);
    connections.forEach((line,i)=>{
      assert.equal(line.attributes.x1,points[i].attributes.cx);
      assert.equal(line.attributes.y1,points[i].attributes.cy);
      assert.equal(line.attributes.x2,points[i+1].attributes.cx);
      assert.equal(line.attributes.y2,points[i+1].attributes.cy);
    });
    assert.match(elements.get('coverage-tooltip').textContent,/Dashed connections/);
  }finally{globalThis.document=previousDocument}
});
