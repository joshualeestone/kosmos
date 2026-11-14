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
/* The identity a record holds, built by hand in the shape create writes (what create itself writes is pinned end to
   end in delete-leftover.win32-accountkeep-8478.test.js): a sign-in by its lower-cased email and organization id, a key
   by its last four and the first 16 hex of its sha256, never the key. */
const signinId = (email, org = null, kind = 'signin') => ({ kind, email, keyTail: null, org });
const keyId = (key) => ({ kind: 'apikey', email: null, keyTail: key.slice(-4),
  keyHash: require('node:crypto').createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16), org: null });

test.afterEach(() => {
  for (const n of made.splice(0)) fs.rmSync(store.profilePath(n), { force: true });
});

test('kosmos#8489 (a): a recorded organization name is the same account once Claude Code writes the uuid beside that name; another name, another uuid or another email is changed; a folder with no name to compare is "could not read"', () => {
  const dir = folder('pat');
  // A record from before this change, made while Claude Code wrote only the organization's name.
  writeClaudeConfig(dir, { emailAddress: 'Pat@Example.test', organizationName: 'Acme Studio' });
  const byName = { kind: 'signin', email: 'pat@example.test', keyTail: null, org: 'Acme Studio' };
  const n = recorded('orgname8489', 'anthropic', 'claude', dir, byName);
  assert.equal(why(n), null, 'fixture: the record does not match its own folder');
  // Claude Code now writes the uuid as well: the same person.
  writeClaudeConfig(dir, { emailAddress: 'Pat@Example.test', organizationName: 'Acme Studio', organizationUuid: UUID_ONE });
  assert.equal(why(n), null, 'the same email read as a changed account once Claude Code wrote the organization uuid');
  // A recorded name is compared with the name the folder shows now. Another name, with or without a
  // uuid, is another organization (and its billing), so changed; a folder with only a uuid shows nothing to compare.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Pictures' });
  assert.equal(why(n), 'changed', 'a record holding one organization name matched a folder in another');
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Other Co', organizationUuid: UUID_TWO });
  assert.equal(why(n), 'changed', 'a record holding an organization name matched a folder signed in to another organization');
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationUuid: UUID_TWO });
  assert.equal(why(n), 'unreadable', 'a folder with no organization name to compare was read as same or changed');
  // A record holding the uuid (what create records now): a rename under it is the same account.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Studio', organizationUuid: UUID_ONE });
  const byUuid = signinId('pat@example.test', UUID_ONE);
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
  const n = recorded('midwrite8489', 'anthropic', 'claude', dir, signinId('lee@example.test', UUID_ONE));
  assert.equal(why(n), null, 'fixture: the record does not match its own folder');
  // Caught while Claude Code was writing it: half a file.
  fs.writeFileSync(accounts.configFile(dir), '{"oauthAccount": {"emailAddress": "lee@exa');
  assert.equal(why(n), 'unreadable', 'a config being written read as a changed account');
  const words = leftover.startsAgainWords(n);
  assert.match(words, /^; it starts on the model it was set to, but Kosmos could not read which account is signed in to the account folder it last used, so it starts on your main account unless it can read that by then and it is still the same account\. If it still cannot, Kosmos keeps that folder and tries it again at the next Start at login, unless its startup job is written again before then \(changing its account or model does that\), which forgets that folder\.$/);
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
  const id = keyId(key);
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
  const g = recorded('gemkey8489', 'google', 'gemini', gdir, keyId('AIza' + 'c'.repeat(30) + 'LMNO'));
  assert.equal(why(g), null);
  fs.writeFileSync(gem.keyFile(gdir), 'AIza' + 'd'.repeat(30) + 'LMNO');
  assert.equal(why(g), 'changed', 'another Gemini key with the same last four characters was trusted');
  // Grok: a key, then a subscription whose auth.json is being written.
  const grok = require('./grokaccounts');
  const xdir = folder('grok');
  fs.writeFileSync(grok.keyFile(xdir), 'xai-' + 'e'.repeat(30) + 'HIJK');
  const x = recorded('grokkey8489', 'xai', 'grok', xdir, keyId('xai-' + 'e'.repeat(30) + 'HIJK'));
  fs.writeFileSync(grok.keyFile(xdir), 'xai-' + 'f'.repeat(30) + 'HIJK');
  assert.equal(why(x), 'changed', 'another Grok key with the same last four characters was trusted');
  const sdir = folder('grokSub');
  fs.writeFileSync(grok.authFile(sdir), JSON.stringify({ 'https://auth.x.ai::client': { email: 'kim@example.test', refresh_token: 'r' } }));
  const s = recorded('groksub8489', 'xai', 'grok', sdir, signinId('kim@example.test', null, 'subscription'));
  assert.equal(why(s), null, 'fixture: the Grok sign-in does not match its own folder');
  fs.writeFileSync(grok.authFile(sdir), '{"https://auth.x.ai::client": {"em');
  assert.equal(why(s), 'unreadable', 'a Grok sign-in file being written read as a changed account');
  // codex: a key by fingerprint; a ChatGPT sign-in mid-write; signed out (codex logout deletes auth.json).
  const oa = require('./openaiaccounts');
  const kdir = folder('codexKey');
  fs.writeFileSync(oa.authFile(kdir), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-' + 'g'.repeat(30) + 'TUVW' }));
  const k = recorded('codexkey8489', 'openai', 'codex', kdir, keyId('sk-proj-' + 'g'.repeat(30) + 'TUVW'));
  fs.writeFileSync(oa.authFile(kdir), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-' + 'h'.repeat(30) + 'TUVW' }));
  assert.equal(why(k), 'changed', 'another OpenAI key with the same last four characters was trusted');
  const cdir = folder('codexGpt');
  const idToken = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'Ana@example.test' }), account_id: UUID_ONE } }));
  const c = recorded('codexgpt8489', 'openai', 'codex', cdir, signinId('ana@example.test', UUID_ONE, 'chatgpt'));
  assert.equal(why(c), null, 'fixture: the codex sign-in does not match its own folder');
  fs.writeFileSync(oa.authFile(cdir), '{"auth_mode": "chatgpt", "tok');
  assert.equal(why(c), 'unreadable', 'a codex sign-in file being written read as a changed account');
  fs.rmSync(oa.authFile(cdir));
  assert.equal(why(c), 'changed', 'a codex sign-out was not called changed');
});

