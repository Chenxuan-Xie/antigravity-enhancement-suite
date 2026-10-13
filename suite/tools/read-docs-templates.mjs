// Collect anonymous DOM copies only. No actual app DOM is overwritten.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readAnonymousTemplates} from './docs-templates.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(root,'artifacts','docs-anonymous-templates.json'),JSON.stringify(await readAnonymousTemplates()));
console.log('Saved anonymous native templates; original page restored.');
