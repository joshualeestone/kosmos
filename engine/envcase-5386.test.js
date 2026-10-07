'use strict';
/**
 * kosmos#5386: engine modules that copy process.env for a child remove and set account-scoped names through
 * engine/win32env.js, so an inherited spelling (Claude_Config_Dir, Codex_Home, xai_api_key) cannot survive a plain
 * delete or sit beside the new value. A copy keeps names as spelled; on Windows any one of them is the variable the
 * child reads. Reads of process.env itself are not flagged: Windows looks those up case-insensitively.
 *
 * The scan covers EVERY non-test module in engine/, so a new site cannot hide by not being on a list. What it cannot
 * see: a name built at runtime (env[name]), or an env object under a name it reads as process.env.
 *
 *   node --test engine/envcase-5386.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NAMES = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME', 'XAI_API_KEY', 'KOSMOS_AGENT_TOKEN', 'KOSMOS_BOARD_TOKEN_FILE',
  'GEMINI_API_KEY', 'GEMINI_CLI_HOME'];
const N = NAMES.join('|');
const PATTERNS = [
  ['a plain delete', new RegExp(`\\bdelete\\s+(?!process\\.env\\b)[\\w$.]+(\\.(${N})\\b|\\[\\s*['"](${N})['"]\\s*\\])`)],
  ['a set by assignment', new RegExp(`(?<![\\w$.])(?!process\\b)[A-Za-z_$][\\w$]*\\.(${N})\\s*=(?!=)`)],
  ['a set beside a spread', new RegExp(`\\.\\.\\.process\\.env\\s*,[^}]*\\b(${N})\\s*:`)],
  ['a set by Object.assign', new RegExp(`Object\\.assign\\(\\s*\\{\\s*\\}\\s*,\\s*process\\.env\\s*,[^)]*\\b(${N})\\s*:`)],
];

/* Lines of source with comments blanked (line numbers kept), each matched against every pattern. */
function exactCaseSites(name, src) {
  const out = [];
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').forEach((raw, i) => {
    const l = raw.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
    for (const [what, rx] of PATTERNS) if (rx.test(l)) out.push(name + ':' + (i + 1) + ' ' + what + ': ' + l.trim());
  });
  return out;
}
const MODULES = fs.readdirSync(__dirname).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js')).sort();

test('#5386: no engine module deletes or sets an account-scoped name on an env copy by its exact spelling', () => {
  assert.ok(MODULES.length > 100, 'the scan found only ' + MODULES.length + ' modules (moved folder?)');
  assert.ok(MODULES.includes('win32env.js') && MODULES.includes('create.js'), 'the scan is not reading engine/');
  const hits = MODULES.flatMap((f) => exactCaseSites(f, fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.deepEqual(hits, [], 'use envDelete/envSet (engine/win32env.js):\n' + hits.join('\n'));
});

test('#5386: each pattern form is caught, and a comment or a process.env read is not (controls)', () => {
  const caught = (l) => exactCaseSites('x.js', l).length;
  assert.equal(caught('  delete env.CLAUDE_CONFIG_DIR;'), 1);
  assert.equal(caught("  delete out['XAI_API_KEY'];"), 1);
  assert.equal(caught('  if (dir) env.CODEX_HOME = String(dir);'), 1);
  assert.equal(caught('  const env = { ...process.env, GROK_HOME: spot.dir };'), 1);
  assert.equal(caught('  Object.assign({}, process.env, o.h ? { CODEX_HOME: o.h } : {});'), 1);
  assert.equal(caught('  // delete env.CLAUDE_CONFIG_DIR is the bug'), 0, 'a // comment');
  assert.equal(caught('/* it builds its env and\n   delete env.CLAUDE_CONFIG_DIR */'), 0, 'a block comment');
  assert.equal(caught('  if (env.CODEX_HOME === x) return;'), 0, 'a comparison is a read');
  assert.equal(caught('  process.env.CODEX_HOME = dir;'), 0, 'process.env is case-insensitive on Windows');
});

test('#5386: the scan finds the real sites in the code before this card (control on main\'s own files)', (t) => {
  let src;
  try { src = execFileSync('git', ['-C', path.join(__dirname, '..'), 'show', 'origin/main~0:engine/subscription.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return t.skip('no origin/main in this checkout'); }
  if (/envDelete\(env, 'CLAUDE_CONFIG_DIR'\)/.test(src)) return t.skip('origin/main already carries this card');
  assert.ok(exactCaseSites('subscription.js', src).length >= 2, 'main\'s subscription.js delete and set were not flagged');
});

test('#5386: preWorldEnv drops the world and restores the roots whatever the inherited spelling', () => {
  const worlds = require('./worlds');
  const marker = JSON.stringify({ roots: { AGENT_WORKFORCE_DATA: '/pre/data' } });
  const out = worlds.preWorldEnv({ Kosmos_World: 'w2', kosmos_pre_world_roots: marker, Agent_Workforce_Data: '/w2/data', PATH: '/bin' });
  const upper = Object.keys(out).map((k) => k.toUpperCase());
  assert.equal(upper.filter((k) => k === 'KOSMOS_WORLD').length, 0, 'a world variable survived: ' + Object.keys(out).join(','));
  assert.equal(upper.filter((k) => k === 'KOSMOS_PRE_WORLD_ROOTS').length, 0, 'the marker survived');
  assert.deepEqual(Object.keys(out).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA'), ['AGENT_WORKFORCE_DATA']);
  assert.equal(out.AGENT_WORKFORCE_DATA, '/pre/data', 'the recorded root came back');
  assert.equal(out.PATH, '/bin');
});