test('kosmos#8489: a recorded organization id with none in the folder now is "could not read", never the same account; so is none recorded and one now; none on either side is the email alone', () => {
  const dir = folder('orgGone');
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationUuid: UUID_ONE });
  const n = recorded('orggone8489', 'anthropic', 'claude', dir, signinId('pat@example.test', UUID_ONE));
  // The config now shows only an organization name: which organization it is cannot be told.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationName: 'Acme Studio' });
  assert.equal(why(n), 'unreadable', 'a recorded organization uuid matched a folder that shows none');
  // Recorded with none, the folder now shows one: the email decides.
  const m = recorded('orgnew8489', 'anthropic', 'claude', dir, { kind: 'signin', email: 'pat@example.test', keyTail: null, org: null });
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationUuid: UUID_TWO });
  assert.equal(why(m), 'unreadable', 'a record with no organization matched a folder in one');
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test' });
  assert.equal(why(m), null, 'no organization on either side did not fall back to the email');
  // codex: a recorded workspace with none in auth.json now.
  const oa = require('./openaiaccounts');
  const cdir = folder('codexWs');
  const idToken = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'ana@example.test' }), account_id: 'ws-1' } }));
  const c = recorded('codexws8489', 'openai', 'codex', cdir, signinId('ana@example.test', 'ws-1', 'chatgpt'));
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'ana@example.test' }) } }));
  assert.equal(why(c), 'unreadable', 'a recorded ChatGPT workspace matched an auth.json that names none');
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'ana@example.test' }), account_id: 'ws-2' } }));
  assert.equal(why(c), 'changed', 'another ChatGPT workspace was trusted');
  // A codex record with no workspace against a folder now in one is "could not read"; none on either side is the email.
  const none = recorded('codexnows8489', 'openai', 'codex', cdir, signinId('ana@example.test', null, 'chatgpt'));
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'ana@example.test' }), account_id: 'ws-team' } }));
  assert.equal(why(none), 'unreadable', 'a codex record with no workspace matched a folder now in a team workspace');
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'ana@example.test' }) } }));
  assert.equal(why(none), null, 'no workspace on either side did not fall back to the email');
});

