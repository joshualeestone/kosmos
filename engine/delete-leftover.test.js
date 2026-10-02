'use strict';
/**
 * #514: the separate verb that frees a name. Sandboxed on every root, the
 * same way remove.test.js is: this module MOVES OR DELETES FOLDERS, and an
 * unsandboxed run would do it to somebody's real agents.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
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

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };
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

test('#4994: a delete that left the folder behind does not retire the community account (it cannot be undone)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, () => {
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
  leftoverAgent('halfgone', { job: false });
  cs.grantTrust('halfgone');
  const realRename = fs.renameSync;
  const realRm = fs.rmSync;
  const folder = create.workerDir('halfgone');
  fs.renameSync = (from, to) => { if (from === folder) throw new Error('busy'); return realRename(from, to); };
  fs.rmSync = (target, o) => { if (target === folder) throw new Error('busy'); return realRm(target, o); };
  let done;
  try {
    quiet();
    done = mac.del('halfgone');
  } finally {
    fs.renameSync = realRename;
    fs.rmSync = realRm;
  }
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'control: the folder was meant to be stuck');
  assert.ok(done.steps.some((x) => x.step === 'its community standing' && x.ok), 'the standing step did not run');
  assert.equal(cs.trustState('halfgone'), 'untrusted', 'a partial delete left the standing in place');
  /* The sentence the person reads: true about what happened, and no card number in it. */
  assert.match(done.because, /None of its files were moved\. Its standing in the community was reset/, done.because);
  assert.ok(!/#\d/.test(done.because), 'a card number reached the person: ' + done.because);
});
