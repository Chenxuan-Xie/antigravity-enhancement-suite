const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const fontsDir = path.join(rootDir, 'fonts');
const coreCssPath = path.join(rootDir, 'src', 'claude-core.css');
const outCssPath = path.join(rootDir, 'claude-theme.css');

const regWoff2 = fs.readFileSync(path.join(fontsDir, 'SourceSerif4-Regular-latin.woff2')).toString('base64');
const itaWoff2 = fs.readFileSync(path.join(fontsDir, 'SourceSerif4-Italic-latin.woff2')).toString('base64');

const fontFaceCss = `/* ==========================================================================
   Offline Embedded Fonts: ClaudeSerif (Source Serif 4 Variable + Noto Serif SC)
   ========================================================================== */
@font-face {
  font-family: 'ClaudeSerif';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url("data:font/woff2;base64,${regWoff2}") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'ClaudeSerif';
  font-style: italic;
  font-weight: 300 700;
  font-display: swap;
  src: url("data:font/woff2;base64,${itaWoff2}") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
`;

const coreCss = fs.readFileSync(coreCssPath, 'utf8');
const fullCss = fontFaceCss + '\n' + coreCss;
fs.writeFileSync(outCssPath, fullCss, 'utf8');
console.log('Built claude-theme.css successfully! Total size:', (fullCss.length / 1024).toFixed(1), 'KB');
