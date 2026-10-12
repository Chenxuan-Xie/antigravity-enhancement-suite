const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..');
function args(argv){const out={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]===undefined)throw Error('Invalid install arguments');out[argv[i].slice(2)]=argv[i+1];}return out;}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+process.pid;fs.writeFileSync(temp,value);fs.renameSync(temp,file);}
function copyTree(from,to,filter=()=>true,overwrite=true){
  if(!filter(from))return;
  const stat=fs.lstatSync(from);if(stat.isSymbolicLink())throw Error('Runtime packages must not contain symlinks: '+from);
  if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from))copyTree(path.join(from,entry),path.join(to,entry),filter,overwrite);}
  else if(overwrite||!fs.existsSync(to)){fs.mkdirSync(path.dirname(to),{recursive:true});const temp=to+'.tmp-'+process.pid;fs.copyFileSync(from,temp);fs.renameSync(temp,to);}
}
function copyRuntime(from,to){
  const allowed=['suite','antigravity-claude-skin','antigravity-account-switcher','antigravity-model-switcher'];
  for(const name of allowed)copyTree(path.join(from,name),path.join(to,name),file=>{
    const parts=path.relative(path.join(from,name),file).split(path.sep);
    if(parts.some(part=>['.git','node_modules','backup','inspect','i18n-repo','tools-test'].includes(part)))return false;
    if(parts.includes('data'))return path.basename(file)==='data'||file.endsWith('.example.json');
    return !/\.(log|pid|bak|tmp)(\.|$)/.test(file);
  });
  for(const name of ['install-all.ps1','uninstall-all.ps1','live-reload.ps1','双击一键安装.cmd','双击一键卸载.cmd'])fs.copyFileSync(path.join(from,name),path.join(to,name));
}
function migrateData(from,to){
  for(const name of ['antigravity-account-switcher','antigravity-model-switcher']){
    const input=path.join(from,name,'data'),output=path.join(to,name,'data');
    if(fs.existsSync(input)&&path.resolve(input)!==path.resolve(output))copyTree(input,output,file=>!file.endsWith('.log')&&!/\.tmp/.test(file),false);
  }
}
function config(file){if(!fs.existsSync(file))return {};return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function installPlugins(runtime,configDir,settings){
  const configFile=path.join(configDir,'config.json'),original=config(configFile);
  const backup=path.join(runtime,'data','plugin-config-before.json');if(!fs.existsSync(backup))write(backup,JSON.stringify({plugins:{'account-switcher':original.plugins?.['account-switcher']??null,'api-model-switcher':original.plugins?.['api-model-switcher']??null}}));
  const {pathToFileURL}=require('node:url');
  for(const [module,id,enabled] of [['antigravity-account-switcher','account-switcher',settings.accounts],['antigravity-model-switcher','api-model-switcher',settings.api]]){
    console.log('[Plugin] '+id);
    const destination=path.join(configDir,'plugins',id),root=path.join(runtime,module);
    // Copy via temporary files; avoid native cpSync path/overwrite failures
    // seen on Windows with non-ASCII source and destination paths.
    copyTree(path.join(root,'plugin'),destination);
    console.log('[Plugin] Files copied');
    const main=path.join(destination,'sidecars','panel','main.mjs');let code=fs.readFileSync(main,'utf8');
    code=code.replaceAll('../../../core/api-handler.mjs',pathToFileURL(path.join(root,'core','api-handler.mjs')).href);
    code=code.replace('path.resolve(__dirname, "../../../core/daemon.mjs")',JSON.stringify(path.join(runtime,'antigravity-account-switcher','core','daemon.mjs')));
    write(main,code);
    if(module==='antigravity-model-switcher')write(path.join(destination,'mcp_config.json'),JSON.stringify({mcpServers:{'api-model-switcher-mcp':{command:process.execPath,args:[path.join(root,'core','mcp-server.mjs')]}}},null,2));
    original.plugins??={};original.plugins[id]={...original.plugins[id],enabled};
  }
  write(configFile,JSON.stringify(original,null,2)+'\n');
}
async function install(options){
  console.log('[Install] Preparing independent runtime');
  const runtime=path.resolve(options.runtime||process.env.AGY_SUITE_RUNTIME_DIR||path.join(os.homedir(),'.gemini','antigravity-suite'));
  const configDir=path.resolve(options.config||path.join(os.homedir(),'.gemini','config'));
  const test=options.test==='true';
  // Parse existing config before making any changes. A corrupt config is never overwritten.
  config(path.join(configDir,'config.json'));
  let rendererChecked=false;
  if(!test){
    try{const {connectToAntigravity}=await import('../antigravity-model-switcher/tools/cdp-utils.mjs');const cdp=await connectToAntigravity();try{if(await cdp.evaluate('!!window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat || !!document.querySelector(\'button[data-tooltip-id="input-send-button-cancel-tooltip"]\')'))throw Error('请等待当前生成结束后安装');rendererChecked=true;}finally{cdp.close();}}
    catch(error){if(error.message.includes('请等待'))throw error;}
  }
  const modules=options.modules==='none'?[]:(options.modules||'skin,i18n,accounts,api').split(',').filter(Boolean);
  if(modules.some(name=>!['skin','i18n','accounts','api'].includes(name)))throw Error('Unknown module selection');
  if(options.app)process.env.AGY_APP_DIR=path.resolve(options.app);
  const sourcePaths=require('../antigravity-claude-skin/tools/agy-paths.cjs');
  const resources=sourcePaths.resolveResourcesDir();
  require('../antigravity-claude-skin/tools/install-core.js').readAsarPackageJson(path.join(resources,'app.asar'));
  const oldHook=path.join(resources,'app','index.js');let oldRuntime='';
  if(fs.existsSync(oldHook)){
    const content=fs.readFileSync(oldHook,'utf8');
    if(!content.includes('AGY_EXTERNAL_BOOTSTRAP_V2'))throw Error('应用已有其他启动器，未覆盖；请先移除其他启动器');
    const match=content.match(/require\(("(?:\\.|[^"\\])*")\)/);
    if(match){const bootstrap=JSON.parse(match[1]);if(path.basename(bootstrap)==='native-bootstrap.cjs')oldRuntime=path.resolve(path.dirname(bootstrap),'../..');}
  }
  let backend;
  if(!test){
    try{backend=await fetch('http://127.0.0.1:19823/api/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());}catch{}
    if(backend&&backend.service!=='antigravity-account-switcher')throw Error('本机 19823 端口由其他程序占用');
    if(backend&&(backend.activeRequests>0||(!rendererChecked&&backend.activeRequests===undefined)))throw Error('无法确认旧后端空闲；请打开 Antigravity 后重新安装');
    const allowed=[runtime,oldRuntime,options.legacy?path.resolve(options.legacy):source].filter(Boolean);
    if(backend){
      const scripts=allowed.map(dir=>path.join(dir,'antigravity-account-switcher','core','daemon.mjs').replace(/'/g,"''"));
      const verified=execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(backend.pid)}'; if($p -and $p.Name -eq 'node.exe' -and (@(${scripts.map(s=>"'"+s+"'").join(',')}) | Where-Object { $p.CommandLine.Contains($_) })) { 'owned' }`],{windowsHide:true,encoding:'utf8'}).trim();
      if(verified!=='owned')throw Error('端口对应其他安装的后端；未停止该进程');
    }
    // Disable the previous recovery task before replacing its runtime. Stop only
    // guardians whose exact script paths belong to this app's existing hook.
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(source,'antigravity-claude-skin','tools','register-guardian.ps1'),'-Disable'],{windowsHide:true});
    for(const dir of new Set([runtime,oldRuntime].filter(Boolean))){const guardian=path.join(dir,'antigravity-claude-skin','tools','auto-heal-daemon.js').replace(/'/g,"''");execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine.Contains('${guardian}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],{windowsHide:true});}
    if(backend)process.kill(backend.pid);
  }
  if(source!==runtime){fs.mkdirSync(runtime,{recursive:true});console.log('[Install] Copying core files');copyRuntime(source,runtime);console.log('[Install] Preserving local data');migrateData(source,runtime);}
  if(options.legacy)migrateData(path.resolve(options.legacy),runtime);
  if(oldRuntime&&oldRuntime!==runtime)migrateData(oldRuntime,runtime);
  const settings=require(path.join(runtime,'suite','settings.cjs'));
  const selected=Object.fromEntries(['skin','i18n','accounts','api'].map(key=>[key,modules.includes(key)]));
  selected.guardian=options.guardian==='true';settings.writeSettings(selected);
  process.env.AGY_NODE_BIN=process.execPath;
  fs.mkdirSync(path.join(runtime,'antigravity-claude-skin','backup'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'antigravity-claude-skin','backup','node-bin.txt'),'\uFEFF'+process.execPath,'utf16le');
  if(options.app)process.env.AGY_APP_DIR=path.resolve(options.app);
  console.log('[Install] Installing selected plugins');installPlugins(runtime,configDir,settings.readSettings());
  for(const builder of ['build-theme.js','build-i18n.js'])require(path.join(runtime,'antigravity-claude-skin','tools',builder));
  const core=require(path.join(runtime,'antigravity-claude-skin','tools','install-core.js'));
  const paths=require(path.join(runtime,'antigravity-claude-skin','tools','agy-paths.cjs'));
  paths.saveInstallPathsCache({nodeBin:process.execPath,resourcesDir:paths.resolveResourcesDir()});
  core.installNativeAppHook();
  write(path.join(runtime,'data','install-manifest.json'),JSON.stringify({runtime,configDir,resourcesDir:paths.resolveResourcesDir(),version:2,installedAt:new Date().toISOString()},null,2));
  if(!test){
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(runtime,'antigravity-claude-skin','tools','register-guardian.ps1'),...(selected.guardian?[]:['-Disable'])],{stdio:'inherit',windowsHide:true});
    const child=spawn(process.execPath,[path.join(runtime,'antigravity-account-switcher','core','daemon.mjs')],{detached:true,stdio:'ignore',windowsHide:true});child.unref();
    for(let attempt=0;attempt<20;attempt++){try{const health=await fetch('http://127.0.0.1:19823/api/health',{signal:AbortSignal.timeout(500)}).then(r=>r.json());if(health.runtimeRoot===runtime)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    try{await core.injectLiveViaCdp();}catch(error){console.log('下次启动应用时加载：'+error.message);}
  }
  console.log(JSON.stringify({installed:true,runtime,modules,guardian:selected.guardian,sourceCanBeDeleted:true}));return runtime;
}
async function uninstall(options){
  const runtime=path.resolve(options.runtime||process.env.AGY_SUITE_RUNTIME_DIR||path.join(os.homedir(),'.gemini','antigravity-suite'));
  const manifest=config(path.join(runtime,'data','install-manifest.json'));if(manifest.runtime!==runtime)throw Error('找不到此安装的清单；未更改应用');
  const settings=require(path.join(runtime,'suite','settings.cjs'));
  if(options.test!=='true'){
    const health=await fetch('http://127.0.0.1:19823/api/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.json()).catch(()=>null);
    if(health?.activeRequests>0)throw Error('请先完成或停止正在运行的 API 请求');
  }
  const disabled=settings.writeSettings({skin:false,i18n:false,accounts:false,api:false,guardian:false});
  if(options.test!=='true'){
    const core=require(path.join(runtime,'antigravity-claude-skin','tools','install-core.js'));
    await core.injectLiveViaCdp({settings:disabled}).catch(()=>{});
  }
  if(options.test!=='true'){
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(runtime,'antigravity-claude-skin','tools','register-guardian.ps1'),'-Disable'],{windowsHide:true});
    const daemon=path.join(runtime,'antigravity-account-switcher','core','daemon.mjs').replace(/'/g,"''");
    execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine.Contains('${daemon}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],{windowsHide:true});
  }
  const hook=path.join(manifest.resourcesDir,'app','index.js');
  if(fs.existsSync(hook)){
    const content=fs.readFileSync(hook,'utf8');
    if(content.includes('AGY_EXTERNAL_BOOTSTRAP_V2')&&content.includes(JSON.stringify(path.join(runtime,'antigravity-claude-skin','tools','native-bootstrap.cjs')))){
      fs.unlinkSync(hook);fs.unlinkSync(path.join(manifest.resourcesDir,'app','package.json'));
    }else throw Error('启动器已由其他程序更改，未删除');
  }
  const configFile=path.join(manifest.configDir,'config.json'),current=config(configFile),before=config(path.join(runtime,'data','plugin-config-before.json'));
  for(const id of ['account-switcher','api-model-switcher'])if(current.plugins){if(before.plugins?.[id])current.plugins[id]=before.plugins[id];else delete current.plugins[id];}
  write(configFile,JSON.stringify(current,null,2)+'\n');
  console.log('已卸载启动器和后台任务；账号、密钥与会话仍保存在 '+runtime+'。重新启动应用可恢复官方界面。');
}
if(require.main===module){const options=args(process.argv.slice(2));(options.uninstall==='true'?uninstall(options):install(options)).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={install,uninstall,copyRuntime,migrateData,installPlugins};
