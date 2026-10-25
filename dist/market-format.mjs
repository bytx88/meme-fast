export const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pct=(value,unit='%')=>typeof value==='number'&&Number.isFinite(value)?`${value>=0?'+':''}${value.toFixed(2)}${unit}`:'—';
export const direction=value=>typeof value==='number'&&Number.isFinite(value)?value>0?'up':value<0?'down':'flat':'flat';
export const when=value=>value?new Date(value).toLocaleString():'—';
