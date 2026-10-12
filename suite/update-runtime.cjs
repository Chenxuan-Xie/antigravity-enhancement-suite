const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const runtime=path.resolve(process.argv[2]||process.env.AGY_SUITE_RUNTIME_DIR||path.join(os.homedir(),'.gemini','antigravity-suite'));
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'data','install-manifest.json'),'utf8'));
const settings=JSON.parse(fs.readFileSync(path.join(runtime,'data','suite-settings.json'),'utf8'));
require('./install.cjs').install({runtime,config:manifest.configDir,app:path.dirname(manifest.resourcesDir),
  modules:['skin','i18n','accounts','api'].filter(key=>settings[key]).join(',')||'none',guardian:String(settings.guardian)}).catch(error=>{console.error(error.message);process.exitCode=1;});
