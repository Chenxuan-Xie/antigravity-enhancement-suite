// Retire only the old suite's unconditional CSS/JS injection. Preserve its
// original Electron bridges; modern renderers load modules from the bootstrap.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const original=path.join(require('./agy-paths.cjs').resolveResourcesDir(),'app.asar','dist','preload.js');
const {code}=require('./runtime-transforms.cjs').retireLegacyPreload(fs.readFileSync(original,'utf8'));
const preload=new Module(original,module);preload.filename=original;preload.paths=Module._nodeModulePaths(path.dirname(original));preload._compile(code,original);
