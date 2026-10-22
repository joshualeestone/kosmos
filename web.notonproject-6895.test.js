'use strict';
/* #6895: a task's open part held by an agent who is not on its project is named "(not on this project)" on the Tasks
 * row, the project's task cards and the task page, and the project page counts such open tasks. #6896: the repeating
 * task's reviewer choice reads the page's member OBJECTS by session name.
 *
 *   node --test web.notonproject-6895.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const NAMES = { ada: 'Ada', rex: 'Rex', bo: 'Bo' };
// The shape the projects route sends (engine/projects.js `agents: members`), not bare names.
const member = (sn) => ({ sessionName: sn, name: NAMES[sn] });

const memberName = new Function('tskAgentName', page.liftAll(SCRIPT, ['tkMemberName']) + '\nreturn tkMemberName;')((s) => NAMES[s] || s);

test('#6895: a holder of open work who is not a member is named so; a member, and any name not shown as holding, are not', () => {
  const p = { agents: [member('ada')] };
  assert.equal(memberName(p, 'rex', true), 'Rex (not on this project)');
  assert.equal(memberName(p, 'ada', true), 'Ada', 'CONTROL: a member');
  assert.equal(memberName(p, 'rex'), 'Rex', 'CONTROL: the other callers (builtBy, receipts, history) are unchanged');
  assert.equal(memberName(p, 'rex', false), 'Rex', 'a finished part');
});

/* paintProjectTasks run for real against a thin DOM, as web.task-card-761.test.js does. */
function paintProject(project) {
  const els = { 'pj-tasklist': { innerHTML: '' }, 'pj-alltasks': { hidden: true, textContent: '' }, 'pj-offproject': { hidden: true, textContent: '' } };
  const src = ['let TK_SHOW_ALL = false;', 'let TK_LIST_HTML = null;',
    page.liftAll(SCRIPT, ['tkFace', 'tkSayPart', 'claimNotReported', 'taskClaimHtml', 'tkMemberName', 'taskNest', 'paintProjectTasks'])].join('\n');
  new Function('document', 'esc', 'discTint', 'discInk', 'initials', 'encodeURIComponent', 'tskAgentName', 'project', src + '\n; paintProjectTasks(project);')(
    { getElementById: (id) => els[id] || null }, (s) => String(s), () => '#dfe5ea', () => '#4a5560',
    (n) => String(n).slice(0, 2).toUpperCase(), encodeURIComponent, (s) => NAMES[s] || s, project);
  return els;
}
const task = (n, parts) => ({ number: n, sentence: 'task ' + n, closedAt: null, parts,
  progress: { done: parts.filter((x) => x.closedAt).length, total: parts.length, closed: false, assigned: parts.filter((x) => x.who).length } });

test('#6895: the project\'s task cards name an off-project holder, and the page counts every such open task', () => {
  const tasks = [
    task(1, [{ id: 1, who: 'rex', closedAt: null }]),
    task(2, [{ id: 1, who: 'ada', closedAt: null }]),
    task(3, [{ id: 1, who: 'ada', closedAt: null }, { id: 2, who: 'rex', closedAt: null }]),
    task(4, [{ id: 1, who: 'rex', closedAt: '2026-10-21T00:00:00Z' }, { id: 2, who: 'ada', closedAt: null }]),
  ];
  const els = paintProject({ id: 'p1', agents: [member('ada')], tasks });
  const html = els['pj-tasklist'].innerHTML;
  assert.match(html, /<b>Rex \(not on this project\)<\/b>/);
  assert.match(html, /<b>Ada<\/b>/, 'CONTROL: a member is not marked');
  assert.match(html, /<b>Rex<\/b>/, 'a finished part held by a former member is history, unmarked');
  assert.equal(els['pj-offproject'].hidden, false);
  assert.equal(els['pj-offproject'].textContent, '2 open tasks are held by agents not on this project.');
  const all = paintProject({ id: 'p1', agents: [member('ada'), member('rex')], tasks });
  assert.equal(all['pj-offproject'].hidden, true, 'CONTROL: with rex a member, no count');
  assert.doesNotMatch(all['pj-tasklist'].innerHTML, /not on this project/);
  const one = paintProject({ id: 'p1', agents: [member('ada')], tasks: [tasks[0], tasks[1]] });
  assert.equal(one['pj-offproject'].textContent, '1 open task is held by an agent not on this project.');
});

test('#6895: the Tasks row names an off-project holder as the engine marks it, and leaves a member alone', () => {
  const NOW = Date.parse('2026-10-22T12:00:00Z');
  const rep = new Function('tskAgentName', page.liftAll(SCRIPT, ['agoWords', 'tskRepeatMissed', 'tskToldSentence', 'tskRepeatSentence'])
    + '\nreturn { tskRepeatSentence, tskRepeatMissed };')((s) => s);
  const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
    page.liftAll(SCRIPT, ['pjChainText', 'pjChainSpoken', 'tskChainOf', 'tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [], (s) => String(s), () => 'just now',
    (x) => x.projectId + '#' + x.number, () => '', (s) => NAMES[s] || s, rep.tskRepeatSentence, rep.tskRepeatMissed, [])(t, { depth: 0, crumb: false, kids: 0 });
  const base = { number: 4, sentence: 'Write the brief', projectId: 'p1', projectName: 'Book', createdAt: new Date(NOW).toISOString(), state: 'assigned', whoNames: ['rex', 'ada'] };
  const html = row({ ...base, offProject: ['rex'] });
  assert.match(html, /data-agent="rex">Rex \(not on this project\)<\/button>/);
  assert.match(html, /data-agent="ada">Ada<\/button>/, 'CONTROL: a member is not marked');
  assert.doesNotMatch(row(base), /not on this project/, 'CONTROL: with no offProject from the engine, nothing is marked');
});

test('#6896: the reviewer choice reads member objects: agents by session name, a member never marked as left', () => {
  const el = (id) => ({ id, hidden: true, _t: '', value: '', dataset: {}, children: [], appendChild(o) { this.children.push(o); },
    set textContent(v) { this._t = v; if (v === '') this.children = []; }, get textContent() { return this._t; } });
  const els = { 'tk-review-row': el('r'), 'tk-review-who': el('w'), 'tk-review-msg': el('m') };
  const doc = { activeElement: null, getElementById: (id) => els[id] || null, createElement: () => ({ value: '', textContent: '' }) };
  const paint = new Function('document', 'TK_ACT', 'tskAgentName', page.liftAll(SCRIPT, ['tkReviewerOf', 'tkPaintReviewer'])
    + '\nreturn tkPaintReviewer;')(doc, 'close', (s) => NAMES[s] || s);
  const t = { number: 4, repeat: { every: 'day', at: '09:00' }, repeatReviewer: 'ada' };
  paint({ id: 'p1', agents: [member('ada'), member('bo')] }, t);
  assert.deepEqual(els['tk-review-who'].children.map((o) => o.value + '=' + o.textContent), ['none=Nobody', 'me=Me', 'ada=Ada', 'bo=Bo']);
  paint({ id: 'p1', agents: [member('bo')] }, t);
  assert.ok(els['tk-review-who'].children.some((o) => o.value === 'ada' && o.textContent === 'Ada (left the project)'), 'a reviewer who left says so');
});
