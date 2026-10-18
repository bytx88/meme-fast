// Decimal rounding of the displayed value; ledger values remain unchanged.
export function formatSmartNumber(value){
 if(!Number.isFinite(value))return '—';
 if(value===0)return '0';
 const magnitude=Math.abs(value),places=magnitude>=10?4:magnitude>=1?5:6;
 const [coefficient,exponentText]=magnitude.toExponential().split('e');
 const exponent=Number(exponentText),power=magnitude<0.01?-exponent-2:0;
 const digits=coefficient.replace('.','');
 const shift=exponent+power-digits.length+1+places;
 let rounded;
 if(shift>=0)rounded=BigInt(digits)*10n**BigInt(shift);
 else{
  const divisor=10n**BigInt(-shift),number=BigInt(digits);
  rounded=number/divisor+(number%divisor*2n>=divisor?1n:0n);
 }
 const fixed=rounded.toString().padStart(places+1,'0');
 const integer=fixed.slice(0,-places),fraction=fixed.slice(-places).replace(/0+$/,'');
 const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return (value<0?'-':'')+grouped+(fraction?'.'+fraction:'')+(power?'e-'+power:'');
}
