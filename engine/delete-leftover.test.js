'use strict';
/**
 * #514: the separate verb that frees a name. Sandboxed on every root, the
 * same way remove.test.js is: this module MOVES OR DELETES FOLDERS, and an
 * unsandboxed run would do it to somebody's real agents.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { skipOnWin32 } = require('../test-support/skip-on-win32');   // kosmos#8378: the POSIX-mode arms
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
// #5432: on Linux the agent's job is a systemd user unit, kept in this sandbox too (a sandboxed board without it refuses
// every systemd call, so a create ends partial on a Linux runner). macOS and Windows never read it.
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = require('node:path').join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const leftover = require('./delete-leftover');
const fleet = require('../test-support/fleet');
const sendertoken = require('./sendertoken');
const store = require('./store');

/* kosmos#8378: node itself stands in for both programs, a file every platform can run (/bin/echo is not a path on
   Windows, so runners.isRunnable refused it there and every create answered that Claude Code was missing). */
const BINS = { claudeBin: process.execPath, tmuxBin: process.execPath };
const calls = [];
leftover.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
remove.setRunner(() => ({ ok: true, stdout: '' }));

/* 🛑 THE PLATFORM IS STATED, NOT INHERITED (#570), the same fix step 9 made to
   remove.test.js. Every fixture below writes a `.plist` and expects the Mac's
   Trash; on Windows the job is a Scheduled Task, so an unstated platform runs
   the win32 arm against Mac fixtures. The win32 arm is pinned from EITHER
   platform in jobexists.win32-570.test.js. */
const mac = {
  plan: (name, o) => leftover.plan(name, { platform: 'darwin', ...(o || {}) }),
  del: (name, o) => leftover.del(name, { platform: 'darwin', ...(o || {}) }),
};

function leftoverAgent(name, { files = 3, job = true } = {}) {
  const dir = create.workerDir(name);
  fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
  for (let i = 0; i < files; i += 1) fs.writeFileSync(nodePath.join(dir, i ? `notes/${i}.md` : 'CLAUDE.md'), `work ${i}\n`);
  if (job) {
    fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
    fs.writeFileSync(create.plistPath(name), '<plist/>');
  }
  return name;
}
function quiet() { status.setPaneSource(() => ''); }
function createAgain(name) {
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  require('../test-support/jobfixture').useJobStore();   // kosmos#8378: on Windows the job goes to a stand-in Task Scheduler
  quiet();
  const r = create.createAgent({ ...BINS, name, role: 'pm' });
  create.setRunner(null);
  return r;
}
test.beforeEach(() => { fs.mkdirSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true }); calls.length = 0; quiet(); });
test.afterEach(() => { status.setPaneSource(null); });

test('the plan counts what a person would lose, in words, and offers the Trash when it can take the files', () => {
  leftoverAgent('april');
  const p = mac.plan('april', { now: Date.now() });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.folder.files, 3);
  assert.equal(p.toTrash, true);
  assert.equal(p.typeToConfirm, null, 'the Trash path asked for the name to be typed');
  assert.match(p.loses[0], /^Its folder: 3 files, \d+ bytes, last changed a moment ago$/);
  assert.match(p.loses[1], /auto-start file/);
  assert.match(p.verb, /^Move 3 files to the Trash$/);
  assert.match(p.reassurance, /Trash, where you can get it back/);
  assert.match(p.reassurance, /the name april is free/);
});

test('a running agent is not a leftover, and nothing of it is offered', () => {
  leftoverAgent('busy');
  status.setPaneSource(() => fleet.line({ session: 'busy', claim: 'busy', title: '✳ Claude Code' }));
  const p = mac.plan('busy');
  assert.equal(p.ok, false);
  assert.match(p.because, /is running/);
});

test('the done-when: delete, and the name passes create again; the files are in the Trash, not gone', () => {
  leftoverAgent('may');
  /* A removed record too, the realistic shape: removed from the board,
     folder left behind, name refused. */
  const done = mac.del('may');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.toTrash, true);
  assert.ok(!fs.existsSync(create.workerDir('may')), 'the folder survived');
  assert.ok(!fs.existsSync(create.plistPath('may')), 'the job file survived');
  const inTrash = fs.readdirSync(process.env.AGENT_WORKFORCE_TRASH).filter((n) => n.startsWith('may (Kosmos '));
  assert.equal(inTrash.length, 1, 'the folder is not in the Trash');
  assert.ok(fs.existsSync(nodePath.join(process.env.AGENT_WORKFORCE_TRASH, inTrash[0], 'CLAUDE.md')), 'the work did not travel with the folder');
  assert.ok(calls.some((c) => c[0] === 'launchctl' && c[1][0] === 'bootout'), 'the job was not booted out before its file went');
  const again = createAgain('may');
  assert.equal(again.outcome, create.OUTCOME.CREATED, `the name is still refused: ${again.because}`);
});

test('without a Trash the plan says for good, asks for the name, and refuses an untyped delete with nothing changed', () => {
  fs.rmSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true, force: true });
  leftoverAgent('june');
  const p = mac.plan('june');
  assert.equal(p.toTrash, false);
  assert.equal(p.typeToConfirm, 'june');
  assert.match(p.reassurance, /cannot be undone/);
  assert.match(p.verb, /^Delete 3 files for good$/);
  const refused = mac.del('june', { typed: 'jane' });
  assert.equal(refused.outcome, leftover.OUTCOME.REFUSED);
  assert.ok(fs.existsSync(create.workerDir('june')), 'a refused delete deleted');
  const done = mac.del('june', { typed: 'june' });
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.ok(!fs.existsSync(create.workerDir('june')));
  assert.ok(!fs.existsSync(create.plistPath('june')));
});

test('a folder that is a link, or nothing left at all, is refused in words', () => {
  fs.mkdirSync(nodePath.join(SANDBOX, 'elsewhere'), { recursive: true });
  fs.mkdirSync(create.WORKERS_DIR, { recursive: true });
  fs.symlinkSync(nodePath.join(SANDBOX, 'elsewhere'), create.workerDir('linky'));
  const p = mac.plan('linky');
  assert.equal(p.ok, false);
  assert.match(p.because, /link to somewhere else/);
  assert.ok(fs.existsSync(nodePath.join(SANDBOX, 'elsewhere')));
  const none = mac.plan('nobody');
  assert.equal(none.ok, false);
  assert.match(none.because, /nothing of nobody is left/);
});

test('a removed agent stops being hidden once its files are gone, so the board can show a new one by that name', () => {
  quiet();
  leftoverAgent('july', { job: false });
  const rec = remove.remove('july');
  assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
  assert.equal(remove.isHidden('july'), true, 'the fixture is not on the removed list');
  const done = mac.del('july');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(remove.isHidden('july'), false, 'the removed record outlived the files');
});


/* ------------------------------------------------------------------ #1131
 * Deleting an agent must take its sender token with it.
 *
 * 🛑 WHY THE FIRST ARM ASSERTS THE DANGEROUS ANSWER BEFORE THE SAFE ONE.
 * The bug was that `revoke` was never called, and a test that only checks the
 * token is gone AFTER a delete passes just as happily when the token was never
 * mintable in the first place. So it proves the old token DOES speak for a
 * fresh card of that name, and only then deletes. Without that half the arm
 * cannot fail for the reason it exists.
 * -------------------------------------------------------------------------- */

test('#1131: the old token speaks for a NEW agent of the same name -- until the delete revokes it', () => {
  leftoverAgent('rosa');
  const minted = sendertoken.mint('rosa');
  assert.equal(minted.ok, true, minted.because);

  /* THE CONTROL, and it is the whole point of the arm: with a card on the
     board for this name, the token resolves. If this ever stops holding, the
     assertion below starts passing for the wrong reason. */
  status.setPaneSource(() => fleet.line({ session: 'rosa', claim: 'rosa', title: '✳ Claude Code' }));
  const before = sendertoken.resolve(minted.token, status.paneRoster());
  assert.equal(before.ok, true, 'control: the token should speak for a live card of its own name');

  quiet();
  const done = mac.del('rosa');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);

  /* The name is now free -- the success sentence says so -- so somebody takes
     it. This is the whole scenario: same name, different agent. */
  createAgain('rosa');
  status.setPaneSource(() => fleet.line({ session: 'rosa', claim: 'rosa', title: '✳ Claude Code' }));
  const after = sendertoken.resolve(minted.token, status.paneRoster());
  assert.equal(after.ok, false, 'the deleted agent\'s token still speaks for the new agent of that name');

  /* And by the paneless path too, which asks no roster at all. */
  assert.equal(sendertoken.resolveName(minted.token).ok, false, 'the token still resolves to a name');
});

test('#1131: an agent that never had a token deletes cleanly, and the step is not reported as a failure', () => {
  leftoverAgent('quiet-one');
  quiet();
  const done = mac.del('quiet-one');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  const step = done.steps.find((x) => x.step === 'its sender tokens');
  assert.ok(step, 'the token step was not recorded at all');
  assert.equal(step.ok, true, 'an agent with no token was reported as a token failure');
});

test('#4475: deleting a stopped agent\'s leftovers (never removed) ends its identity in the history, so an agent that made it no longer owns the name', () => {
  leftoverAgent('freed-name');
  quiet();
  const before = new Date(Date.now() - 1000).toISOString();
  assert.equal(sendertoken.endedSince(['freed-name'], before), false, 'CONTROL: the history already named it');
  const done = mac.del('freed-name');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(sendertoken.endedSince(['freed-name'], before), true, 'deleting the leftovers freed the name without ending its identity in the history');
});

