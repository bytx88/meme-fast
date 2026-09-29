const dollars = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:3, maximumFractionDigits:3});
const significant = new Intl.NumberFormat('en-US', {maximumSignificantDigits:4, useGrouping:false});
const scientific = new Intl.NumberFormat('en-US', {notation:'scientific', maximumSignificantDigits:4});

export function formatUnitPrice(value) {
  if(!Number.isFinite(value)||value<=0)return '—';
  if(value>0.1)return dollars.format(value);
  if(value<0.000001)return `$${scientific.format(value).replace('E','e')}`;
  return `$${significant.format(value)}`;
}
