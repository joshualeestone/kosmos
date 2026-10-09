'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #4491 post-rebase review: the undo copier (#5153) reads a file FOR an agent on the agent's own token, so it must never
 * keep a copy of the board's own credentials: board.token (by name, by its temp names, by a hard link under another
 * name) or a sender token. A refused file leaves no copy of its bytes in the undo store. Control: an ordinary file in
 * the agent's own folder is still kept.
 *   node --test engine/undo-credential-4491.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ud4491-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
for (const d of ['data', 'workers', '.claude/projects']) fs.mkdirSync(path.join(SB, d), { recursive: true });

const undo = require('./undo');
const store = require('./store');
const sendertoken = require('./sendertoken');

function worker(name) {
  const d = path.join(SB, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  store.writeProfile(name, { displayName: name });
  undo.resetForTests();
  return d;
}
const SECRET = 'board-secret-' + crypto.randomBytes(8).toString('hex');
const secretHash = crypto.createHash('sha256').update(SECRET).digest('hex');
/* Every byte the undo store holds, so a refusal can be checked to have left no copy behind. */
function storeHolds(text) {
  const root = path.join(store.ROOT, 'undo');
  const walk = (d) => { let out = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) out = out.concat(e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); } catch { /* none */ } return out; };
  return walk(root).some((f) => { try { return fs.readFileSync(f, 'utf8').includes(text); } catch { return false; } });
}

test('#4491: the undo copier never keeps a copy of the board token or a sender token', () => {
  const me = worker('ud-me');
  undo.setOn(true);
  fs.mkdirSync(store.ROOT, { recursive: true });
  const token = path.join(store.ROOT, 'board.token');
  fs.writeFileSync(token, SECRET, { mode: 0o600 });

  assert.deepEqual(undo.keep(token, { cwd: me }), { kept: false, because: 'credential' }, 'board.token was copied');
  const tmp = path.join(store.ROOT, '.board.token.123.tmp');
  fs.writeFileSync(tmp, SECRET);
  assert.equal(undo.keep(tmp, { cwd: me }).because, 'credential', 'a temp copy of the token was copied');
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  const st = path.join(sendertoken.DIR, 'someone');
  fs.writeFileSync(st, SECRET);
  assert.equal(undo.keep(st, { cwd: me }).because, 'credential', 'a sender token was copied');
  const link = path.join(me, 'notes.txt');
  fs.linkSync(token, link);   // must work in the sandbox: a skipped arm here would prove nothing
  assert.equal(undo.keep(link, { cwd: me }).because, 'credential', 'a hard link to board.token under another name was copied');
  assert.equal(undo.keep(path.join(store.ROOT, 'BOARD.TOKEN.new'), { cwd: me }).because, 'credential', 'a case variant of the name was recorded');
  const stLink = path.join(me, 'colleague.txt');
  fs.linkSync(st, stLink);
  assert.equal(undo.keep(stLink, { cwd: me }).because, 'credential', 'a hard link to a sender token was copied');
  const upper = path.join(path.dirname(sendertoken.DIR), path.basename(sendertoken.DIR).toUpperCase(), 'someone');
  assert.equal(undo.keep(upper, { cwd: me }).because, 'credential', 'the sender tokens folder spelled in another case was not refused');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['ud-me'] }));
  assert.equal(undo.keep(sendertoken.tokenOnlyFile(), { cwd: me }).because, 'credential', 'the token-only list was copied');
  const own = path.join(me, '.claude');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'settings.json'), '{}');
  assert.equal(undo.keep(path.join(own, 'settings.json'), { cwd: me }).because, 'credential', 'a token-only agent settings file is kept (and could be restored over its guard)');
  // Review 5: an account home and a registry temp name made AFTER the set was worked out (plan and apply work it out
  // once) are refused by name and place, not only by an exact path in the set.
  const set = require('./setup-assistant').boardCredentialPaths();
  const later = path.join(SB, '.claude-later');
  fs.mkdirSync(later, { recursive: true });
  fs.writeFileSync(path.join(later, 'settings.json'), '{}');
  assert.ok(!set.files.includes(path.join(later, 'settings.json')), 'CONTROL: the new home is not in the set built before it');
  assert.equal(undo.credentialVerdict(path.join(later, 'settings.json'), null, set), 'protected', 'an account home made later was not caught by name and place');
  const regDir = path.join(SB, 'worldsbase');
  fs.mkdirSync(regDir, { recursive: true });
  const fakeSet = { files: [], dirs: [], home: SB, regDir, regBase: 'worlds.json' };
  assert.equal(undo.credentialVerdict(path.join(regDir, '.worlds.json.lock'), null, fakeSet), 'protected', 'a registry lock name was not caught');
  assert.equal(undo.credentialVerdict(path.join(regDir, 'notes.json'), null, fakeSet), null, 'CONTROL: another file beside the registry');
  assert.equal(undo.keep(path.join(store.ROOT, 'board.token.gone'), { cwd: me }).because, 'credential', 'a not-yet-existing token name was recorded');
  assert.equal(storeHolds(SECRET), false, 'the undo store holds the token bytes');
  assert.equal(storeHolds(secretHash), false, 'the undo store names the token blob');

  // CONTROL: an ordinary file in the agent's own folder is still kept, so the refusals above are not "keep is off".
  const plain = path.join(me, 'plain.txt');
  fs.writeFileSync(plain, 'ordinary words');
  assert.deepEqual(undo.keep(plain, { cwd: me }), { kept: true });
  assert.equal(storeHolds('ordinary words'), true, 'CONTROL: the ordinary copy did not reach the store');
});