test('#1131: a token that cannot be removed makes the delete PARTIAL, never a DELETED that says the name is free', () => {
  leftoverAgent('stuckcred');
  /* A directory where the token file goes: `unlink` refuses it, which is a
     real failure rather than a stubbed one. */
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  fs.mkdirSync(nodePath.join(sendertoken.DIR, store.safeKey('stuckcred') + '.json'), { recursive: true });
  quiet();
  const done = mac.del('stuckcred');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'files gone + credential live was reported as a clean delete');
  assert.match(done.because, /sender tokens/, 'the refusal does not say which part failed');
  assert.ok(!/name is free/.test(done.said || ''), 'it promised the name was free while a credential for it survived');
});

test('#4994: deleting a leftover retires its community account, so a new agent under the name does not inherit it', async () => {
  const cs = require('./communitysend');
  assert.ok(cs._paths.keysFile().startsWith(SANDBOX), 'the community keys are not under this test\'s sandbox');
  const KEY = { remoteId: 'r9', name: 'oldposter', apiKey: 'kc_key_r9', token: 'tok_r9', registeredAt: '2026-09-28T07:00:00.000Z' };
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ oldposter: KEY }));   // as ensureRegistered writes it
  leftoverAgent('oldposter');
  quiet();
  const done = mac.del('oldposter');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  const step = done.steps.find((x) => x.step === 'its community account');
  assert.ok(step && step.ok, 'the community account step was not recorded as done');
  await cs.sweep();                                    // the next keys.json section applies it (no network in tests)
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  assert.equal(keys.oldposter, undefined, 'the freed name still holds the deleted agent\'s community account');
  assert.equal(Object.keys(keys).filter((k) => k.startsWith('retired:oldposter:')).length, 1, 'the old account was dropped, not retired');
});

test('#4994: a community account that cannot be retired makes the delete PARTIAL, never a DELETED that says the name is free', () => {
  const cs = require('./communitysend');
  leftoverAgent('stuckcomm');
  /* A FILE where the request folder goes: the save cannot make the folder, a real failure rather than a stub. */
  fs.mkdirSync(nodePath.dirname(cs._paths.retireDir()), { recursive: true });
  fs.rmSync(cs._paths.retireDir(), { recursive: true, force: true });
  fs.writeFileSync(cs._paths.retireDir(), 'not a folder');
  quiet();
  let done;
  try { done = mac.del('stuckcomm'); } finally { fs.rmSync(cs._paths.retireDir(), { force: true }); }
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'the old account was left live under a name reported free');
  assert.match(done.because, /could not retire its community account yet\. Making a new agent with this name retires it first, or refuses/, 'the refusal does not say which part failed');
  assert.ok(!/name is free/.test(done.said || ''), 'it promised the name was free while the old account still answers to it');
});

test('#4994: a delete that left the folder behind does not retire the community account (it cannot be undone)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false) }, () => {
  const cs = require('./communitysend');
  leftoverAgent('halfgone');
  /* A Trash nothing can be moved into: the folder stays, a real failure rather than a stub. */
  const trash = process.env.AGENT_WORKFORCE_TRASH;
  assert.ok(trash.startsWith(SANDBOX), 'refusing to touch a Trash outside this test\'s sandbox');
  fs.chmodSync(trash, 0o500);
  quiet();
  let done;
  try { done = mac.del('halfgone'); } finally { fs.chmodSync(trash, 0o700); }
  assert.ok(done.steps && done.steps.some((x) => x.step === 'its folder' && !x.ok), 'CONTROL: the folder really was left behind: ' + JSON.stringify(done));
  const reqs = fs.existsSync(cs._paths.retireDir()) ? fs.readdirSync(cs._paths.retireDir()) : [];
  const mine = reqs.filter((f) => JSON.parse(fs.readFileSync(nodePath.join(cs._paths.retireDir(), f), 'utf8')).agent === 'halfgone');
  assert.deepEqual(mine, [], 'the account was retired while the agent can still start');
  assert.equal(done.steps.find((x) => x.step === 'its community account'), undefined);
});

test('#4994: a stuck token alone still retires the account, because no retry can (the delete is refused once the files are gone)', () => {
  const cs = require('./communitysend');
  leftoverAgent('tokenstuck');
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  fs.mkdirSync(nodePath.join(sendertoken.DIR, store.safeKey('tokenstuck') + '.json'), { recursive: true });
  quiet();
  const done = mac.del('tokenstuck');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'CONTROL: the token really was stuck');
  assert.equal(mac.plan('tokenstuck').ok, false, 'CONTROL: a retry is refused, so this delete was the only chance');
  const step = done.steps.find((x) => x.step === 'its community account');
  assert.ok(step && step.ok, 'the community account was not retired');
  fs.rmSync(nodePath.join(sendertoken.DIR, store.safeKey('tokenstuck') + '.json'), { recursive: true, force: true });
});

test('#4994: the confirmation says the community account does not come back, only when there is one', () => {
  const cs = require('./communitysend');
  leftoverAgent('poster2');
  leftoverAgent('quiet2');
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ poster2: { remoteId: 'r8', name: 'poster2', apiKey: 'k', token: 't' } }));
  const p = mac.plan('poster2', { now: Date.now() });
  assert.equal(p.ok, true, p.because);
  assert.ok(p.loses.some((l) => /^Its community account: /.test(l)), 'the account is not in what the person loses');
  assert.match(p.reassurance, /Its community account does not come back/);
  assert.equal(/Everything goes to the Trash/.test(p.reassurance), false, 'it still promises everything comes back');
  const q = mac.plan('quiet2', { now: Date.now() });
  assert.equal(q.loses.some((l) => /community/.test(l)), false, 'CONTROL: a name with no account lists one');
  assert.match(q.reassurance, /^Everything goes to the Trash/);
});

test('#4994: creating an agent under a name freed by hand retires the community account still held under it', async () => {
  const cs = require('./communitysend');
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ handfreed: { remoteId: 'r7', name: 'handfreed', apiKey: 'k7', token: 't7' } }));
  assert.equal(cs.hasAccount('handfreed'), true, 'CONTROL: the old account is held under the name');
  const made = createAgain('handfreed');                 // no leftover files: the name was freed by hand
  assert.notEqual(made.outcome, 'refused', JSON.stringify(made));
  await cs.sweep();                                      // the next keys.json section applies it (no network in tests)
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  assert.equal(keys.handfreed, undefined, 'the new agent was made under the old community account');
  assert.equal(Object.keys(keys).filter((k) => k.startsWith('retired:handfreed:')).length, 1);
});

test('#4994: a create while the community keys cannot be read still retires the account once they can', async () => {
  const cs = require('./communitysend');
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), '{ not json');
  assert.throws(() => JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8')), 'CONTROL: the keys really cannot be read');
  const made = createAgain('blindfreed');
  assert.notEqual(made.outcome, 'refused', JSON.stringify(made));
  await cs.sweep();
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ blindfreed: { remoteId: 'r6', name: 'blindfreed', apiKey: 'k6', token: 't6' } }));   // repaired
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  assert.equal(keys.blindfreed, undefined, 'the new agent kept the old community account once the keys were repaired');
});

test('#4994: the confirmation names the community account when the keys cannot be read, or the account is another service\'s', () => {
  const cs = require('./communitysend');
  leftoverAgent('elsewhere');
  const other = nodePath.join(cs._paths.dir(), 'bbbbbbbbbbbb');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(nodePath.join(other, 'keys.json'), JSON.stringify({ elsewhere: { remoteId: 'r5', apiKey: 'k5', token: 't5' } }));
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({}));
  assert.ok(mac.plan('elsewhere', { now: Date.now() }).loses.some((l) => /^Its community account: /.test(l)), 'an account on another service was not named');
  fs.rmSync(other, { recursive: true, force: true });
  assert.equal(mac.plan('elsewhere', { now: Date.now() }).loses.some((l) => /community/.test(l)), false, 'CONTROL: with no account anywhere, none is named');
  fs.writeFileSync(cs._paths.keysFile(), '{ not json');
  try {
    assert.ok(mac.plan('elsewhere', { now: Date.now() }).loses.some((l) => /^Its community account: /.test(l)), 'unreadable keys were read as no account');
  } finally { fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({})); }
});

test('#4994: with no account but unsent community posts, the confirmation says they never go, even after a restore', () => {
  const communitystore = require('./communitystore');
  const feedpublish = require('./feedpublish');
  leftoverAgent('queuer');
  const cs = require('./communitysend');
  fs.mkdirSync(nodePath.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({}));   // Community never switched on: nothing would go
  communitystore.grantTrust('queuer');
  const r = feedpublish.publishPost({ kind: 'community_post', agent: 'queuer', at: new Date().toISOString(), topic: 't', body: 'queued' }, { agentId: 'queuer' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(mac.plan('queuer', { now: Date.now() }).loses.some((l) => /has not gone out yet/.test(l)), false,
    'a post that was never going out (no ON period) was named as a loss');
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ since: '2000-01-01T00:00:00.000Z' }));   // Community on
  const p = mac.plan('queuer', { now: Date.now() });
  assert.ok(p.loses.some((l) => /^Anything it wrote for the community that has not gone out yet: it never goes, even if you bring its folder back$/.test(l)), JSON.stringify(p.loses));
  assert.match(p.reassurance, /Anything it wrote for the community that has not gone out stays unsent/);
  assert.equal(/Everything goes to the Trash/.test(p.reassurance), false);
  assert.equal(p.loses.some((l) => /^Its community account/.test(l)), false, 'CONTROL: no account is named for an agent that never had one');
});

