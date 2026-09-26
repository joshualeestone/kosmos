'use strict';

/**
 * #3958: once the agent page's pill follows the poll, the "when last seen" marker beside it must
 * read the LATEST card too. It used to read CURRENT (the card from when the page opened), which
 * agreed with a pill frozen at that moment; with a live pill it would past-mark a restart that
 * began after the page opened ("Restarting agent · when last seen", the inversion #2019 forbids).
 *
 * A SOURCE pin, and said so: the behavioural path needs a restarting agent whose presence reads
 * off, which no fixture here produces. The pill's own behaviour is measured in a browser by
 * docs/browser-checks/render-agent-pill-3958.js.
 *
 *   node --test web.pill-remembered-3958.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
/* Sandboxed before fleet is required, as the sibling web tests do: the cards below come from a real
   snapshot of a fixture board, never typed by hand (fixture-discipline.test.js). */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pill-3958-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const fleet = require('./test-support/fleet');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('#3958: the remembered marker reads the latest card from LAST, not CURRENT alone', () => {
  const calls = RAW.match(/markStateRemembered\(!\([^;]*\);/g) || [];
  assert.equal(calls.length, 1, 'expected the one restarting-aware call site; found ' + calls.length);
  assert.match(calls[0], /latest && latest\.state === 'restarting'/);
  assert.match(RAW, /const latest = CURRENT && \(\(typeof LAST !== 'undefined' && Array\.isArray\(LAST\) && LAST\.find\(\(x\) => x\.sessionName === CURRENT\.sessionName\)\) \|\| CURRENT\);/);
  assert.doesNotMatch(RAW, /markStateRemembered\(!\(CURRENT && CURRENT\.state === 'restarting'\)\)/, 'the frozen read is the bug');
});

test('#3958: the poll paints the pill off the same fresh card as the DM line', () => {
  assert.match(RAW, /paintBusy\(fresh, CURRENT\.name\);\n\s*\/\* #3958: the pill follows the poll too/);
  assert.match(RAW, /if \(fresh\) paintDetailState\(fresh\);/);
});

/* The page's function source by name, brace-matched (the same slicer the sibling web tests use). */
function pageFnSource(name) {
  const start = RAW.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from web/index.html');
  let depth = 0;
  for (let k = RAW.indexOf('{', start); k < RAW.length; k += 1) {
    if (RAW[k] === '{') depth += 1;
    else if (RAW[k] === '}') { depth -= 1; if (depth === 0) return RAW.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* A top-level `const NAME = {...};` from the page, brace-matched: the real table, not a copy. */
function constSource(name) {
  const start = RAW.indexOf('const ' + name + ' = {');
  assert.ok(start > -1, name + ' vanished from web/index.html');
  let depth = 0;
  for (let k = RAW.indexOf('{', start); k < RAW.length; k += 1) {
    if (RAW[k] === '{') depth += 1;
    else if (RAW[k] === '}') { depth -= 1; if (depth === 0) return RAW.slice(start, RAW.indexOf(';', k) + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* The REAL paintDetailState and workingSampleIsStale, with the label/glyph derivations stubbed to
   echo the state they were handed, so the test reads which state the pill was painted from. */
function pillFor(card, spokeLearnedAt, lastAt) {
  const els = {};
  const doc = { getElementById: (id) => (els[id] = els[id] || { className: '', innerHTML: '', textContent: '', hidden: false, dataset: {} }) };
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'DM_SPOKE_AT', 'LAST_AT', [
    'const esc = (s) => String(s);',
    'const stateCopyOf = (a) => ({ label: a.state });',
    'const cardStOf = (a) => ({ st: a.state });',
    'const glyphOf = () => "";',
    'const taskLine = () => "";',
    pageFnSource('workingSampleIsStale'),
    pageFnSource('paintDetailState'),
    'return paintDetailState;',
  ].join('\n'))(doc, new Map(spokeLearnedAt === null ? [] : [[card.sessionName, { at: 1, learnedAt: spokeLearnedAt }]]), lastAt);
  run(card);
  pillFor.els = els;
  pillFor.repaint = run;
  return els['d-state'].className;
}

test('#3958: a working sample older than the reply on screen paints the pill idle, as the DM line hides', () => {
  const cardIn = (state) => {
    const board = fleet.install([fleet.agent('beatrix', { state })]);
    const card = board.agents.find((x) => x.name === 'beatrix');
    assert.ok(card && card.state === state, 'the fixture did not produce a ' + state + ' card');
    return card;
  };
  try {
    const working = cardIn('working');
    assert.match(pillFor(working, 2000, 1000), /\bst-idle\b/, 'the reply was learned after the sample: stale');
    assert.match(pillFor(working, 500, 1000), /\bst-working\b/, 'control: the sample is newer than the reply, so it stands');
    assert.match(pillFor(working, null, 1000), /\bst-working\b/, 'control: no reply known, the sample stands');
    assert.match(pillFor(cardIn('needs_you'), 2000, 1000), /\bst-needs_you\b/, 'only a WORKING sample is ever downgraded');
  } finally {
    fleet.restore();
  }
});

test('#3958: a stale working sample is dropped whole: its evidence line does not stay beside the Idle pill', () => {
  /* A working card that DOES carry evidence: Claude Code's live retry line (engine/status.js #3410). */
  const board = fleet.install([fleet.agent('beatrix', { state: 'working',
    screen: 'Reading the lease\n✻ Connection refused (ECONNREFUSED) · Retrying in 5s · attempt 4/10\n' })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    assert.ok(card && card.state === 'working' && /Retrying in 5s/.test(String(card.stateEvidence || '')),
      'the fixture did not produce a working card with evidence: ' + JSON.stringify(card && [card.state, card.stateEvidence]));
    pillFor(card, null, 1000);
    assert.match(pillFor.els['d-said'].innerHTML + pillFor.els['d-said'].textContent, /Retrying in 5s/,
      'control: a sample that stands shows its evidence (else the arm below proves nothing)');
    assert.match(pillFor(card, 2000, 1000), /\bst-idle\b/);
    assert.doesNotMatch(pillFor.els['d-said'].innerHTML + pillFor.els['d-said'].textContent, /Retrying in 5s/,
      'the Idle pill kept the working sample\'s evidence line beside it');
  } finally {
    fleet.restore();
  }
});

test('#3991: a swarm member\'s face carries the same ring and dot as any other member', () => {
  const src = pageFnSource('pjMember');
  assert.match(src, /const swFace = swRow \? '<span class="lav pj-face pj-swface' \+ dotCls \+ '"[^;]*\+ memRing \+ warn \+ reachMark/,
    'the swarm face is drawn without the ring or the dot (a SOURCE pin: no fixture here turns swarms on)');
  assert.match(src, /const dotCls = present \? memberDotClass\(dotRow\) : '';/, 'the dot must come from the shared helper');
  assert.match(src, /const dotRow = boardCard \? Object\.assign\(\{\}, boardCard, \{ state: liveM\.state \}\) : liveM;/, 'the dot state must follow the member projection (the tie gate)');
});

test('#3991: the dot\'s trust exception reads needsTrust (the board poll\'s own field), as lrow does', () => {
  // eslint-disable-next-line no-new-func
  const memberDotClass = new Function([
    'const boardMods = () => "";',
    constSource('CARD_ST'),
    pageFnSource('cardStOf'),
    pageFnSource('memberDotClass'),
    'return memberDotClass;',
  ].join('\n'))();
  const board = fleet.install([fleet.agent('beatrix', { state: 'idle' })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    /* The server adds `running` and `needsTrust` on /api/status; the member row's state comes from
       the projects poll, so the two can disagree for one poll. The dot follows the board's field. */
    const onBoard = (extra) => Object.assign({}, card, extra);
    assert.equal(memberDotClass(onBoard({ running: false, needsTrust: true, state: 'idle' })), ' pjd pjd-unk',
      'the board says trust-stuck while the member poll still says idle: the unsure dot, not offline or green');
    assert.equal(memberDotClass(onBoard({ running: false, needsTrust: true, state: 'needs_trust' })), ' pjd pjd-unk',
      'a trust-stuck member drew the green all-clear beside its red needs-you triangle');
    assert.equal(memberDotClass(onBoard({ running: true, state: 'unknown' })), ' pjd pjd-unk', 'an unsure presence is the unsure dot');
    assert.equal(memberDotClass(onBoard({ running: true, state: 'needs_you' })), ' pjd', 'control: needs-you is present, green');
    assert.equal(memberDotClass(onBoard({ running: false, needsTrust: false, state: 'needs_trust' })), ' pjd pjd-off',
      'the board has cleared trust (and says not running): the stale member state must not keep it');
    assert.equal(memberDotClass(onBoard({ running: false })), ' pjd pjd-off', 'control: not running, no trust, offline');
  } finally {
    fleet.restore();
  }
});

test('#3958: the poll does not rewrite an unchanged pill, task or said label (a selection survives)', () => {
  const board = fleet.install([fleet.agent('beatrix', { state: 'working' })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    pillFor(card, null, 1000);
    const els = pillFor.els;
    /* Count writes from here on, on the same elements, across a second identical paint. */
    const counted = {};
    for (const id of ['d-state', 'd-task', 'd-said-lab']) {
      const el = els[id];
      if (!el) continue;
      for (const k of ['innerHTML', 'textContent']) {
        let v = el[k];
        Object.defineProperty(el, k, { get: () => v, set: (x) => { counted[id + '.' + k] = (counted[id + '.' + k] || 0) + 1; v = x; } });
      }
    }
    pillFor.repaint(card);
    assert.deepEqual(counted, {}, 'an identical poll rewrote: ' + JSON.stringify(counted));
  } finally {
    fleet.restore();
  }
});
