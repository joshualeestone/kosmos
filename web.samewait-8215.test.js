'use strict';

/**
 * #8215: the project's needs-you block shows an agent's own question in its words, and members asking the same thing
 * are said once, above their names ("These 3 are asking the same thing. ...", not three separate reds). pjNeedsNotice is extracted
 * from the page and CALLED, with the real esc(), on real member rows (fixture discipline).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-samewait-8215-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
const fleet = require('./test-support/fleet');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(start) {
  const at = PAGE.indexOf(start);
  assert.notEqual(at, -1, `${start} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1) + (start.startsWith('const ') ? ';' : '');
}
// eslint-disable-next-line no-new-func
const pjNeedsNotice = new Function(slice('function esc(') + '\n' + slice('const PJ_NEEDS_WHY = ') + '\n'
  + slice('function pjAlsoWhy(') + '\n' + slice('function pjSaidWords(') + '\n' + slice('function pjNeedsNotice(') + '\nreturn pjNeedsNotice;')();

const ROWS = (() => {
  const projectsEngine = require('./engine/projects');
  const names = ['ada', 'bo', 'cy', 'dee', 'eli'];
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    const dir = nodePath.join(SANDBOX, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    projectsEngine.create({ name: 'Same', folder: dir, agents: names, roster: board.agents });
    return projectsEngine.list(board.agents).find((x) => x.name === 'Same').agents;
  } finally { board.restore(); }
})();
/* A member asking its own question here (needsYouHere 'question', reported by the agent), with its words. */
const ask = (session, because, extra) => {
  const row = ROWS.find((r) => r.sessionName === session);
  assert.ok(row && row.present, 'CONTROL: the real row for ' + session + ' is there and present');
  return { ...row, state: 'needs_you', stateReportedBy: 'agent', needsYouHere: 'question', because, ...(extra || {}) };
};
const count = (html, re) => (html.match(re) || []).length;
/* What the person reads: the text of the reason spans (an attribute such as Dismiss's key carries words they never see). */
const shown = (html) => (html.match(/<span class="pnwhy">[^<]*<\/span>/g) || []).join('\n');

test('#8215: one question is shown in its own words', () => {
  const html = pjNeedsNotice([ask('ada', 'Which folder should the report go in?')]);
  assert.match(html, /Waiting for your answer: “Which folder should the report go in\?”/);
  assert.equal(count(html, /pn-same/g), 0);
});

