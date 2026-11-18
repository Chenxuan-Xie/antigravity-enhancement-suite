import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-credential-scope-'));
const appData = path.join(root, 'Roaming');
fs.mkdirSync(path.join(appData, 'Antigravity'), { recursive: true });
process.env.APPDATA = appData;

const {
  credentialTargets,
  credentialScopeForAccount,
  oauthAudienceForAccount,
  inferQuotaWindow,
  buildGeminiQuotaGroup,
  mergeQuotaGroups,
} = await import('../core/account-manager.mjs');

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

const nowMs = Date.parse('2026-11-18T05:00:00Z');
assert.equal(inferQuotaWindow('2026-11-18T09:30:00Z', '', nowMs), '5h');
assert.equal(inferQuotaWindow('2026-11-19T01:00:00Z', '', nowMs), 'daily');
assert.equal(inferQuotaWindow('2026-11-25T05:00:00Z', '', nowMs), 'weekly');

const unifiedGemini = buildGeminiQuotaGroup(
  [
    { modelId: 'gemini-4-hydrogen-sonar', remainingFraction: 0.881, resetTime: '2026-11-18T09:28:38Z' },
    { modelId: 'gemini-3-flash', remainingFraction: 0.881, resetTime: '2026-11-18T09:28:38Z' },
    { modelId: 'claude-sonnet-4-6', remainingFraction: 1, resetTime: '2026-11-18T10:00:00Z' },
  ],
  null,
  nowMs
);
assert.equal(unifiedGemini?.displayName, 'Gemini models');
assert.equal(unifiedGemini?.buckets.length, 1);
assert.equal(unifiedGemini?.buckets[0].remainingPercent, 88);
assert.equal(unifiedGemini?.buckets[0].window, '5h');

const splitGemini = buildGeminiQuotaGroup(
  [
    { modelId: 'gemini-4-hydrogen-sonar', remainingFraction: 0.62, resetTime: '2026-11-18T09:00:00Z' },
    { modelId: 'gemini-3-flash', remainingFraction: 1.0, resetTime: '2026-11-18T09:00:00Z' },
  ],
  null,
  nowMs
);
assert.equal(splitGemini?.buckets.length, 2);
assert.equal(splitGemini?.buckets[0].displayName, 'Gemini Pro/4');
assert.equal(splitGemini?.buckets[0].remainingPercent, 62);
assert.equal(splitGemini?.buckets[1].displayName, 'Gemini Flash');
assert.equal(splitGemini?.buckets[1].remainingPercent, 100);

const fallbackFromModels = buildGeminiQuotaGroup(
  [],
  {
    'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro', quotaInfo: { remainingFraction: 0.96, resetTime: '2026-11-25T05:00:00Z' } },
  },
  nowMs
);
assert.equal(fallbackFromModels?.buckets[0].remainingPercent, 96);
assert.equal(fallbackFromModels?.buckets[0].window, 'weekly');

const mergedGroups = mergeQuotaGroups(
  [
    {
      displayName: 'Claude and GPT models',
      buckets: [{ bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 }],
    },
  ],
  unifiedGemini
);
assert.equal(mergedGroups.length, 2);
assert.equal(mergedGroups[0].displayName, 'Gemini models');
assert.equal(mergedGroups[1].displayName, 'Claude and GPT models');

fs.rmSync(root, { recursive: true, force: true });
console.log('11 credential & Gemini quota checks passed.');
