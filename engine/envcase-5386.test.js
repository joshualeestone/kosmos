'use strict';
/**
 * kosmos#5386: engine modules that copy process.env for a child remove and set account-scoped names through
 * engine/win32env.js, so an inherited spelling (Claude_Config_Dir, Codex_Home, xai_api_key) cannot survive a plain
 * delete or sit beside the new value. A copy keeps names as spelled; on Windows any one of them is the variable the
 * child reads. Reads of process.env itself are not flagged: Windows looks those up case-insensitively.
 *
 * The scan covers EVERY non-test module in engine/, so a new site cannot hide by not being on a list. It is a regex
 * scanner, not a parser. What it cannot see: a name built at runtime (env[name]); code after a `/*` or `//` that sits
 * inside a string (comment stripping blanks it). What it over-flags: any object's property of these names
 * (opts.CODEX_HOME = x), which here is always an env; rename the property if that ever stops being true.
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
  ['a set by bracket', new RegExp(`(?<![\\w$.])(?!process\\b)[A-Za-z_$][\\w$]*\\[\\s*['"](${N})['"]\\s*\\]\\s*=(?!=)`)],
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
  assert.equal(caught("  env['CLAUDE_CONFIG_DIR'] = dir;"), 1);
  assert.equal(caught("  if (env['CODEX_HOME'] === x) return;"), 0, 'a bracket comparison is a read');
  assert.equal(caught('  const env = { ...process.env, GROK_HOME: spot.dir };'), 1);
  assert.equal(caught('  Object.assign({}, process.env, o.h ? { CODEX_HOME: o.h } : {});'), 1);
  assert.equal(caught('  // delete env.CLAUDE_CONFIG_DIR is the bug'), 0, 'a // comment');
  assert.equal(caught('/* it builds its env and\n   delete env.CLAUDE_CONFIG_DIR */'), 0, 'a block comment');
  assert.equal(caught('  if (env.CODEX_HOME === x) return;'), 0, 'a comparison is a read');
  assert.equal(caught('  process.env.CODEX_HOME = dir;'), 0, 'process.env is case-insensitive on Windows');
});

/* Lines as they stood on main before this card (2026-10-07), pinned so this control stays armed after it merges. */
const BEFORE = [
  "  delete env.KOSMOS_AGENT_TOKEN;",
  "  if (dir) env.CODEX_HOME = String(dir);",
  "    if (configDir) env.CLAUDE_CONFIG_DIR = configDir; else delete env.CLAUDE_CONFIG_DIR;",
  "  const env = { ...process.env, GROK_HOME: spot.dir };",
  "  delete env.XAI_API_KEY;",
  "    env: { ...process.env, CODEX_HOME: spot.dir },",
  "    child = spawn(bin, args, { env: { ...process.env, CODEX_HOME: spot.dir }, stdio: ['ignore', 'pipe', 'pipe'] });",
  "  env.CODEX_HOME = accountDir;",
  "    delete env.KOSMOS_BOARD_TOKEN_FILE;   // never a stale one inherited from the launcher",
  "    if (tokenFile) env.KOSMOS_BOARD_TOKEN_FILE = tokenFile;",
  "      || Object.assign({}, process.env, o.codexHome ? { CODEX_HOME: String(o.codexHome) } : {});",
];

test('#5386: every site this card fixed, as it stood before, is flagged (control)', () => {
  const missed = BEFORE.filter((l) => exactCaseSites('before.js', l).length === 0);
  assert.deepEqual(missed, [], 'the scan no longer sees a site it was written for');
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

test('#5386: applyAgentWorldEnv reads an oddly spelled world marker on a copy, and restores the roots', () => {
  const worlds = require('./worlds');
  const marker = JSON.stringify({ world: 'other', roots: { AGENT_WORKFORCE_DATA: '/pre/data' } });
  const env = { kosmos_pre_world_roots: marker, Agent_Workforce_Data: '/other/data', PATH: '/bin' };
  worlds.applyAgentWorldEnv(env);   // a default-world copy: restore the originals, apply nothing
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA'), ['AGENT_WORKFORCE_DATA']);
  assert.equal(env.AGENT_WORKFORCE_DATA, '/pre/data', 'the other world\'s root was kept');
  assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === 'KOSMOS_PRE_WORLD_ROOTS').length, 0);
});
