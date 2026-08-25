'use strict';

/**
 * #761 item 8 (Josh, 2026-08-24 21:56): "A task shows the assignee's face,
 * and under it the status (not started, waiting on me, there's an issue);
 * 'we could not check' is not a status a person can use. Multiple
 * assignees, as the pack drew."
 *
 * These run the page's real `tkFace`, `taskClaimHtml` and `paintProjectTasks`
 * against a stub DOM. `tkFace` and `taskClaimHtml` are shared with the task
 * DETAIL page (web.task-page.test.js covers that side); this file covers the
 * card LIST, plus the column filter fix underneath it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-data-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-workers-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tkcard-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');

let PROJECT = null;
test.before(() => {
  const board = fleet.install([
    fleet.agent('april', { displayName: 'April' }),
    fleet.agent('mikey', { displayName: 'Mikey' }),
  ]);
  try {
    const made = projects.create({ name: 'Task Card Faces' });
    projects.addAgent(made.id, 'april');
    projects.addAgent(made.id, 'mikey');
    PROJECT = projects.describe(projects.readAll().find((x) => x.id === made.id), board.agents);
    assert.equal(PROJECT.agents.length, 2, 'PRE-CONTROL: the fixture project does not carry both members');
    assert.ok(PROJECT.agents.every((a) => 'hasAvatar' in a),
      'PRE-CONTROL: the roster row this page reads does not carry hasAvatar');
  } finally { board.restore(); }
});

/** Stub thin enough for innerHTML assertions: one element (#pj-tasklist), one door. */
function stubDoc() {
  const els = {
    'pj-tasklist': { innerHTML: '' },
    'pj-alltasks': { hidden: true, textContent: '' },
  };
  return { els, getElementById: (id) => els[id] || null };
}

function runPaintProjectTasks(project, showAll) {
  const doc = stubDoc();
  const src = [
    'let TK_SHOW_ALL = ' + (showAll ? 'true' : 'false') + ';',
    fnSource('tkFace'), fnSource('taskClaimHtml'), fnSource('tkMemberName'),
    'let TK_LIST_HTML = null;',
    fnSource('paintProjectTasks'),
  ].join('\n');
  new Function('document', 'esc', 'discTint', 'discInk', 'initials', 'encodeURIComponent', 'project',
    src + '\n; paintProjectTasks(project);')(
    doc, (s) => String(s), () => '#dfe5ea', () => '#4a5560',
    (n) => String(n).slice(0, 2).toUpperCase(), encodeURIComponent, project);
  return doc;
}