test('#4994: an agent whose community posts all went out is not told any are waiting', () => {
  const communitystore = require('./communitystore');
  const feedpublish = require('./feedpublish');
  const cs = require('./communitysend');
  leftoverAgent('sentall');
  fs.mkdirSync(nodePath.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ since: '2000-01-01T00:00:00.000Z' }));   // Community on
  communitystore.grantTrust('sentall');
  feedpublish.publishPost({ kind: 'community_post', agent: 'sentall', at: new Date().toISOString(), topic: 't', body: 'went out' }, { agentId: 'sentall' });
  const { id } = communitystore.publishedPosts().find((x) => x.agent === 'sentall');
  const waits = () => mac.plan('sentall', { now: Date.now() }).loses.some((l) => /has not gone out yet/.test(l));
  assert.equal(waits(), true, 'CONTROL: with no record of it going out, it is named as waiting');
  fs.mkdirSync(nodePath.dirname(cs._paths.sentFile()), { recursive: true });
  fs.writeFileSync(cs._paths.sentFile(), JSON.stringify({ [id]: { state: 'sent', agent: 'sentall', remoteId: 'p1', sentAt: new Date().toISOString() } }));
  try {
    assert.equal(waits(), false, 'a post that went out was named as not gone out');
  } finally { fs.writeFileSync(cs._paths.sentFile(), JSON.stringify({})); }
});

test('#4994: a refused or owner-deleted community post is not named as waiting; a still-pending one is', () => {
  const communitystore = require('./communitystore');
  const feedpublish = require('./feedpublish');
  const cs = require('./communitysend');
  leftoverAgent('finals');
  fs.mkdirSync(nodePath.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ since: '2000-01-01T00:00:00.000Z' }));
  communitystore.grantTrust('finals');
  feedpublish.publishPost({ kind: 'community_post', agent: 'finals', at: new Date().toISOString(), topic: 't', body: 'final' }, { agentId: 'finals' });
  const { id } = communitystore.publishedPosts().find((x) => x.agent === 'finals');
  const waits = () => mac.plan('finals', { now: Date.now() }).loses.some((l) => /has not gone out yet/.test(l));
  const setRec = (rec) => fs.writeFileSync(cs._paths.sentFile(), JSON.stringify(rec ? { [id]: rec } : {}));
  try {
    setRec({ state: 'pending', agent: 'finals' });
    assert.equal(waits(), true, 'CONTROL: a post still waiting to go is named');
    setRec({ state: 'refused', agent: 'finals', reasons: ['rejected'] });
    assert.equal(waits(), false, 'a post the community refused was named as waiting');
    setRec(null);
    fs.writeFileSync(cs._paths.deletesFile(), JSON.stringify({ [id]: new Date().toISOString() }));
    assert.equal(waits(), false, 'a post the owner deleted was named as waiting');
  } finally { setRec(null); fs.writeFileSync(cs._paths.deletesFile(), JSON.stringify({})); }
});

test('#4994: with Community switched off, a held post still counts as waiting (release could send it); a published one does not', () => {
  const communitystore = require('./communitystore');
  const feedpublish = require('./feedpublish');
  const cs = require('./communitysend');
  leftoverAgent('switchoff');
  fs.mkdirSync(nodePath.dirname(cs._paths.stateFile()), { recursive: true });
  fs.writeFileSync(cs._paths.stateFile(), JSON.stringify({ since: '2000-01-01T00:00:00.000Z' }));
  communitystore.grantTrust('switchoff');
  feedpublish.publishPost({ kind: 'community_post', agent: 'switchoff', at: new Date().toISOString(), topic: 't', body: 'published' }, { agentId: 'switchoff' });
  const waits = () => mac.plan('switchoff', { now: Date.now() }).loses.some((l) => /has not gone out yet/.test(l));
  cs.setSwitch(() => ({ on: false, ok: true }));
  try {
    assert.equal(waits(), false, 'a published post was named as waiting while Community is off');
    feedpublish.publishPost({ kind: 'community_post', agent: 'switchoff', at: new Date().toISOString(), topic: 't', body: 'held' }, { trusted: false });
    assert.equal(waits(), true, 'a held post was not named while Community is off');
  } finally { cs.setSwitch(null); }
});

test('#4994: when the Trash cannot take the files, the for-good sentence also says the community account does not come back', () => {
  const cs = require('./communitysend');
  leftoverAgent('forgood');
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ forgood: { remoteId: 'r2', name: 'forgood', apiKey: 'k2', token: 't2' } }));
  const trash = process.env.AGENT_WORKFORCE_TRASH;
  assert.ok(trash.startsWith(SANDBOX), 'refusing to touch a Trash outside this test\'s sandbox');
  fs.rmSync(trash, { recursive: true, force: true });       // no Trash: the files would be deleted for good
  try {
    const p = mac.plan('forgood', { now: Date.now() });
    assert.equal(p.toTrash, false, 'CONTROL: the plan really is the for-good path');
    assert.match(p.reassurance, /^This cannot be undone: .*, and its community account does not come back\./);
  } finally { fs.mkdirSync(trash, { recursive: true }); fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({})); }
});

test('#4006: deleting a leftover clears its failed-restart record', () => {
  const disruption = require('./disruption');
  leftoverAgent('failgone');
  disruption.begin('failgone', 'restart');
  disruption.fail('failgone', null);
  assert.equal(disruption.read('failgone').failed, true, 'precondition: a failed record is on file');
  quiet();
  const done = mac.del('failgone');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(disruption.read('failgone').found, false, 'the failed record outlived the delete');
});

test('#5957 slice 3: deleting a leftover clears its last report', () => {
  const liveness = require('./liveness');
  leftoverAgent('idlegone');
  liveness.seen('idlegone', new Date(Date.now() - 40 * 86400000).toISOString());
  assert.equal(liveness.read('idlegone').found, true, 'precondition: a report is on file');
  quiet();
  const done = mac.del('idlegone');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(liveness.read('idlegone').found, false, 'the last report outlived the delete');
});

test('#5000: a trusted name is put back at the start by the delete, so a new agent under it is not trusted', () => {
  const cs = require('./communitystore');
  leftoverAgent('trusty');
  cs.grantTrust('trusty');
  cs.grantTrust('bystander5000');
  assert.equal(cs.trustState('trusty'), 'trusted', 'control: the agent had earned trust before it was deleted');
  quiet();
  const done = mac.del('trusty');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  const step = done.steps.find((x) => x.step === 'its community standing');
  assert.ok(step && step.ok === true, 'the standing step was not recorded as done');
  createAgain('trusty');
  assert.equal(cs.trustState('trusty'), 'untrusted', 'the new agent under the freed name inherited the deleted one\'s trust');
  assert.equal(cs.trustState('bystander5000'), 'trusted', 'the delete changed another agent\'s standing');
});

test('#5000: a standing that cannot be reset refuses the whole delete with nothing touched, and a retry then works', () => {
  const cs = require('./communitystore');
  leftoverAgent('stucktrust');
  cs.grantTrust('stucktrust');
  /* A FILE where the community folder goes: the write cannot make its folder, a real failure, not a stub. */
  const dir = cs._paths.dir();
  const had = fs.existsSync(dir);
  const moved = had ? dir + '.aside-5000' : null;
  if (had) fs.renameSync(dir, moved);
  fs.writeFileSync(dir, 'not a folder');
  let done;
  try {
    quiet();
    done = mac.del('stucktrust');
  } finally {
    fs.rmSync(dir, { force: true });
    if (had) fs.renameSync(moved, dir);
  }
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, 'a delete that could not reset the standing went ahead');
  assert.match(done.because, /standing/, 'the refusal does not say which part failed');
  assert.ok(fs.existsSync(create.workerDir('stucktrust')), 'the folder was moved although the delete was refused');
  /* The retry, which is the reason the reset goes first: with the folder still there, plan() offers the delete
     again and the reset now succeeds. */
  quiet();
  const again = mac.del('stucktrust');
  assert.equal(again.outcome, leftover.OUTCOME.DELETED, again.because);
  assert.equal(cs.trustState('stucktrust'), 'untrusted', 'the retry did not reset the standing');
});

test('#5000: the folder\'s own name is reset when it is asked for in another case', (t) => {
  const cs = require('./communitystore');
  leftoverAgent('Miles5000');
  cs.grantTrust('Miles5000');
  /* Only a disk that does not tell case apart (a Mac's, by default) can be asked for the folder in another case,
     so only there does this exercise the real-case lookup. Elsewhere it says so rather than passing vacuously. */
  if (!fs.existsSync(create.workerDir('miles5000'))) { t.skip('this disk tells case apart'); return; }
  quiet();
  const done = mac.del('miles5000');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(cs.trustState('Miles5000'), 'untrusted', 'the folder\'s own name kept its standing');
});

test('#5000: a folder that cannot be moved still leaves the name reset, because the reset comes first', () => {
  const cs = require('./communitystore');
  leftoverAgent('resetfirst', { job: false });
  cs.grantTrust('resetfirst');
  const realRename = fs.renameSync;
  const realRm = fs.rmSync;
  const folder = create.workerDir('resetfirst');
  fs.renameSync = (from, to) => { if (from === folder) throw new Error('busy'); return realRename(from, to); };
  fs.rmSync = (target, o) => { if (target === folder) throw new Error('busy'); return realRm(target, o); };
  let done;
  try {
    quiet();
    done = mac.del('resetfirst');
  } finally {
    fs.renameSync = realRename;
    fs.rmSync = realRm;
  }
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'control: the folder was meant to be stuck');
  assert.ok(done.steps.some((x) => x.step === 'its community standing' && x.ok), 'the standing step did not run');
  assert.equal(cs.trustState('resetfirst'), 'untrusted', 'a partial delete left the standing in place');
  /* The sentence the person reads: true about what happened, and no card number in it. */
  assert.match(done.because, /None of its files were moved\. Its standing in the community was reset/, done.because);
  assert.ok(!/#\d/.test(done.because), 'a card number reached the person: ' + done.because);
});

