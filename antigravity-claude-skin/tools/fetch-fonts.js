const https = require('https');
const fs = require('fs');
const path = require('path');

const fontsDir = path.resolve(__dirname, '..', 'fonts');
fs.mkdirSync(fontsDir, { recursive: true });

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  // Fetch Google Fonts CSS for Source Serif 4 (opsz,wght) and Newsreader
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700&display=swap';
  const css = await fetchText(cssUrl);
  console.log('Fetched Google Fonts CSS length:', css.length);
  fs.writeFileSync(path.join(fontsDir, 'google-source-serif-4.css'), css, 'utf8');

  // Extract latin normal and latin italic woff2 URLs
  const blocks = css.split('/*');
  for (const block of blocks) {
    if (block.includes('latin */')) {
      const isItalic = block.includes('font-style: italic');
      const urlMatch = block.match(/url\((https:\/\/[^)]+\.woff2)\)/);
      if (urlMatch) {
        const woffUrl = urlMatch[1];
        const fileName = isItalic ? 'SourceSerif4-Italic-latin.woff2' : 'SourceSerif4-Regular-latin.woff2';
        console.log('Downloading', fileName, 'from', woffUrl);
        const buf = await fetchBuffer(woffUrl);
        fs.writeFileSync(path.join(fontsDir, fileName), buf);
        console.log('Saved', fileName, buf.length, 'bytes');
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
