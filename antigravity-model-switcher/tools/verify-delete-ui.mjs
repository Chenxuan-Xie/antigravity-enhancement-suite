// Native Connect RPC lifecycle checks in an isolated iframe; no real deletion.
import fs from 'node:fs';
import { connectToAntigravity } from './cdp-utils.mjs';
const source=fs.readFileSync(new URL('../core/chat-injector.js',import.meta.url),'utf8').replace('openModal: openModelManagerModal,', 'fixtureError: showError, openModal: openModelManagerModal,');
const cdp=await connectToAntigravity();
try {
 await cdp.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 const results=await cdp.evaluate(`(async()=>{
  const frame=document.createElement('iframe');frame.style.display='none';frame.id='agy-ms-delete-fixture';
  const blobUrl=URL.createObjectURL(new Blob(['<html><body></body></html>'],{type:'text/html'}));
  const loaded=new Promise(resolve=>frame.onload=resolve);frame.src=blobUrl;document.body.append(frame);await loaded;
  const w=frame.contentWindow;
  const keys=['agy-ms-deleted-conversations','agy-ms-pending-deletes'];
  const saved=keys.map(key=>localStorage.getItem(key));
  keys.forEach(key=>localStorage.removeItem(key));
  let writes=0,deletes=0,bridgeDeletes=0,resolveWrite,failDelete=false;
  const deletionOrder=[];
  const deletedIds=[];
  let holdWriteFor=null,resolveHeldWrite;
  const results=[];const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(ok,name)=>{if(!ok)throw new Error(name);results.push(name);};
  const framed=(value,flags=0)=>{const text=new w.TextEncoder().encode(JSON.stringify(value));const bytes=new w.Uint8Array(5+text.length);bytes[0]=flags;new w.DataView(bytes.buffer).setUint32(1,text.length);bytes.set(text,5);return bytes;};
  const response=(value={},flags=0)=>new w.Response(framed(value,flags),{headers:{'Content-Type':'application/connect+json'}});
  const cid='eeeeeeee-1111-2222-3333-aaaaaaaaaaaa';
  const rpc=method=>w.location.origin+'/exa.language_server_pb.LanguageServerService/'+method;
  const send=(method,id=cid)=>w.fetch(rpc(method),{method:'POST',body:framed({cascadeId:id})});
  w.fetch=async (input,options)=>{
   const url=new URL(String(input),w.location.href);
   const body=options?.body;let requestId;
   try{requestId=JSON.parse(typeof body==='string'?body:new w.TextDecoder().decode(body.subarray(5)))?.cascadeId;}catch{}
   if(url.pathname.endsWith('/JetboxWriteSummary')){writes++;if(requestId===holdWriteFor)return new Promise(resolve=>{resolveHeldWrite=()=>resolve(response());});if(writes===1)return new Promise(resolve=>{resolveWrite=()=>resolve(response());});return response();}
   if(url.pathname.endsWith('/JetboxDeleteSummary')){deletionOrder.push('summary');return response();}
   if(url.pathname.endsWith('/DeleteCascadeTrajectory')){deletes++;deletedIds.push(requestId);deletionOrder.push('trajectory');return failDelete?response({error:{code:'internal',message:'fixture failure'}},2):response();}
   if(url.pathname.endsWith('/bridge/delete')){bridgeDeletes++;return new w.Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}
   return new w.Response(JSON.stringify({ok:true,models:[],activeMode:'official',localSessions:[],bridge:{conversationId:'local-fixture',exchanges:[]}}),{headers:{'Content-Type':'application/json'}});
  };
  try {
   w.eval(${JSON.stringify(source)});
   const writing=send('JetboxWriteSummary');
   await pause(20);
   const deleting=send('DeleteCascadeTrajectory');
   await pause(20);
   check(deletes===0,'native deletion waits for pending summary writes');
   resolveWrite();await writing;await deleting;
   check(deletes===1&&bridgeDeletes===1,'successful native deletion synchronizes the relay tombstone');
   check((await send('JetboxWriteSummary')).status===404&&writes===1,'late summary writes cannot recreate the deleted conversation');
   w.__AGY_MODEL_SWITCHER_CLEANUP();w.eval(${JSON.stringify(source)});
   check((await send('JetboxWriteSummary')).status===404&&writes===1,'deleted state survives reinjection and blocks late saves');
   failDelete=true;const failed='dddddddd-1111-2222-3333-aaaaaaaaaaaa';
   await send('DeleteCascadeTrajectory',failed);
   check(bridgeDeletes===1,'a native Connect error returned with HTTP 200 does not delete relay history');
   check((await send('JetboxWriteSummary',failed)).status===200&&writes===2,'failed deletion permits the conversation to keep saving');
   failDelete=false;deletionOrder.length=0;
   await send('JetboxDeleteSummary','bbbbbbbb-1111-2222-3333-aaaaaaaaaaaa');
   check(deletionOrder.join(',')==='summary,trajectory'&&bridgeDeletes===2,'summary deletion finishes by deleting the physical trajectory');
   const siblings=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
   await Promise.all(siblings.map(id=>send('JetboxWriteSummary',id)));
   await send('JetboxDeleteSummary',siblings[1]);
   const marked=JSON.parse(w.localStorage.getItem('agy-ms-deleted-conversations'));
   check(siblings.every((id,i)=>marked.includes(id)===(i===1)),'deleting one UUID never marks its same-title siblings deleted');
   check((await send('JetboxWriteSummary',siblings[0])).status===200&&(await send('JetboxWriteSummary',siblings[2])).status===200,'surviving sibling conversations can continue saving');
   const api=w.__AGY_MODEL_SWITCHER;
   const localId=api.getActiveConversationId();
   api.fixtureError('会话已删除',localId);
   check(w.document.getElementById('agy-ms-error-notice')?.textContent==='会话已删除','conversation errors carry the UUID that produced them');
   api.getState().activeLocalSessionId='local-other-conversation';api.syncAllUI();
   check(!w.document.getElementById('agy-ms-error-notice'),'switching conversations removes the previous deleted-conversation alert');
   api.fixtureError('会话已删除',localId);
   check(!w.document.getElementById('agy-ms-error-notice'),'late errors from another conversation cannot mark the current conversation deleted');
   const frozen='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
   holdWriteFor=frozen;const pendingWrite=send('JetboxWriteSummary',frozen);await pause(20);
   const reusedBody=framed({cascadeId:frozen});
   const deletingFrozen=w.fetch(rpc('DeleteCascadeTrajectory'),{method:'POST',body:reusedBody});await pause(20);
   reusedBody.set(framed({cascadeId:other}));resolveHeldWrite();await pendingWrite;await deletingFrozen;holdWriteFor=null;
   check(deletedIds.at(-1)===frozen&&!deletedIds.includes(other),'waiting for a summary write cannot change the deletion UUID through a reused request buffer');
   return results;
  } finally {
   w.__AGY_MODEL_SWITCHER_CLEANUP?.();frame.remove();URL.revokeObjectURL(blobUrl);
   keys.forEach((key,i)=>saved[i]===null?localStorage.removeItem(key):localStorage.setItem(key,saved[i]));
  }
 })()`,15000);
 results.forEach(item=>console.log('PASS '+item));
} finally {await cdp.call('Emulation.setFocusEmulationEnabled',{enabled:false});cdp.close();}
