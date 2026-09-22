import {contractForCopy,axiomLink} from './contract-copy.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function tokenActions(coin){
 const address=contractForCopy(coin);if(!address)return '';
 const axiom=axiomLink(coin);
 return `<span class="token-actions compact-token-actions"><button type="button" class="ca-copy" data-copy-ca="${esc(coin.id)}" title="${esc(address)}" aria-label="Copy ${esc(coin.symbol)} contract address">CA ⧉</button><a class="token-detail" href="./?query=${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(coin.symbol)} token research in a new tab">Detail ↗</a>${axiom?`<a class="axiom-link" href="${esc(axiom)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(coin.symbol)} on Axiom">Axiom ↗</a>`:''}</span>`;
}