test('a single-assignee task shows a face and a status underneath the name, not a colored-letter chip', () => {
  const t = {
    number: 1, sentence: 'Write the brief', who: 'april', closedAt: null,
    parts: [{ id: 1, who: 'april', sentence: 'Write the brief', closedAt: null }],
    progress: { done: 0, total: 1, closed: false, assigned: 1 },
    claim: { claimed: true },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.doesNotMatch(html, /tkchip/, 'the old colored-letter chip is still being drawn');
  assert.match(html, /class="lav"/, 'no face (.lav) was drawn for the assignee');
  assert.match(html, /<b>April<\/b>/, 'the assignee name is missing or not bold');
  // "and under it the status": name and status live in the same stacked
  // container (.tkcard-who-b), not inline on one line with the name.
  assert.match(html, /<span class="tkcard-who-b"><b>April<\/b><em class="tksay">says it is on this<\/em>/);
});

test('the unknown claim shows the ENGINE\'S REAL REASON, never the generic "we could not check"', () => {
  const t = {
    number: 2, sentence: 'Ship it', who: 'april', closedAt: null,
    parts: [{ id: 1, who: 'april', sentence: 'Ship it', closedAt: null }],
    progress: { done: 0, total: 1, closed: false, assigned: 1 },
    claim: { claimed: null, because: 'it last reported 42 minutes ago, too long to still be true' },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.doesNotMatch(html, /we could not check/,
    'Josh, 2026-08-24 21:56: "\'we could not check\' is not a status a person can use" -- still shipping it');
  assert.match(html, /it last reported 42 minutes ago, too long to still be true/,
    'the real, specific because the engine computed did not reach the card');
  // Splinter's read: an objection to the words, not the state -- the third
  // state must still be its own visibly distinct appearance (.tkunk), not
  // silently merged into .tksay (which would read as the agent's own claim).
  assert.match(html, /<em class="tkunk"/, 'the could-not-establish state lost its distinct appearance');
  // Full sentence still reachable (title=), even though the on-screen glyphs
  // are CSS-clamped to one line by .tkcard-who-b .tkunk's overflow rule.
  assert.match(html, /title="it last reported 42 minutes ago, too long to still be true"/);
});

test('a task assigned only through parts, with no legacy top-level who, is not silently dropped from the column', () => {
  // The exact "second t.who gate" mistake engine/projects.js's own comment
  // names: a task created via the parts-first flow carries parts but no
  // top-level `who` at all.
  const t = {
    number: 3, sentence: 'Multi-part, no legacy who', who: undefined, closedAt: null,
    parts: [
      { id: 1, who: 'april', sentence: 'Half one', closedAt: null },
      { id: 2, who: null, sentence: 'Half two', closedAt: null },
    ],
    progress: { done: 0, total: 2, closed: false, assigned: 1 },
    claim: { claimed: true },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  assert.match(doc.els['pj-tasklist'].innerHTML, /Task 3/,
    'a parts-only-assigned task (no t.who) fell out of the column, the old t.who-only filter\'s bug');
});

test('multiple assignees, as the pack drew: one face+name row per part, including an unassigned one, and an honest N of M count', () => {
  const t = {
    number: 4, sentence: 'Two-person task', who: 'april', closedAt: null,
    parts: [
      { id: 1, who: 'april', sentence: 'Pull the numbers', closedAt: null },
      { id: 2, who: 'mikey', sentence: 'Write it up', closedAt: null },
      { id: 3, who: null, sentence: 'Check it against the live flow', closedAt: null },
    ],
    progress: { done: 0, total: 3, closed: false, assigned: 2 },
    claim: { claimed: true },
  };
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [t] });
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.match(html, /class="tkcard-parts"/, 'no per-part rows drawn for a multi-part task');
  assert.match(html, /<b>April<\/b>/);
  assert.match(html, /<b>Mikey<\/b>/);
  assert.match(html, /<b>Nobody yet<\/b>/, 'the unassigned third part was dropped instead of shown as its own row');
  // The count comes off t.progress.assigned/total (engine-computed,
  // progressOf), never counted client-side from the parts array.
  assert.match(html, /2 of 3 assigned/);
  // The claim (the TASK's, not a per-part fact) lands on the FIRST assigned
  // part only, the same convention the task detail page's per-part rows use.
  const aprilRowEnd = html.indexOf('Mikey');
  assert.match(html.slice(0, aprilRowEnd), /says it is on this/, 'the claim did not land on the first assigned part');
  assert.doesNotMatch(html.slice(aprilRowEnd), /says it is on this/,
    'the claim was repeated on a second part, as though two reports were made');
});

test('an unassigned single-part task still says Nobody yet, and a closed task shows no claim status', () => {
  const nobody = {
    number: 5, sentence: 'Not picked up', who: null, closedAt: null,
    parts: [{ id: 1, who: null, sentence: 'Not picked up', closedAt: null }],
    progress: { done: 0, total: 1, closed: false, assigned: 0 },
  };
  const closed = {
    number: 6, sentence: 'Finished', who: 'april', closedAt: new Date().toISOString(),
    parts: [{ id: 1, who: 'april', sentence: 'Finished', closedAt: new Date().toISOString() }],
    progress: { done: 1, total: 1, closed: true, assigned: 1 },
  };
  // Both are "behind the door" (nobody: assigned 0; closed: progress.closed
  // true), so they are invisible in the default column; showAll=true renders
  // them the way the door's own "View all tasks" click does.
  const doc = runPaintProjectTasks({ ...PROJECT, tasks: [nobody, closed] }, true);
  const html = doc.els['pj-tasklist'].innerHTML;
  assert.match(html, /tkcard-who-b">Nobody yet</, 'an unassigned task did not say Nobody yet');
  assert.doesNotMatch(html, /says it is|<em class="tk(say|unk)"/,
    'a closed task (no claim computed for it, claimFor returns null once progressOf().closed) drew a claim status anyway');
});
