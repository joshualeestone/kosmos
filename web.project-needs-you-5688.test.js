'use strict';

/**
 * #5688 (Josh, 2026-10-09 08:45): a project showed a red Issue, and its page never said what the issue was or how to
 * clear it. pjNeedsNotice names each member the pill counts (the engine's needsYouHere), says why, and offers Open.
 * Extracted from the page and CALLED, with the real esc().
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-needsyou-5688-'));
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
  + slice('function pjAlsoWhy(') + '\n' + slice('function pjNeedsNotice(') + '\nreturn pjNeedsNotice;')();

/* Real member rows (fixture-discipline): a real board from test-support/fleet, described by the real projects engine.
   The reason under test is then set on each row; the engine's own derivation of it is tested in engine/projects.test.js. */
const ROWS = (() => {
  const projectsEngine = require('./engine/projects');
  const names = ['elon', 'dario', 'sam', 'mark', 'demis', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'xss'];
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    const dir = nodePath.join(SANDBOX, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    projectsEngine.create({ name: 'Five', folder: dir, agents: names, roster: board.agents });
    return projectsEngine.list(board.agents).find((x) => x.name === 'Five').agents;
  } finally { board.restore(); }
})();
const m = (session, needsYouHere, name) => {
  const row = ROWS.find((r) => r.sessionName === session);
  assert.ok(row && row.present, 'CONTROL: the real row for ' + session + ' is there and present');
  return { ...row, needsYouHere, ...(name ? { name } : {}) };
};

test('#5688: nothing counted, nothing said', () => {
  assert.equal(pjNeedsNotice([m('dario', null), m('demis', null)]), '');
  assert.equal(pjNeedsNotice([]), '');
});

test('#5688: one member: named in the heading, the reason, and one Open that names the agent', () => {
  const html = pjNeedsNotice([m('dario', null), m('elon', 'stuck_auth', 'Elon')]);
  assert.match(html, /<b>Elon needs you on this project\.<\/b>/);
  assert.match(html, /Kosmos has seen it unable to sign in for a while\. It cannot work until its account is reconnected\./);
  assert.match(html, /data-pn-open="elon"/);
  assert.match(html, /aria-label="Open Elon">Open<\/button>/);
  assert.equal((html.match(/data-pn-open=/g) || []).length, 1, 'only the counted member gets a row');
  assert.equal(html.includes('—'), false, 'an em dash reached the person');
});

test('#5688: several members: counted in the heading, each with its own reason; a question says Answer', () => {
  const html = pjNeedsNotice([m('elon', 'question', 'Elon'), m('sam', 'crash_loop'), m('mark', 'gave_up'), m('demis', 'stuck_rate'), m('dario', 'trust')]);
  assert.match(html, /<b>5 agents need you on this project\.<\/b>/);
  assert.match(html, /aria-label="Answer Elon">Answer<\/button>/);
  for (const w of ['Waiting for your answer.', 'keeps restarting it', 'stopped trying to reconnect it',
    'Kosmos has seen it paused by a rate limit', 'Waiting for you to approve it']) assert.ok(html.includes(w), w);
});

test('#5688: no reason sentence carries an em dash', () => {
  const html = pjNeedsNotice(['question', 'trust', 'gave_up', 'crash_loop', 'stuck_auth', 'stuck_rate', 'other'].map((r, i) => m('a' + i, r)));
  assert.equal((html.match(/data-pn-open=/g) || []).length, 7, 'CONTROL: every reason drew a row');
  assert.equal(html.includes('\u2014'), false);
});

test('#5688: a reason the page does not know yet still gets a row, worded generally', () => {
  const html = pjNeedsNotice([m('elon', 'something_new', 'Elon')]);
  assert.match(html, /Kosmos needs you to look at it\./);
  assert.match(html, /data-pn-open="elon"/);
});

test('#5688: names are escaped', () => {
  const html = pjNeedsNotice([m('xss', 'trust', '<b>x</b>')]);
  assert.equal(html.includes('<b>x</b>'), false);
});