test('kosmos#8489: "could not read" ends: the third Start at login in a row drops the folder for good, and the words say so', () => {
  const dir = folder('torn');
  writeClaudeConfig(dir, { emailAddress: 'lee@example.test', organizationUuid: UUID_ONE });
  const id = signinId('lee@example.test', UUID_ONE);
  fs.writeFileSync(accounts.configFile(dir), Buffer.alloc(64));   // torn to NULs by a crash
  const keptAs = (name, unreadable) => {
    made.push(name);
    store.writeProfile(name, { displayName: name, provider: 'anthropic',
      win32Task: { runner: 'claude', configDir: dir, model: SET_MODEL, account: id, kept: true, ...(unreadable ? { unreadable } : {}) } });
    return name;
  };
  assert.equal(why(keptAs('torn0-8489', 0)), 'unreadable');
  assert.equal(why(keptAs('torn1-8489', 1)), 'unreadable');
  const last = keptAs('torn2-8489', 2);
  assert.equal(why(last), 'unreadableGaveUp', 'a folder unread three Start at logins in a row was kept again');
  assert.equal(create.win32RecordedTask(last).accountOk, false);
  assert.equal(leftover.startsAgainWords(last), '; it starts on the model it was set to, but Kosmos could not read which account is signed in to the account folder it last used, and could not confirm that account at the two Start at logins before either, so at the next Start at login it moves to your main account for good, unless it can read that account by then and it is still the same one. Choose its account again if it should use another.');
});

test('kosmos#8489: a Grok sign-in file holding no x.ai sign-in is signed out (changed); two is "could not read"', () => {
  const grok = require('./grokaccounts');
  const dir = folder('grokOut');
  fs.writeFileSync(grok.authFile(dir), JSON.stringify({ 'https://auth.x.ai::u': { email: 'kim@example.test', refresh_token: 'r' } }));
  const n = recorded('grokout8489', 'xai', 'grok', dir, signinId('kim@example.test', null, 'subscription'));
  fs.writeFileSync(grok.authFile(dir), JSON.stringify({}));
  assert.equal(why(n), 'changed', 'a Grok file with nobody signed in was read as "could not read"');
  fs.writeFileSync(grok.authFile(dir), JSON.stringify({ 'https://auth.x.ai::u': { email: 'kim@example.test' }, 'https://auth.x.ai::v': { email: 'kim@example.test' } }));
  assert.equal(why(n), 'unreadable');
});

