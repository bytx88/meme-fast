const validCount=value=>value===null||value===undefined||value===''?null:Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const validPercent=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=100?Number(value):null;

export function parseHolderInfo(payload,network,address){
 const token=payload?.data,attributes=token?.attributes;
 if(!attributes||typeof attributes.address!=='string'||typeof token.id!=='string')return null;
 if(!token.id.startsWith(`${network}_`))return null;
 const same=network==='solana'?attributes.address===address:attributes.address.toLowerCase()===address.toLowerCase();
 if(!same)return null;
 const count=validCount(attributes.holders?.count);
 if(count===null)return null;
 const top10=validPercent(attributes.holders?.distribution_percentage?.top_10);
 const updatedAt=Date.parse(attributes.holders?.last_updated||'');
 return {count,top10,updatedAt:Number.isFinite(updatedAt)?updatedAt:null};
}
