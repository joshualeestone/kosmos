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

/* A top-level one-line `const NAME = ...;` from the page, verbatim. */
function constLine(name) {
  const m = RAW.match(new RegExp('^const ' + name + ' = [^;\\n]*;', 'm'));
  assert.ok(m, name + ' vanished from web/index.html');
  return m[0];
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
  const doc = { activeElement: null, getElementById: (id) => (els[id] = els[id] || { id, className: '', innerHTML: '', textContent: '', hidden: false, dataset: {},
    contains(x) { return x === this || (!!x && x.parent === this); }, focus() { doc.activeElement = this; } }) };
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'DM_SPOKE_AT', 'LAST_AT', [
    'const esc = (s) => String(s);',
    'const stateCopyOf = (a) => ({ label: a.state });',
    'const cardStOf = (a) => ({ st: a.state });',
    'const glyphOf = () => "";',
    'const taskLine = () => "";',
    pageFnSource('workingSampleIsStale'),
    // #5959 slice 2: paintDetailState paints the health line, so its pieces come along.
    RAW.match(/^const HEALTH_QUIET_MS = [^\n]*/m)[0],
    RAW.match(/^const HEALTH_READ_STATES = [^\n]*/m)[0],
    pageFnSource('seenAtWords'),
    pageFnSource('healthLine'),
    RAW.match(/^const SAID_STATES = [^\n]*/m)[0],   // #6716: which states show their screen line
    pageFnSource('paintDetailState'),
    'return paintDetailState;',
  ].join('\n'))(doc, new Map(spokeLearnedAt === null ? [] : [[card.sessionName, { at: 1, learnedAt: spokeLearnedAt }]]), lastAt);
  run(card);
  pillFor.els = els;
  pillFor.doc = doc;
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

