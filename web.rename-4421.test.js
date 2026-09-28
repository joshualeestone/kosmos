'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4421 (Josh, 2026-09-28): after renaming an agent, its page heading said "Demis Hassabis - Gemini" while the
 * "Direct Message to" title, every message label and the "is working" line said "Gemini-Sub". Those read
 * CURRENT.name, the card as it was when the agent was opened, and nothing refreshed it: a restart does not reopen
 * the agent. The fix copies the fresh card's name onto CURRENT on every poll (followRename), before anything paints.
 *
 * These run the REAL page functions (lifted from web/index.html): the poll's followRename, the message label
 * (dmWho) and the working line (busyRow). The title is 'Direct Message to ' + the name the poll passes, pinned by
 * source order below. The browser check docs/browser-checks/render-rename-4421.js drives the real poll in a page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const page = require('./test-support/page');
/* Real cards (fixture discipline: no hand-built card), so a sandbox for the fleet fixture's worker files first. */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-rename-4421-web-')));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
const fleet = require('./test-support/fleet');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);

const OLD = 'gemini-sub';          // the session name, which the old surfaces kept showing
const NEW = 'Demis Hassabis - Gemini';

/* The agent as the board served it when opened (named by its id: nothing names it yet) and as the next poll serves
   it after the rename (its own instructions file now names it). In this order: the second writes the name file. */
function cardOf(key, opts) {
  const board = fleet.install([fleet.agent(key, { state: 'working', ...opts })]);
  try { return board.agents.find((c) => c.sessionName === key); } finally { board.restore(); }
}
const OPENED = cardOf(OLD, {});
const POLLED = cardOf(OLD, { displayName: NEW });
const APRIL = cardOf('april', { displayName: 'April Ludgate' });
const SOMEONE = cardOf('someone-else', { displayName: 'Someone Else' });

function world({ boxValue = OLD, focused = false, photo = false } = {}) {
  const state = { focused };
  const heading = { textContent: OLD };
  const els = {
    'd-name': heading,
    'd-instr-lede': { textContent: '' },
    'd-memory': { innerHTML: '' },
    'd-initials': { textContent: 'G', hidden: photo, style: { background: 'old', color: 'old' }, parentElement: { style: { background: 'old' } } },
    'd-rename': { value: boxValue, dataset: { shown: OLD } },
  };
  const nav = [];
  const doc = { getElementById: (id) => els[id] || null, get activeElement() { return state.focused ? els['d-rename'] : null; } };
  const src = 'let CURRENT = null;\nlet LAST = [];\n'
    + page.liftConst(SCRIPT, 'WORKING_VERB') + '\n'
    // The avatar tints: one line each (DISC_INKS is aligned with two spaces, which liftConst does not match).
    + ['DISC_TINTS', 'DISC_INKS'].map((c) => (SCRIPT.match(new RegExp('^const ' + c + '\\s+=.*$', 'm')) || [''])[0]).join('\n') + '\n'
    + page.liftAll(SCRIPT, ['esc', 'initials', 'discIndex', 'discTint', 'discInk', 'busyRow', 'dmWho', 'followRename', 'paintInstrLede', 'tskAgentName']) + '\n'
    + 'return { set: (c) => { CURRENT = c; }, get: () => CURRENT, setLast: (l) => { LAST = l; }, followRename, dmWho, busyRow, initials, discTint, discInk };';
  // eslint-disable-next-line no-new-func
  /* memoryBox and paintDetailMeta are the page's own; stubbed to show which card each was handed (the browser check
     runs the real ones). */
  const metas = [];
  const avatars = [];
  const mems = [];
  const w = new Function('document', 'detailNavNames', 'fitDetailName', 'memoryBox', 'paintDetailMeta', 'renderAvatar', src)(
    doc, (n) => nav.push(n), () => {}, (a) => { mems.push(a); return 'memory of ' + (a && a.name); }, (a) => metas.push(a),
    (a) => avatars.push(a && a.name));
  return { ...w, heading, nav, els, metas, avatars, mems, state };
}

