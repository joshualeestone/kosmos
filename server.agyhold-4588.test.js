'use strict';
/* #4588 PR B, the server half:
 *  - givePart in its assigner mode refuses (409, held) an agent held on its machine's shared Google quota BEFORE
 *    tasks.assignPart, measured on the real function against real projects and tasks;
 *  - source pins on server.js: every automatic timer's deliver closure calls chat.deliverAutomatic, the agy resume
 *    sweep stays on chat.deliver, the auto-retell passes { automatic: true }, and the recommender passes heldUntil.
 *    The pins read the CODE with comments stripped, so a comment naming a function cannot satisfy one.
 *
 *   node --test server.agyhold-4588.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agyhold-'));
process.env.HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
// agyquota remembers the latest pool reset it has seen (the release tail); each test starts with none.
test.beforeEach(() => { require('./engine/agyquota').POOL_MEMO.bySession.clear(); require('./engine/agyquota').POOL_MEMO.seen.clear(); });
const assert = require('node:assert/strict');

const store = require('./engine/store');
const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const chat = require('./engine/chat');
const { givePart } = require('./server');

require('./test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [store.ROOT]);
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

/* ---- givePart: a held agent is refused before the part is assigned ---- */

let seq = 0;
function setup(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const p = projects.create({ name: 'Agy Hold Give ' + (++seq) });
  projects.addAgent(p.id, name, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the release notes', made: { via: 'screen' } });
  const n = t.task ? t.task.number : t.number;
  const partOf = () => tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n))[0];
  return { board, pid: p.id, n, partOf };
}
/* The roster the Assigner hands givePart. Hand-built rows in the card's shape, WITHOUT isNamedOurs, so even a
   delivery that got past the gate would be refused before any keystroke. */
const paused = (sessionName, until) => ({ sessionName, name: sessionName, runner: 'antigravity', state: 'rate_limited', quotaUntil: until, target: 'kt-agyhold-none:9.9' });
const idleAgy = (sessionName) => ({ sessionName, name: sessionName, runner: 'antigravity', state: 'idle', quotaUntil: null, target: 'kt-agyhold-none:9.8' });

function spyAssign(fn) {
  const real = tasks.assignPart;
  const calls = [];
  tasks.assignPart = (...args) => { calls.push(args); return real(...args); };
  try { return fn(calls); } finally { tasks.assignPart = real; }
}

