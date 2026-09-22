import {contractForCopy,axiomLink} from './contract-copy.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function tokenActions(coin){
 const address=contractForCopy(coin);if(!address)return '';
 const axiom=axiomLink(coin),name=String(coin.name||coin.symbol||'').trim(),find=`https://x.com/search?${new URLSearchParams({q:name,src:'typed_query',f:'live'})}`;
 return `<span class="token-actions compact-token-actions"><button type="button" class="ca-copy" data-copy-ca="${esc(coin.id)}" title="${esc(address)}" aria-label="Copy ${esc(coin.symbol)} contract address">CA ⧉</button><a class="token-find" href="${esc(find)}" target="_blank" rel="noopener noreferrer" aria-label="Find ${esc(name)} on X in a new tab">Find ↗</a><a class="token-detail" href="./?query=${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(coin.symbol)} stats in a new tab">Stats ↗</a>${axiom?`<a class="axiom-link" href="${esc(axiom)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(coin.symbol)} on Axiom">Axiom ↗</a>`:''}</span>`;
}
