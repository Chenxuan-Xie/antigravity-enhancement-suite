'use strict';
const {execFileSync}=require('node:child_process');

function normalizeProxy(value){
  if(!value)return '';
  try{const url=new URL(/^[a-z]+:\/\//i.test(value)?value:'http://'+value);return ['http:','https:','socks5:','socks5h:'].includes(url.protocol)&&url.hostname?url.href:'';}catch{return '';}
}

function proxyEnvironment(env,registry=''){
  const result={};
  const enabled=/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(registry);
  const server=enabled?(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(registry)?.[1]||'').trim():'';
  const perProtocol=Object.fromEntries(server.split(';').filter(item=>item.includes('=')).map(item=>item.trim().split('=')));
  for(const [protocol,key] of [['http','HTTP_PROXY'],['https','HTTPS_PROXY']]){
    const explicit=env[key]||env[key.toLowerCase()]||env.ALL_PROXY||env.all_proxy;
    const fallback=server.includes('=')?(perProtocol[protocol]||perProtocol.http||''):server;
    const value=normalizeProxy(explicit||fallback);
    if(value)result[key]=value;
  }
  if(Object.keys(result).length){
    const entries=(env.NO_PROXY||env.no_proxy||'').split(',').map(value=>value.trim()).filter(Boolean);
    result.NO_PROXY=[...new Set([...entries,'localhost','127.0.0.1','::1'])].join(',');
  }
  return result;
}

function getProxyEnvironment(env=process.env){
  let registry='';
  if(process.platform==='win32')try{registry=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{encoding:'utf8',windowsHide:true,timeout:3000});}catch{}
  return proxyEnvironment(env,registry);
}

function languageServerProxy(source,environment){
  if(environment&& !Object.keys(environment).length)return {code:source,compatible:true,changed:false};
  const expression=environment?JSON.stringify(environment):'require('+JSON.stringify(__filename)+').getProxyEnvironment()';
  let matched=0;
  const code=source.replace(/\bconst\s+env\s*=\s*\{[^;\r\n]*\bshellEnvSync\b[^;\r\n]*\};/g,match=>{matched++;return match+'\nObject.assign(env, '+expression+');';});
  return {code:matched===1?code:source,compatible:matched===1,changed:matched===1};
}
module.exports={proxyEnvironment,getProxyEnvironment,languageServerProxy};
