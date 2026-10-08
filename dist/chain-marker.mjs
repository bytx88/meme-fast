export function chainMarker(value){
 const raw=typeof value==='string'?value:value?.network||value?.chain||value?.id?.split(':')[0]||'';
 const chain=String(raw).toLowerCase();
 if(chain==='base')return '<span class="chain-marker base" role="img" aria-label="Base" title="Base">B</span>';
 if(chain==='solana')return '<span class="chain-marker solana" role="img" aria-label="Solana" title="Solana">S</span>';
 if(chain==='robinhood'||chain==='robinhood chain')return '<span class="chain-marker robinhood" role="img" aria-label="Robinhood Chain" title="Robinhood Chain">R</span>';
 if(chain==='bsc'||chain==='bnb chain')return '<span class="chain-marker bsc" role="img" aria-label="BNB Chain" title="BNB Chain">B</span>';
 return '';
}
