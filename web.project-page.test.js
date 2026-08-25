"use strict";
/**
 * #761, first items on the project page: member titles as the catalogue
 * writes them, no stale "bring it up to date" line, "Show all", and the
 * minus asks before it removes, in both views.
 *
 *   node --test web.project-page.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
// A fixture board still types into real agents (a standing lesson this
// codebase's memory carries): DATA, PROJECTS, WORKERS, LAUNCH and
// TMUX_BIN sandboxed together, or fleet.install refuses on purpose
// rather than write into the operator's real fleet. ⚠️ SET BEFORE
// REQUIRING fleet OR ANY ENGINE MODULE: engine/store.js reads
// AGENT_WORKFORCE_DATA into a top-level const at first require, and
// fleet.js requires engine/status.js, which pulls store in transitively
// -- an env var set after that first require is too late.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-pjp-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-pjp-workers-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-pjp-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-pjp-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
const fleet = require('./test-support/fleet');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

test('a member row derives its title the way the cards do, so a catalogue role reads as the catalogue writes it', () => {
  assert.match(SCRIPT, /'<small class="pj-member-role">' \+ esc\(roleLine\(\{ role: m\.role \}, ROLE_TITLES\)\) \+ '<\/small>'/);
  const at = SCRIPT.indexOf('function roleLine('); const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  // eslint-disable-next-line no-new-func
  const roleLine = new Function(fn + '\nreturn roleLine;')();
  const titles = new Map([['copywriter', 'Copywriter'], ['account manager', 'Account Manager']]);
  assert.equal(roleLine({ role: 'copywriter' }, titles), 'Copywriter');
  assert.equal(roleLine({ role: 'account manager' }, titles), 'Account Manager');
  // A role the catalogue has never seen gets only its first letter raised (the standing rule; it cannot invent capitals for words it has never seen).
  assert.equal(roleLine({ role: 'iOS engineer' }, titles), 'IOS engineer');
  assert.equal(roleLine({ role: 'copywriter' }, null), 'Copywriter', 'with no catalogue yet, the first letter still rises');
});

test('the files door says Show all, and the stale arm draws nothing', () => {
  assert.match(SCRIPT, /all\.textContent = more > 0 \? 'Show all ' \+ body\.total : 'Show all';/);
  assert.doesNotMatch(SCRIPT, /Has not picked this up yet/);
  assert.doesNotMatch(SCRIPT, /pj-notyet-go/);
});

test('the minus asks first, names the agent and the project, lands on the harmless answer, and only its Remove calls the drop; it is in both views', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /<div class="rm-back" id="mem-modal" hidden>\s*<div class="rm-box" role="alertdialog" aria-modal="true" aria-labelledby="mem-title" aria-describedby="mem-small">/);
  // #762 factored the modal setup into openMemModal, shared by the tab
  // view's minus AND the settings rows' -- the listener itself is now a
  // one-line call, so the pins on "asks before it acts" moved onto the
  // shared function.
  const at = SCRIPT.indexOf("getElementById('pj-one-agents').addEventListener('click'"); const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});\n', at) + 5);
  assert.match(handler, /openMemModal\(btn, document\.getElementById\('pj-one-msg'\)\)/);
  assert.doesNotMatch(handler, /dropMember\(/, 'the minus removes without asking');
  const openAt = SCRIPT.indexOf('function openMemModal(btn, msg)'); const openFn = SCRIPT.slice(openAt, SCRIPT.indexOf('\n}\n', openAt) + 3);
  assert.match(openFn, /'Remove ' \+ who \+ ' from ' \+ pjName \+ '\?'/);
  assert.match(openFn, /getElementById\('mem-keep'\)\.focus\(\);/, 'Enter on the fresh dialog does not land on the harmless answer');
  assert.doesNotMatch(openFn, /dropMember\(/, 'the minus removes without asking');
  assert.match(SCRIPT, /getElementById\('mem-go'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,300}dropMember\(p\.btn, p\.msg \|\| document\.getElementById\('pj-one-msg'\)\)/);
  assert.match(SCRIPT, /getElementById\('mem-keep'\)\.addEventListener\('click', memConfirmClose\);/);
  assert.match(PAGE, /\n\.pj-minus \{ display: grid;[^}]*opacity: 0; \}\n\.pj-member:hover \.pj-minus, \.pj-minus:focus-visible \{ opacity: 1; \}/);
  assert.match(PAGE, /\n#pj-remove-member \{ display: none; \}/);
});

/* #761's engine half (project-engine-761, PR #809): task/part assignment
   now answers `heard: { who, state, because }` beside `told`. The page
   half says the fact -- "I created three new tasks and assigned them but
   I don't know that the agent was notified." */
