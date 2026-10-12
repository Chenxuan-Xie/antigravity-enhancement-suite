import settings from './settings.cjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
export async function handleSuiteApi(req,res,pathname) {
  if (pathname !== '/api/suite/settings') return false;
  const origin = req.headers?.origin || '';
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.writeHead(403);res.end();return true;
  }
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'Access-Control-Allow-Origin':origin || '*','Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Private-Network':'true'});res.end(JSON.stringify(value));};
  try {
    if(req.method==='OPTIONS'){send(200,{ok:true});return true;}
    if(req.method==='GET'){send(200,{ok:true,settings:settings.readSettings()});return true;}
    if(req.method!=='POST'){send(405,{ok:false,error:'Method not allowed'});return true;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('Settings body too large');chunks.push(chunk);}
    const patch=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Settings must be an object');
    for(const key of Object.keys(patch))if(!(key in settings.defaults))throw Error('Unknown suite setting: '+key);
    const previous=settings.readSettings();settings.validate({...previous,...patch});
    if(patch.api===false&&(await import('../antigravity-model-switcher/core/api-handler.mjs')).getActiveModelRequestCount()>0)throw Error('请先完成或停止正在运行的 API 请求');
    if(patch.guardian!==undefined && !process.env.AGY_SUITE_TEST) {
      const script=path.join(settings.root,'antigravity-claude-skin','tools','register-guardian.ps1');
      // A newly launched guardian reads this flag immediately. Persist first,
      // then roll back on failure instead of starting it against an old flag.
      settings.writeSettings({guardian:patch.guardian});
      try{await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
        ...(patch.guardian?[]:['-Disable'])],{windowsHide:true,timeout:20000});}
      catch(error){settings.writeSettings({guardian:previous.guardian});throw error;}
    }
    send(200,{ok:true,settings:settings.writeSettings(patch)});
  }catch(error){send(400,{ok:false,error:error.message});}
  return true;
}