test('#5003: a delete asked in another case while the agent runs is refused, and its folder stays where it is', () => {
  leftoverAgent('Miles5003');
  const running = () => status.setPaneSource(() => fleet.line({ session: 'Miles5003', claim: 'Miles5003', title: '✳ Claude Code' }));
  /* The control on the same path: asked in its own case while running, it is refused as before. */
  running();
  const own = mac.plan('Miles5003');
  assert.equal(own.ok, false, 'control: a running agent asked by its own name was offered for deletion');
  for (const asked of ['miles5003', 'MILES5003']) {
    running();
    const p = mac.plan(asked);
    assert.equal(p.ok, false, `a running agent asked as ${asked} was offered for deletion`);
    assert.match(p.because, /is running/, p.because);
    running();
    const done = mac.del(asked);
    assert.equal(done.outcome, leftover.OUTCOME.REFUSED, `a delete asked as ${asked} went ahead on a running agent`);
    assert.ok(fs.existsSync(create.workerDir('Miles5003')), `the running agent's folder was moved by a delete asked as ${asked}`);
    assert.ok(fs.existsSync(create.plistPath('Miles5003')), `the running agent's auto-start file was moved by a delete asked as ${asked}`);
  }
  /* And once it is not running, the leftover is offered again: the refusal above is about running, not about case. */
  quiet();
  assert.equal(mac.plan('Miles5003').ok, true, 'a stopped leftover was refused');
});

test('#5003: a STOPPED leftover asked in another case is deleted under its own name: launchd label and removed record too', (t) => {
  leftoverAgent('Rosa5003');
  if (!fs.existsSync(create.workerDir('rosa5003'))) { t.skip('this disk tells case apart'); return; }
  quiet();
  const rec = remove.remove('Rosa5003');
  assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
  assert.equal(remove.isHidden('Rosa5003'), true, 'control: the fixture is on the removed list');
  const p = mac.plan('rosa5003');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.name, 'Rosa5003', 'the plan did not take the agent\'s own spelling');
  calls.length = 0;
  const done = mac.del('rosa5003');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  const boot = calls.find((c) => c[0] === 'launchctl' && c[1][0] === 'bootout');
  assert.ok(boot && boot[1][1].endsWith('/' + create.serviceLabel('Rosa5003')), 'launchd was asked to stop a label that is not the agent\'s: ' + JSON.stringify(boot));
  assert.equal(remove.isHidden('Rosa5003'), false, 'the removed record of the agent\'s own spelling outlived the delete');
});

test('#5003: a Mac leftover with only its auto-start file, asked in another case, is stopped under its own label', (t) => {
  leftoverAgent('Juno5003');
  fs.rmSync(create.workerDir('Juno5003'), { recursive: true, force: true });
  if (!fs.existsSync(create.plistPath('juno5003'))) { t.skip('this disk tells case apart'); return; }
  quiet();
  const p = mac.plan('juno5003');
  assert.equal(p.ok, true, p.because);
  assert.equal(p.name, 'Juno5003', 'a job-only plan did not take the agent\'s own spelling');
  assert.equal(p.job.label, create.serviceLabel('Juno5003'));
});

test('#5003: a recorded folder named like the agent in another case does not rename it (only the workers folder counts)', () => {
  /* A connected agent `cato5003` whose recorded folder is workers/team/Cato5003: inside the workers folder, so plan()
     accepts it, but its name is not the agent's. The agent's own spelling stays as asked. */
  const dir = nodePath.join(create.WORKERS_DIR, 'team', 'Cato5003');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'x\n');
  store.writeProfile('cato5003', { dir });
  assert.equal(create.workerDir('cato5003'), dir, 'control: the recorded folder is what workerDir answers');
  quiet();
  const p = mac.plan('cato5003');
  assert.equal(p.name, 'cato5003', 'a recorded folder\'s name was taken as the agent\'s: ' + p.name);
});

test('#5003: a connected agent whose recorded folder sits in the workers folder under another case keeps its own name', () => {
  /* discover.connect names the agent as typed: `nero5003`, recorded folder workers/Nero5003, label ...nero5003. */
  const dir = nodePath.join(create.WORKERS_DIR, 'Nero5003');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'x\n');
  store.writeProfile('nero5003', { dir });
  assert.equal(create.workerDir('nero5003'), dir, 'control: the recorded folder is what workerDir answers');
  quiet();
  const p = mac.plan('nero5003');
  assert.equal(p.name, 'nero5003', 'the recorded folder\'s spelling was taken as the agent\'s: ' + p.name);
});

test('#5003: on the Mac the auto-start file\'s spelling wins over the folder\'s', (t) => {
  /* The folder says Vela5003 but the job was written for vela5003: the label is what bootout must name. */
  leftoverAgent('vela5003');
  const folder = create.workerDir('vela5003');
  const upper = nodePath.join(nodePath.dirname(folder), 'Vela5003');
  fs.renameSync(folder, upper);
  if (!fs.existsSync(create.workerDir('vela5003'))) { t.skip('this disk tells case apart'); return; }
  quiet();
  const p = mac.plan('VELA5003');
  assert.equal(p.name, 'vela5003', 'the folder\'s spelling won over the auto-start file\'s: ' + p.name);
  assert.equal(p.job.label, create.serviceLabel('vela5003'));
});

test('#5003: the win32 arm reads a stopped leftover\'s own spelling from its folder too', (t) => {
  leftoverAgent('Ida5003', { job: false });
  /* Task Scheduler answers "no such task", so the plan gets as far as the folder (the stub is the one this module's
     win32 arm reads through; nothing here runs schtasks). */
  const win32job = require('./win32job');
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' }));
  let win;
  try { win = leftover.plan('ida5003', { platform: 'win32' }); } finally { win32job.setRunner(null); }
  if (!fs.existsSync(create.workerDir('ida5003'))) { t.skip('this disk tells case apart'); return; }
  assert.equal(win.name || 'refused: ' + win.because, 'Ida5003');
});

test('#6173 (Liu Kang m5550): an agent a move holds is not a leftover in its restart gap: plan and delete both refuse, and nothing is moved', () => {
  /* The gap: the move's restart has closed the agent's window and not yet loaded its new job, so there is no live
     session and the files and job file are all there, exactly what a leftover looks like. */
  leftoverAgent('midmove');
  quiet();
  remove.holdForMove(['midmove']);
  try {
    const p = mac.plan('midmove');
    assert.equal(p.ok, false, 'the plan offered to delete an agent a move holds');
    assert.match(p.because, /is part of an account move that has not finished with it yet, so we left it alone/);
    const done = mac.del('midmove');
    assert.equal(done.outcome, leftover.OUTCOME.REFUSED, 'a delete ran on an agent a move holds');
    assert.match(done.because, /is part of an account move that has not finished with it yet/);
    assert.ok(fs.existsSync(nodePath.join(create.workerDir('midmove'), 'CLAUDE.md')), 'its folder was moved');
    assert.ok(fs.existsSync(create.plistPath('midmove')), 'its job file was moved');
    assert.deepEqual(calls, [], 'a command ran for an agent a move holds');
    assert.equal(fs.readdirSync(process.env.AGENT_WORKFORCE_TRASH).filter((n) => n.startsWith('midmove')).length, 0, 'it reached the Trash');
  } finally { remove.releaseFromMove('midmove'); }
  /* The control: released, the same leftover is offered (the refusal was the hold, not the fixture). */
  assert.equal(mac.plan('midmove').ok, true, 'the control: released, the leftover is not offered');
});

test('kosmos#7149: deleting what is left forgets the agent\'s instructions copy; making a new agent under a name forgets an old one', () => {
  const ir = require('./instructionreread');
  leftoverAgent('ned');
  assert.equal(ir.remember('ned', 'what ned last read'), true);
  const done = mac.del('ned');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(ir.readSeen('ned'), null, 'a deleted agent kept its copy');
  // A copy left under a name (a hand-deleted folder never reaches delete-leftover) is forgotten when the name is made again.
  assert.equal(ir.remember('ned', 'stale'), true);
  const again = createAgain('ned');
  assert.equal(again.outcome, create.OUTCOME.CREATED, again.because);
  assert.equal(ir.readSeen('ned'), null, 'a new agent inherited the old copy');
});

/* #7819: the name's profile and picture go with the files, so a new agent under the freed name is a new agent. */
const trashHas = (prefix) => fs.readdirSync(process.env.AGENT_WORKFORCE_TRASH).some((f) => f.startsWith(prefix + ' (Kosmos '));

test('#7819: after a delete, a new agent under the freed name gets a new id and none of the old profile fields', () => {
  const name = leftoverAgent('rex7819');
  store.writeProfile(name, { dir: '/old/place', vendorAccount: '/old/acct', provider: 'openai', displayName: 'Rex' });
  const old = store.readProfile(name);
  assert.ok(old.id && old.dir === '/old/place' && old.vendorAccount === '/old/acct', 'fixture: the old profile was not written');
  const r = mac.del(name);
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(fs.existsSync(store.profilePath(name)), false, 'the profile outlived the delete');
  assert.ok(trashHas('rex7819.json'), 'the profile did not go to the Trash with the folder');
  assert.ok(r.steps.some((s) => s.step === 'its settings' && s.ok), 'the delete did not report moving its settings');
  const made = createAgain(name);
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  store.writeProfile(name, { displayName: 'Rex the second' });   // the new agent's first profile write
  const now = store.readProfile(name);
  assert.ok(now.id, 'no id was minted for the new agent');
  assert.notEqual(now.id, old.id, 'the new agent inherited the deleted one\'s id');
  for (const k of ['dir', 'vendorAccount']) assert.equal(now[k], undefined, `the new agent inherited ${k} from the deleted one`);
  assert.notEqual(now.provider, 'openai', 'the new agent inherited the deleted one\'s provider');
});

