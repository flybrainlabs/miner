// Decimal SI prefixes only. IDs, money, hashes and binary storage use other formats.
export function compactNumber(value,{digits=2,locale='en'}={}){
  if(value==null||(typeof value==='number'&&!Number.isFinite(value)))return {text:'—',exact:'Unmeasured',prefix:''};
  if(typeof value!=='bigint'&&typeof value!=='number')return {text:'—',exact:'Unmeasured',prefix:''};
  const negative=value<0,absolute=negative?-value:value,prefixes=['','k','M','G','T'];let level=0;
  if(typeof absolute==='bigint')while(level<4&&absolute>=1000n**BigInt(level+1))level++;
  else while(level<4&&absolute>=1000**(level+1))level++;
  if(typeof absolute==='bigint'){
    const places=10n**BigInt(digits),round=k=>(absolute*places+1000n**BigInt(k)/2n)/(1000n**BigInt(k));let rounded=round(level);
    if(rounded>=1000n*places&&level<4)rounded=round(++level);
    const whole=rounded/places,tail=(rounded%places).toString().padStart(digits,'0').replace(/0+$/,'');
    const separator=(1.1).toLocaleString(locale,{useGrouping:false}).replace(/1/g,'');
    return {text:(negative?'-':'')+whole.toLocaleString(locale,{useGrouping:false})+(tail?separator+tail:'')+(level?' '+prefixes[level]:''),exact:value.toLocaleString(locale),prefix:prefixes[level]};
  }
  const scaled=k=>Math.round(absolute/1000**k*10**digits)/10**digits;
  let number=scaled(level);if(number>=1000&&level<4)number=scaled(++level);
  return {text:(negative?'-':'')+number.toLocaleString(locale,{maximumFractionDigits:digits,useGrouping:false})+(level?' '+prefixes[level]:''),exact:value.toLocaleString(locale),prefix:prefixes[level]};
}