/* A record in the undo store naming a credential (written there by something other than keep, which refuses it) is
   never restored or moved: plan flags it and apply refuses it again at the write. Its target is named board.token, so
   the name check refuses it first; the place and identity checks are pinned by the other tests in this file. */
const taskchat = require('./taskchat');
const T = (hhmm) => `2026-10-01T${hhmm}:00.000Z`;
const ms = (hhmm) => Date.parse(T(hhmm));
test('#4491: a forged undo record naming board.token is never restored, moved or copied', () => {
  undo.setOn(true, ms('08:00'));
  const me = worker('ud-forge');
  const own = path.join(me, 'mine.txt');
  fs.writeFileSync(own, 'before'); const t9 = new Date(ms('09:00')); fs.utimesSync(own, t9, t9);
  const file = taskchat.taskChatFile('pf', 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [{ at: T('10:00'), kind: 'created', who: 'ud-forge' }, { at: T('11:00'), kind: 'closed' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.deepEqual(undo.keep(own, { cwd: me, session: 's', now: ms('10:10') }), { kept: true });
  fs.writeFileSync(own, 'after'); const t10 = new Date(ms('10:11')); fs.utimesSync(own, t10, t10);
  const token = path.join(store.ROOT, 'board.token');
  fs.writeFileSync(token, SECRET);
  const t8 = new Date(ms('08:30')); fs.utimesSync(token, t8, t8);
  const index = path.join(store.ROOT, 'undo', 'index.jsonl');
  const forged = fs.readFileSync(index, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.path === own)
    .map((r) => JSON.stringify({ ...r, id: r.id + 'f', path: token, dirReal: fs.realpathSync(store.ROOT) }));
  fs.appendFileSync(index, forged.join('\n') + '\n');
  const plan = undo.plan('pf', { number: 1, closedAt: T('11:00') });
  const row = plan.files.find((x) => x.path === token);
  assert.ok(row, 'CONTROL: the forged record is in the plan, so the check below is reached: ' + JSON.stringify(plan.files));
  assert.deepEqual([row.ok, row.why], [false, 'protected']);
  const r = undo.apply('pf', { number: 1, closedAt: T('11:00') }, [token, own], { now: ms('12:00') });
  assert.ok(!r.done.includes(token), 'board.token was restored');
  assert.equal(fs.readFileSync(token, 'utf8'), SECRET, 'board.token was changed');
  assert.ok(r.done.includes(own), 'CONTROL: the agent\'s own file was undone in the same call');
  const saved = path.join(store.ROOT, 'undo-saved');
  const savedHolds = (d) => { try { return fs.readdirSync(d, { recursive: true }).some((n) => { try { return fs.readFileSync(path.join(d, n), 'utf8').includes(SECRET); } catch { return false; } }); } catch { return false; } };
  assert.equal(savedHolds(saved), false, 'a copy of board.token was saved aside');
});

test('#4491 review 3: a guarded folder reached by a link of another name is refused; a repo .claude, a FIFO and a linked parent behave as before', (t) => {
  undo.setOn(true);
  const me = worker('ud-paths');
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['ud-paths'] }));   // a token-only agent
  // Review 4: an ORDINARY agent's .claude (skills, plans, hooks) is its own work and keeps its undo copy.
  const plainAgent = worker('ud-plain');
  fs.mkdirSync(path.join(plainAgent, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(plainAgent, '.claude', 'skills', 'x.md'), 'a skill');
  assert.deepEqual(undo.keep(path.join(plainAgent, '.claude', 'skills', 'x.md'), { cwd: plainAgent }), { kept: true }, 'an ordinary agent lost the undo copy of its own .claude file');
  const own = path.join(me, '.claude');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'settings.json'), '{}');
  fs.symlinkSync(own, path.join(me, 'l'));
  assert.equal(undo.keep(path.join(me, 'l', 'settings.json'), { cwd: me }).because, 'credential', 'the guard settings were kept through a link named l');
  fs.writeFileSync(path.join(own, 'hook.sh'), 'echo');
  assert.equal(undo.keep(path.join(own, 'hook.sh'), { cwd: me }).because, 'credential', 'another file in the agent .claude (write-denied by the guard) was kept');
  // A code repo's own .claude settings, edited by an agent: an ordinary file, still kept.
  const repo = path.join(SB, 'somerepo', '.claude');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'settings.json'), '{"repo":true}');
  assert.deepEqual(undo.keep(path.join(repo, 'settings.json'), { cwd: me }), { kept: true }, 'a repo .claude/settings.json lost its undo copy');
  // A link as the final name is still refused as a link.
  fs.writeFileSync(path.join(me, 'real.txt'), 'real');
  fs.symlinkSync(path.join(me, 'real.txt'), path.join(me, 'alias.txt'));
  assert.equal(undo.keep(path.join(me, 'alias.txt'), { cwd: me }).because, 'link');
  // An ordinary file reached through a linked parent folder is still kept (the old code allowed it).
  const realDir = path.join(SB, 'elsewhere');
  fs.mkdirSync(realDir, { recursive: true });
  fs.writeFileSync(path.join(realDir, 'doc.txt'), 'doc');
  fs.symlinkSync(realDir, path.join(me, 'linked'));
  assert.deepEqual(undo.keep(path.join(me, 'linked', 'doc.txt'), { cwd: me }), { kept: true }, 'a file under a linked folder lost its undo copy');
  // A FIFO is refused as not a file, without hanging on the open.
  if (process.platform === 'win32') { t.diagnostic('no FIFOs on Windows'); return; }
  const fifo = path.join(me, 'pipe');
  const mk = require('node:child_process').spawnSync('mkfifo', [fifo]);
  assert.equal(mk.status, 0, 'mkfifo failed, so the FIFO arm would prove nothing');
  assert.equal(undo.keep(fifo, { cwd: me }).because, 'not-a-file');
});