test('#7819: the picture goes with it (every extension), and the plan says where they go', () => {
  const name = leftoverAgent('pic7819');
  store.writeProfile(name, { displayName: 'Pic' });
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'pic7819.png'), 'png');
  fs.writeFileSync(nodePath.join(store.AVATARS, 'pic7819.jpg'), 'jpg');   // a crashed save's second extension
  const p = mac.plan(name);
  assert.ok(p.loses.includes('Its settings and picture: to the Trash with the files, and a new agent with this name starts without them'), JSON.stringify(p.loses));
  assert.equal(p.typeToConfirm, null, 'nothing goes for good, yet the name was asked for');
  const r = mac.del(name);
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(store.avatarPath(name), null, 'a picture outlived the delete');
  assert.ok(trashHas('pic7819.png') && trashHas('pic7819.jpg'), 'both pictures did not go to the Trash');
  // CONTROL: a leftover with neither says nothing about them.
  const bare = leftoverAgent('bare7819');
  assert.ok(!mac.plan(bare).loses.some((l) => /settings|picture/.test(l)), 'a leftover with no settings is told they go');
});

test('#7819: a picture alone is named as the picture', () => {
  const name = leftoverAgent('onlypic7819');
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'onlypic7819.png'), 'png');
  assert.ok(mac.plan(name).loses.includes('Its picture: to the Trash with the files, and a new agent with this name starts without it'));
});

test('#7819: a folder recorded under another name never takes that other agent\'s profile or picture', () => {
  // carl was removed and his folder freed; dave was connected to it (discover.connect records another's folder).
  const carl = leftoverAgent('carl7819', { job: false });
  store.writeProfile(carl, { displayName: 'Carl' });
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'carl7819.png'), 'png');
  const dave = 'dave7819';
  fs.mkdirSync(nodePath.dirname(create.plistPath(dave)), { recursive: true });
  fs.writeFileSync(create.plistPath(dave), '<plist/>');
  store.writeProfile(dave, { displayName: 'Dave', dir: create.workerDir(carl) });
  const r = mac.del(dave);
  assert.notEqual(r.outcome, leftover.OUTCOME.REFUSED, r.because);
  assert.equal(fs.existsSync(store.profilePath(carl)), true, 'deleting dave took carl\'s profile');
  assert.ok(store.avatarPath(carl), 'deleting dave took carl\'s picture');
  assert.equal(fs.existsSync(store.profilePath(dave)), false, 'CONTROL: dave\'s own profile did not go');
});

test('#7819: without a Trash the settings are deleted for good, and the plan says so', () => {
  const trash = process.env.AGENT_WORKFORCE_TRASH;
  const name = leftoverAgent('gone7819');
  store.writeProfile(name, { displayName: 'Gone' });
  fs.rmSync(trash, { recursive: true, force: true });
  let p; let r;
  try {
    p = mac.plan(name);
    assert.equal(p.toTrash, false, 'CONTROL: the plan really is the for-good path');
    assert.ok(p.loses.includes('Its settings: deleted for good, and a new agent with this name starts without them'), JSON.stringify(p.loses));
    assert.equal(p.typeToConfirm, 'Gone', 'the for-good path did not ask for the name');
    r = mac.del(name, { typed: 'Gone' });
  } finally { fs.mkdirSync(trash, { recursive: true }); }
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(fs.existsSync(store.profilePath(name)), false);
  assert.ok(!trashHas('gone7819.json'), 'the for-good path put the settings in a Trash');
});

test('#7819: a job that will not go keeps the settings (the agent can still start)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a move with' : false) }, () => {
  const name = leftoverAgent('job7819');
  store.writeProfile(name, { displayName: 'Job', provider: 'openai' });
  const dir = nodePath.dirname(create.plistPath(name));
  fs.chmodSync(dir, 0o555);
  let r;
  try { r = mac.del(name); } finally { fs.chmodSync(dir, 0o755); }
  assert.notEqual(r.outcome, leftover.OUTCOME.DELETED, 'CONTROL: the job really was stuck');
  assert.equal(fs.existsSync(create.plistPath(name)), true, 'CONTROL: the job is still there');
  assert.equal(store.readProfile(name).provider, 'openai', 'an agent that can still start lost its settings');
});

test('#7819: a profile another agent shares (same stored name, other case) is kept, and the step says why', () => {
  const name = leftoverAgent('miles7819', { job: false });
  store.writeProfile(name, { displayName: 'miles' });
  status.setPaneSource(() => fleet.line({ session: 'Miles7819', claim: 'Miles7819', title: '✳ Claude Code' }));
  // On Linux names are case-sensitive, so the running Miles7819 does not hold miles7819's leftover.
  const r = leftover.del(name, { platform: 'linux' });
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'the delete took a profile the running Miles7819 also reads');
  assert.ok(r.steps.some((s) => s.step === 'its settings and picture' && /kept: Miles7819 uses the same stored name/.test(s.because || '')), JSON.stringify(r.steps));
});

test('#7819: settings that will not move after the files went: PARTIAL, and it says a new agent would start with them', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a move with' : false) }, () => {
  const name = leftoverAgent('stuck7819');
  store.writeProfile(name, { displayName: 'Stuck' });
  const dir = nodePath.dirname(store.profilePath(name));
  fs.chmodSync(dir, 0o555);
  let r;
  try { r = mac.del(name); } finally { fs.chmodSync(dir, 0o755); }
  assert.equal(r.outcome, leftover.OUTCOME.PARTIAL, r.because);
  assert.match(r.because, /Its settings are still on this computer, so a new agent with this name would start with them\.$/);
  // Never removed, so no removed-list row: no retry is promised that a person could not reach (kosmos#7825 review 3).
  assert.doesNotMatch(r.because, /Deleting what is left again/);
  assert.doesNotMatch(r.because, /name is free/);
  assert.equal(fs.existsSync(create.workerDir(name)), false, 'CONTROL: the folder did go');
});

test('#7819: a job-only leftover whose settings go for good asks for the name, and does not say nothing is lost', () => {
  const name = 'unit7819';
  const unit = require('./linuxjob').unitPath(name);
  fs.mkdirSync(nodePath.dirname(unit), { recursive: true });
  fs.writeFileSync(unit, '[Unit]\n');
  const plain = leftover.plan(name, { platform: 'linux' });
  assert.equal(plain.ok, true, plain.because);
  assert.equal(plain.typeToConfirm, null, 'CONTROL: a job-only leftover with nothing stored asks for no typing');
  store.writeProfile(name, { displayName: 'Unit' });
  const p = leftover.plan(name, { platform: 'linux' });
  assert.equal(p.typeToConfirm, 'Unit', 'settings deleted for good, yet no typing was asked');
  assert.doesNotMatch(p.reassurance, /Nothing you can lose/);
  assert.match(p.reassurance, /^Its settings cannot go to the Trash, so they are deleted for good\. After this, the name Unit is free for a new agent\.$/);
  fs.rmSync(unit, { force: true });
});

test('#7819: a failed look at what is stored refuses the plan, never promises a free name over a profile', () => {
  const name = leftoverAgent('look7819');
  store.writeProfile(name, { displayName: 'Look' });
  let reads = 0;
  status.setPaneSource(() => { reads += 1; if (reads > 1) throw new Error('tmux went away'); return ''; });
  const p = mac.plan(name);
  assert.ok(reads > 1, 'fixture: the roster was not read a second time, so the failing look never happened');
  assert.equal(p.ok, false, 'the plan offered a delete after it could not see what is stored');
  assert.match(p.because, /could not check what Kosmos has stored for Look/);
  assert.equal(fs.existsSync(store.profilePath(name)), true);
});


/* #7819 review 3. */
test('#7819: a leftover whose own folder is spelled differently from the name asked is not mistaken for another agent', () => {
  // The profile records WORKERS_DIR/Rowan7819; the delete is asked as rowan7819 (a Mac does not tell them apart).
  const folder = nodePath.join(create.WORKERS_DIR, 'Rowan7819');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(nodePath.join(folder, 'CLAUDE.md'), 'work\n');
  store.writeProfile('rowan7819', { displayName: 'Rowan', dir: folder });
  const r = mac.del('rowan7819');
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(fs.existsSync(store.profilePath('rowan7819')), false, 'its own profile was kept as if another agent owned it');
  assert.doesNotMatch(r.said, /stay/, 'the result says settings stayed');
});

test('#7819: the picture\'s kept originals go to the Trash with it, not deleted', () => {
  const name = leftoverAgent('orig7819');
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'orig7819.png'), 'fitted');
  const origDir = nodePath.join(nodePath.dirname(store.AVATARS), 'avatar-originals');
  fs.mkdirSync(origDir, { recursive: true });
  fs.writeFileSync(nodePath.join(origDir, 'orig7819.1-6.png'), 'as set');
  const r = mac.del(name);
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(fs.existsSync(nodePath.join(origDir, 'orig7819.1-6.png')), false, 'CONTROL: the original is gone from its folder');
  assert.ok(trashHas('orig7819.1-6.png'), 'the picture as the person set it was deleted, not moved to the Trash');
});

test('#7819: settings kept for another agent are said in the plan and in the result', () => {
  const name = leftoverAgent('kim7819', { job: false });
  store.writeProfile(name, { displayName: 'kim' });
  status.setPaneSource(() => fleet.line({ session: 'Kim7819', claim: 'Kim7819', title: '✳ Claude Code' }));
  const p = leftover.plan(name, { platform: 'linux' });
  assert.ok(p.loses.includes('Its settings stay: Kim7819 uses the same stored name, and a new agent with this name shares them'), JSON.stringify(p.loses));
  const r = leftover.del(name, { platform: 'linux' });
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.match(r.said, /Its settings stay \(Kim7819 uses the same stored name\), so a new agent with this name shares them\.$/);
  assert.equal(fs.existsSync(store.profilePath(name)), true);
});


test('#7819: with nothing stored, a shared stored name says nothing about settings staying', () => {
  const name = leftoverAgent('nil7819', { job: false });
  status.setPaneSource(() => fleet.line({ session: 'Nil7819', claim: 'Nil7819', title: '✳ Claude Code' }));
  assert.equal(fs.existsSync(store.profilePath(name)), false, 'fixture: a profile exists');
  const p = leftover.plan(name, { platform: 'linux' });
  assert.equal(p.ok, true, p.because);
  assert.ok(!p.loses.some((l) => /stay/.test(l)), 'the plan says settings stay that do not exist: ' + JSON.stringify(p.loses));
  const r = leftover.del(name, { platform: 'linux' });
  assert.doesNotMatch(String(r.said || r.because), /stay/, 'the result says settings stayed that do not exist');
});


