'use strict';
/**
 * kosmos#8489: Start at login (register.repair) puts a Windows agent back on its recorded account folder only while that
 * folder still holds the account it was recorded with (create.win32RecordedTask, kosmos#8478). The same person could
 * read as a changed account in two ways, and an API key was matched by its last four characters only:
 *   (a) the record held the organization's NAME (the fallback when Claude Code had written no uuid), and later Claude
 *       Code wrote the uuid, or the organization was renamed;
 *   (b) the config was read while Claude Code (or codex, or grok) was writing it, so it did not parse;
 *   (c) two keys with the same last four characters read as one account.
 * Each case is driven through the real reader (win32RecordedTask) against real files in a sandbox, and the words
 * through the real sentence (delete-leftover.startsAgainWords). Nothing here touches a Scheduled Task: neither reader
 * reads or writes one (the end-to-end repair is in delete-leftover.win32-accountkeep-8478.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'samaccount-8489-')));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const store = require('./store');
const accounts = require('./accounts');
const leftover = require('./delete-leftover');

const UUID_ONE = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const UUID_TWO = '6fa459ea-ee8a-3ca4-894e-db77e160355e';
const SET_MODEL = 'claude-opus-5-5';

const made = [];
let seq = 0;
/* An account folder as each provider's own program leaves it. */
function folder(tag) {
  const dir = nodePath.join(SANDBOX, '.claude-' + tag + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const writeClaudeConfig = (dir, oauthAccount) => fs.writeFileSync(accounts.configFile(dir), JSON.stringify(oauthAccount ? { oauthAccount } : { theme: 'dark' }));
const writeClaudeKey = (dir, key) => fs.writeFileSync(require('./claudeaccounts').keyFile(dir), key + '\n');
/* An agent whose profile records its last Windows task on `dir`, with `account` as the identity recorded then. */
function recorded(name, provider, runner, dir, account) {
  made.push(name);
  store.writeProfile(name, { displayName: name, provider, win32Task: { runner, configDir: dir, model: runner === 'claude' ? SET_MODEL : null, account } });
  return name;
}
const why = (name) => create.win32RecordedTask(name).accountWhy;

test.afterEach(() => {
  for (const n of made.splice(0)) fs.rmSync(store.profilePath(n), { force: true });
});

test('kosmos#8489 (a): the same email reads as the same account when the organization was recorded by name and is now a uuid, or renamed; another email or another uuid is still changed', () => {
  const dir = folder('pat');
  // A record from before this change, made while Claude Code wrote only the organization's name.
  writeClaudeConfig(dir, { emailAddress: 'Pat@Example.test', organizationName: 'Acme Studio' });
  const byName = { kind: 'signin', email: 'pat@example.test', keyTail: null, org: 'Acme Studio' };
  const n = recorded('orgname8489', 'anthropic', 'claude', dir, byName);
  assert.equal(why(n), null, 'fixture: the record does not match its own folder');
  // Claude Code now writes the uuid as well: the same person.
  writeClaudeConfig(dir, { emailAddress: 'Pat@Example.test', organizationName: 'Acme Studio', organizationUuid: UUID_ONE });
  assert.equal(why(n), null, 'the same email read as a changed account once Claude Code wrote the organization uuid');
  // The organization renamed, no uuid written: the same person.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Pictures' });
  assert.equal(why(n), null, 'a renamed organization read as a changed account');
  // What a record keeps now is the uuid, never the name, so a later rename cannot change it.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Studio', organizationUuid: UUID_ONE });
  const byUuid = create.win32AccountIdentity('claude', dir);
  assert.deepEqual(byUuid, { kind: 'signin', email: 'pat@example.test', keyTail: null, org: UUID_ONE });
  const u = recorded('orguuid8489', 'anthropic', 'claude', dir, byUuid);
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Pictures', organizationUuid: UUID_ONE });
  assert.equal(why(u), null, 'a rename under the same uuid read as a changed account');
  // Never wider than a person: another organization (both uuids known) and another email are changed.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Studio', organizationUuid: UUID_TWO });
  assert.equal(why(u), 'changed', 'the same email in another organization was trusted');
  writeClaudeConfig(dir, { emailAddress: 'sam@example.test', organizationName: 'Acme Studio', organizationUuid: UUID_ONE });
  assert.equal(why(u), 'changed', 'another person in the same organization was trusted');
  assert.equal(why(n), 'changed', 'another person was trusted against a record that holds an organization name');
  writeClaudeConfig(dir, null);   // signed out: the config is read whole and holds no sign-in
  assert.equal(why(u), 'changed', 'a signed-out folder was not called changed');
});

test('kosmos#8489 (b): a Claude config that cannot be read right now is "could not read", never "changed", and the words say so', () => {
  const dir = folder('lee');
  writeClaudeConfig(dir, { emailAddress: 'lee@example.test', organizationUuid: UUID_ONE });
  const n = recorded('midwrite8489', 'anthropic', 'claude', dir, create.win32AccountIdentity('claude', dir));
  assert.equal(why(n), null, 'fixture: the record does not match its own folder');
  // Caught while Claude Code was writing it: half a file.
  fs.writeFileSync(accounts.configFile(dir), '{"oauthAccount": {"emailAddress": "lee@exa');
  assert.equal(why(n), 'unreadable', 'a config being written read as a changed account');
  const words = leftover.startsAgainWords(n);
  assert.match(words, /^; it starts on the model it was set to, but Kosmos could not read which account is signed in to the folder it used just now, so it starts on your main account unless it can read that by then and it is still the same account\. If it still cannot, Kosmos keeps that folder and tries it again at the next Start at login\.$/);
  assert.doesNotMatch(words, /signed out or changed/, 'the person was told the account signed out or changed');
  // Not there at all, with no key beside it: could not read too.
  fs.rmSync(accounts.configFile(dir));
  assert.equal(why(n), 'unreadable', 'a missing config read as a changed account');
  // Readable again: the same account.
  writeClaudeConfig(dir, { emailAddress: 'lee@example.test', organizationUuid: UUID_ONE });
  assert.equal(why(n), null);
});

test('kosmos#8489 (c): a Claude API key is recorded by a fingerprint of the whole key (never the key), so another key with the same last four is changed; an old last-four record still matches its own key', () => {
  const key = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ';
  const other = 'sk-ant-api03-' + 'b'.repeat(40) + 'WXYZ';   // the same last four characters
  const dir = folder('key');
  writeClaudeKey(dir, key);
  const id = create.win32AccountIdentity('claude', dir);
  assert.equal(id.kind, 'apikey');
  assert.match(id.keyHash, /^[0-9a-f]{16}$/, 'no fingerprint of the key was recorded');
  assert.equal(id.keyTail, 'WXYZ');
  assert.doesNotMatch(JSON.stringify(id), /aaaa/, 'the key itself went into the record');
  const n = recorded('keyhash8489', 'anthropic', 'claude', dir, id);
  assert.equal(why(n), null, 'the same key read as a changed account');
  writeClaudeKey(dir, other);
  assert.equal(why(n), 'changed', 'another key with the same last four characters was trusted');
  // A record written before this change holds the last four only: still the same account for the same key.
  writeClaudeKey(dir, key);
  const old = recorded('keytail8489', 'anthropic', 'claude', dir, { kind: 'apikey', email: null, keyTail: 'WXYZ', org: null });
  assert.equal(why(old), null, 'an old last-four record no longer matches its own key');
  writeClaudeKey(dir, 'sk-ant-api03-' + 'a'.repeat(40) + 'QRST');
  assert.equal(why(old), 'changed', 'an old last-four record matched a key with other last four characters');
});

test('kosmos#8489: the other account modules: a Gemini or Grok key and a codex key by fingerprint; a codex or Grok sign-in file mid-write is "could not read"; a codex sign-out is changed', () => {
  // Gemini: keys only.
  const gem = require('./geminiaccounts');
  const gdir = folder('gem');
  fs.writeFileSync(gem.keyFile(gdir), 'AIza' + 'c'.repeat(30) + 'LMNO');
  const g = recorded('gemkey8489', 'google', 'gemini', gdir, create.win32AccountIdentity('gemini', gdir));
  assert.equal(why(g), null);
  fs.writeFileSync(gem.keyFile(gdir), 'AIza' + 'd'.repeat(30) + 'LMNO');
  assert.equal(why(g), 'changed', 'another Gemini key with the same last four characters was trusted');
  // Grok: a key, then a subscription whose auth.json is being written.
  const grok = require('./grokaccounts');
  const xdir = folder('grok');
  fs.writeFileSync(grok.keyFile(xdir), 'xai-' + 'e'.repeat(30) + 'HIJK');
  const x = recorded('grokkey8489', 'xai', 'grok', xdir, create.win32AccountIdentity('grok', xdir));
  fs.writeFileSync(grok.keyFile(xdir), 'xai-' + 'f'.repeat(30) + 'HIJK');
  assert.equal(why(x), 'changed', 'another Grok key with the same last four characters was trusted');
  const sdir = folder('grokSub');
  fs.writeFileSync(grok.authFile(sdir), JSON.stringify({ 'https://auth.x.ai::client': { email: 'kim@example.test', refresh_token: 'r' } }));
  const s = recorded('groksub8489', 'xai', 'grok', sdir, create.win32AccountIdentity('grok', sdir));
  assert.equal(why(s), null, 'fixture: the Grok sign-in does not match its own folder');
  fs.writeFileSync(grok.authFile(sdir), '{"https://auth.x.ai::client": {"em');
  assert.equal(why(s), 'unreadable', 'a Grok sign-in file being written read as a changed account');
  // codex: a key by fingerprint; a ChatGPT sign-in mid-write; signed out (codex logout deletes auth.json).
  const oa = require('./openaiaccounts');
  const kdir = folder('codexKey');
  fs.writeFileSync(oa.authFile(kdir), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-' + 'g'.repeat(30) + 'TUVW' }));
  const k = recorded('codexkey8489', 'openai', 'codex', kdir, create.win32AccountIdentity('codex', kdir));
  fs.writeFileSync(oa.authFile(kdir), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-' + 'h'.repeat(30) + 'TUVW' }));
  assert.equal(why(k), 'changed', 'another OpenAI key with the same last four characters was trusted');
  const cdir = folder('codexGpt');
  const idToken = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'Ana@example.test' }), account_id: UUID_ONE } }));
  const c = recorded('codexgpt8489', 'openai', 'codex', cdir, create.win32AccountIdentity('codex', cdir));
  assert.equal(why(c), null, 'fixture: the codex sign-in does not match its own folder');
  fs.writeFileSync(oa.authFile(cdir), '{"auth_mode": "chatgpt", "tok');
  assert.equal(why(c), 'unreadable', 'a codex sign-in file being written read as a changed account');
  fs.rmSync(oa.authFile(cdir));
  assert.equal(why(c), 'changed', 'a codex sign-out was not called changed');
});
