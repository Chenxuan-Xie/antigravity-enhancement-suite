import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';import {PassThrough} from 'node:stream';import {EventEmitter} from 'node:events';import os from 'node:os';
import {handleAccountApiRequest} from '../../../core/api-handler.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','application/javascript']],['/styles.css',['styles.css','text/css']]]);
async function loadSdk(){
  try{return await import('sidecar_sdk');}catch{}
  for(const dir of [path.resolve(directory,'../../../..','node_modules','sidecar_sdk'),path.join(process.env.USERPROFILE||os.homedir(),'.gemini','config','node_modules','sidecar_sdk')]){
    if(fs.existsSync(path.join(dir,'package.json'))){const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));return import(pathToFileURL(path.join(dir,pkg.main||'index.js')).href);}
  }
  throw Error('Antigravity bundled sidecar_sdk is unavailable');
}
if(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT){
  const {SidecarApp,Response}=await loadSdk();const app=new SidecarApp();
  for(const [route,[name,contentType]] of files)app.page(route,()=>new Response(fs.readFileSync(path.join(directory,name)),{contentType}));
  for(const [route,method] of [['/api/accounts','GET'],['/api/accounts/quota','POST'],['/api/switch','POST'],['/api/accounts/delete','POST'],['/api/accounts/meta','POST'],['/api/accounts/import-token','POST'],['/api/oauth/start','POST'],['/api/oauth/status','GET'],['/api/oauth/manual','POST']]){
    app.api(route,async data=>{
      const req=new PassThrough();req.method=method;req.url=route;req.headers={};
      const res=new EventEmitter();let status=200,payload='{}';res.headersSent=false;res.writableEnded=false;
      res.writeHead=code=>{status=code;res.headersSent=true;};res.end=body=>{payload=body;res.writableEnded=true;};
      const handled=handleAccountApiRequest(req,res,route);req.end(method==='GET'?'':JSON.stringify(data));await handled;
      return new Response(payload,{status,contentType:'application/json; charset=utf-8'});
    },method);
  }
  await app.run();
}else{
  const server=http.createServer(async(req,res)=>{
    try{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname.startsWith('/api/')){if(await handleAccountApiRequest(req,res,url.pathname))return;}
      if(url.pathname==='/preload.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end('');return;}
      const entry=files.get(url.pathname);if(!entry){res.writeHead(404);res.end('Not found');return;}
      res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(directory,entry[0])));
    }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:error.message}));}
  });server.listen(Number(process.env.PORT||0),'127.0.0.1',()=>console.log('Account panel listening on http://127.0.0.1:'+server.address().port));
}