test('#7819: a pictures folder that cannot be read refuses the plan, never promises a clean name', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root reads a folder whatever its mode' : false) }, () => {
  const name = leftoverAgent('blind7819');
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'blind7819.png'), 'png');
  fs.chmodSync(store.AVATARS, 0o000);
  let p;
  try { p = mac.plan(name); } finally { fs.chmodSync(store.AVATARS, 0o755); }
  assert.equal(p.ok, false, 'the plan promised a clean name over a picture it could not see');
  assert.match(p.because, /could not check what Kosmos has stored for blind7819/);
  // CONTROL: readable again, the same leftover is offered and its picture named.
  assert.ok(mac.plan(name).loses.some((l) => /^Its picture: to the Trash/.test(l)));
});

test('#7819: a workers folder that cannot be read refuses the plan (it could hide a folder sharing the stored name)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root reads a folder whatever its mode' : false) }, () => {
  const name = 'wblind7819';
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>');   // the job keeps it a leftover while the folder cannot be seen
  store.writeProfile(name, { displayName: 'Wblind' });
  fs.mkdirSync(create.WORKERS_DIR, { recursive: true });
  fs.chmodSync(create.WORKERS_DIR, 0o000);
  let p;
  try { p = mac.plan(name); } finally { fs.chmodSync(create.WORKERS_DIR, 0o755); }
  assert.equal(p.ok, false, 'the plan offered a delete without being able to see the workers folder');
  assert.match(p.because, /could not check what Kosmos has stored for Wblind/);
  assert.equal(mac.plan(name).ok, true, 'CONTROL: readable again, the same leftover is offered');
  fs.rmSync(create.plistPath(name), { force: true });
});

/* kosmos#7825: settings or a picture left with no folder and no job (a delete from before #7819, or a #7819 PARTIAL). */
function strandedProfile(name, fields) {
  store.writeProfile(name, { displayName: name, ...(fields || {}) });
  return name;
}
function withWorldStarts(entries, fn) {
  const ws = require('./worldstarts');
  const had = fs.existsSync(ws.RECORD_FILE) ? fs.readFileSync(ws.RECORD_FILE) : null;
  fs.mkdirSync(nodePath.dirname(ws.RECORD_FILE), { recursive: true });
  fs.writeFileSync(ws.RECORD_FILE, typeof entries === 'string' ? entries : JSON.stringify({ entries }));
  try { return fn(); } finally { if (had === null) fs.rmSync(ws.RECORD_FILE, { force: true }); else fs.writeFileSync(ws.RECORD_FILE, had); }
}

test('kosmos#7825: a stranded profile and picture are offered, cleared to the Trash, and a new agent under the name gets a new id', () => {
  const name = strandedProfile('lone7825', { provider: 'openai', vendorAccount: '/old/acct' });
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'lone7825.png'), 'png');
  const old = store.readProfile(name);
  assert.ok(old.id, 'fixture: no id was minted');
  assert.equal(fs.existsSync(create.workerDir(name)), false, 'fixture: a folder exists');
  const p = mac.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.equal(p.folder, null);
  assert.equal(p.job, null);
  assert.deepEqual(p.loses, ['Its settings and picture: to the Trash, and a new agent with this name starts without them']);
  assert.equal(p.verb, 'Move its settings and picture to the Trash');
  assert.equal(p.reassurance, 'Its settings and picture go to the Trash, where you can get them back until you empty it. After this, the name lone7825 is free for a new agent.');
  assert.match(p.hint, /^Kosmos still has its settings and picture for lone7825, though nothing else of it is left/);
  assert.equal(p.typeToConfirm, null, 'nothing goes for good, yet the name was asked for');
  const r = mac.del(name);
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(r.said, "lone7825's settings and picture are in the Trash. The name is free.");
  assert.equal(fs.existsSync(store.profilePath(name)), false, 'the stranded profile outlived the delete');
  assert.equal(store.avatarPath(name), null, 'the stranded picture outlived the delete');
  assert.ok(trashHas('lone7825.json') && trashHas('lone7825.png'), 'they did not go to the Trash');
  const made = createAgain(name);
  assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
  const now = store.readProfile(name);
  assert.ok(now.id && now.id !== old.id, 'the new agent inherited the stranded id');
  assert.equal(now.vendorAccount, undefined, 'the new agent inherited a stranded field');
});

test('kosmos#7825: CONTROL: a name with nothing stored is still "nothing left"', () => {
  const p = mac.plan('nobody7825');
  assert.equal(p.ok, false);
  assert.match(p.because, /^nothing of nobody7825 is left on this computer/);
});

test('kosmos#7825: a pending world start\'s profile is never offered, and a delete leaves it', () => {
  const name = strandedProfile('ws7825', { provider: 'openai' });
  withWorldStarts([{ name, why: 'paused', because: 'held for a retry' }], () => {
    const p = mac.plan(name);
    assert.equal(p.ok, false, 'a waiting world start was offered for deleting');
    assert.match(p.because, /^ws7825 is waiting to start on this computer, so its settings are not left over\.$/);
    assert.equal(mac.del(name).outcome, leftover.OUTCOME.REFUSED);
  });
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'the delete took a waiting world start\'s profile');
  // CONTROL: the same profile with the record gone is a leftover.
  assert.equal(mac.plan(name).ok, true, 'CONTROL: the same profile without a world start is not offered');
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a world start recorded in another case shares the stored name and holds it too', () => {
  const name = strandedProfile('case7825');
  withWorldStarts([{ name: 'Case7825', why: 'import' }], () => {
    assert.match(mac.plan(name).because || '', /waiting to start/);
  });
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a profile marked held with no world start waiting is stranded, and offered (review 1)', () => {
  // remove.recordRemoval drops the world-start entry and leaves the mark; Repair cannot start a name with no folder.
  const name = strandedProfile('held7825', { policyHeld: true, provider: 'openai' });
  assert.equal(mac.plan(name).ok, true, 'a stranded profile was refused for its leftover policyHeld mark');
  withWorldStarts([{ name, why: 'import', because: 'held by policy' }], () => {
    assert.match(mac.plan(name).because || '', /^held7825 is waiting to start on this computer/, 'CONTROL: with its entry it is a waiting world start');
  });
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a profile that cannot be read refuses, never reads as "no recorded folder" (review 1)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root reads a file whatever its mode' : false) }, () => {
  const name = strandedProfile('noread7825', { dir: nodePath.join(SANDBOX, 'unplugged-disk', 'noread7825') });
  const file = store.profilePath(name);
  fs.chmodSync(file, 0o000);
  let p;
  try { p = mac.plan(name); } finally { fs.chmodSync(file, 0o644); }
  assert.equal(p.ok, false, 'an unreadable profile was offered for deleting');
  assert.match(p.because, /could not read what Kosmos has stored for noread7825/);
  // Not JSON: also a failed look.
  // A file that reads but is not settings is offered, and the plan says it could not be checked (review 4); a waiting
  // world start still holds it.
  for (const body of ['{half', 'null', '[1]']) {
    fs.writeFileSync(file, body);
    const d = mac.plan(name);
    assert.equal(d.ok, true, `${body}: ${d.because}`);
    assert.ok(d.loses.includes('Its settings file is not in a form Kosmos can read, so Kosmos could not check what it recorded before offering it'), JSON.stringify(d.loses));
    withWorldStarts([{ name, why: 'import' }], () => assert.match(mac.plan(name).because || '', /waiting to start/, `${body}: a damaged file was offered over a waiting world start`));
  }
  fs.writeFileSync(file, JSON.stringify({ displayName: 'x' }));
  assert.ok(!mac.plan(name).loses.some((l) => /not in a form/.test(l)), 'CONTROL: readable settings were said to be unreadable');
  fs.rmSync(file, { force: true });
});

test('kosmos#7825: a world-start record that cannot be read refuses, never offers', () => {
  const name = strandedProfile('unread7825');
  withWorldStarts('{not json', () => {
    const p = mac.plan(name);
    assert.equal(p.ok, false);
    assert.match(p.because, /could not check whether unread7825 is waiting to start/);
  });
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a connected agent whose folder is out of reach (outside the workers folder) is never offered', () => {
  const name = strandedProfile('away7825', { dir: nodePath.join(SANDBOX, 'unplugged-disk', 'away7825') });
  const p = mac.plan(name);
  assert.equal(p.ok, false, 'an agent on a disconnected disk was offered for deleting');
  assert.match(p.because, /is not there now and is not where Kosmos keeps agents\. It may be on a disk or a shared folder that is not connected/);
  // CONTROL: a recorded folder inside the workers folder that is gone is a leftover.
  store.writeProfile(name, { dir: nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'away7825') });
  assert.equal(mac.plan(name).ok, true, 'CONTROL: a gone folder inside the workers folder is not offered');
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: without a Trash a stranded profile is deleted for good, and the name must be typed', () => {
  const trash = process.env.AGENT_WORKFORCE_TRASH;
  const name = strandedProfile('nobin7825');
  fs.rmSync(trash, { recursive: true, force: true });
  let p; let refused; let r;
  try {
    p = mac.plan(name);
    assert.equal(p.typeToConfirm, 'nobin7825');
    assert.equal(p.verb, 'Delete its settings for good');
    assert.equal(p.reassurance, 'This cannot be undone: the Trash cannot take its settings, so they are deleted for good. After this, the name nobin7825 is free for a new agent.');
    refused = mac.del(name);
    r = mac.del(name, { typed: 'nobin7825' });
  } finally { fs.mkdirSync(trash, { recursive: true }); }
  assert.equal(refused.outcome, leftover.OUTCOME.REFUSED, 'deleted for good without the name typed');
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(r.said, "nobin7825's settings are deleted. The name is free.");
  assert.equal(fs.existsSync(store.profilePath(name)), false);
});