test('heardSentence: the three delivery states get three sentences, and no assignee says nothing', () => {
  const at = SCRIPT.indexOf('function heardSentence(heard)');
  const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  assert.ok(at > -1, 'heardSentence moved; re-anchor');
  const pjSentenceAt = SCRIPT.indexOf('function pjSentence(because)');
  const pjSentenceFn = SCRIPT.slice(pjSentenceAt, SCRIPT.indexOf('\n}\n', pjSentenceAt) + 3);
  // eslint-disable-next-line no-new-func
  const heardSentence = new Function(pjSentenceFn + '\n' + fn + '\nreturn heardSentence;')();
  assert.equal(heardSentence(undefined), '', 'no heard object (close/reopen, or no assignee) says something');
  assert.equal(heardSentence({ who: 'April' }), '', 'a heard with no state says something');
  assert.equal(heardSentence({ who: 'April', state: 'placed', because: null }),
    'Told April.');
  assert.equal(heardSentence({ who: 'April', state: 'could_not', because: 'we could not get to its window, so we did not type anything' }),
    'Could not tell April: We could not get to its window, so we did not type anything.');
  // ⚠️ NOT "could not tell": an unconfirmed send may have landed, and
  // saying it did not is the over-claim chat.js's own comments warn
  // against for exactly this state.
  const unconfirmed = heardSentence({ who: 'April', state: 'unconfirmed', because: 'it went into its window and we could not press Enter, so it may be sitting in its composer unsent' });
  assert.match(unconfirmed, /^Could not confirm April saw it: /);
  assert.doesNotMatch(unconfirmed, /Could not tell/);
});

test('the heard sentence is wired to both surfaces that can produce one, after the repaint that would otherwise wipe it', () => {
  // New Task (the project page): set after leaveNewTask() and pjReload(),
  // neither of which touches pj-one-msg.
  const ntAt = SCRIPT.indexOf("getElementById('nt-go').addEventListener('click'");
  const ntFn = SCRIPT.slice(ntAt, SCRIPT.indexOf('\n});\n', ntAt) + 5);
  assert.ok(ntAt > -1, "nt-go's handler moved; re-anchor");
  assert.match(ntFn, /await pjReload\(\);[\s\S]{0,600}if \(heard\) document\.getElementById\('pj-one-msg'\)\.textContent = heard;/,
    'New Task no longer surfaces the heard verdict after its own reload');
  // Add a part / reassign a part (the task page): tkPartPost is the one
  // function both routes share.
  const tpAt = SCRIPT.indexOf('async function tkPartPost(url, body)');
  const tpFn = SCRIPT.slice(tpAt, SCRIPT.indexOf('\n}\n', tpAt) + 3);
  assert.ok(tpAt > -1, 'tkPartPost moved; re-anchor');
  assert.match(tpFn, /await pjReload\(\);[\s\S]{0,600}msg\.textContent = heardSentence\(spokenHeard\(pjById\(PJ_CURRENT\), out && out\.heard\)\);/,
    'tkPartPost no longer surfaces the heard verdict after its own reload');
});

/* Independent review caught this: heard.who off the wire is the raw
   sessionName (heardBy, server.js), not what any other member-facing
   sentence on this page shows. Without spokenHeard, "Told april-writer."
   would ship instead of "Told April." */
