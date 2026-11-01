import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export function localCollectionControls(filename=path.resolve('.data/collection-controls.json')){
 let writing=Promise.resolve();
 async function read(){
  let saved;
  try{saved=JSON.parse(await readFile(filename,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  return {version:1,features:Object.fromEntries(['wallets','mode'].map(key=>[key,{
   enabled:saved?.features?.[key]?.enabled===true,updatedAt:saved?.features?.[key]?.updatedAt??null,
  }]))};
 }
 async function enabled(feature){try{return (await read()).features[feature]?.enabled===true}catch{return false}}
 function update(payload){
  if(!payload||Object.keys(payload).sort().join(',')!=='enabled,feature'||!['wallets','mode'].includes(payload.feature)||typeof payload.enabled!=='boolean')throw new Error('Choose wallets or mode and an enabled boolean');
  writing=writing.catch(()=>{}).then(async()=>{
   const state=await read();
   state.features[payload.feature]={enabled:payload.enabled,updatedAt:Date.now()};
   await mkdir(path.dirname(filename),{recursive:true});
   await writeFile(filename+'.tmp',JSON.stringify(state));await rename(filename+'.tmp',filename);
   return state;
  });
  return writing;
 }
 return {read,enabled,update};
}
