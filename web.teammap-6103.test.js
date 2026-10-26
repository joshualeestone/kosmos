'use strict';

/**
 * kosmos#6103: a project's team map, read-only. pjTeamMap draws the members by who reports to whom (the org chart's
 * orgTreeOf), each with its model family, status word and open parts held, then who handed work to whom, taken ONLY
 * from a part's movedBy (#6150). Extracted from the page and CALLED, on a project the real engines built.
 *
 *   node --test web.teammap-6103.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-teammap-6103-'));
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
const pjTeamMap = new Function(['function esc(', 'const STATE_COPY = ', 'function restartingLabel(', 'function stateCopyOf(',
  'const WV_PROVIDER = ', 'function orgTreeOf(', 'function pjTeamMap('].map(slice).join('\n') + '\nreturn pjTeamMap;')();

/* A real project (fixture-discipline): a real board from test-support/fleet, tasks and moves made through the real
   tasks engine, described by the real projects engine, so the parts carry movedBy exactly as the page receives it. */
function build(name, setup) {
  const projectsEngine = require('./engine/projects');
  const tasks = require('./engine/tasks');
  const names = ['roo', 'pixel', 'quill'];
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    const dir = nodePath.join(SANDBOX, name);
    fs.mkdirSync(dir, { recursive: true });
    const p = projectsEngine.create({ name, folder: dir, agents: names, roster: board.agents });
    setup(p, tasks);
    /* The page's board list is /api/status, which adds `account` (server.js accountForAgent) to each snapshot() row.
       Copied out of the fixture's guard so a row can carry one, as the route's rows do; none here has one yet. */
    const status = board.agents.map((c) => ({ ...c, account: null }));
    return { p: projectsEngine.list(board.agents).find((x) => x.name === name), board: status };
  } finally { board.restore(); }
}
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/* One member's own words on the map, from its button to that button's end, so a claim about one member can never be
   met by a later member's words (review round 4: a match greedy across nodes could not fail). */
const held = (html, name) => {
  const at = html.indexOf('data-agent="' + name + '"');
  assert.notEqual(at, -1, name + ' is not on the map');
  return textOf(html.slice(at, html.indexOf('</button>', at)));
};

test('#6103: a hand-off is said only where a part records who moved it', () => {
  const { p, board } = build('Handoffs', (proj, tasks) => {
    const a = tasks.create(proj.id, { sentence: 'Write the copy' });
    const b = tasks.create(proj.id, { sentence: 'Check the copy' });
    const c = tasks.create(proj.id, { sentence: 'Draw the chart' });
    assert.equal(tasks.assignPart(proj.id, a.number, 1, 'pixel', { via: 'process', by: 'roo' }).changed, true);
    assert.equal(tasks.assignPart(proj.id, b.number, 1, 'pixel', { via: 'process', by: 'roo' }).changed, true);
    // From the screen: a person moved it, so no agent handed it over.
    assert.equal(tasks.assignPart(proj.id, c.number, 1, 'quill', { via: 'screen' }).changed, true);
  });
  assert.ok(p && p.agents.length === 3, 'CONTROL: the real project has its three members');
  const parts = p.tasks.flatMap((t) => t.parts);
  assert.equal(parts.filter((x) => x.movedBy === 'roo').length, 2, 'CONTROL: the engine recorded two named moves');
  const html = pjTeamMap(p, board);
  const out = textOf(html);
  assert.match(out, /roo handed pixel 2 open parts/, 'the named hand-offs are not said');
  assert.doesNotMatch(out, /handed quill/, 'a move from the screen was drawn as a hand-off between agents');
  assert.match(held(html, 'pixel'), /holds 2 open parts/, 'pixel does not show the two parts it holds');
  assert.match(held(html, 'quill'), /holds 1 open part\b/, 'quill does not show the part it holds');
  assert.match(held(html, 'roo'), /holds no open parts/, 'roo does not say it holds nothing');
});

test('#6103: with no recorded hand-off, the map says none rather than guessing the lead gave it out', () => {
  const { p, board } = build('NoHandoffs', (proj, tasks) => {
    const a = tasks.create(proj.id, { sentence: 'Write it' });
    assert.equal(tasks.assignPart(proj.id, a.number, 1, 'pixel', { via: 'process' }).changed, true);   // nobody named
  });
  const html = pjTeamMap(p, board);
  const out = textOf(html);
  assert.match(out, /No hand-offs between agents on open work yet/);
  assert.doesNotMatch(out, /\w+ handed \w+ \d/, 'a hand-off was invented');
  assert.match(held(html, 'pixel'), /holds 1 open part\b/, 'CONTROL: the held part still counts');
});

