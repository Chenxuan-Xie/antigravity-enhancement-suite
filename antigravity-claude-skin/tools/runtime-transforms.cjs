// Optional account-switch recovery policy, applied in memory on module load.
// Neither file sizes nor ASAR offsets are changed.
function languageServerPolicy(source) {
    let matched = 0;
    const code = source.replace(/\bconst\s+MAX_RESTARTS\s*=\s*\d+\s*;/, () => { matched++; return 'const MAX_RESTARTS = 999;'; })
        .replace(/\bconst\s+RESTART_COOLDOWN_MS\s*=\s*\d+\s*;/, () => { matched++; return 'const RESTART_COOLDOWN_MS = 800;'; });
    return { code, matched, compatible: matched === 2 };
}
function retireLegacyPreload(source){
    if(!source.includes('bootAgyClaude')||!source.includes('wf.insertCSS(css)'))return {code:source,legacy:false};
    const pattern=/function\s+applyCssAndI18n\s*\(css,\s*js\)\s*\{/;
    if(!pattern.test(source))return {code:source,legacy:false};
    if(/function\s+applyCssAndI18n\s*\(css,\s*js\)\s*\{\s*return;/.test(source))return {code:source,legacy:true};
    return {legacy:true,code:source.replace(pattern,match=>match+'return;').replace(/^wk\(\);\s*$/m,'')};
}
function legacyPreloadPath(source,preload){
    let matched=0;
    const code=source.replace(/(preload\s*:\s*)([\w$.]+)\.join\(\s*__dirname\s*,\s*['"]preload\.js['"]\s*\)/g,(_,prefix)=>{matched++;return prefix+JSON.stringify(preload);})
      .replace("const backgroundColor = isLight ? '#FAF9F5' : '#141413';","const backgroundColor = isLight ? '#FAFAFA' : '#131313';")
      .replace("const foregroundColor = isLight ? '#141413' : '#FAF9F5';","const foregroundColor = isLight ? '#383A42' : '#FAFAFA';");
    return {code,compatible:matched>0};
}
module.exports = { languageServerPolicy,retireLegacyPreload,legacyPreloadPath };
