const dollars = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:3, maximumFractionDigits:3});
const significant = new Intl.NumberFormat('en-US', {maximumSignificantDigits:4, useGrouping:false});

export function formatUnitPrice(value) {
  if(!Number.isFinite(value)||value<=0)return '—';
  if(value>0.1)return dollars.format(value);
  if(value>=0.01)return `$${significant.format(value).replace(/^0(?=\.)/,'')}`;
  const exponent=Math.floor(Math.log10(value))+2;
  const mantissa=significant.format(value/10**exponent).replace(/^0(?=\.)/,'');
  return `$${mantissa} (e${exponent})`;
}