test('kosmos#8489: a bug in the reader is not "could not read": it reads as changed (never kept) and is logged', (t) => {
  const oa = require('./openaiaccounts');
  const dir = folder('codexBug');
  fs.writeFileSync(oa.authFile(dir), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-' + 'k'.repeat(30) }));
  const n = recorded('codexbug8489', 'openai', 'codex', dir, keyId('sk-proj-' + 'k'.repeat(30)));
  const real = oa.identityFromData;
  const logged = [];
  t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
  oa.identityFromData = () => { throw new Error('a bug'); };
  try {
    assert.equal(why(n), 'changed', 'a thrown bug was read as "could not read" (which keeps the folder)');
  } finally { oa.identityFromData = real; }
  assert.ok(logged.some((l) => /kosmos#8489: reading the account in .* failed: a bug/.test(l)), 'the bug was not logged: ' + JSON.stringify(logged));
});

test('kosmos#8489: each "cannot tell" gives its own true reason: a failed read says could not read; a read that cannot confirm the same account says could not confirm', () => {
  const READ = /Kosmos could not read which account is signed in to the account folder it last used, so it starts on your main account unless it can read that by then and it is still the same account\./;
  const CONFIRM = /Kosmos could not confirm that the account folder it last used still holds the account it used before, so it starts on your main account unless it can confirm that by then\./;
  const dir = folder('why');
  // A failed read: half a config.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test' });
  const n = recorded('whyread8489', 'anthropic', 'claude', dir, signinId('pat@example.test'));
  fs.writeFileSync(accounts.configFile(dir), '{"oauthAccount": {"emailAd');
  let rec = create.win32RecordedTask(n);
  assert.deepEqual([rec.accountWhy, rec.unreadableReason], ['unreadable', 'read']);
  assert.match(leftover.startsAgainWords(n), READ);
  assert.doesNotMatch(leftover.startsAgainWords(n), /could not confirm/);
  // The read worked: the record has no organization and the folder now shows one.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationUuid: UUID_ONE });
  rec = create.win32RecordedTask(n);
  assert.deepEqual([rec.accountWhy, rec.unreadableReason], ['unreadable', 'confirm']);
  assert.match(leftover.startsAgainWords(n), CONFIRM);
  assert.doesNotMatch(leftover.startsAgainWords(n), /could not read/, 'a read that worked was blamed on a failed read');
  // No config and no key: nothing failed to read; nothing shows whose account it is.
  fs.rmSync(accounts.configFile(dir));
  rec = create.win32RecordedTask(n);
  assert.deepEqual([rec.accountWhy, rec.unreadableReason], ['unreadable', 'confirm']);
  assert.match(leftover.startsAgainWords(n), CONFIRM);
  // The drop at the third try, for a reason that is not a failed read.
  writeClaudeConfig(dir, { emailAddress: 'pat@example.test', organizationUuid: UUID_ONE });
  made.push('whydrop8489');
  store.writeProfile('whydrop8489', { displayName: 'whydrop8489', provider: 'anthropic',
    win32Task: { runner: 'claude', configDir: dir, model: SET_MODEL, account: signinId('pat@example.test'), kept: true, unreadable: 2 } });
  assert.equal(leftover.startsAgainWords('whydrop8489'), '; it starts on the model it was set to, but Kosmos could not confirm that the account folder it last used still holds the account it used before, now or at the two Start at logins before, so at the next Start at login it moves to your main account for good, unless it can confirm that by then. Choose its account again if it should use another.');
  // codex: a record with no workspace, the folder now in one.
  const oa = require('./openaiaccounts');
  const cdir = folder('whyCodex');
  const idToken = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
  fs.writeFileSync(oa.authFile(cdir), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken({ email: 'ana@example.test' }), account_id: 'ws-team' } }));
  const c = recorded('whycodex8489', 'openai', 'codex', cdir, signinId('ana@example.test', null, 'chatgpt'));
  assert.equal(create.win32RecordedTask(c).unreadableReason, 'confirm');
});

test('kosmos#8489: the out-of-reach words say when earlier unreadable starts will drop the folder, and say nothing of it when there were none', () => {
  const account = signinId('pat@example.test', UUID_ONE);
  const gone = nodePath.join(SANDBOX, 'not-connected-8489', '.claude-away');   // a folder Kosmos cannot reach
  const keptAs = (name, unreadable) => {
    made.push(name);
    store.writeProfile(name, { displayName: name, provider: 'anthropic',
      win32Task: { runner: 'claude', configDir: gone, model: SET_MODEL, account, kept: true, ...(unreadable ? { unreadable } : {}) } });
    return name;
  };
  const KEEPS = 'Kosmos keeps that folder and tries it again at each Start at login until its startup job is written again (changing its account or model does that), which forgets that folder';
  const none = leftover.startsAgainWords(keptAs('away0-8489', 0));
  assert.equal(create.win32RecordedTask('away0-8489').accountWhy, 'unreachable');
  assert.ok(none.endsWith(KEEPS + '.'), none);
  assert.ok(leftover.startsAgainWords(keptAs('away1-8489', 1)).endsWith(KEEPS + ', or until two more Start at logins that reach that folder still cannot read or confirm the account in it, which moves it to your main account for good.'));
  assert.ok(leftover.startsAgainWords(keptAs('away2-8489', 2)).endsWith(KEEPS + ', or until the next Start at login that reaches that folder still cannot read or confirm the account in it, which moves it to your main account for good.'));
});