test('#8215: three asking the same thing are said once, above their names, each keeping its own buttons', () => {
  const html = pjNeedsNotice([
    ask('ada', 'Can I restart the build server?'),
    ask('bo', '  can I restart   the build server? '),
    ask('cy', 'Can I restart the build server?'),
  ]);
  assert.match(html, /<b>3 agents need you on this project\.<\/b>/);
  assert.equal(count(html, /class="pnrow pn-same"/g), 1, 'one line for the shared question');
  assert.match(html, /These 3 are asking the same thing\. Waiting for your answer: “Can I restart the build server\?”/);
  assert.equal(count(html, /Waiting for your answer/g), 1, 'said once, on the shared line, not again on each row');
  for (const s of ['ada', 'bo', 'cy']) {
    assert.equal(count(html, new RegExp('data-pn-open="' + s + '"', 'g')), 1, s + ' keeps its Answer');
    assert.equal(count(html, new RegExp('data-pn-dismiss="' + s + '"', 'g')), 1, s + ' keeps its Dismiss');
  }
  // Each Dismiss still carries that member's own key, so dismissing one does not hide the others.
  assert.equal(count(html, /data-pn-reason="question:/g), 3);
  assert.ok(html.indexOf('pn-same') < html.indexOf('data-pn-open="ada"'), 'the shared line comes before the names');
});

test('#8215: different questions stay separate rows, each with its words', () => {
  const html = pjNeedsNotice([ask('ada', 'Which folder?'), ask('bo', 'Which account?')]);
  assert.equal(count(html, /pn-same/g), 0);
  assert.match(html, /“Which folder\?”/);
  assert.match(html, /“Which account\?”/);
});

test('#8215: two the same and one different: one shared line, then the other on its own', () => {
  const html = pjNeedsNotice([ask('ada', 'Same?'), ask('bo', 'Other?'), ask('cy', 'Same?')]);
  assert.match(html, /These 2 are asking the same thing\. Waiting for your answer: “Same\?”/);
  assert.match(html, /Waiting for your answer: “Other\?”/);
});

test('#8215 control: a needs-you read off the screen (not reported by the agent) shows no words and is never grouped', () => {
  const html = pjNeedsNotice([ask('ada', 'it shows a prompt', { stateReportedBy: null }), ask('bo', 'it shows a prompt', { stateReportedBy: null })]);
  assert.equal(count(html, /pn-same/g), 0);
  assert.equal(shown(html).includes('it shows a prompt'), false);
  assert.ok(html.includes('it shows a prompt'), 'CONTROL: the words are in the markup (the Dismiss key), so the line above can fail');
  assert.equal(count(html, /Waiting for your answer\./g), 2);
});

test('#8215 control: a failed restart is not a question, so its words are not shown', () => {
  const html = pjNeedsNotice([ask('ada', 'Same?', { restartFailed: true }), ask('bo', 'Same?')]);
  assert.equal(count(html, /pn-same/g), 0);
  assert.equal(count(html, /“Same\?”/g), 1);
});

test('#8215: a held question says held, with its words', () => {
  const html = pjNeedsNotice([ask('ada', 'Ship it tonight?', { stateHeld: true })]);
  assert.match(html, /Held until you are back: “Ship it tonight\?”/);
});

test('#8215: a question about no named project keeps its sentence and adds the words after it', () => {
  // Not counted here (no needsYouHere), drawn red: the "also" rows.
  const m = { ...ask('ada', 'Which project?'), needsYouHere: null, stateProject: null };
  const html = pjNeedsNotice([m], () => true);
  assert.match(html, /Waiting for you\. It did not say which project\. It asks: “Which project\?”/);
});

test('#8215: long words are cut at 160 characters, on a code-point boundary, with an ellipsis', () => {
  const long = 'a'.repeat(159) + '\u{1F600}' + 'b'.repeat(40);
  const html = pjNeedsNotice([ask('ada', long)]);
  assert.ok(html.includes('a'.repeat(159) + '\u{1F600}…'), 'cut after the whole emoji');
  assert.equal(shown(html).includes('b'), false);
  assert.ok(shown(html).includes('a'.repeat(159)), 'CONTROL: the reason span is read');
  const exact = 'c'.repeat(160);
  assert.ok(pjNeedsNotice([ask('ada', exact)]).includes('“' + exact + '”'), 'exactly 160 is not cut');
});

test('#8215: the words are escaped, and nothing has an em dash', () => {
  const html = pjNeedsNotice([ask('ada', '<img src=x onerror=alert(1)> ok?'), ask('bo', '<img src=x onerror=alert(1)> ok?')]);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; ok\?/);
  assert.equal(html.includes('\u2014'), false);
});

test('#8215: a held question and the same words asked for real are not merged (each row keeps what it says)', () => {
  const html = pjNeedsNotice([ask('ada', 'Ship it?', { stateHeld: true }), ask('bo', 'Ship it?')]);
  assert.equal(count(html, /pn-same/g), 0);
  assert.match(html, /Held until you are back: \u201cShip it\?\u201d/);
  assert.match(html, /Waiting for your answer: \u201cShip it\?\u201d/);
  // CONTROL: two held with the same words do group, and the shared line says held.
  const both = pjNeedsNotice([ask('ada', 'Ship it?', { stateHeld: true }), ask('bo', 'Ship it?', { stateHeld: true })]);
  assert.match(both, /These 2 are asking the same thing\. Held until you are back: \u201cShip it\?\u201d/);
});

test('#8215: a crash-looping agent with a question gets its crash-loop reason only, never the question pinned to it', () => {
  const m = { ...ask('ada', 'Which project?'), needsYouHere: null, crashLoop: { looping: true } };
  const html = pjNeedsNotice([m], () => true);
  assert.match(html, /keeps restarting it/);
  assert.equal(shown(html).includes('Which project'), false);
  // CONTROL: the same row without the crash loop shows the words.
  const ok = pjNeedsNotice([{ ...m, crashLoop: null }], () => true);
  assert.ok(shown(ok).includes('Which project'));
});

test('#8215: two long questions that differ only after the 160-character cut are not grouped, and are shown whole', () => {
  const head = 'q'.repeat(170);
  const html = pjNeedsNotice([ask('ada', head + ' one'), ask('bo', head + ' two')]);
  assert.equal(count(html, /pn-same/g), 0);
  assert.ok(shown(html).includes(head + ' one\u201d') && shown(html).includes(head + ' two\u201d'), 'each whole, so the two rows differ');
  // CONTROL: one long question on its own is still cut.
  assert.ok(shown(pjNeedsNotice([ask('ada', head + ' one')])).includes('\u2026\u201d'));
});

test('#8215: a question asked without words (the engine fills in its own sentence) shows no quote and is never grouped', () => {
  const generic = require('./engine/status').ASKING_GENERIC;
  assert.equal(typeof generic, 'string');
  assert.ok(PAGE.includes("const PJ_ASKING_GENERIC = '" + generic + "';"), 'the page knows the engine\'s exact sentence');
  const html = pjNeedsNotice([ask('ada', generic), ask('bo', generic)]);
  assert.equal(count(html, /pn-same/g), 0);
  assert.equal(shown(html).includes(generic), false);
  assert.equal(count(html, /Waiting for your answer\./g), 2);
});

test('#8215: every question sentence, pinned with its words (a change to a reason must change this test)', () => {
  const also = (extra) => pjNeedsNotice([{ ...ask('ada', 'X?'), needsYouHere: null, ...extra }], () => true);
  assert.match(also({ stateProject: 'p-other' }), /Waiting for your answer about another project: “X\?”/);
  assert.match(also({ stateProject: 'p-other', stateHeld: true }), /Held until you are back, about another project: “X\?”/);
  assert.match(also({ stateProject: null }), /Waiting for you\. It did not say which project\. It asks: “X\?”/);
  assert.match(pjNeedsNotice([ask('ada', 'X?')]), /Waiting for your answer: “X\?”/);
  assert.match(pjNeedsNotice([ask('ada', 'X?', { stateHeld: true })]), /Held until you are back: “X\?”/);
});