test('kosmos#7825: a stranded profile a running agent shares by stored name is not offered', () => {
  const name = strandedProfile('share7825');
  status.setPaneSource(() => fleet.line({ session: 'Share7825', claim: 'Share7825', title: '✳ Claude Code' }));
  // Linux, so the running Share7825 is not the same name and the stored-name rule is what refuses.
  let p;
  try { p = leftover.plan(name, { platform: 'linux' }); } finally { status.setPaneSource(null); }
  assert.equal(p.ok, false);
  assert.equal(p.because, 'nothing of share7825 is left on this computer except its settings, which stay because Share7825 uses the same stored name, so there is nothing to delete.');
  assert.equal(fs.existsSync(store.profilePath(name)), true);
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a records-only delete revokes its tokens and retires its community account, and the plan says so (review 1)', () => {
  const cs = require('./communitysend');
  const name = strandedProfile('poster7825');
  fs.mkdirSync(nodePath.dirname(cs._paths.keysFile()), { recursive: true });
  const had = fs.existsSync(cs._paths.keysFile()) ? JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8')) : {};
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ ...had, poster7825: { remoteId: 'r7825', name, apiKey: 'kc_7825', token: 't7825', registeredAt: '2026-11-02T00:00:00.000Z' } }));
  const minted = sendertoken.mint(name);
  assert.equal(minted.ok, true, minted.because);
  const p = mac.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.ok(p.loses.some((l) => /^Its community account:/.test(l)), JSON.stringify(p.loses));
  assert.match(p.reassurance, /^Its settings go to the Trash, where you can get them back until you empty it, and its community account does not come back\. After this/);
  const r = mac.del(name);
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.ok(r.steps.some((x) => x.step === 'its community account' && x.ok), JSON.stringify(r.steps));
  assert.equal(sendertoken.resolveName(minted.token).ok, false, 'the stranded name\'s token still resolves');
});

test('kosmos#7825: records-only settings that will not move: REFUSED, community account NOT retired, and a retry is offered (review 1)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a move with' : false) }, () => {
  const name = strandedProfile('stuckonly7825');
  const dir = nodePath.dirname(store.profilePath(name));
  fs.chmodSync(dir, 0o555);
  let r;
  try { r = mac.del(name); } finally { fs.chmodSync(dir, 0o755); }
  assert.equal(r.outcome, leftover.OUTCOME.REFUSED, r.because);
  assert.ok(!r.steps.some((x) => x.step === 'its community account'), 'the account was retired while nothing was deleted');
  assert.match(r.because, /^we could not move its settings\. Nothing was moved\./);
  assert.doesNotMatch(r.because, /Deleting what is left again/, 'a retry was promised with no removed-list row to reach it');
  assert.equal(mac.plan(name).ok, true, 'CONTROL: the retry the sentence promises is offered');
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a records-only leftover is offered on Linux too', () => {
  const name = strandedProfile('linux7825');
  const p = leftover.plan(name, { platform: 'linux' });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.verb, 'Move its settings to the Trash');
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: settings stuck after the folder went keep the removed-list row, so the retry is reachable, and it clears it (review 2)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a move with' : false) }, () => {
  quiet();
  const name = leftoverAgent('retry7825', { job: false });
  store.writeProfile(name, { displayName: 'Retry' });
  const rec = remove.remove(name);
  assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
  const dir = nodePath.dirname(store.profilePath(name));
  fs.chmodSync(dir, 0o555);
  let first;
  try { first = mac.del(name); } finally { fs.chmodSync(dir, 0o755); }
  assert.equal(first.outcome, leftover.OUTCOME.PARTIAL, first.because);
  assert.match(first.because, /Deleting what is left again from the removed agents list clears them\.$/);
  assert.equal(fs.existsSync(create.workerDir(name)), false, 'CONTROL: the folder did go');
  assert.equal(remove.isRemoved(name), true, 'the removed-list row (the way back to Delete) went while its settings stayed');
  const again = mac.del(name);
  assert.equal(again.outcome, leftover.OUTCOME.DELETED, again.because);
  assert.equal(fs.existsSync(store.profilePath(name)), false);
  assert.equal(remove.isRemoved(name), false, 'the row outlived the settings');
});

test('kosmos#7825: a recorded folder that is not an absolute path is not a connected agent, so it does not hold the settings (review 2)', () => {
  const name = strandedProfile('rel7825', { dir: 'somewhere/rel7825' });
  assert.equal(mac.plan(name).ok, true);
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: on a case-blind disk a folder recorded in the workers folder in another case is inside it (review 2)', { skip: (() => { const W = process.env.AGENT_WORKFORCE_WORKERS; fs.mkdirSync(W, { recursive: true }); return fs.existsSync(W.toUpperCase()) ? false : 'this disk tells case apart (review 6)'; })() }, () => {
  const W = process.env.AGENT_WORKFORCE_WORKERS;
  const name = strandedProfile('fold7825', { dir: nodePath.join(W.toUpperCase(), 'fold7825') });
  assert.equal(mac.plan(name).ok, true, 'a gone folder inside the workers folder, spelled in another case, read as out of reach');
  // No Linux CONTROL here: the disk under the test answers, and on a case-blind disk the link-resolving compare
  // (review 4) already reads both spellings as one folder whatever platform is asked about.
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a folder or auto-start file that will not go still drops the removed-list record, so the card shows again (review 3)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a move with' : false) }, () => {
  quiet();
  for (const [name, lockDir] of [['fstuck7825', () => process.env.AGENT_WORKFORCE_WORKERS], ['jstuck7825', () => nodePath.dirname(create.plistPath('jstuck7825'))]]) {
    leftoverAgent(name);
    store.writeProfile(name, { displayName: name });
    const rec = remove.remove(name);
    assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
    assert.equal(remove.isRemoved(name), true, 'fixture: not on the removed list');
    const dir = lockDir();
    fs.chmodSync(dir, 0o555);
    let r;
    try { r = mac.del(name); } finally { fs.chmodSync(dir, 0o755); }
    assert.notEqual(r.outcome, leftover.OUTCOME.DELETED, `${name}: fixture: nothing was stuck`);
    assert.equal(fs.existsSync(store.profilePath(name)), true, `${name}: CONTROL: the records step did not run`);
    assert.equal(remove.isRemoved(name), false, `${name}: the removed-list record was kept while a folder or job still shows the card`);
    assert.equal(remove.isHidden(name), false, `${name}: the card stays hidden`);
  }
});

test('kosmos#7825: a recorded folder spelled through a link to the workers folder is inside it (review 4)', () => {
  const W = process.env.AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(W, { recursive: true });
  const link = nodePath.join(SANDBOX, 'workers-link');
  fs.rmSync(link, { force: true }); fs.symlinkSync(W, link);
  const name = strandedProfile('link7825', { dir: nodePath.join(link, 'link7825') });
  assert.equal(mac.plan(name).ok, true, 'a gone folder in the workers folder, spelled through a link, read as out of reach');
  // (A profile recording the workers folder itself has a folder that exists, so plan()'s folder rule answers first.)
  // CONTROL: a sibling folder of the workers folder is outside it.
  store.writeProfile(name, { dir: nodePath.join(SANDBOX, 'elsewhere', 'link7825') });
  assert.match(mac.plan(name).because || '', /is not there now and is not where Kosmos keeps agents\. It may be on a disk or a shared folder that is not connected/);
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a picture alone left over is named in the singular, end to end', () => {
  const name = 'onlypic7825';
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, 'onlypic7825.png'), 'png');
  const p = mac.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.equal(p.verb, 'Move its picture to the Trash');
  assert.equal(p.reassurance, 'Its picture goes to the Trash, where you can get it back until you empty it. After this, the name onlypic7825 is free for a new agent.');
  assert.match(p.hint, /a new agent with this name would start with it\.$/);
  const r = mac.del(name);
  assert.equal(r.outcome, leftover.OUTCOME.DELETED, r.because);
  assert.equal(r.said, "onlypic7825's picture is in the Trash. The name is free.");
  assert.equal(store.avatarPath(name), null);
});

