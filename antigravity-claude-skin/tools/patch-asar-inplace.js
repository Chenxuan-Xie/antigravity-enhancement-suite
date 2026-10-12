// Compatibility entry point. Fixed-slot rewriting is retired: never overwrite
// an official archive with a stale backup or depend on preload byte slack.
const { installNativeAppHook } = require('./install-core');
function patchAsarInPlace(options) { return installNativeAppHook(options); }
function ensureCleanBackup() { return { asarModified: false }; }
if (require.main === module) console.log(JSON.stringify(patchAsarInPlace()));
module.exports = { patchAsarInPlace, ensureCleanBackup };