test('#5688 wiring: both notice boxes paint it first, and its Open opens the agent with the project to return to', () => {
  assert.match(PAGE, /const notice = pjNeedsNotice\(roster, pjRedHere\) \+ pjCoordNotice\(p\) \+ pjNotice\(roster, p\.id\);/);
  assert.match(PAGE, /setIfChanged\(rn, op \? pjNeedsNotice\(op\.agents \|\| \[\], pjRedHere\) \+ pjCoordNotice\(op\)/);
  // #5692: the red test is the row builder itself, so the block and the rows cannot disagree.
  assert.match(slice('function pjRedHere('), /pjMember\(m, true, true, true\)/);
  assert.match(slice('function pjNeedsOpenClick('), /openDetail\(b\.dataset\.pnOpen, undefined, PJ_CURRENT\)/);
  assert.match(PAGE, /getElementById\('pj-one-notice'\)\.addEventListener\('click', pjNeedsOpenClick\)/);
  assert.match(PAGE, /rn\.addEventListener\('click', pjNeedsOpenClick\)/);
});

test('#5688 (Josh 08:50/08:51): "Done not set" is gone from the projects list and Roadmap, markup and styles', () => {
  // A deletion with no guard gets undone: the tag's class and words must not come back into the page's markup or CSS.
  // Comments may still NAME it (history); a quoted string or a CSS selector may not.
  assert.equal(/['"][^'"\n]*Done not set[^'"\n]*['"]/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')), false, 'the words are back in a string');
  assert.equal(/\.pj-doneunset\b|class="pj-doneunset"/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'the tag class is back');
  assert.ok(PAGE.includes('doneSet') || PAGE.includes('What does done look like?'), 'CONTROL: the done field itself is still on the page');
});

test('#5688 review 2: a repaint puts focus back on the same agent\'s Open, or the first one left', () => {
  // eslint-disable-next-line no-new-func
  const keep = new Function('document', slice('function pjKeepOpenFocus(') + '\nreturn pjKeepOpenFocus;');
  const run = (focusedOn, after) => {
    const doc = { activeElement: null };
    const btn = (id) => ({ dataset: { pnOpen: id }, focus() { doc.activeElement = this; } });
    let btns = focusedOn ? [btn('dario'), btn(focusedOn)] : [];
    doc.activeElement = btns.find((b) => b.dataset.pnOpen === focusedOn) || null;
    const box = { contains: (el) => btns.includes(el), querySelectorAll: () => btns };
    keep(doc)(box, () => { btns = after.map(btn); });   // the repaint replaces every button
    return doc.activeElement ? doc.activeElement.dataset.pnOpen : null;
  };
  assert.equal(run('elon', ['dario', 'elon']), 'elon', 'focus went back to the same agent');
  assert.equal(run('elon', ['dario']), 'dario', 'that agent is gone: the first Open left');
  assert.equal(run(null, ['dario']), null, 'CONTROL: nothing focused in the notice, nothing is focused after');
});

test('#5692: a red row whose need is not about this project is named too, after the counted ones, and never as a question it is not', () => {
  const red = new Set(['sam', 'mark', 'demis']);   // what the row builder draws red (the page passes pjRedHere)
  const redHere = (r) => red.has(r.sessionName);
  const sam = { ...m('sam', null), state: 'needs_you', stateProject: 'other-project' };
  const mark = { ...m('mark', null), state: 'needs_you', stateProject: null, restartFailed: true };
  const demis = { ...m('demis', null), state: 'needs_you', stateProject: null };
  const dario = m('dario', null);   // CONTROL: not red, not counted: not listed
  const html = pjNeedsNotice([m('elon', 'stuck_auth', 'Elon'), sam, mark, demis, dario], redHere);
  assert.match(html, /<b>Elon needs you on this project\.<\/b>/, 'the heading still speaks for the pill');
  assert.match(html, /Also waiting on you:</);
  assert.match(html, /Waiting for your answer about another project\./);
  assert.match(html, /Kosmos restarted it, and it did not come back\./);
  assert.equal(/data-pn-open="mark"[^>]*>Answer/.test(html), false, 'a dead agent was offered Answer');
  assert.match(html, /Waiting for you\. It did not say which project\./);
  assert.equal(/nothing on this project|not about this project/.test(html), false, 'claims a need is not about this project, which nobody knows');
  assert.equal(/data-pn-open="dario"/.test(html), false);
  assert.ok(html.indexOf('data-pn-open="elon"') < html.indexOf('data-pn-open="sam"'), 'counted rows come first');
  // Only uncounted red rows: the heading says so.
  assert.match(pjNeedsNotice([sam], redHere), /<b>[^<]+ needs you\.<\/b>/);
  assert.match(pjNeedsNotice([sam, mark], redHere), /<b>2 agents need you\.<\/b>/, 'two uncounted rows and none counted');
  // A crash loop the pill did not count says so, before any state sentence.
  assert.match(pjNeedsNotice([{ ...m('demis', null), state: 'connection_lost', crashLoop: { looping: true } }], redHere), /keeps restarting it/);
  // No em dash in any of the also-sentences.
  assert.equal(pjNeedsNotice([m('elon', 'trust'), sam, mark, demis], redHere).includes('\u2014'), false);
  // Without the row builder (an older caller), only the counted rows.
  assert.equal(pjNeedsNotice([sam]), '');
});
