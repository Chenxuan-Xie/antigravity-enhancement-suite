// Optional account-switch recovery policy, applied in memory on module load.
// Neither file sizes nor ASAR offsets are changed.
function languageServerPolicy(source) {
    let matched = 0;
    const code = source.replace(/\bconst\s+MAX_RESTARTS\s*=\s*\d+\s*;/, () => { matched++; return 'const MAX_RESTARTS = 999;'; })
        .replace(/\bconst\s+RESTART_COOLDOWN_MS\s*=\s*\d+\s*;/, () => { matched++; return 'const RESTART_COOLDOWN_MS = 800;'; });
    return { code, matched, compatible: matched === 2 };
}
module.exports = { languageServerPolicy };
