'use strict';
/**
 * #3923: the project notice (Mona Lisa's design, project-notice-mock.html). One notice above the
 * members list while an agent could not be given the project's folder, shaped by what the person
 * must do: WAIT (Try again only), ACT (a sentence only), RETRY (a sentence and Try again),
 * EXPLAIN (a sentence saying there is nothing to do). Success and not_tried say nothing.
 *
 * The member rows are REAL: the fleet fixture's agents, put on a project by the projects engine
 * and read back through its own `list()`, with the verdicts set in the stored project record
 * (what `syncAgent` writes). Fixture discipline: no hand-built row.
 */
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

// ⚠️ SANDBOX FIRST, BEFORE ANY REQUIRE: the engine and the fixture read their roots at require time.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-notice-3923-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const ENGINE = fs.readFileSync(nodePath.join(__dirname, 'engine', 'projects.js'), 'utf8');

/** The page's own function source, by its declaration. */
function pageFn(sig) {
  const at = PAGE.indexOf(sig);
  assert.ok(at > 0, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}
/** The notice code as the page has it, with the page's own esc and pjSentence. */
function notice() {
  const at = PAGE.indexOf('const PJ_NOTICE = [');
  const end = PAGE.indexOf('/**\n * How a member reads.', at);
  assert.ok(at > 0 && end > at, 'the notice code moved; re-anchor');
  // eslint-disable-next-line no-new-func
  return new Function(pageFn('function esc(') + '\n' + pageFn('function pjSentence(') + '\n'
    + PAGE.slice(at, end) + '\nreturn { pjNotice, PJ_NOTICE, PJ_NOTICE_TRIED };')();
}

let projectCount = 0;
/** Real member rows, one per name, each with the verdict given (a because, or a state). */
function rows(verdicts) {
  const names = Object.keys(verdicts);
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    const dir = nodePath.join(SANDBOX, 'p' + (++projectCount));
    fs.mkdirSync(dir, { recursive: true });
    const made = projects.create({ name: 'Notice ' + projectCount, folder: dir, agents: names, roster: board.agents });
    const all = projects.readAll();
    const p = all.find((x) => x.id === made.id);
    p.told = {};
    for (const [n, v] of Object.entries(verdicts)) {
      p.told[n] = (v === 'told' || v === 'not_tried') ? { state: v, because: null } : { state: 'could_not', because: v };
    }
    projects.writeAll(all);
    return projects.list(board.agents).find((x) => x.id === made.id).agents;
  } finally {
    board.restore();
  }
}
/** The whole real project (as the page's PROJECTS holds it) for the verdicts given. */
function projectWith(verdicts) {
  const agents = rows(verdicts);
  const p = projects.readAll()[projects.readAll().length - 1];
  return { id: p.id, agents };
}
// The words a person reads: the decorative (aria-hidden) hazard mark is not one of them.
const text = (html) => html.replace(/<span class="haz" aria-hidden="true">!<\/span>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('#3923: nothing wrong says nothing (success and not_tried included)', () => {
  const { pjNotice } = notice();
  assert.equal(pjNotice([]), '');
  assert.equal(pjNotice(rows({ leo: 'told', april: 'not_tried' })), '');
});

test('#3923: the four shapes, one agent each, as the design draws them', () => {
  const { pjNotice } = notice();
  const wait = pjNotice(rows({ leo: 'we could not write to its instructions' }));
  assert.equal(text(wait), 'leo does not have this project’s folder. We could not write to leo’s instructions. Try again');
  assert.match(wait, /data-pn-retry="leo"/);

  const act = pjNotice(rows({ april: 'it has no instructions file yet, and we will not create one' }));
  assert.equal(text(act), 'april does not have this project’s folder. april has no instructions file, and Kosmos will not create one. Give april some instructions and Kosmos will pick it up the next time this project changes.');
  assert.doesNotMatch(act, /Try again/, 'Act offers no button: pressing it would fail every time');
  assert.match(act, /<b class="pnfix">Give april/);

  const retry = pjNotice(rows({ mikey: 'we could not find an agent with exactly this name on this computer' }));
  assert.equal(text(retry), 'mikey does not have this project’s folder. Kosmos cannot match mikey to a session on this computer. Start mikey, then try again. Try again');

  const explain = pjNotice(rows({ casey: 'it has no folder of its own on this computer yet' }));
  assert.equal(text(explain), 'casey does not have this project’s folder. Kosmos only keeps instructions for agents it made. casey came from somewhere else, so Kosmos has nowhere to write.');
  assert.doesNotMatch(explain, /Try again|pnfix/, 'Explain prescribes nothing');

  // A file the reader refuses is Explain too: pressing again reads the same file the same way.
  const unreadable = pjNotice(rows({ leo: 'its instruction file is not UTF-8 text, so editing it here would corrupt it' }));
  assert.doesNotMatch(unreadable, /Try again/);
  assert.match(text(unreadable), /leo’s instructions are in a file Kosmos cannot safely change/);
});

test('#3923: several agents: the header counts, each row carries its own why and only its own button', () => {
  const { pjNotice } = notice();
  const html = pjNotice(rows({
    leo: 'we could not write to its instructions',
    bob: 'told',
    april: 'it has no instructions file yet, and we will not create one',
    casey: 'it has no folder of its own on this computer yet',
  }));
  assert.match(text(html), /^Three agents do not have this project’s folder\./);
  assert.equal((html.match(/class="pnrow"/g) || []).length, 3, 'one row per failing agent; the told one says nothing');
  assert.equal((html.match(/data-pn-retry=/g) || []).length, 1, 'only leo (Wait) gets a button');
  assert.match(html, /aria-label="Try again for leo"/, 'each button names its agent for a screen reader');
  assert.match(html, /<span class="pnwho">leo<\/span><span class="pnwhy">We could not write to its instructions\./);
  assert.match(html, /<span class="pnwho">casey<\/span><span class="pnwhy">Kosmos only keeps instructions for agents it made, and casey came from somewhere else, so Kosmos has nowhere to write\./);
  assert.doesNotMatch(html, /bob/);
});

test('#3923: a Try again that came back with the same answer says so on the row, and only then', () => {
  const { pjNotice, PJ_NOTICE_TRIED } = notice();
  const r = rows({ leo: 'we could not write to its instructions' });
  assert.doesNotMatch(pjNotice(r), /still did not work/, 'CONTROL: not before a retry');
  PJ_NOTICE_TRIED.set('leo', 'we could not write to its instructions');
  assert.match(text(pjNotice(r)), /We could not write to leo’s instructions\. It still did not work\./);
  // A different answer after the retry is new information, not "still".
  assert.doesNotMatch(pjNotice(rows({ leo: 'its instructions are already at the size limit' })), /still did not work/);
});

test('#3923: an unknown cause is one honest retry with the engine\'s own sentence', () => {
  const { pjNotice } = notice();
  assert.equal(text(pjNotice(rows({ leo: 'the disk is full' }))), 'leo does not have this project’s folder. The disk is full. Try again');
});

test('#3923: every could_not sentence the engine names has a shape (none falls through to the generic retry)', () => {
  const { PJ_NOTICE } = notice();
  const at = ENGINE.indexOf('const GROUP_BECAUSE = new Map([');
  const end = ENGINE.indexOf(']);', at);
  assert.ok(at > 0 && end > at, 'GROUP_BECAUSE moved; re-anchor');
  // Each entry opens `['<singular>',` whether its value is on the same line or the next.
  const keys = [...ENGINE.slice(at, end).matchAll(/\[\s*'([^']+)',\s*'/g)].map((m) => m[1]);
  const rowsInMap = (ENGINE.slice(at, end).match(/\[\s*'/g) || []).length;
  assert.equal(keys.length, rowsInMap, 'CONTROL: the scan read every row of the engine map');
  assert.ok(keys.length >= 9, 'CONTROL: the engine map has its rows (found ' + keys.length + ')');
  // The other could_not sentences tellAgent can return: the N-blocks one, and the reader's own
  // refusals it passes through for a file it cannot safely edit (workerfile.js, instructions.js).
  keys.push('its instructions contain 2 Kosmos project blocks, so we cannot tell which is ours and did not change anything',
    'its worker folder is a link, so we do not read through it',
    'its instruction file is not UTF-8 text, so editing it here would corrupt it',
    'its instruction file is not one we can read',
    'its instruction file could not be read',
    'we cannot get at its instruction file to read it',
    'that file is not inside the workers folder',
    'that is not a name we can look up');
  for (const because of keys) {
    assert.ok(PJ_NOTICE.some(([re]) => re.test(because)), 'no shape for: ' + because);
  }
});

test('#3923: names are escaped', () => {
  const { pjNotice } = notice();
  // The page's own esc, given a name no fleet agent can carry: the row's shape is otherwise real.
  const [real] = rows({ leo: 'we could not write to its instructions' });
  const html = pjNotice([{ ...real, name: '<img src=x>' }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});

/* The Try again listener, run as the page has it, against a stand-in page. */
function retryHandler(state) {
  const sig = "document.getElementById('pj-one-notice').addEventListener('click', ";
  const at = PAGE.indexOf(sig);
  assert.ok(at > 0, 'the Try again listener moved; re-anchor');
  const body = PAGE.slice(at + sig.length, PAGE.indexOf('\n});', at) + 2).replace(/PJ_CURRENT/g, 'state.PJ_CURRENT');
  // eslint-disable-next-line no-new-func
  return new Function('state', 'document', 'fetch', 'loadProjects', 'paintOneProject', 'PROJECTS', 'PJ_NOTICE_TRIED', 'window', 'CSS',
    'return ' + body + ';')(state, state.document, state.fetch, state.loadProjects, state.paintOneProject, state.PROJECTS, state.tried, {}, undefined);
}
function standIn(project, { rowAfter = true, switchTo = null, fetchFails = false } = {}) {
  const log = [];
  const btn = { dataset: { pnRetry: project.agents[0].sessionName }, disabled: false, closest() { return this; } };
  const again = { focus() { log.push('focus:again'); } };
  const attrs = {};
  const heading = { focus() { log.push('focus:heading'); }, hasAttribute: (k) => k in attrs, setAttribute: (k, v) => { attrs[k] = v; } };
  const box = { __lastLive: 'x', querySelector: () => (rowAfter ? again : null) };
  const state = {
    PJ_CURRENT: project.id, PROJECTS: [project], tried: new Map(), log, btn, attrs,
    document: { getElementById: () => box, querySelector: () => heading },
    fetch: async (url, opts) => { log.push('fetch:' + opts.method + ' ' + url + ' disabled=' + btn.disabled); if (switchTo) state.PJ_CURRENT = switchTo; if (fetchFails) throw new Error('offline'); return { ok: true }; },
    loadProjects: async () => { log.push('load live=' + box.__lastLive); },
    paintOneProject: () => { log.push('paint live=' + box.__lastLive); },
  };
  return state;
}

test('#3923: Try again re-tells with ?retell=1, repaints, marks the answer, and puts focus back', async () => {
  const project = projectWith({ leo: 'we could not write to its instructions' });
  const st = standIn(project);
  await retryHandler(st)({ target: st.btn });
  assert.deepEqual(st.log, [
    'fetch:POST /api/project/' + encodeURIComponent(project.id) + '/agent/leo?retell=1 disabled=true',
    'load live=null',
    'paint live=null',
    'focus:again',
  ]);
  assert.equal(st.btn.disabled, false, 'the button must be re-enabled after the repaint');
  assert.equal(st.tried.get('leo'), 'we could not write to its instructions', 'the answer before the retry is remembered');
});

test('#3923: when the row is gone focus goes to the Members heading; after a project switch it goes nowhere', async () => {
  const project = projectWith({ leo: 'we could not write to its instructions' });
  const gone = standIn(project, { rowAfter: false });
  await retryHandler(gone)({ target: gone.btn });
  assert.equal(gone.log[gone.log.length - 1], 'focus:heading');
  assert.equal(gone.attrs.tabindex, '-1', 'the heading must be focusable to take focus');

  const moved = standIn(project, { switchTo: 'another-project' });
  await retryHandler(moved)({ target: moved.btn });
  assert.ok(!moved.log.some((l) => l.startsWith('focus:')), 'focus moved into a project the person had left: ' + moved.log);
  assert.equal(moved.btn.disabled, false);

  // A retry that never reached the board marks nothing as "still".
  const offline = standIn(project, { fetchFails: true });
  await retryHandler(offline)({ target: offline.btn });
  assert.equal(offline.tried.has('leo'), false, 'a failed request was recorded as a retry that did not work');
  assert.equal(offline.btn.disabled, false);

  // CONTROL: a click that is not on a Try again does nothing at all.
  const idle = standIn(project);
  await retryHandler(idle)({ target: { closest: () => null } });
  assert.deepEqual(idle.log, []);
});