test('heardSentence speaks the display name, never the raw session name', () => {
  const nameAt = SCRIPT.indexOf('function pjNameOf(p, sessionName)');
  const nameFn = SCRIPT.slice(nameAt, SCRIPT.indexOf('\n}\n', nameAt) + 3);
  assert.ok(nameAt > -1, 'pjNameOf moved; re-anchor');
  const spokenAt = SCRIPT.indexOf('function spokenHeard(p, heard)');
  const spokenFn = SCRIPT.slice(spokenAt, SCRIPT.indexOf('\n}\n', spokenAt) + 3);
  assert.ok(spokenAt > -1, 'spokenHeard moved; re-anchor');
  const heardAt = SCRIPT.indexOf('function heardSentence(heard)');
  const heardFn = SCRIPT.slice(heardAt, SCRIPT.indexOf('\n}\n', heardAt) + 3);
  const pjSentenceAt = SCRIPT.indexOf('function pjSentence(because)');
  const pjSentenceFn = SCRIPT.slice(pjSentenceAt, SCRIPT.indexOf('\n}\n', pjSentenceAt) + 3);
  // eslint-disable-next-line no-new-func
  const { heardSentence, spokenHeard } = new Function(
    pjSentenceFn + '\n' + heardFn + '\n' + nameFn + '\n' + spokenFn
    + '\nreturn { heardSentence, spokenHeard };')();
  // A real card and a real project record, not a hand-built stand-in
  // (fixture discipline, this file's own established pattern): the
  // session key and the display name are deliberately different, which
  // is the whole thing under test.
  const projectsEngine = require('./engine/projects');
  const board = fleet.install([fleet.agent('april', { displayName: 'April' })]);
  const pdir = nodePath.join(SANDBOX, 'heard-sentence-proj');
  let p;
  try {
    fs.mkdirSync(pdir, { recursive: true });
    projectsEngine.create({ name: 'Heard Sentence', folder: pdir, agents: ['april'], roster: board.agents });
    p = projectsEngine.list(board.agents).find((x) => x.name === 'Heard Sentence');
  } finally {
    board.restore();
  }
  const sessionKey = p.agents[0].sessionName;
  assert.equal(p.agents[0].name, 'April', 'PRE-CONTROL: the fixture did not carry a display name distinct from the session key');
  assert.notEqual(sessionKey, 'April', 'PRE-CONTROL: the session key already equals the display name, so this test cannot tell them apart');
  const heard = { who: sessionKey, state: 'placed', because: null };
  assert.equal(heardSentence(spokenHeard(p, heard)), 'Told April.',
    'the raw session name reached the screen');
  // No project (a stale reload race): the raw name is what there is left
  // to say, better than nothing rather than silently dropped.
  assert.equal(heardSentence(spokenHeard(null, heard)), 'Told ' + sessionKey + '.');
  // An agent no longer on the project's roster: same fallback.
  assert.equal(heardSentence(spokenHeard({ agents: [] }, heard)), 'Told ' + sessionKey + '.');
});

/* #761: "I have to hard refresh the page to get files in this project to
   refresh." The files card painted once, on opening a project, and never
   again; pjLoadDocs now skips its own repaint when the folder's stamp has
   not moved, so a 5s poll can call it without blanking the list every
   tick, and tick() itself now does. */
test('the files card is on the main poll now, gated on the project view being on screen', () => {
  const at = SCRIPT.indexOf('async function tick()');
  assert.ok(at > -1, 'tick() moved; re-anchor');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  const tickFn = SCRIPT.slice(at, end);
  assert.match(tickFn, /if \(PJ_CURRENT && !document\.getElementById\('pj-one-view'\)\.hidden\) pjLoadDocs\(PJ_CURRENT\);/,
    'the status tick no longer keeps the files card fresh while the project view is on screen');
});

test('pjLoadDocs repaints only when the stamp actually moved, and a could-not-read state always repaints', async () => {
  const at = SCRIPT.indexOf('async function pjLoadDocs(id)');
  assert.ok(at > -1, 'pjLoadDocs moved; re-anchor');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  const fn = SCRIPT.slice(at, end);
  let stampDecl = SCRIPT.slice(0, at);
  stampDecl = stampDecl.slice(stampDecl.lastIndexOf('let PJ_DOCS_STAMP'));
  const els = {
    'pj-docs': { textContent: '', appendCount: 0, append(...c) { this.appendCount += c.length; }, children: [] },
    'pj-docs-msg': { textContent: '' },
    'pj-docs-all': { hidden: true, textContent: '' },
  };
  let currentBody = null;
  const fetchImpl = () => Promise.resolve({ json: () => Promise.resolve(currentBody) });
  const pjLoadDocs = new Function('document', 'fetch', 'fileIcon', 'pjSize', 'esc',
    stampDecl + '\n' + fn + '\nreturn pjLoadDocs;')(
    { getElementById: (id) => els[id], createElement: () => ({ append() {}, insertAdjacentHTML() {}, dataset: {} }) },
    fetchImpl, () => '', () => '', (s) => s);
  global.PJ_CURRENT = 'p1';
  currentBody = { ok: true, total: 1, files: [{ name: 'a.txt', size: 10 }], stamp: 'aaaa' };
  await pjLoadDocs('p1');
  const firstPaintCount = els['pj-docs'].appendCount;
  assert.ok(firstPaintCount > 0, 'the first read with a project open did not paint');
  // Same stamp: must not repaint (box.textContent = '' never runs, so
  // appendCount stays exactly what the first paint left).
  await pjLoadDocs('p1');
  assert.equal(els['pj-docs'].appendCount, firstPaintCount, 'a poll with an unmoved stamp repainted anyway');
  // A NEW stamp: must repaint.
  currentBody = { ok: true, total: 1, files: [{ name: 'a.txt', size: 10 }, { name: 'b.txt', size: 20 }], stamp: 'bbbb' };
  await pjLoadDocs('p1');
  assert.ok(els['pj-docs'].appendCount > firstPaintCount, 'a poll with a moved stamp did not repaint');
  // A could-not-read state carries no stamp; it must always repaint even
  // with nothing changing between two identical failed reads.
  currentBody = { ok: false, because: 'we cannot read that folder right now' };
  await pjLoadDocs('p1');
  assert.match(els['pj-docs-msg'].textContent, /we cannot read that folder right now/);
  els['pj-docs-msg'].textContent = '';
  await pjLoadDocs('p1');
  assert.match(els['pj-docs-msg'].textContent, /we cannot read that folder right now/,
    'a second identical could-not-read was skipped as though it were a repeat stamp');
  // Independent review caught this: a SUCCESS landing right after a
  // failure, with the SAME stamp as the success from before the failure,
  // must still repaint -- the screen is showing the error, not the files,
  // and the stamp alone cannot tell the difference.
  currentBody = { ok: true, total: 1, files: [{ name: 'a.txt', size: 10 }, { name: 'b.txt', size: 20 }], stamp: 'bbbb' };
  await pjLoadDocs('p1');
  assert.equal(els['pj-docs-msg'].textContent, '',
    'the stale error message survived a successful read with an old stamp');
  assert.ok(els['pj-docs'].appendCount > firstPaintCount,
    'recovery from a could-not-read state did not repaint the file list, because its stamp matched the LAST success (from before the failure)');
  delete global.PJ_CURRENT;
});

