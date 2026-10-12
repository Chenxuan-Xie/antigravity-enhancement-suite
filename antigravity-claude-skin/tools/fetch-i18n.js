const fs = require('fs');
const path = require('path');
const https = require('https');

const skinRoot = path.resolve(__dirname, '..');
const i18nDir = path.join(skinRoot, 'i18n');
const dictsDir = path.join(i18nDir, 'dicts');

fs.mkdirSync(dictsDir, { recursive: true });

const baseUrl = 'https://raw.githubusercontent.com/Silas-02/antigravity-desktop-cn/main';
const filesToFetch = [
  { remote: 'localization_engine.js', local: path.join(i18nDir, 'localization_engine.js') },
  { remote: 'dicts/common.json', local: path.join(dictsDir, 'common.json') },
  { remote: 'dicts/menu_nav.json', local: path.join(dictsDir, 'menu_nav.json') },
  { remote: 'dicts/page_agents.json', local: path.join(dictsDir, 'page_agents.json') },
  { remote: 'dicts/page_mcp_knowledge.json', local: path.join(dictsDir, 'page_mcp_knowledge.json') },
  { remote: 'dicts/page_settings.json', local: path.join(dictsDir, 'page_settings.json') },
  { remote: 'dicts/page_workspaces.json', local: path.join(dictsDir, 'page_workspaces.json') },
  { remote: 'dicts/v2.21.1.json', local: path.join(dictsDir, 'v2.21.1.json') }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(dest, buf);
        resolve(buf.length);
      });
    }).on('error', reject);
  });
}

async function main() {
  for (const item of filesToFetch) {
    const url = `${baseUrl}/${item.remote}`;
    const size = await download(url, item.local);
    console.log(`[i18n] Downloaded ${item.remote} (${(size / 1024).toFixed(1)} KB)`);
  }
  console.log('[i18n] All localization files downloaded successfully to', i18nDir);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
