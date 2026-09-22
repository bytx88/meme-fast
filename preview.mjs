import http from 'node:http';
import {createMarketProxy} from './worker/market.mjs';
const market=createMarketProxy();
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const base=path.resolve('dist');
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/market/')){const response=await market(new Request(url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return}const filename=path.resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!filename.startsWith(base+path.sep)){res.writeHead(403).end();return}const data=await readFile(filename);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'})[path.extname(filename)]||'application/octet-stream');res.end(data)}catch{res.writeHead(404).end('Not found')}}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