/* Independent review caught this too: pjLoadDocs now has two callers
   (openProject's own call on switch, and tick's 5s poll), so a slow fetch
   dispatched first can settle after a faster one dispatched second -- the
   PJ_CURRENT check alone only catches a response arriving after a PROJECT
   switch, not two in-flight reads of the SAME project resolving out of
   order. Same PLUS_EPOCH (#743) pattern, applied here. */
test('pjLoadDocs epoch guard: an older in-flight read cannot overwrite a newer one that already landed', async () => {
  const at = SCRIPT.indexOf('async function pjLoadDocs(id)');
  assert.ok(at > -1, 'pjLoadDocs moved; re-anchor');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', at); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  const fn = SCRIPT.slice(at, end);
  let stampDecl = SCRIPT.slice(0, at);
  stampDecl = stampDecl.slice(stampDecl.lastIndexOf('let PJ_DOCS_STAMP'));
  assert.match(stampDecl, /let PJ_DOCS_EPOCH = 0;/,
    'PJ_DOCS_EPOCH moved out of the sliced declaration block; re-anchor the test');
  const els = {
    'pj-docs': { textContent: '', appendCount: 0, append(...c) { this.appendCount += c.length; }, children: [] },
    'pj-docs-msg': { textContent: '' },
    'pj-docs-all': { hidden: true, textContent: '' },
  };
  const pending = [];
  const fetchImpl = () => new Promise((resolve) => { pending.push(resolve); });
  const pjLoadDocs = new Function('document', 'fetch', 'fileIcon', 'pjSize', 'esc',
    stampDecl + '\n' + fn + '\nreturn pjLoadDocs;')(
    { getElementById: (id) => els[id], createElement: () => ({ append() {}, insertAdjacentHTML() {}, dataset: {} }) },
    fetchImpl, () => '', () => '', (s) => s);
  global.PJ_CURRENT = 'p1';
  // Call A dispatched first (older, e.g. openProject's own call), call B
  // dispatched second (newer, e.g. the next tick) -- both for the SAME
  // project, neither awaited yet.
  const a = pjLoadDocs('p1');
  const b = pjLoadDocs('p1');
  assert.equal(pending.length, 2, 'both calls did not reach fetch');
  // B, the newer call, resolves FIRST -- plausible under real network
  // jitter -- and paints.
  pending[1]({ json: () => Promise.resolve({ ok: true, total: 1, files: [{ name: 'newer.txt', size: 1 }], stamp: 'newer' }) });
  await b;
  const afterB = els['pj-docs'].appendCount;
  assert.ok(afterB > 0, 'the newer call did not paint');
  // A, the older call, resolves LAST, with data from before whatever
  // changed between the two dispatches -- it must be discarded, not
  // overwrite the fresher paint already on screen.
  pending[0]({ json: () => Promise.resolve({ ok: true, total: 1, files: [{ name: 'older.txt', size: 1 }], stamp: 'older' }) });
  await a;
  assert.equal(els['pj-docs'].appendCount, afterB,
    'a stale, later-resolving read overwrote the fresher read already on screen');
  delete global.PJ_CURRENT;
});