test('#6103: a closed part is neither held nor handed', () => {
  const { p, board } = build('Closed', (proj, tasks) => {
    const a = tasks.create(proj.id, { sentence: 'Done already' });
    assert.equal(tasks.assignPart(proj.id, a.number, 1, 'pixel', { via: 'process', by: 'roo' }).changed, true);
  });
  const open = textOf(pjTeamMap(p, board));
  assert.match(open, /roo handed pixel 1 open part\b/, 'CONTROL: while open, the hand-off is said');
  const closed = { ...p, tasks: p.tasks.map((t) => ({ ...t, parts: t.parts.map((x) => ({ ...x, closedAt: '2026-10-16T16:00:00Z' })) })) };
  assert.match(held(pjTeamMap(p, board), 'pixel'), /holds 1 open part\b/, 'CONTROL: while open, pixel holds it');
  const closedHtml = pjTeamMap(closed, board);
  assert.doesNotMatch(textOf(closedHtml), /\w+ handed \w+ \d/, 'a closed part was drawn as a hand-off');
  assert.match(held(closedHtml, 'pixel'), /holds no open parts/, 'a closed part still counts as held');
  // A closed TASK whose parts are still open: the task-level skip alone keeps them out.
  const closedTask = { ...p, tasks: p.tasks.map((t) => ({ ...t, closedAt: '2026-10-16T16:00:00Z' })) };
  assert.ok(closedTask.tasks.every((t) => t.parts.some((x) => !x.closedAt)), 'CONTROL: the parts are still open');
  const taskHtml = pjTeamMap(closedTask, board);
  assert.doesNotMatch(textOf(taskHtml), /\w+ handed \w+ \d/, 'a closed task\'s open part was drawn as a hand-off');
  assert.match(held(taskHtml, 'pixel'), /holds no open parts/, 'a closed task\'s open part still counts as held');
  // progress.closed alone (a task its parts closed, as the engine reports it), with closedAt unset on the task.
  const doneTask = { ...p, tasks: p.tasks.map((t) => ({ ...t, closedAt: null, progress: { ...(t.progress || {}), closed: true } })) };
  assert.ok(doneTask.tasks.every((t) => !t.closedAt && t.parts.some((x) => !x.closedAt)), 'CONTROL: only progress says closed');
  const doneHtml = pjTeamMap(doneTask, board);
  assert.doesNotMatch(textOf(doneHtml), /\w+ handed \w+ \d/, 'a task whose progress says closed was drawn as a hand-off');
  assert.match(held(doneHtml, 'pixel'), /holds no open parts/, 'a task whose progress says closed still counts');
});

