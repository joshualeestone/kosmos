'use strict';

/**
 * kosmos#6324: the team map (#6103) from the consolidated layout, which hides the Members card that holds the tab
 * layout's button. The rail head gets its own button and box, painted by paintRailTeamMap from paintRailPjNotice with
 * the same pjTeamMap and the same PJ_TEAMMAP_OPEN. Both painters are lifted from the page and CALLED, on a project the
 * real engines built; only the DOM is a stand-in.
 *
 *   node --test web.teammap-rail-6324.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-teammap-rail-6324-'));
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

/* A stand-in for the few elements the two painters touch. setIfChanged is the page's own contract (write only on a
   change), reduced to the write. */
function rig({ consolidated, current, projects, board, red = () => false }) {
  // A real scroll box drops its offset when its content is replaced; the stand-in does the same, so a missing restore
  // shows as a lost position.
  const el = () => { let html = ''; return { hidden: false, textContent: '', dataset: {}, attrs: {}, scrollTop: 0,
    get innerHTML() { return html; }, set innerHTML(v) { if (v !== html) { html = v; this.scrollTop = 0; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } }; };
  const els = { 'alist-pj-notice': el(), 'alist-pj-notice-said': el(), 'alist-teammap-btn': el(), 'alist-teammap': el() };
  els['alist-teammap-btn'].hidden = true;
  els['alist-teammap'].hidden = true;
  const document = { getElementById: (id) => els[id] || null,
    body: { classList: { contains: (c) => c === 'consolidated' && consolidated } } };
  const open = new Set();
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'PJ_CURRENT', 'PROJECTS', 'LAST', 'PJ_TEAMMAP_OPEN', 'RED',
    ['function esc(', 'const STATE_COPY = ', 'function restartingLabel(', 'function stateCopyOf(', 'const WV_PROVIDER = ',
      'function orgTreeOf(', 'function pjTeamMap(', 'function paintRailTeamMap(', 'function paintRailPjNotice('].map(slice).join('\n')
    + `
function setIfChanged(box, html) { if (box.innerHTML !== html) box.innerHTML = html; }
function pjById(id) { return PROJECTS.find((x) => x.id === id) || null; }
function pjKeepOpenFocus(box, paint) { paint(); }
function pjNeedsNotice() { return ''; }
function pjNotice() { return ''; }
function pjRedHere(m) { return RED(m); }
return { paint: paintRailPjNotice };`);
  const api = make(document, current, projects, board, open, red);
  return { els, open, paint: api.paint };
}