test('#3958 / #6716: a working sample\'s screen line is never shown, stale or fresh; a waiting state\'s is', () => {
  /* A working card that DOES carry evidence: Claude Code's live retry line (engine/status.js #3410). */
  const board = fleet.install([fleet.agent('beatrix', { state: 'working',
    screen: 'Reading the lease\n✻ Connection refused (ECONNREFUSED) · Retrying in 5s · attempt 4/10\n' })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    assert.ok(card && card.state === 'working' && /Retrying in 5s/.test(String(card.stateEvidence || '')),
      'the fixture did not produce a working card with evidence: ' + JSON.stringify(card && [card.state, card.stateEvidence]));
    const saidOf = () => pillFor.els['d-said'].innerHTML + pillFor.els['d-said'].textContent;
    /* #6716 (Josh, 2026-10-20): a working agent's screen line is never shown, fresh or stale: it is the CLI's own
       chrome. The control is the same card's line in a waiting state, which IS shown, folded, so the arms below can
       red. (Spread from the real card: only the state differs.) */
    pillFor({ ...card, state: 'needs_you' }, null, 1000);
    assert.match(saidOf(), /Retrying in 5s/, 'control: a waiting state shows its screen line (else the arms prove nothing)');
    assert.equal(pillFor.els['d-said-box'].hidden, false, 'control: the fold around it is shown');
    pillFor(card, null, 1000);
    assert.doesNotMatch(saidOf(), /Retrying in 5s/, 'a working agent showed its raw screen line (#6716)');
    assert.equal(pillFor.els['d-said-box'].hidden, true, 'a working agent showed the screen-line fold (#6716)');
    /* The stale sample still paints Idle (#3958). Its line is now hidden twice over (idle is not in SAID_STATES either),
       so the assertion after it cannot fail on its own; kept as the #3958 record, not as the guard. The guard is the
       working arm above. */
    assert.match(pillFor(card, 2000, 1000), /\bst-idle\b/);
    assert.doesNotMatch(saidOf(), /Retrying in 5s/,
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

test('#6716: the screen-line fold starts closed each time it appears, and a poll leaves an opened one open', () => {
  const screen = 'Reading the lease\n✻ Connection refused (ECONNREFUSED) · Retrying in 5s · attempt 4/10\n';
  const board = fleet.install([fleet.agent('beatrix', { state: 'working', screen }), fleet.agent('cora', { state: 'working', screen })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    const waiting = { ...card, state: 'needs_you' };
    pillFor(waiting, null, 1000);
    const box = pillFor.els['d-said-box'];
    assert.equal(box.hidden, false, 'control: the fold shows for a waiting agent');
    assert.equal(box.open, false, 'the fold did not start closed');
    box.open = true;   // the person opens it
    pillFor.repaint(waiting);
    assert.equal(box.open, true, 'a poll for the same agent closed the fold the person opened');
    pillFor.repaint({ ...waiting, stateEvidence: '' });   // still waiting, its screen text empty for one poll
    assert.equal(box.hidden, true, 'control: an empty line hides the fold');
    pillFor.repaint(waiting);
    assert.equal(box.open, true, 'one poll with no screen text closed the fold during the same wait (review 11)');
    pillFor.repaint({ ...waiting, state: 'auth_failed' });   // a different wait, with different words
    assert.equal(box.open, false, 'a move to another waiting state kept the fold open over its new words (review 12)');
    box.open = true;
    pillFor.repaint({ ...waiting, state: 'auth_failed' });
    assert.equal(box.open, true, 'control: the same waiting state on the next poll leaves it open');
    pillFor.repaint(card);   // back to working: hidden
    assert.equal(box.hidden, true);
    pillFor.repaint(waiting);   // waiting on something again
    assert.equal(box.open, false, 'the fold came back already open for a new wait');
    box.open = true;
    pillFor.repaint({ ...board.agents.find((x) => x.name === 'cora'), state: 'needs_you' });   // another agent, from the fleet
    assert.equal(box.open, false, 'another agent\'s quote opened already expanded');
  } finally {
    fleet.restore();
  }
});

test('#6716: opening a page closes the fold, even for the agent whose quote was open', () => {
  /* openDetail runs on every real open and never on the poll; it must reset the fold so the next paint counts as an
     appearance. Read from the real function's source, then replayed against the real paint. */
  const src = pageFnSource('openDetail');
  const reset = src.match(/const saidFold = document\.getElementById\('d-said-box'\);\n\s*if \(saidFold\) \{[^\n]*\}/);
  assert.ok(reset, 'openDetail no longer resets the screen-line fold (#6716 review 6)');
  assert.match(reset[0], /delete saidFold\.dataset\.for;[^\n]*delete saidFold\.dataset\.waiting;/, 'openDetail clears only one of the fold\'s two keys (review 13)');
  const board = fleet.install([fleet.agent('beatrix', { state: 'working', screen: 'Reading the lease\n✻ Connection refused (ECONNREFUSED) · Retrying in 5s · attempt 4/10\n' })]);
  try {
    const waiting = { ...board.agents.find((x) => x.name === 'beatrix'), state: 'needs_you' };
    pillFor(waiting, null, 1000);
    const box = pillFor.els['d-said-box'];
    box.open = true;
    pillFor.repaint(waiting);
    assert.equal(box.open, true, 'control: without an open, the poll leaves it open');
    // eslint-disable-next-line no-new-func
    new Function('document', reset[0])(pillFor.doc);   // the person goes back to the grid and reopens Beatrix
    pillFor.repaint(waiting);
    assert.equal(box.open, false, 'reopening the same waiting agent showed the fold already open');
  } finally {
    fleet.restore();
  }
});

test('#6716: when the fold hides under the keyboard, focus moves to the state line, not the top of the page', () => {
  const board = fleet.install([fleet.agent('beatrix', { state: 'working', screen: 'Reading the lease\n✻ Connection refused (ECONNREFUSED) · Retrying in 5s · attempt 4/10\n' })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    const waiting = { ...card, state: 'needs_you' };
    pillFor(waiting, null, 1000);
    const box = pillFor.els['d-said-box'];
    const summary = { parent: box };
    pillFor.doc.activeElement = { parent: null };   // CONTROL: focus elsewhere is left alone
    pillFor.repaint(card);
    assert.notEqual(pillFor.doc.activeElement && pillFor.doc.activeElement.id, 'd-state', 'focus was moved though it was not in the fold');
    pillFor.repaint(waiting);
    pillFor.doc.activeElement = summary;   // the keyboard is on the summary
    pillFor.repaint(card);   // back to working: the fold hides
    assert.equal(box.hidden, true);
    assert.equal(pillFor.doc.activeElement && pillFor.doc.activeElement.id, 'd-state', 'focus was left on the hidden fold');
    assert.equal(pillFor.els['d-state'].tabIndex, -1, 'the state line became a Tab stop');
  } finally {
    fleet.restore();
  }
});

test('#3958: the poll does not rewrite an unchanged pill, task or said label (a selection survives)', () => {
  /* #6716 review 14: a WAITING agent, since only a waiting state shows the quote now; a working one paints the label and
     quote empty on both polls, so this test could not fail for them. */
  const board = fleet.install([fleet.agent('beatrix', { state: 'auth_failed' })]);
  try {
    const card = board.agents.find((x) => x.name === 'beatrix');
    pillFor(card, null, 1000);
    const els = pillFor.els;
    assert.ok(els['d-said-lab'].textContent && els['d-said'].textContent, 'control: the label and the quote are painted, so their rewrites are watched');
    /* Count writes from here on, on the same elements, across a second identical paint. */
    const counted = {};
    for (const id of ['d-state', 'd-task', 'd-said', 'd-said-lab']) {
      const el = els[id];
      assert.ok(el, id + ' was never painted, so this test would not watch it');
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

test('#3958: the per-poll Start re-derive leaves a Start of this open alone, in flight or done', () => {
  const board = fleet.install([fleet.agent('beatrix', { state: 'working' })]);
  try {
    const running = board.agents.find((x) => x.name === 'beatrix');
    const make = (flight, receipt, epoch) => {
      const els = {
        'd-start-wrap': { hidden: false },
        'd-start-agent': { hidden: true, disabled: true, textContent: 'Starting…' },
        'd-start-msg': { textContent: 'Started Beatrix. Say hello to wake them.' },
      };
      // eslint-disable-next-line no-new-func
      const fn = new Function('document', 'START_FLIGHT', 'START_RECEIPT', 'START_EPOCH', [
        'let START_RECEIPT_SAW_RUNNING = false;',
        'let START_RECEIPT_STOPPED_POLLS = 0;',
        constLine('START_RECEIPT_STALE_POLLS'),
        constSource('CARD_ST'),
        pageFnSource('cardStOf'),
        pageFnSource('refreshStartAffordance'),
        'return refreshStartAffordance;',
      ].join('\n'))({ getElementById: (id) => els[id] || null }, flight, receipt, epoch);
      return { fn, els };
    };
    /* The agent came up (working): with no Start of this open, the wrap hides. */
    const plain = make(null, null, 3);
    plain.fn(running);
    assert.equal(plain.els['d-start-wrap'].hidden, true, 'control: a running agent hides the Start area');
    /* In flight for this open: the "Starting..." line stays. */
    const flying = make(3, null, 3);
    flying.fn(running);
    assert.equal(flying.els['d-start-wrap'].hidden, false, 'the poll hid the Start area mid-start, taking "Starting..." with it');
    /* Done for this open: the receipt stays, and the button is not offered again. */
    const done = make(null, 3, 3);
    done.fn(running);
    assert.equal(done.els['d-start-wrap'].hidden, false, 'the poll hid the "Started" receipt');
    assert.equal(done.els['d-start-agent'].hidden, true, 'the button came back under the receipt');
    /* A receipt holds through a stale "stopped" poll right after the start (the board catching
       up), but once the agent has been seen running, a stopped poll is a real stop: the receipt
       clears and Start is offered again. */
    const board2 = fleet.install([fleet.agent('beatrix', { state: 'stopped' })]);
    const stopped = board2.agents.find((x) => x.name === 'beatrix');
    const again = make(null, 3, 3);
    again.fn(stopped);
    assert.equal(again.els['d-start-agent'].hidden, true, 'a stale stopped poll right after the start re-offered the button');
    again.fn(running);
    again.fn(stopped);
    assert.equal(again.els['d-start-wrap'].hidden, false, 'the agent stopped again and the Start area stayed hidden');
    assert.equal(again.els['d-start-agent'].hidden, false, 'the agent stopped again and Start was not offered');
    assert.equal(again.els['d-start-msg'].textContent, '', 'the stale "Started" receipt stayed after the agent stopped again');
    /* It exited right after a confirmed start, and the board never showed it running: one stopped
       poll is lag, the second is a real stop, and Start comes back (it used to stay hidden). */
    const quick = make(null, 3, 3);
    quick.fn(stopped);
    assert.equal(quick.els['d-start-agent'].hidden, true, 'control: one stopped poll after a confirmed start is lag');
    quick.fn(stopped);
    assert.equal(quick.els['d-start-agent'].hidden, false, 'an agent that exited right after starting stranded Start behind the receipt');
    /* An old line of a failed Start (no receipt) must not come back after the agent has run. */
    const failed = make(null, null, 3);
    failed.els['d-start-msg'].textContent = 'We asked Beatrix to start, but it has not come back yet.';
    failed.fn(running);
    failed.fn(stopped);
    assert.equal(failed.els['d-start-wrap'].hidden, false, 'control: stopped again, the Start area is back');
    assert.equal(failed.els['d-start-msg'].textContent, '', 'the old "has not come back" line returned after the agent had run');
    /* A receipt from an EARLIER open does not stick. */
    const old = make(null, 2, 3);
    old.fn(running);
    assert.equal(old.els['d-start-wrap'].hidden, true, 'a receipt from an earlier open held the Start area');
  } finally {
    fleet.restore();
  }
});