const opened = () => ({ ...OPENED });   // a copy: followRename writes CURRENT.name
const polled = () => ({ ...POLLED });

test('#4421 fixture: the real cards are the agent before and after the rename', () => {
  assert.equal(OPENED.name, OLD);
  assert.equal(POLLED.name, NEW);
  assert.equal(POLLED.sessionName, OPENED.sessionName);
});

test('#4421 fixture: before the poll, the page shows the name it was opened with (the bug\'s starting point)', () => {
  const w = world();
  w.set(opened());
  assert.equal(w.dmWho(OLD, w.get().name), OLD);
});

test('#4421: after a rename, the poll moves every surface to the new name, and the id is never shown', () => {
  const w = world();
  w.set(opened());
  const fresh = polled();
  w.followRename(fresh);
  const name = w.get().name;   // what the poll then passes to paintTalk and paintBusy
  assert.equal(name, NEW, 'CURRENT kept the old name, so every surface that reads it did too');
  assert.equal(w.dmWho(OLD, name), NEW, 'the label on the agent\'s own messages');
  const busy = w.busyRow(fresh, name);
  assert.match(busy, new RegExp(NEW + ' is working'), 'the "is working" line: ' + busy);
  assert.doesNotMatch(busy, new RegExp(OLD), 'the "is working" line still names the id: ' + busy);
  assert.equal(w.heading.textContent, NEW, 'the heading follows a rename made anywhere else too');
  assert.deepEqual(w.nav, [NEW]);
  const disc = w.els['d-initials'];
  assert.equal(disc.textContent, w.initials(NEW), 'the picture\'s letter');
  assert.equal(disc.style.background, w.discTint(NEW), 'the picture\'s tint is the old name\'s');
  assert.equal(disc.style.color, w.discInk(NEW));
  assert.equal(disc.parentElement.style.background, w.discTint(NEW));
  assert.deepEqual(w.avatars, [], 'renderAvatar re-fetches a photo and redraws a swarm cluster; the rename does not need it');
  assert.match(w.els['d-instr-lede'].textContent, /^What Demis Hassabis - Gemini is for/, 'the Instructions lede');
  assert.equal(w.els['d-memory'].innerHTML, 'memory of ' + NEW, 'the memory box names the new name');
  assert.equal(w.mems[0], w.get(), 'the memory box was drawn from the fresh card, not CURRENT (whose reading the ring and badge show)');
  assert.equal(w.metas.length, 1);
  assert.equal(w.metas[0], fresh, 'the title line (and its "no name was chosen" note) was not repainted from the renamed card');
  assert.equal(w.els['d-rename'].value, NEW, 'the rename box, which Save sends as the name');
});

test('#4421: a DM row from someone other than the open agent is named by their card, not their id', () => {
  const w = world();
  w.set(opened());
  w.setLast([APRIL]);
  assert.equal(w.dmWho('april', OLD), 'April Ludgate');
  w.setLast([]);
  assert.equal(w.dmWho('april', OLD), 'april', 'with no card, the id is all there is');
});

test('#4421: the rename box follows only while untouched, so Save cannot rename the agent back, and typing is kept', () => {
  const idle = world();
  idle.set(opened());
  idle.followRename(polled());
  assert.equal(idle.els['d-rename'].value, NEW, 'an untouched box kept the old name, and the next Save would restore it');
  assert.equal(idle.els['d-rename'].dataset.shown, NEW, 'the box forgot what it now shows, so Save would read it as edited');
  const typed = world({ boxValue: 'Somebody New' });
  typed.set(opened());
  typed.followRename(polled());
  assert.equal(typed.els['d-rename'].value, 'Somebody New', 'a name somebody typed was overwritten');
  const focused = world({ focused: true });
  focused.set(opened());
  focused.followRename(polled());
  assert.equal(focused.els['d-rename'].value, OLD, 'the box was changed under somebody\'s cursor');
  focused.state.focused = false;
  focused.followRename(polled());   // a later poll, the name already followed
  assert.equal(focused.els['d-rename'].value, NEW, 'a box that had focus on the renaming poll never caught up once left');
});

