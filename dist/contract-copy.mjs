// A validated shape is not proof of token identity: the data source must also
// explicitly verify the chain/address pair. Fictional fixtures never pass.
export function contractForCopy(coin) {
 if(!coin||coin.contract_verified!==true||typeof coin.contract_address!=='string')return null;
 const address=coin.contract_address;
 const valid=coin.chain==='Solana'?/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address):['Base','Ethereum','BSC','Arbitrum','Polygon'].includes(coin.chain)&&/^0x[a-fA-F0-9]{40}$/.test(address);
 return valid?address:null;
}
export async function copyContract(coin,clipboard) {
 const address=contractForCopy(coin);
 if(!address)return {status:'unavailable'};
 try {
  if(!clipboard?.writeText)return {status:'manual',address};
  await clipboard.writeText(address);
  return {status:'copied',address};
 }catch{return {status:'manual',address}}
}