test('#4588 B givePart (assigner): an agy agent held by a paused colleague is refused 409 held, before assignPart', () => {
  const s = setup('giveheld');
  try {
    const until = new Date(Date.now() + 30 * 60e3).toISOString();
    const roster = [paused('agy-colleague', until), idleAgy('giveheld')];
    const before = tasks.processPartWrites().count;
    spyAssign((calls) => {
      const g = givePart(s.pid, s.n, 1, 'giveheld', { assigner: true, roster });
      assert.equal(g.ok, false);
      assert.equal(g.status, 409);
      assert.equal(g.held, true);
      assert.match(g.because, new RegExp(until.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(calls.length, 0, 'tasks.assignPart was called for a held agent');
    });
    assert.equal(s.partOf().who, null, 'the held agent was put on the part');
    assert.equal(tasks.processPartWrites().count, before);
  } finally { s.board.restore(); }
});

test('#4588 B givePart CONTROL: the same give with the pool open (or a person\'s give) reaches assignPart and is not held', () => {
  const s = setup('givefree');
  try {
    const past = new Date(Date.now() - 60e3).toISOString();
    spyAssign((calls) => {
      const g = givePart(s.pid, s.n, 1, 'givefree', { assigner: true, roster: [paused('agy-colleague', past), idleAgy('givefree')] });
      assert.ok(calls.length >= 1, 'CONTROL: an unheld assigner give must reach assignPart');
      assert.equal(calls[0][3], 'givefree', 'CONTROL: the first assignPart puts the agent on the part');
      assert.equal(g.held, undefined, 'CONTROL: an open pool must not mark the give held');
      assert.doesNotMatch(String(g.because), /held until/);
      // The hand-built card is refused at delivery, so the Assigner takes the give back (the #3595 rule).
      assert.equal(g.ok, false);
      assert.equal(g.heard && g.heard.state, chat.DELIVERY.COULD_NOT, 'fixture: the pane line did not fail as arranged');
    });
    assert.equal(s.partOf().who, null, 'fixture: the unreachable give was not taken back');
  } finally { s.board.restore(); }
});

/* ---- source pins on server.js ---- */

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
/* Comments out, strings kept: a small scanner, so a `//` inside a string or template is not taken for a comment
   and a comment naming chat.deliverAutomatic cannot satisfy a pin. */
/* After this text, does a `/` start a regex (an operand is expected) rather than divide? */
function regexCanStart(before) {
  const t = before.replace(/\s+$/, '');
  if (!t) return true;
  if (/(^|[^\w$])(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(t)) return true;
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(t);
}
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; out += ' '; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e === -1 ? src.length : e; continue; }
    /* A regex literal: a `/` where an operand is expected. Without this, a quote inside a regex (server.js has many)
       flips the scanner into a string for the rest of the file and every later comment survives (measured: from
       line 3914 on, before this). Consumed to its closing `/`, through escapes and [...] classes. */
    if (c === '/' && regexCanStart(out)) {
      let j = i + 1; let cls = false;
      while (j < src.length && src[j] !== '\n') {
        const k = src[j];
        if (k === '\\') { j += 2; continue; }
        if (k === '[') cls = true; else if (k === ']') cls = false; else if (k === '/' && !cls) break;
        j += 1;
      }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}
const CODE = stripComments(SRC);

test('pin fixture: the scanner stays in step over ALL of server.js (no pure // comment line survives); CONTROL: a quote in a regex no longer desyncs it', () => {
  const survivors = [];
  for (const [n, line] of SRC.split('\n').entries()) {
    const m = line.match(/^\s*\/\/ (.{24,48})/);
    if (m && CODE.includes(m[1])) survivors.push(n + 1);
  }
  assert.deepEqual(survivors, [], 'the comment stripper lost step; comments survive from line ' + survivors[0]);
  const s = stripComments("const r = /['\"]/g; /* chat.deliverAutomatic( */ x(); // chat.deliverAutomatic(\nchat.deliver(1);");
  assert.equal(s.includes('deliverAutomatic'), false, 'a regex holding quotes flipped the scanner into a string');
  assert.ok(s.includes("/['\"]/g") && s.includes('chat.deliver(1)'));
});

test('pin fixture: stripComments removes a comment mention and keeps a call and a string', () => {
  const s = stripComments("a(); /* chat.deliverAutomatic( */ b(); // chat.deliverAutomatic(\nconst u = 'http://x'; chat.deliver(1);");
  assert.equal(s.includes('deliverAutomatic'), false);
  assert.ok(s.includes("'http://x'"));
  assert.ok(s.includes('chat.deliver(1)'));
  // And server.js's own comments really do name deliverAutomatic, so stripping them is load-bearing.
  const comments = SRC.length - CODE.length;
  assert.ok(comments > 0);
  assert.ok((SRC.match(/chat\.deliver\b/g) || []).length > (CODE.match(/chat\.deliver\b/g) || []).length,
    'fixture: no comment in server.js names chat.deliver, so the comment-proofing is untested');
});

/* The call-argument window after a unique anchor: from the anchor to the first `});` that ends the call. */
function windowAfter(anchor) {
  const at = CODE.indexOf(anchor);
  assert.notEqual(at, -1, 'anchor not found in server.js code: ' + anchor);
  assert.equal(CODE.indexOf(anchor, at + 1), -1, 'anchor is not unique in server.js code: ' + anchor);
  const end = CODE.indexOf('});', at);
  assert.notEqual(end, -1);
  return CODE.slice(at, end);
}

const AUTOMATIC = [
  ['autohandoff', 'lastBand: autohandoffBands,', /deliver:\s*\(session, textToSend\)\s*=>\s*\{\s*try\s*\{\s*return chat\.deliverAutomatic\(session, textToSend, roster,/],
  ['firstreply-nudge', 'book: FIRSTREPLY_BOOK,', /deliver:\s*\(session, text, r\)\s*=>\s*chat\.deliverAutomatic\(session, text, r,/],
  ['account-notify', 'accountNotify.sweepOnce({', /deliver:\s*\(session, text\)\s*=>\s*chat\.deliverAutomatic\(session, text, cards,/],
  ['recommender', 'recommender.runOnce({', /deliver:\s*\(session, text\)\s*=>\s*chat\.deliverAutomatic\(session, text, roster,/],
  ['assigner ask', 'give: (projectId, n, partId, who, roster, from) => givePart(projectId, n, partId, who, { assigner: true, roster, from }),', /ask:\s*\(session, text, roster\)\s*=>\s*chat\.deliverAutomatic\(session, text, roster\)/],
  ['agent-nudge', 'book: AGENT_NUDGE_BOOK,', /deliver:\s*\(session, text, r\)\s*=>\s*chat\.deliverAutomatic\(session, text, r,/],
];

for (const [name, anchor, re] of AUTOMATIC) {
  test('#4588 B pin: the ' + name + ' timer delivers through chat.deliverAutomatic, never chat.deliver', () => {
    const w = windowAfter(anchor);
    assert.match(w, re, name + ': its deliver closure does not call chat.deliverAutomatic');
    assert.equal(/chat\.deliver\(/.test(w), false, name + ': a plain chat.deliver( call is still in the closure');
  });
}

test('#4588 B pin: the connlost-heal timer stays on chat.deliver (it counts a try before delivering)', () => {
  const w = windowAfter('book: CONNLOST_BOOK,');
  assert.match(w, /deliver:\s*\(session, text, r\)\s*=>\s*chat\.deliver\(session, text, r,/);
  assert.equal(/deliverAutomatic/.test(w), false, 'a hold would spend connlost-heal\'s counted tries');
});

test('#4588 B pin: the agy-quota-resume sweep stays on chat.deliver (it is the line that ends the hold)', () => {
  const w = windowAfter('book: AGY_QUOTA_BOOK,');
  assert.match(w, /deliver:\s*\(session, text, r\)\s*=>\s*chat\.deliver\(session, text, r,/);
  assert.equal(/deliverAutomatic/.test(w), false, 'the resume sweep would be held by the very pause it resumes from');
  // And the window is really the makeTick call of agyQuota.
  const at = CODE.indexOf('book: AGY_QUOTA_BOOK,');
  assert.match(CODE.slice(Math.max(0, at - 200), at), /agyQuota\.makeTick\(\{\s*[\s\S]*$/);
});

test('#4588 B pin: the recommender passes heldUntil built on agyQuota.heldForQuota over its roster', () => {
  const w = windowAfter('recommender.runOnce({');
  assert.match(w, /heldUntil:\s*\(session\)\s*=>\s*agyQuota\.heldForQuota\(session, roster, Date\.now\(\)\)/);
  // agyQuota is declared in code before the recommender runner that closes over it.
  const decl = CODE.indexOf("const agyQuota = require('./engine/agyquota');");
  assert.notEqual(decl, -1);
  assert.ok(decl < CODE.indexOf('recommender.runOnce({'), 'agyQuota is declared after the recommender uses it');
});

test('#4588 B pin: only the auto-retell timer passes { automatic: true }, and retellMember forwards it', () => {
  const w = windowAfter('retell: (name, id) =>');
  assert.match(w, /retell:\s*\(name, id\)\s*=>\s*retellMember\(name, id, board\(\), \{ automatic: true \}\)/);
  const fnAt = CODE.indexOf('function retellMember(name, id, roster, { automatic = false } = {})');
  assert.notEqual(fnAt, -1, 'retellMember no longer takes { automatic }');
  const body = CODE.slice(fnAt, CODE.indexOf('\nfunction ', fnAt + 1));
  assert.match(body, /projects\.speakOfMembership\(name, proj, 'listed', roster, \{ automatic \}\)/);
  const calls = CODE.match(/retellMember\([^)]*\)[^;\n]*/g) || [];
  const automatic = calls.filter((c) => /automatic:\s*true/.test(c));
  assert.equal(automatic.length, 1, 'expected exactly one automatic retell, got: ' + JSON.stringify(automatic));
  assert.ok(calls.some((c) => /^retellMember\(name, id, roster\)/.test(c)), 'CONTROL: the person\'s Try again route still retells without automatic');
});

test('#4588 B pin: givePart checks heldForQuota inside its assigner branch BEFORE tasks.assignPart', () => {
  const fnAt = CODE.indexOf('function givePart(');
  assert.notEqual(fnAt, -1);
  const body = CODE.slice(fnAt, CODE.indexOf('\nfunction ', fnAt + 1));
  const held = body.search(/heldForQuota\(who, roster \|\| safeRoster\(\), Date\.now\(\)\)/);
  const assign = body.indexOf('tasks.assignPart(');
  assert.notEqual(held, -1, 'givePart no longer checks heldForQuota');
  assert.notEqual(assign, -1);
  assert.ok(held < assign, 'the hold is checked after the part is assigned');
  const branch = body.lastIndexOf('if (assigner) {', held);
  assert.notEqual(branch, -1, 'the hold check is not inside an assigner branch');
  assert.match(body.slice(held, assign), /status:\s*409,\s*held:\s*true/);
});

test('#4588 B pin: the auto-retell\'s ready() holds a running agent on the pool BEFORE anything is written or spent', () => {
  const at = CODE.indexOf('ready: (name) => {');
  assert.notEqual(at, -1, 'the auto-retell ready() was not found');
  assert.equal(CODE.indexOf('ready: (name) => {', at + 1), -1, 'ready() anchor is not unique');
  const body = CODE.slice(at, CODE.indexOf('},', at));
  const held = body.search(/heldForQuota\(card\.sessionName, board\(\), now\)/);
  const stopped = body.indexOf('STATE.STOPPED');
  const told = body.indexOf('projects.toldOverride(');
  assert.ok(held > -1, 'ready() does not ask heldForQuota');
  assert.match(body, /if \(held !== null\) return false;/, 'a held agent is not reported not-ready');
  assert.ok(stopped > -1 && stopped < held, 'a stopped agent must still be ready first (it reads its file at its next start)');
  assert.ok(told > held, 'the hold must come before the staleness read decides readiness');
});

/* #4588 PR B review: the #4624 idle flush types "[Since you last heard from this room, N room posts ...]" into the agent, an
   automatic line, and the minute retry that tells posts held on the quota after the reset is one too. Both go through
   the gated async path; a held verdict is COULD_NOT, which puts the ids back (engine/roomhold-agyhold-4588.test.js). */
for (const [name, anchor] of [['#4624 idle flush', 'roomhold.flushOnIdle(who, {'], ['quota-held room retry', 'roomhold.flushReleased(r, {']]) {
  test('#4588 B pin: the ' + name + ' delivers through chat.deliverAutomaticAsync, never chat.deliverAsync', () => {
    const w = windowAfter(anchor);
    assert.match(w, /deliver:\s*chat\.deliverAutomaticAsync,/, name + ': not on the gated path');
    assert.equal(/chat\.deliverAsync\b/.test(w), false, name + ': a plain chat.deliverAsync is still passed');
  });
}

test('#4588 B pin: the quota-held room retry runs in the minute sweep beside sweepUnanswered, for antigravity cards only', () => {
  const at = CODE.indexOf('roomhold.flushReleased(r, {');
  const sweep = CODE.lastIndexOf('messages.sweepUnanswered(safeRoster())', at);
  assert.ok(sweep > -1 && at - sweep < 400, 'the retry is not in the nudge sweep\'s minute timer');
  assert.match(windowAfter('roomhold.flushReleased(r, {'), /isAgy:\s*\(c\)\s*=>\s*c\.runner === 'antigravity'/);
});
