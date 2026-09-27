import {validPriorityIds,PRIORITY_TTL,tokenKey} from './worker/refresh-priority.mjs';
import {STORY_SOURCES} from './dist/coin-context.mjs';
import http from 'node:http';
import tls from 'node:tls';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collect,readSnapshot} from './worker/coin-collector.mjs';
import {snapshotView,readSnapshotVersion} from './worker/snapshot-view.mjs';
const runFile=promisify(execFile);
const python=process.platform==='win32'?'py':'python3';
// Windows installations may trust a network certificate through the OS store
// while Node's bundled CA list does not. Keep normal TLS verification enabled.
if(process.platform==='win32'&&tls.setDefaultCACertificates&&tls.getCACertificates){
 tls.setDefaultCACertificates([...tls.getCACertificates('default'),...tls.getCACertificates('system')]);
}
const historyFile=path.resolve('.data/coins.json');
const xFactorFile=path.resolve('.data/x-factor.json');
const priorityFile=path.resolve('.data/refresh-priorities.json');
const priorities=new Map();
try{for(const [id,at] of Object.entries(JSON.parse(await readFile(priorityFile,'utf8'))))if(Date.now()-at<PRIORITY_TTL)priorities.set(id,at)}catch{}
let priorityWrite=Promise.resolve();
let collecting=false;
async function tick(){if(collecting)return;collecting=true;try{await runFile(python,['worker/robinhood_indexer.py','scan',path.resolve('.data/robinhood-pools.sqlite'),path.resolve('.data/robinhood-pool-feed.json')],{timeout:280000})}catch(error){console.error('Robinhood pool indexer:',error.message)}try{await collect(historyFile,{priorityIds:[...priorities].filter(([,at])=>Date.now()-at<PRIORITY_TTL).sort((a,b)=>b[1]-a[1]).slice(0,300).map(([id])=>id)})}catch(error){console.error('Coin collector:',error.message)}finally{collecting=false}}

import {createMarketProxy} from './worker/market.mjs';
const market=createMarketProxy();
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const base=path.resolve('dist');
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/refresh-priority'){
 if(req.method!=='POST'){res.writeHead(405).end();return}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>6000){res.writeHead(400).end('Priority request too large');return}}
 let ids;try{ids=validPriorityIds(JSON.parse(body).ids)}catch{res.writeHead(400).end('Request 1 to 30 supported token contracts');return}
 const snapshot=await readSnapshot(historyFile),known=new Set([...(snapshot.coins||[]),...(snapshot.radarCoins||[])].map(c=>tokenKey(c.id))),accepted=ids.filter(id=>known.has(id));
 accepted.forEach(id=>priorities.set(id,Date.now()));for(const [id,at]of priorities)if(Date.now()-at>=PRIORITY_TTL)priorities.delete(id);
 priorityWrite=priorityWrite.catch(()=>{}).then(async()=>{await mkdir(path.dirname(priorityFile),{recursive:true});await writeFile(priorityFile,JSON.stringify(Object.fromEntries(priorities)))});await priorityWrite;
 res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({accepted:accepted.length,expiresInHours:24}));return
 }if(url.pathname==='/api/x-factor'){let report;try{report=JSON.parse(await readFile(xFactorFile,'utf8'))}catch{report={version:1,status:'disconnected',coins:{}}}res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(report));return}if(url.pathname==='/api/new-coins/version'){const payload=await readSnapshotVersion(historyFile,readSnapshot);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(payload));return}if(url.pathname==='/api/new-coins'){const snapshot=await readSnapshot(historyFile);let payload;try{payload=snapshotView(snapshot,url.searchParams.get('view')||'',url.searchParams.getAll('id'),Date.now(),url.searchParams.get('name')||'')}catch(error){res.writeHead(400).end(error.message||'Invalid snapshot request');return}res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(payload));return}if(url.pathname==='/api/pool-catalog'){const query=(url.searchParams.get('query')||'').trim().toLowerCase();if(!/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(query)){res.writeHead(400).end('Use a Robinhood token contract or pool ID');return}try{const result=await runFile(python,['worker/robinhood_indexer.py','query',path.resolve('.data/robinhood-pools.sqlite'),query],{timeout:10000});res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(result.stdout)}catch{res.writeHead(502).end('Pool catalog unavailable')}return}if(url.pathname.startsWith('/api/market/')){const response=await market(new Request(url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return}if(url.pathname.startsWith('/api/context/source/')){const source=STORY_SOURCES.find(s=>s.id===url.pathname.split('/').pop());if(!source){res.writeHead(404).end('Unknown story source');return}const response=await fetch('https://r.jina.ai/'+source.url,{signal:AbortSignal.timeout(28000)});res.writeHead(response.status,{'content-type':'text/plain; charset=utf-8'}).end((await response.text()).slice(0,60000));return}if(url.pathname==='/api/context/search'){const name=url.searchParams.get('name')?.trim()||'',symbol=url.searchParams.get('symbol')?.trim()||'',contract=url.searchParams.get('contract')?.trim()||'';if(!name||name.length>100||!symbol||symbol.length>32||!/^[A-Za-z0-9]{20,100}$/.test(contract)){res.writeHead(400).end('Invalid token context query');return}const query=url.searchParams.get('mode')==='contract'?`"${contract}"`:`"${name}" ${symbol} meme origin story`,target='https://r.jina.ai/http://html.duckduckgo.com/html/?'+new URLSearchParams({q:query});const response=await fetch(target,{headers:{accept:'text/plain'},signal:AbortSignal.timeout(20000)});if(!response.ok){res.writeHead(502).end('Context provider unavailable');return}res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}).end((await response.text()).slice(0,60000));return}const filename=path.resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!filename.startsWith(base+path.sep)){res.writeHead(403).end();return}const data=await readFile(filename);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs': 'text/javascript'})[path.extname(filename)]||'application/octet-stream');res.end(data)}catch{res.writeHead(404).end('Not found')}}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>{console.log(`Local: http://127.0.0.1:${process.env.PORT||4173}`);if(process.env.MEME_COLLECTOR_DISABLED!=='1'){tick();setInterval(tick,300000).unref()}});
