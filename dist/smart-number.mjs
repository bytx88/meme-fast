// eN is the user's compact inverse-power suffix: multiply by 10^-N.
// Truncate visible decimals, preserving full values in the underlying ledger.
export function formatSmartNumber(value){
 if(!Number.isFinite(value))return '—';
 if(value===0)return '0';
 const magnitude=Math.abs(value),places=magnitude>=10?4:magnitude>=1?5:6;
 const [coefficient,exponentText]=magnitude.toExponential().split('e');
 const exponent=Number(exponentText),power=magnitude<0.01?-exponent-2:0;
 const digits=coefficient.replace('.',''),point=exponent+power+1;
 const integer=point>0?digits.padEnd(point,'0').slice(0,point):'0';
 const fraction=((point<0?'0'.repeat(-point):'')+digits.slice(Math.max(0,point))).slice(0,places).replace(/0+$/,'');
 const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return (value<0?'-':'')+grouped+(fraction?'.'+fraction:'')+(power?' e'+power:'');
}
