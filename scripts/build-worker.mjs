import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
// Embed the existing static app so every route ships with the Worker, without asset bindings.
const assets={};
for(const entry of await readdir('dist',{withFileTypes:true})){
  if(!entry.isFile())continue;
  const ext=entry.name.split('.').at(-1),type={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8'}[ext];
  if(!type)throw new Error('Unsupported asset: '+entry.name);
  assets['/'+entry.name]={type,body:await readFile('dist/'+entry.name,'utf8')};
}
if(!assets['/index.html']||!assets['/narratives.html'])throw new Error('Missing page');
const proxy=await readFile('worker/market.mjs','utf8');
const source=proxy+'\nconst assets='+JSON.stringify(assets)+';\n'+`
const market=createMarketProxy();
export default {async fetch(request){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/market/'))return market(request);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const path=url.pathname==='/'?'/index.html':url.pathname==='/narratives'?'/narratives.html':url.pathname;
  const asset=assets[path];
  if(!asset)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff'}});
}};
`;
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js',source);
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
console.log('Built Worker with '+Object.keys(assets).length+' app assets.');