test('kosmos#7825: a recorded folder outside the workers folder that is there (a link) is refused without blaming a disconnected disk (review 5)', () => {
  const out = nodePath.join(SANDBOX, 'outside7825');
  fs.mkdirSync(nodePath.join(out, 'real'), { recursive: true });
  const link = nodePath.join(out, 'linked');
  fs.rmSync(link, { force: true }); fs.symlinkSync(nodePath.join(out, 'real'), link);
  const name = strandedProfile('there7825', { dir: link });
  assert.equal(mac.plan(name).because, "there7825's folder is not where Kosmos keeps agents, so Kosmos will not delete its settings.");
  // A real folder there: plan()'s own folder rule answers first, with its own true sentence.
  store.writeProfile(name, { dir: nodePath.join(out, 'real') });
  assert.equal(mac.plan(name).because, "there7825's folder is not where Kosmos keeps agents, so Kosmos will not delete it.");
  // CONTROL: nothing there is the disconnected-disk sentence.
  store.writeProfile(name, { dir: nodePath.join(out, 'gone') });
  assert.match(mac.plan(name).because || '', /is not there now and is not where Kosmos keeps agents\. It may be on a disk or a shared folder that is not connected/);
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a recorded folder inside the workers folder behind a link is judged by the link (review 6)', () => {
  const W = process.env.AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(W, { recursive: true });
  const dangling = nodePath.join(W, 'ext7825');
  fs.rmSync(dangling, { force: true }); fs.symlinkSync(nodePath.join(SANDBOX, 'unmounted7825'), dangling);
  const name = strandedProfile('behind7825', { dir: nodePath.join(dangling, 'behind7825') });
  try {
    assert.match(mac.plan(name).because || '', /^behind7825's folder is behind a link that leads nowhere right now/, 'a folder behind a link to an unmounted disk was offered');
    // A live link out of the workers folder: judged by where it goes (outside, and its folder gone there).
    fs.mkdirSync(nodePath.join(SANDBOX, 'mounted7825'), { recursive: true });
    const live = nodePath.join(W, 'live7825');
    fs.rmSync(live, { force: true }); fs.symlinkSync(nodePath.join(SANDBOX, 'mounted7825'), live);
    store.writeProfile(name, { dir: nodePath.join(live, 'behind7825') });
    assert.match(mac.plan(name).because || '', /is not there now and is not where Kosmos keeps agents\. It may be on a disk or a shared folder that is not connected/, 'a gone folder behind a link out of the workers folder was offered');
    // CONTROL: the same gone folder spelled with no link is a leftover.
    store.writeProfile(name, { dir: nodePath.join(W, 'behind7825') });
    assert.equal(mac.plan(name).ok, true);
  } finally {
    for (const l of ['ext7825', 'live7825']) fs.rmSync(nodePath.join(W, l), { force: true });
    fs.rmSync(store.profilePath(name), { force: true });
  }
});

test('kosmos#7825: a look below the workers folder that fails refuses, never reads as a gone folder (review 6)', { skip: skipOnWin32('it fails a read or a move with a POSIX file or folder mode (chmod), which Windows does not keep') || (typeof process.getuid === 'function' && process.getuid() === 0 ? 'root reads a folder whatever its mode' : false) }, () => {
  const W = process.env.AGENT_WORKFORCE_WORKERS;
  const locked = nodePath.join(W, 'locked7825');
  fs.mkdirSync(locked, { recursive: true });
  const name = strandedProfile('peek7825', { dir: nodePath.join(locked, 'inner', 'peek7825') });
  fs.chmodSync(locked, 0o000);
  let p;
  try { p = mac.plan(name); } finally { fs.chmodSync(locked, 0o755); fs.rmSync(locked, { recursive: true, force: true }); }
  assert.equal(p.ok, false, 'a folder Kosmos could not look into was read as gone');
  assert.match(p.because, /^we could not check where peek7825's folder was/);
  fs.rmSync(store.profilePath(name), { force: true });
});

test('kosmos#7825: a dangling link is found whatever the case of the spelling or the links before it, and a file on the way is a gone rest (review 7)', () => {
  const W = process.env.AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(W, { recursive: true });
  const made = [];
  const link = (from, to) => { fs.rmSync(from, { force: true }); fs.symlinkSync(to, from); made.push(from); };
  const name = strandedProfile('hop7825');
  try {
    link(nodePath.join(W, 'ext7825'), nodePath.join(SANDBOX, 'unmounted7825'));
    // Two links: a live one in front of a dangling one.
    fs.mkdirSync(nodePath.join(W, 'b7825'), { recursive: true }); made.push(nodePath.join(W, 'b7825'));
    link(nodePath.join(W, 'b7825', 'ext'), nodePath.join(SANDBOX, 'unmounted7825'));
    link(nodePath.join(W, 'a7825'), nodePath.join(W, 'b7825'));
    store.writeProfile(name, { dir: nodePath.join(W, 'a7825', 'ext', 'hop7825') });
    assert.match(mac.plan(name).because || '', /behind a link that leads nowhere/, 'a dangling link behind a live one was not seen');
    // In another case (a case-blind disk only).
    if (fs.existsSync(W.toUpperCase())) {
      store.writeProfile(name, { dir: nodePath.join(W.toUpperCase(), 'ext7825', 'hop7825') });
      assert.match(mac.plan(name).because || '', /behind a link that leads nowhere/, 'a dangling link spelled in another case was not seen');
    }
    // A link that loops.
    link(nodePath.join(W, 'loop7825'), nodePath.join(W, 'loop7825'));
    store.writeProfile(name, { dir: nodePath.join(W, 'loop7825', 'hop7825') });
    assert.match(mac.plan(name).because || '', /behind a link that leads nowhere/);
    // A file where a folder would be: the rest is gone, so it is a leftover (not a refusal that never clears).
    fs.writeFileSync(nodePath.join(W, 'afile7825'), 'x'); made.push(nodePath.join(W, 'afile7825'));
    store.writeProfile(name, { dir: nodePath.join(W, 'afile7825', 'hop7825') });
    assert.equal(mac.plan(name).ok, true, mac.plan(name).because);
  } finally {
    for (const m of made.reverse()) fs.rmSync(m, { recursive: true, force: true });
    fs.rmSync(store.profilePath(name), { force: true });
  }
});

test('kosmos#7825: with the workers folder gone, a folder recorded inside it is judged by the same walk (review 8)', () => {
  const W = process.env.AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(W, { recursive: true });
  const away = W + '.away7825';
  const name = strandedProfile('nowork7825', { dir: nodePath.join(W, 'nowork7825') });
  fs.renameSync(W, away);
  let p;
  try { p = mac.plan(name); } finally { fs.renameSync(away, W); fs.rmSync(store.profilePath(name), { force: true }); }
  // The sandbox sits under /var, a link to /private/var on a Mac: resolved on one side only, it read as outside.
  assert.equal(p.ok, true, p.because);
});

/* kosmos#7825 PR 2: the removed list's source of names with only settings left. */
test('kosmos#7825 PR 2: settingsLeftovers lists a profile with no folder and no job, and nothing that is still something else', () => {
  quiet();
  const lone = strandedProfile('list7825');
  const live = leftoverAgent('hasdir7825', { job: false });   // a folder: not settings-only
  store.writeProfile(live, { displayName: live });
  const gone = leftoverAgent('removed7825', { job: false });
  store.writeProfile(gone, { displayName: gone });
  assert.notEqual(remove.remove(gone).outcome, remove.OUTCOME.REFUSED);
  fs.rmSync(create.workerDir(gone), { recursive: true, force: true });   // removed, then its folder went by hand: drawn as a removed row already
  const waiting = strandedProfile('wait7825');
  const jobOnly = strandedProfile('jobonly7825');   // its startup job is still there: "Delete" already reaches it
  fs.mkdirSync(nodePath.dirname(create.plistPath(jobOnly)), { recursive: true });
  fs.writeFileSync(create.plistPath(jobOnly), '<plist/>');
  try {
    withWorldStarts([{ name: waiting, why: 'import' }], () => {
      const r = leftover.settingsLeftovers({ platform: 'darwin' });
      assert.equal(r.ok, true);
      const names = r.names.map((x) => x.name);
      assert.ok(names.includes(lone), 'a stranded profile was not listed: ' + JSON.stringify(names));
      assert.deepEqual(r.names.find((x) => x.name === lone), { name: lone, shownAs: lone });
      for (const n of [live, gone, waiting, jobOnly]) assert.ok(!names.includes(n), `${n} was listed as settings only`);
    });
    assert.ok(leftover.settingsLeftovers({ platform: 'darwin' }).names.some((x) => x.name === waiting), 'CONTROL: without its world start it is settings only');
    withWorldStarts('{broken', () => assert.deepEqual(leftover.settingsLeftovers({ platform: 'darwin' }), { ok: false, names: [] }, 'an unreadable world-start record listed names'));
  } finally {
    for (const n of [lone, live, gone, waiting, jobOnly]) fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(create.plistPath(jobOnly), { force: true });
    try { remove.forget(gone); } catch { /* best effort */ }
  }
});

test('kosmos#7825 PR 2 review 1: settingsLeftovers leaves out a running agent and an outside recorded folder, and a failed roster lists none', () => {
  const run = strandedProfile('runs7825');
  const away = strandedProfile('away27825', { dir: nodePath.join(SANDBOX, 'share-gone', 'away27825') });
  const inside = strandedProfile('in7825', { dir: nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'in7825') });
  fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
  const realW = fs.realpathSync.native(process.env.AGENT_WORKFORCE_WORKERS);
  // review 3: the same workers folder spelled through its links (/private/var for /var on a Mac).
  const spelled = strandedProfile('in27825', { dir: nodePath.join(realW, 'in27825') });
  try {
    status.setPaneSource(() => fleet.line({ session: 'Runs7825', claim: 'Runs7825', title: '✳ Claude Code' }));
    let names = leftover.settingsLeftovers({ platform: 'darwin' }).names.map((x) => x.name);
    assert.ok(!names.includes(run), 'a running agent (another case on a case-blind disk) was listed as settings only');
    assert.ok(!names.includes(away), 'a folder recorded outside the workers folder was listed as settings only');
    assert.ok(names.includes(inside), 'CONTROL: a gone folder recorded inside the workers folder is settings only');
    assert.ok(names.includes(spelled), 'a folder recorded under the workers folder\'s resolved spelling read as outside');
    quiet();
    names = leftover.settingsLeftovers({ platform: 'darwin' }).names.map((x) => x.name);
    assert.ok(names.includes(run), 'CONTROL: stopped, it is settings only');
    status.setPaneSource(() => { throw new Error('tmux went away'); });
    assert.deepEqual(leftover.settingsLeftovers({ platform: 'darwin' }), { ok: false, names: [] }, 'a failed roster read listed names');
    // A survey handed in is the one used.
    quiet();
    const given = { ok: true, agents: [{ name: 'handed7825', shownAs: 'Handed', profile: true, folder: false, job: false, removed: false }] };
    assert.deepEqual(leftover.settingsLeftovers({ platform: 'darwin', survey: given }).names, [{ name: 'handed7825', shownAs: 'Handed' }]);
  } finally {
    quiet();
    for (const n of [run, away, inside, spelled]) fs.rmSync(store.profilePath(n), { force: true });
  }
});
