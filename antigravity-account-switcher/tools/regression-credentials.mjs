import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-credential-scope-'));
const appData = path.join(root, 'Roaming');
fs.mkdirSync(path.join(appData, 'Antigravity'), { recursive: true });
process.env.APPDATA = appData;

const { credentialTargets, credentialScopeForAccount, oauthAudienceForAccount } = await import('../core/account-manager.mjs');

const scope = 'u1234567890abcdef';
fs.writeFileSync(path.join(appData, 'Antigravity', 'credential-user-scope'), scope, 'utf8');
assert.deepEqual(credentialTargets(), [`antigravity-${scope}`, 'gemini:antigravity']);
assert.equal(credentialScopeForAccount({ id_token: 'x.y.z' }), '');

const sub = '106291770964175177187';
const payload = Buffer.from(JSON.stringify({ sub, email: 'fixture@example.test' })).toString('base64url');
const expected = 'u' + crypto.createHash('sha256').update(sub).digest('hex').slice(0, 16);
assert.equal(credentialScopeForAccount({ id_token: `header.${payload}.signature` }), expected);
assert.equal(credentialScopeForAccount({ credential_scope: 'u-saved-scope' }), 'u-saved-scope');
assert.equal(oauthAudienceForAccount({ id_token: `header.${payload}.signature` }), '');
const audPayload = Buffer.from(JSON.stringify({ aud: '1071006060591-fixture.apps.googleusercontent.com' })).toString('base64url');
assert.equal(oauthAudienceForAccount({ id_token: `header.${audPayload}.signature` }), '1071006060591-fixture.apps.googleusercontent.com');

fs.rmSync(root, { recursive: true, force: true });
console.log('4 credential scope checks passed.');