test('#6103: the "!" marks every member the needs-you block lists, the red-but-uncounted ones too', () => {
  const { p, board } = build('RedHere', () => {});
  // pjNeedsNotice lists needsYouHere members AND present members its redHere predicate draws red (a connection
  // Kosmos gave up on, #3410). The map takes the same predicate, so the two cannot disagree.
  const agents = p.agents.map((m) => ({ ...m, needsYouHere: null }));
  assert.ok(agents.every((m) => m.present === true), 'CONTROL: the fixture members are present');
  const redHere = (m) => m.sessionName === 'pixel';
  const html = pjTeamMap({ ...p, agents }, board, redHere);
  assert.match(html, /class="pjtm-node pjtm-need" type="button" data-agent="pixel"/, 'a red, uncounted member has no "!"');
  assert.doesNotMatch(html, /pjtm-need" type="button" data-agent="(roo|quill)"/, 'a member not drawn red was marked');
  assert.match(textOf(html), /needs you: the needs-you list says what each one is waiting for/, 'the hint is missing when only red members exist');
  const absent = agents.map((m) => (m.sessionName === 'pixel' ? { ...m, present: false } : m));
  assert.doesNotMatch(pjTeamMap({ ...p, agents: absent }, board, redHere), /pjtm-need/, 'an absent member was marked (the block counts only present ones)');
  assert.doesNotMatch(pjTeamMap({ ...p, agents }, board), /pjtm-need/, 'CONTROL: with no predicate, nothing red is marked');
});

test('#6103: members nest under who they report to, and a member needing you is marked', () => {
  const { p, board } = build('Tree', () => {});
  const agents = p.agents.map((m) => ({ ...m, reportsTo: m.sessionName === 'roo' ? '' : 'roo',
    needsYouHere: m.sessionName === 'quill' ? 'trust' : null }));
  const html = pjTeamMap({ ...p, agents }, board);
  // roo at the top level; pixel and quill in the list nested inside roo's item.
  const top = html.indexOf('data-agent="roo"');
  const nested = html.indexOf('<ul>', top);
  assert.ok(top !== -1 && nested !== -1, 'roo has no nested list');
  assert.ok(html.indexOf('data-agent="pixel"') > nested && html.indexOf('data-agent="quill"') > nested, 'pixel and quill are not under roo');
  const flat = pjTeamMap(p, board);
  assert.equal((flat.match(/<ul>/g) || []).length, 1, 'CONTROL: with no managers there is one level only');
  assert.match(html, /class="pjtm-node pjtm-need" type="button" data-agent="quill"/, 'the member needing you is not marked');
  assert.doesNotMatch(html, /pjtm-need" type="button" data-agent="(roo|pixel)"/, 'a member not needing you was marked');
  assert.match(textOf(html), /needs you: the needs-you list says what each one is waiting for/);
  assert.doesNotMatch(textOf(flat), /the needs-you list says what each one/, 'CONTROL: nobody needs you, nothing pointed at');
});

test('#7206: a member running Claude Code on a DeepSeek account shows DeepSeek, never Claude', () => {
  const { p, board } = build('Family DeepSeek', () => {});
  const agents = p.agents.map((m) => ({ ...m, runner: 'claude' }));
  const cards = board.map((c) => (c.sessionName === 'quill' ? { ...c, runner: 'claude', account: { provider: 'deepseek' } } : c));
  const out = textOf(pjTeamMap({ ...p, agents }, cards));
  assert.match(out, /quill DeepSeek ·/, 'a DeepSeek agent read as Claude');
  assert.match(out, /roo Claude ·/, 'CONTROL: a Claude agent beside it still reads Claude');
});

test('#6103: each member shows its model family, and a Qwen agent is never OpenAI', () => {
  const { p, board } = build('Family', () => {});
  const agents = p.agents.map((m) => ({ ...m, runner: m.sessionName === 'roo' ? 'claude' : 'codex' }));
  const cards = board.map((c) => (c.sessionName === 'quill' ? { ...c, runner: 'codex', account: { provider: 'alibaba' } } : c));
  const out = textOf(pjTeamMap({ ...p, agents }, cards));
  assert.match(out, /roo Claude ·/);
  assert.match(out, /pixel OpenAI Codex ·/);
  assert.match(out, /quill Qwen ·/, 'a Qwen agent read as OpenAI');
  // The status word: a member the board cannot see says so; a restarting one keeps its restart words.
  const seen = p.agents.map((m) => (m.sessionName === 'roo' ? { ...m, present: false, state: 'idle' }
    : m.sessionName === 'pixel' ? { ...m, present: false, state: 'restarting' } : m));
  const words = pjTeamMap({ ...p, agents: seen }, board);
  assert.match(held(words, 'roo'), /Kosmos cannot see it/, 'an absent member did not say Kosmos cannot see it');
  assert.match(held(words, 'pixel'), /Restarting agent/, 'a restarting member lost its restart words');
  assert.doesNotMatch(held(words, 'quill'), /cannot see it/, 'CONTROL: a present member reads as present');
});

test('#6103: names are escaped and an empty project says so', () => {
  const { p, board } = build('Escape', () => {});
  const agents = p.agents.map((m) => (m.sessionName === 'pixel' ? { ...m, name: '<img src=x onerror=alert(1)>' } : m));
  const html = pjTeamMap({ ...p, agents }, board);
  assert.ok(!html.includes('<img'), 'a name reached the page as markup');
  assert.ok(html.includes('&lt;img'), 'CONTROL: the name is there, escaped');
  assert.match(pjTeamMap({ ...p, agents: [] }, board), /No agents on this project yet/);
});

test('#6103: the page wires the map: a closed-by-default button, a painter call, and member clicks open the agent', () => {
  assert.match(PAGE, /<button class="btn-quiet pj-tmbtn" id="pj-teammap-btn" type="button" aria-expanded="false" aria-controls="pj-teammap" hidden>Team map<\/button>/);
  assert.match(PAGE, /<div id="pj-teammap" class="pjtm" hidden><\/div>/);
  assert.match(slice('function paintOneProject('), /setIfChanged\(box, pjTeamMap\(p, typeof LAST !== 'undefined' \? LAST : \[\], pjRedHere\)\)/, 'paintOneProject never paints the map, or paints it without the needs-you block\'s predicate');
  assert.match(PAGE, /getElementById\('pj-teammap'\)\.addEventListener\('click'[^]{0,200}openDetail\(n\.dataset\.agent, undefined, PJ_CURRENT\)/);
});
