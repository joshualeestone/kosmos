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
  // An account home made later (not yet in the list): its settings file is refused by name and place.
  const later = path.join(SB, '.claude-later');
  fs.mkdirSync(later, { recursive: true });
  fs.writeFileSync(path.join(later, 'settings.json'), '{}');
  assert.equal(undo.keep(path.join(later, 'settings.json'), { cwd: me }).because, 'credential', 'an account home settings file was kept');
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
   never restored or moved: plan flags it and apply refuses it again at the write. */
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
