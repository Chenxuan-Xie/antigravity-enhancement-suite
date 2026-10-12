const assert=require('node:assert/strict'),vm=require('node:vm');
const {retireLegacyPreload,legacyPreloadPath}=require('./runtime-transforms.cjs');
let checks=0;const check=(value,message)=>{assert(value,message);checks++;console.log('PASS '+message);};
const legacy=`let injected=0,woken=0;const wf={insertCSS:()=>injected++};
function wk(){woken++;}
wk();
function applyCssAndI18n(css,js){wf.insertCSS(css);js();}
function bootAgyClaude(){applyCssAndI18n('legacy',()=>{throw Error('old bundle ran')});}
bootAgyClaude();globalThis.bridge={native:()=>42,injected,woken};`;
const retired=retireLegacyPreload(legacy),context={};vm.runInNewContext(retired.code,context);
check(retired.legacy&&context.bridge.injected===0,'legacy preload no longer inserts unrecoverable Electron CSS');
check(context.bridge.woken===0,'legacy preload cannot launch a competing old backend');
check(context.bridge.native()===42,'retired preload preserves native bridge functions');
check(retireLegacyPreload(retired.code).code===retired.code,'legacy retirement is idempotent');
const native='globalThis.nativeBridge={working:true};';check(retireLegacyPreload(native).code===native&&!retireLegacyPreload(native).legacy,'official preloads remain byte-identical');
const options=`const backgroundColor = isLight ? '#FAF9F5' : '#141413';\nconst foregroundColor = isLight ? '#141413' : '#FAF9F5';\nnew BrowserWindow({webPreferences:{preload: path_1.default.join(__dirname, 'preload.js')}});`;
const redirected=legacyPreloadPath(options,'D:\\应用数据\\runtime\\legacy-preload.cjs');new vm.Script(redirected.code);
check(redirected.compatible&&redirected.code.includes(JSON.stringify('D:\\应用数据\\runtime\\legacy-preload.cjs')),'legacy window loads the external compatibility preload');
check(redirected.code.includes("'#FAFAFA' : '#131313'")&&redirected.code.includes("'#383A42' : '#FAFAFA'"),'legacy native window colors restore the documented original palette');
check(!legacyPreloadPath('const other = true;','unused').compatible,'unrecognized window source is not silently transformed');
console.log(checks+' legacy preload checks passed.');