function build(name) {
  const projectsEngine = require('./engine/projects');
  const names = ['roo', 'pixel', 'quill'];
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    const dir = nodePath.join(SANDBOX, name);
    fs.mkdirSync(dir, { recursive: true });
    const p = projectsEngine.create({ name, folder: dir, agents: names, roster: board.agents });
    const status = board.agents.map((c) => ({ ...c, account: null }));
    return { p: projectsEngine.list(board.agents).find((x) => x.name === name), board: status };
  } finally { board.restore(); }
}
const nodesIn = (html) => [...html.matchAll(/class="pjtm-node[^"]*" type="button" data-agent="([^"]+)"/g)].map((m) => m[1]);

test('#6324: in the consolidated layout with a project open, the rail offers the map closed, and opens it on the set', () => {
  const { p, board } = build('RailOpen');
  assert.ok(p && p.agents.length === 3, 'CONTROL: the real project has its three members');
  const r = rig({ consolidated: true, current: p.id, projects: [p], board });
  r.paint();
  assert.equal(r.els['alist-teammap-btn'].hidden, false, 'the rail has no Team map button for a project with members');
  assert.equal(r.els['alist-teammap-btn'].attrs['aria-expanded'], 'false');
  assert.equal(r.els['alist-teammap'].hidden, true, 'the map is open before anyone asked for it');
  assert.equal(r.els['alist-teammap'].innerHTML, '', 'a closed map still holds markup');
  r.open.add(String(p.id));
  r.paint();
  assert.equal(r.els['alist-teammap'].hidden, false, 'opening it for this project did not show it');
  assert.equal(r.els['alist-teammap-btn'].attrs['aria-expanded'], 'true');
  assert.deepEqual(nodesIn(r.els['alist-teammap'].innerHTML).sort(), ['pixel', 'quill', 'roo'], 'not every member is on the rail map');
});

test('#6324: the rail map is the tab map, drawn by the one pjTeamMap', () => {
  const { p, board } = build('RailSame');
  const r = rig({ consolidated: true, current: p.id, projects: [p], board });
  r.open.add(String(p.id));
  r.paint();
  // eslint-disable-next-line no-new-func
  const pjTeamMap = new Function(['function esc(', 'const STATE_COPY = ', 'function restartingLabel(', 'function stateCopyOf(',
    'const WV_PROVIDER = ', 'function orgTreeOf(', 'function pjTeamMap('].map(slice).join('\n') + '\nreturn pjTeamMap;')();
  assert.equal(r.els['alist-teammap'].innerHTML, pjTeamMap(p, board), 'the rail drew a different map from the tab layout');
});

test('#6324: outside the consolidated layout, with no project open, or with no members, the rail shows no map', () => {
  const { p, board } = build('RailNone');
  const cases = [
    ['the tab layout', { consolidated: false, current: p.id, projects: [p] }],
    ['no project open', { consolidated: true, current: null, projects: [p] }],
    ['a project with no members', { consolidated: true, current: p.id, projects: [{ ...p, agents: [] }] }],
    // The map's own filter: a member with no session name is not drawn, so the button would open an empty map.
    ['a project whose only member has no session name', { consolidated: true, current: p.id, projects: [{ ...p, agents: [{ name: 'Nameless' }] }] }],
  ];
  for (const [what, opts] of cases) {
    const r = rig({ ...opts, board });
    r.open.add(String(p.id));   // even when it was left open
    r.paint();
    assert.equal(r.els['alist-teammap-btn'].hidden, true, `${what}: the rail shows a Team map button`);
    assert.equal(r.els['alist-teammap'].hidden, true, `${what}: the rail shows the map`);
    assert.equal(r.els['alist-teammap'].innerHTML, '', `${what}: the rail map still holds markup`);
  }
  // CONTROL: the same rig, consolidated with the project open, does show it (so the arms above can see a map).
  const c = rig({ consolidated: true, current: p.id, projects: [p], board });
  c.open.add(String(p.id));
  c.paint();
  assert.equal(c.els['alist-teammap'].hidden, false, 'CONTROL: the rig cannot show a map at all');
});

test('#6324: leaving the project empties a map that was open', () => {
  const { p, board } = build('RailLeave');
  const projects = [p];
  const r = rig({ consolidated: true, current: p.id, projects, board });
  r.open.add(String(p.id));
  r.paint();
  assert.ok(nodesIn(r.els['alist-teammap'].innerHTML).length === 3, 'CONTROL: the map was open with its members');
  projects.length = 0;   // the open project is gone (deleted, or a read that no longer has it)
  r.paint();
  assert.equal(r.els['alist-teammap'].hidden, true, 'the map stayed up for a project that is gone');
  assert.equal(r.els['alist-teammap'].innerHTML, '', 'the gone project\'s members stayed in the rail');
});

test('#6324: the page wires the rail map: a closed button in the rail head, and member clicks open the agent', () => {
  const head = PAGE.slice(PAGE.indexOf('<div class="railhead" id="rail-agents"'), PAGE.indexOf('<div class="alist" id="alist"'));
  assert.match(head, /<button class="btn-quiet pj-tmbtn alist-tmbtn" id="alist-teammap-btn" type="button" aria-expanded="false" aria-controls="alist-teammap" hidden>Team map<\/button>/,
    'the button is not in the Agents rail head');
  assert.match(head, /<div id="alist-teammap" class="pjtm alist-tm" hidden><\/div>/, 'the map box is not in the Agents rail head');
  // Above the project notice: a long notice runs past the head, where the list covers it (the browser check clicks it).
  assert.ok(head.indexOf('id="alist-teammap"') < head.indexOf('id="alist-pj-notice"'), 'the map sits under the project notice, where a long notice buries it');
  assert.match(PAGE, /getElementById\('alist-teammap-btn'\)\.addEventListener\('click'[^]{0,250}PJ_TEAMMAP_OPEN[^]{0,150}paintRailPjNotice\(\)/);
  assert.match(PAGE, /getElementById\('alist-teammap'\)\.addEventListener\('click'[^]{0,200}openDetail\(n\.dataset\.agent, undefined, PJ_CURRENT\)/);
  assert.match(PAGE, /body\.consolidated\.fold-a #rail-agents > \.alist-tmbtn, [^{]*#rail-agents > \.alist-tm \{ display: none; \}/, 'folding the agents column does not hide the map');
});

test('#6324: the rail button, the tab button and the map pick members with the one filter', () => {
  // The two painters each decide "has members" for themselves (paintOneProject is lifted alone by other tests, so a
  // shared helper would break them). This holds the three copies to one text, so a change to one reds here.
  const filterIn = (src, what) => {
    const m = /\.filter\(\(m\) => (m && typeof m\.sessionName[^)]*)\)/.exec(src);
    assert.ok(m, `no member filter found in ${what}`);
    return m[1];
  };
  const tab = slice('function paintOneProject(');
  const fromBtn = tab.slice(tab.indexOf("getElementById('pj-teammap-btn')"));
  const want = filterIn(slice('function pjTeamMap('), 'pjTeamMap');
  assert.equal(filterIn(fromBtn, "the tab layout's Team map button"), want, "the tab button's filter is not the map's");
  assert.equal(filterIn(slice('function paintRailTeamMap('), 'paintRailTeamMap'), want, "the rail button's filter is not the map's");
  // CONTROL: the instrument tells two different filters apart.
  assert.notEqual(filterIn('.filter((m) => m && typeof m.sessionName === \'string\')', 'a control'), want, 'CONTROL: the comparison cannot see a difference');
});

test('#6324: the rail passes the needs-you predicate, so a member drawn red gets the "!" as in the tab layout', () => {
  const { p, board } = build('RailRed');
  const present = { ...p, agents: p.agents.map((m) => ({ ...m, present: true })) };
  const plain = rig({ consolidated: true, current: p.id, projects: [present], board });
  plain.open.add(String(p.id));
  plain.paint();
  assert.doesNotMatch(plain.els['alist-teammap'].innerHTML, /pjtm-need/, 'CONTROL: with nobody red, no member is marked');
  const r = rig({ consolidated: true, current: p.id, projects: [present], board, red: (m) => m.sessionName === 'pixel' });
  r.open.add(String(p.id));
  r.paint();
  assert.match(r.els['alist-teammap'].innerHTML, /class="pjtm-node pjtm-need" type="button" data-agent="pixel"/, 'a member the predicate draws red is not marked on the rail map');
  assert.doesNotMatch(r.els['alist-teammap'].innerHTML, /pjtm-need" type="button" data-agent="(roo|quill)"/, 'a member not drawn red was marked');
});

test('#6324: the map keeps its scroll position for the same project, and another project starts at the top', () => {
  const a = build('RailScrollA');
  const b = build('RailScrollB');
  const projects = [a.p, b.p];
  const r = rig({ consolidated: true, current: a.p.id, projects, board: a.board });
  r.open.add(String(a.p.id));
  r.open.add(String(b.p.id));
  r.paint();
  r.els['alist-teammap'].scrollTop = 120;
  const before = r.els['alist-teammap'].innerHTML;
  a.p.agents[0].name = 'Renamed between polls';   // the repaint must really replace the markup
  r.paint();
  assert.notEqual(r.els['alist-teammap'].innerHTML, before, 'CONTROL: the repaint did not change the markup, so it tests nothing');
  assert.equal(r.els['alist-teammap'].scrollTop, 120, 'a repaint of the same project lost its scroll position');
  const r2 = rig({ consolidated: true, current: b.p.id, projects, board: a.board });
  // The same box carried over from project A, as the page's one box is.
  const box2 = r2.els['alist-teammap'];
  box2.innerHTML = r.els['alist-teammap'].innerHTML;   // first: setting markup drops the offset, as a real box does
  box2.dataset = { ...r.els['alist-teammap'].dataset };
  box2.scrollTop = 120;
  assert.equal(box2.dataset.pj, String(a.p.id), 'CONTROL: the carried box does not remember project A');
  r2.open.add(String(b.p.id));
  r2.paint();
  assert.equal(r2.els['alist-teammap'].scrollTop, 0, 'another project\'s map opened at the last project\'s scroll position');
});
