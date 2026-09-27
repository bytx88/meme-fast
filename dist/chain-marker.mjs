export function chainMarker(value){
 const raw=typeof value==='string'?value:value?.network||value?.chain||value?.id?.split(':')[0]||'';
 const chain=String(raw).toLowerCase();
 if(chain==='solana')return '<span class="chain-marker solana" role="img" aria-label="Solana" title="Solana">S</span>';
 if(chain==='robinhood'||chain==='robinhood chain')return '<span class="chain-marker robinhood" role="img" aria-label="Robinhood Chain" title="Robinhood Chain">R</span>';
 return '';
}