test('#4421: a room or task label for an agent that has left the project uses its current card, not its id', () => {
  const src = 'let LAST = null;\n' + page.liftAll(SCRIPT, ['tskAgentName', 'pjNameOf', 'tkMemberName'])
    + '\nreturn { setLast: (l) => { LAST = l; }, pjNameOf, tkMemberName };';
  // eslint-disable-next-line no-new-func
  const f = new Function(src)();
  const project = { agents: [] };   // it left
  f.setLast([POLLED]);
  assert.equal(f.pjNameOf(project, OLD), NEW, 'a room post from a former member showed its id');
  assert.equal(f.tkMemberName(project, OLD), NEW, 'a task row for a former member showed its id');
  f.setLast([]);
  assert.equal(f.pjNameOf(project, OLD), OLD, 'with no card anywhere, the id is all there is');
  assert.equal(f.pjNameOf({ agents: [{ ...OPENED, name: 'Member Name' }] }, OLD), 'Member Name', 'a member keeps its project name');
});

test('#4421: an agent with a photo keeps its photo: the hidden letter disc is not restyled', () => {
  const w = world({ photo: true });
  w.set(opened());
  w.followRename(polled());
  assert.equal(w.els['d-initials'].style.background, 'old');
  assert.equal(w.get().name, NEW, 'the name still followed');
});

test('#4421: no card this poll, another agent\'s card, or a card with no name keeps the last name rather than guessing', () => {
  const w = world();
  w.set(opened());
  w.followRename(null);
  w.followRename(SOMEONE);
  w.followRename({ ...POLLED, name: '' });
  assert.equal(w.get().name, OLD);
  assert.equal(w.heading.textContent, OLD);
  assert.deepEqual(w.nav, [], 'the heading was repainted for nothing');
});

test('#4421: the poll follows the rename BEFORE it paints the title, the labels and the working line', () => {
  const at = (needle) => {
    const i = SCRIPT.indexOf(needle);
    assert.ok(i > 0, 'moved: ' + needle);
    return i;
  };
  const tick = page.lift(SCRIPT, 'tick');
  const m = tick.match(/^\s*followRename\(fresh\);/m);   // a live call inside the poll, not a commented-out one
  assert.ok(m, 'the poll no longer calls followRename');
  const follow = SCRIPT.indexOf(tick) + m.index;
  assert.ok(follow < at('paintTalk(CURRENT.sessionName, CURRENT.name);'), 'the title and labels are painted before the name follows');
  assert.ok(follow < at('paintBusy(fresh, CURRENT.name);'), 'the working line is painted before the name follows');
  assert.match(SCRIPT, /textContent = 'Direct Message to ' \+ name;/, 'the title no longer comes from the name the poll passes');
});

test('#4421: a room row\'s picture takes its letter and tint from the name it shows, not the id', () => {
  /* Pinned in source: the browser check drives the DM row's picture; the room row's is the same rule. */
  const row = page.lift(SCRIPT, 'pjRoomRow');
  assert.match(row, /discTint\(name\) \+ ';color:' \+ discInk\(name\) \+ '">' \+ esc\(initials\(name\)\)/,
    'the room row\'s picture is no longer drawn from the name its label shows');
  assert.doesNotMatch(row, /discTint\(m\.from\)/, 'the room row\'s picture is drawn from the id again');
  const dm = page.lift(SCRIPT, 'dmRow');
  assert.doesNotMatch(dm, /discTint\(m\.from\)/, 'the DM row\'s picture is drawn from the id again');
});