test('#4491 review 4: when the protected set cannot be worked out, keep and plan say they could not check (never "protected")', () => {
  undo.setOn(true);
  const me = worker('ud-garble');
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), '{not json');
  const f = path.join(me, 'any.txt');
  fs.writeFileSync(f, 'x');
  assert.equal(undo.keep(f, { cwd: me }).because, 'cannot-check', 'an unreadable token-only list read as something else');
  assert.equal(undo.credentialVerdict(f, null), 'unknown');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
  assert.deepEqual(undo.keep(f, { cwd: me }), { kept: true }, 'CONTROL: with a readable list the same file is kept');
});

test('#4491 review 5: when the set cannot be worked out, plan flags cannot-check and apply leaves the file alone', () => {
  undo.setOn(true, ms('08:00'));
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
  const me = worker('ud-plancheck');
  const f = path.join(me, 'work.txt');
  fs.writeFileSync(f, 'before'); const t9 = new Date(ms('09:00')); fs.utimesSync(f, t9, t9);
  const file = taskchat.taskChatFile('pc', 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [{ at: T('10:00'), kind: 'created', who: 'ud-plancheck' }, { at: T('11:00'), kind: 'closed' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.deepEqual(undo.keep(f, { cwd: me, session: 's', now: ms('10:10') }), { kept: true });
  fs.writeFileSync(f, 'after'); const t10 = new Date(ms('10:11')); fs.utimesSync(f, t10, t10);
  const ok = undo.plan('pc', { number: 1, closedAt: T('11:00') });
  const okRow = ok.files.find((x) => x.path === f) || {};
  // 'incomplete' (undo was switched on after the agent began, by an earlier test) is choosable: the person can still undo it.
  assert.ok(okRow.ok === true || okRow.why === 'incomplete', 'CONTROL: with a readable list the file can be undone: ' + JSON.stringify(okRow));
  fs.writeFileSync(sendertoken.tokenOnlyFile(), '{not json');   // the set can no longer be worked out
  const row = undo.plan('pc', { number: 1, closedAt: T('11:00') }).files.find((x) => x.path === f);
  assert.deepEqual([row.ok, row.why], [false, 'cannot-check']);
  const r = undo.apply('pc', { number: 1, closedAt: T('11:00') }, [f], { now: ms('12:00') });
  assert.ok(!r.done.includes(f), 'a file was undone while Kosmos could not check it');
  assert.equal(fs.readFileSync(f, 'utf8'), 'after');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
});

test('#4491 review 6: a folder swapped for a link into a token-only agent .claude at the write is refused, and nothing lands there', () => {
  undo.setOn(true, ms('08:00'));
  const me = worker('ud-swap');
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['ud-swap'] }));
  const guard = path.join(me, '.claude');
  fs.mkdirSync(guard, { recursive: true });
  fs.writeFileSync(path.join(guard, 'settings.json'), '{"guard":true}');
  const sub = path.join(me, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'settings.json');   // the same name as the guard file
  fs.writeFileSync(f, '{"sandbox":false}'); const t9 = new Date(ms('09:00')); fs.utimesSync(f, t9, t9);
  const file = taskchat.taskChatFile('sw', 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [{ at: T('10:00'), kind: 'created', who: 'ud-swap' }, { at: T('11:00'), kind: 'closed' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.deepEqual(undo.keep(f, { cwd: me, session: 's', now: ms('10:10') }), { kept: true });
  fs.writeFileSync(f, '{"edited":1}'); const t10 = new Date(ms('10:11')); fs.utimesSync(f, t10, t10);
  const row = undo.plan('sw', { number: 1, closedAt: T('11:00') }).files.find((x) => x.path === f) || {};
  assert.ok(row.ok === true || row.why === 'incomplete', 'CONTROL: before the swap the file can be undone: ' + JSON.stringify(row));
  // At the write: sub becomes a link to the agent's own .claude.
  undo._setBeforeWriteForTests(() => { fs.renameSync(sub, sub + '.was'); fs.symlinkSync(guard, sub); });
  let r;
  try { r = undo.apply('sw', { number: 1, closedAt: T('11:00') }, [f], { now: ms('12:00') }); } finally { undo._setBeforeWriteForTests(null); }
  assert.ok(!r.done.includes(f), 'the restore went through the link');
  assert.deepEqual(r.skipped.find((x) => x.path === f), { path: f, why: 'protected' }, 'the refusal does not say why');
  assert.equal(fs.readFileSync(path.join(guard, 'settings.json'), 'utf8'), '{"guard":true}', 'the guard settings were rewritten');
  assert.deepEqual(fs.readdirSync(guard).filter((n) => n.startsWith('.kosmos-undo-')), [], 'restored bytes were written into the guarded folder');
  // CONTROL: the same swap to an ordinary folder is refused as moved (not protected, not done).
  fs.unlinkSync(sub); fs.renameSync(sub + '.was', sub);
  const elsewhere = path.join(me, 'elsewhere'); fs.mkdirSync(elsewhere, { recursive: true });
  undo._setBeforeWriteForTests(() => { fs.renameSync(sub, sub + '.was2'); fs.symlinkSync(elsewhere, sub); });
  try { r = undo.apply('sw', { number: 1, closedAt: T('11:00') }, [f], { now: ms('12:01') }); } finally { undo._setBeforeWriteForTests(null); }
  assert.deepEqual(r.skipped.find((x) => x.path === f), { path: f, why: 'moved' });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
});

test('#4491 review 7: the check right before the rename is pinned on its own, and move-aside is checked too', () => {
  undo.setOn(true, ms('08:00'));
  const me = worker('ud-late');
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['ud-late'] }));
  const guard = path.join(me, '.claude');
  fs.mkdirSync(guard, { recursive: true });
  fs.writeFileSync(path.join(guard, 'settings.json'), '{"guard":true}');
  const sub = path.join(me, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  const f = path.join(sub, 'settings.json');
  fs.writeFileSync(f, '{"sandbox":false}'); const t9 = new Date(ms('09:00')); fs.utimesSync(f, t9, t9);
  const made = path.join(sub, 'made.txt');   // created by the agent in the task: undo moves it aside
  const file = taskchat.taskChatFile('lt', 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [{ at: T('10:00'), kind: 'created', who: 'ud-late' }, { at: T('11:00'), kind: 'closed' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.deepEqual(undo.keep(f, { cwd: me, session: 's', now: ms('10:10') }), { kept: true });
  assert.deepEqual(undo.keep(made, { cwd: me, session: 's', now: ms('10:12') }), { kept: true });
  fs.writeFileSync(f, '{"edited":1}'); const t10 = new Date(ms('10:11')); fs.utimesSync(f, t10, t10);
  fs.writeFileSync(made, 'agent made this'); const t13 = new Date(ms('10:13')); fs.utimesSync(made, t13, t13);
  // Restore: the swap happens AFTER the first check, with the restored bytes already in a temp beside the file.
  undo._setBeforeWriteForTests((p, stage) => { if (stage === 'rename' && p === f) { fs.renameSync(sub, sub + '.was'); fs.symlinkSync(guard, sub); } });
  let r;
  try { r = undo.apply('lt', { number: 1, closedAt: T('11:00') }, [f], { now: ms('12:00') }); } finally { undo._setBeforeWriteForTests(null); }
  assert.deepEqual(r.skipped.find((x) => x.path === f), { path: f, why: 'protected' }, 'the late check did not refuse');
  assert.equal(fs.readFileSync(path.join(guard, 'settings.json'), 'utf8'), '{"guard":true}', 'the guard settings were rewritten');
  assert.deepEqual(fs.readdirSync(guard).filter((n) => n.startsWith('.kosmos-undo-')), [], 'restored bytes landed in the guarded folder');
  // Named residual: a folder RENAMED under the temp takes the temp with it, so it stays in the agent's own (renamed)
  // folder holding the agent's own earlier content (never a credential, never in the guarded folder).
  const left = fs.readdirSync(sub + '.was').filter((n) => n.startsWith('.kosmos-undo-'));
  assert.ok(left.length <= 1 && left.every((n) => fs.readFileSync(path.join(sub + '.was', n), 'utf8') === '{"sandbox":false}'),
    'something other than the agent\'s own kept content was left behind: ' + JSON.stringify(left));
  fs.unlinkSync(sub); fs.renameSync(sub + '.was', sub);
  // Move-aside: a created file whose folder is swapped for the guard folder at the start is refused, nothing moved.
  fs.writeFileSync(path.join(guard, 'made.txt'), 'the guard folder file');
  undo._setBeforeWriteForTests((p, stage) => { if (stage === 'move' && p === made) { fs.renameSync(sub, sub + '.was'); fs.symlinkSync(guard, sub); } });   // review 19: at the move itself
  try { r = undo.apply('lt', { number: 1, closedAt: T('11:00') }, [made], { now: ms('12:05') }); } finally { undo._setBeforeWriteForTests(null); }
  assert.deepEqual(r.skipped.find((x) => x.path === made), { path: made, why: 'protected' }, 'move-aside went through the link');
  assert.equal(fs.readFileSync(path.join(guard, 'made.txt'), 'utf8'), 'the guard folder file', 'a file in the guarded folder was moved');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
});

test('#4491 review 8: a record naming a file in undo\'s own stores is protected, so a restore can never move or replace them', () => {
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
  const set = require('./setup-assistant').boardCredentialPaths();
  const index = path.join(store.ROOT, 'undo', 'index.jsonl');
  const saved = path.join(store.ROOT, 'undo-saved', '2026-x', 'abc-notes.md');
  assert.equal(undo.credentialVerdict(index, null, set), 'protected', 'the undo index is not protected');
  assert.equal(undo.credentialVerdict(path.join(store.ROOT, 'undo', 'blobs', 'deadbeef'), null, set), 'protected', 'a blob is not protected');
  assert.equal(undo.credentialVerdict(saved, null, set), 'protected', 'a saved-aside file is not protected');
  assert.equal(undo.credentialVerdict(path.join(store.ROOT, 'undo-elsewhere.txt'), null, set), null, 'CONTROL: a file merely named like the store');
});

test('#4491 review 13: the cached protected set sees a token-only list change at once, and a failure is never cached', () => {
  undo.setOn(true);
  const me = worker('ud-cache');   // resets the cache once, here only
  fs.mkdirSync(path.dirname(sendertoken.tokenOnlyFile()), { recursive: true });
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
  const plain = path.join(me, 'plain.txt');
  fs.writeFileSync(plain, 'x');
  assert.deepEqual(undo.keep(plain, { cwd: me }), { kept: true }, 'CONTROL: a set is now cached');
  const own = path.join(me, '.claude');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'notes.md'), 'n');
  assert.deepEqual(undo.keep(path.join(own, 'notes.md'), { cwd: me }), { kept: true }, 'CONTROL: not token-only yet, its .claude is ordinary');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['ud-cache'] }));   // listed, no reset
  assert.equal(undo.keep(path.join(own, 'notes.md'), { cwd: me }).because, 'credential', 'the cache hid a list change');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), '{broken');   // no reset
  assert.equal(undo.keep(plain, { cwd: me }).because, 'cannot-check', 'a broken list read from the cache as fine');
  assert.equal(undo.keep(plain, { cwd: me }).because, 'cannot-check', 'a failure was cached as a set');
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: [] }));
  assert.deepEqual(undo.keep(plain, { cwd: me }), { kept: true }, 'repaired list is seen at once');
});
