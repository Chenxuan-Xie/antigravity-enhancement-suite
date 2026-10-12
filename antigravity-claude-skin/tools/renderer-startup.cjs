'use strict';
function skinPalette(settings,systemDark=false){
  const dark=settings.themeMode==='dark'||(settings.themeMode==='system'&&systemDark);
  return {background:dark?'#1F1E1D':'#FAF9F5',foreground:dark?'#ECE9E2':'#3D3A34'};
}
function rendererSource(settings,bundle){
  return `(()=>{if(window!==window.top||!/^https?:\\/\\/127\\.0\\.0\\.1(?::|\\/)/.test(location.href))return;if(!window.__agySuite)window.__agySuiteInitialSettings=${JSON.stringify(settings)};\n${bundle}\n})();`;
}
module.exports={skinPalette,rendererSource};