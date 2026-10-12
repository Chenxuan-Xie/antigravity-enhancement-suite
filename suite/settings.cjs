const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = process.env.AGY_SUITE_SETTINGS_FILE || path.join(root, 'data', 'suite-settings.json');
const defaults = { version: 1, skin: true, themeMode: 'light', i18n: true, accounts: true, api: true,
  guardian: false, greetingName: '', replyFont: 'default', replySize: 'standard', showUsage: false, quotaReminder: true };
function readSettings() {
  if (!fs.existsSync(file)) return { ...defaults };
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  return validate({ ...defaults, ...data });
}
function validate(data) {
  for (const key of ['skin','i18n','accounts','api','guardian','showUsage','quotaReminder']) {
    if (typeof data[key] !== 'boolean') throw Error(`${key} must be boolean`);
  }
  if (!['light','dark','system'].includes(data.themeMode)) throw Error('Invalid themeMode setting');
  if (!['default','serif','sans'].includes(data.replyFont) || !['small','standard','large'].includes(data.replySize)) throw Error('Invalid typography setting');
  if (typeof data.greetingName !== 'string' || data.greetingName.length > 60) throw Error('称呼最多 60 个字符');
  return Object.fromEntries(Object.keys(defaults).map(key => [key, data[key]]));
}
function writeSettings(patch) {
  for (const key of Object.keys(patch)) if (!(key in defaults)) throw Error('Unknown suite setting: '+key);
  const value = validate({ ...readSettings(), ...patch });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file+'.tmp-'+process.pid;
  fs.writeFileSync(temp, JSON.stringify(value,null,2)+'\n'); fs.renameSync(temp,file);
  return value;
}
module.exports = { root, file, defaults, readSettings, writeSettings, validate };
