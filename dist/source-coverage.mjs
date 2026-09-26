export function feedStatus(previous={},now,{error=null,records=null,...details}={}){
 return {...previous,...details,status:error?details.returnedRecords>0?'partial':'failed':'ok',lastAttempt:now,lastSuccess:error?previous.lastSuccess??null:now,error:error?String(error):null,records:error?previous.records??null:records,returnedRecords:error?details.returnedRecords??0:null};
}

export function sourceCoverageNote(snapshot){
 const sources=snapshot.coverage?.sources||snapshot.feeds||{};
 const failed=Object.entries(sources).filter(([,source])=>source?.error).map(([name])=>name.replaceAll('_',' '));
 if(!failed.length)return '';
 const shown=failed.slice(0,3).join(', ');
 return ` · ${failed.length} source${failed.length===1?'':'s'} unavailable: ${shown}${failed.length>3?` +${failed.length-3} more`:''}; coverage may be incomplete`;
}
