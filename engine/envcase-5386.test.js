'use strict';
/**
 * kosmos#5386: engine modules that copy process.env for a child remove and set account-scoped names through
 * engine/win32env.js, so an inherited spelling (Claude_Config_Dir, Codex_Home, xai_api_key) cannot survive a plain
 * delete or sit beside the new value. A copy keeps names as spelled; on Windows any one of them is the variable the
 * child reads. Reads of process.env itself are not flagged: Windows looks those up case-insensitively.
 *
 * The scan covers EVERY non-test module in engine/, so a new site cannot hide by not being on a list. It is a regex
 * scanner, not a parser. What it cannot see: a name built at runtime (env[name]); code after a `/*` or `//` that sits
 * inside a string (comment stripping blanks it); a nested receiver (opts.env.CODEX_HOME = x); a spread or
 * Object.assign of anything but process.env, or one split across lines; a quoted key ({ ...process.env, 'CODEX_HOME':
 * x }) or a key after a nested {...} in one. What it over-flags: any object's property of these names
 * (opts.CODEX_HOME = x), which here is always an env; rename the property if that ever stops being true.
 * It covers only the names in NAMES below: a NEW account-scoped or world name must be added there to be guarded.
 *
 *   node --test engine/envcase-5386.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NAMES = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME', 'XAI_API_KEY', 'KOSMOS_AGENT_TOKEN', 'KOSMOS_BOARD_TOKEN_FILE',
  'GEMINI_API_KEY', 'GEMINI_CLI_HOME',
  // #1704's world bleed: the world, its marker and the three roots (engine/worlds.js WORLD_ROOT_ENV_VARS)
  'KOSMOS_WORLD', 'KOSMOS_PRE_WORLD_ROOTS', 'AGENT_WORKFORCE_DATA', 'AGENT_WORKFORCE_PROJECTS', 'AGENT_WORKFORCE_WORKERS',
  // other credentials and identities a child must get from exactly one place (no exact-spelling site exists today)
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AGENT_WORKFORCE_HOME', 'KOSMOS_AGENT_SESSION', 'KOSMOS_BOARD_TOKEN'];
const N = NAMES.join('|');
const PATTERNS = [
  ['a plain delete', new RegExp(`\\bdelete\\s+(?!process\\.env\\b)[\\w$.]+(\\.(${N})\\b|\\[\\s*['"](${N})['"]\\s*\\])`)],
  ['a set by assignment', new RegExp(`(?<![\\w$.])(?!process\\b)[A-Za-z_$][\\w$]*\\.(${N})\\s*=(?!=)`)],
  ['a compound assignment', new RegExp(`(?<![\\w$.])(?!process\\b)[A-Za-z_$][\\w$]*\\.(${N})\\s*(\\|\\||\\?\\?|&&)=`)],
  ['a world name by constant key', /\b(delete\s+(?!process\.env\b)[\w$.]+\[\s*([\w$]+\.)?(PRE_WORLD_ROOTS_ENV_VAR|WORLD_ENV_VAR)\s*\]|(?<![\w$.])(?!process\b)[A-Za-z_$][\w$]*\[\s*([\w$]+\.)?(PRE_WORLD_ROOTS_ENV_VAR|WORLD_ENV_VAR)\s*\]\s*=(?!=))/],
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
  assert.equal(caught('  env.CODEX_HOME ??= dir;'), 1, 'a compound assignment');
  assert.equal(caught('  delete env[worlds.PRE_WORLD_ROOTS_ENV_VAR];'), 1, 'a world name by constant key');
  assert.equal(caught('  env[launchidentity.WORLD_ENV_VAR] = id;'), 1);
  assert.equal(caught('  const env = { ...process.env }; delete env.KOSMOS_WORLD;'), 1, 'the #1704 world bleed');
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

/* The world tests drive the Windows arm (where two spellings are one variable) from any host. */
function worldTest(name, fn) {
  test(name, (t) => {
    const worlds = require('./worlds');
    worlds.setWorldCaseFoldPlatformForTests('win32');
    try { return fn(t); } finally { worlds.setWorldCaseFoldPlatformForTests(null); }
  });
}

test('#5386: on a Mac or Linux a differently spelled world name in a copy is a different variable, left alone', () => {
  const worlds = require('./worlds');
  worlds.setWorldCaseFoldPlatformForTests('darwin');
  try {
    const out = worlds.preWorldEnv({ agent_workforce_home: '/x', kosmos_pre_world_roots: '{"roots":{}}', PATH: '/bin' });
    assert.equal(out.AGENT_WORKFORCE_HOME, undefined, 'a lowercase variable was promoted into the store home');
    assert.equal(out.agent_workforce_home, '/x');
    assert.equal(out.kosmos_pre_world_roots, '{"roots":{}}', 'a lowercase variable was read as the marker');
  } finally { worlds.setWorldCaseFoldPlatformForTests(null); }
});

worldTest('#5386: preWorldEnv drops the world and restores the roots whatever the inherited spelling', () => {
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

worldTest('#5386: applyAgentWorldEnv reads an oddly spelled world marker on a copy, and restores the roots', () => {
  const worlds = require('./worlds');
  const marker = JSON.stringify({ world: 'other', roots: { AGENT_WORKFORCE_DATA: '/pre/data' } });
  const env = { kosmos_pre_world_roots: marker, Agent_Workforce_Data: '/other/data', PATH: '/bin' };
  worlds.applyAgentWorldEnv(env);   // a default-world copy: restore the originals, apply nothing
  assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA'), ['AGENT_WORKFORCE_DATA']);
  assert.equal(env.AGENT_WORKFORCE_DATA, '/pre/data', 'the other world\'s root was kept');
  assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === 'KOSMOS_PRE_WORLD_ROOTS').length, 0);
});

worldTest('#5386: a named world applied to a copy derives from, records and restores an oddly spelled data root', () => {
  const worlds = require('./worlds');
  const env = { KOSMOS_WORLD: 'w2', Agent_Workforce_Data: '/sandbox/data', AGENT_WORKFORCE_HOME: '/h', PATH: '/bin' };
  worlds.applyAgentWorldEnv(env);
  const data = Object.keys(env).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA');
  assert.deepEqual(data, ['AGENT_WORKFORCE_DATA'], 'one data root key: ' + data.join(','));
  assert.ok(env.AGENT_WORKFORCE_DATA.startsWith('/sandbox/data'), 'the world hangs off the sandbox root: ' + env.AGENT_WORKFORCE_DATA);
  assert.equal(JSON.parse(env.KOSMOS_PRE_WORLD_ROOTS).roots.AGENT_WORKFORCE_DATA, '/sandbox/data', 'the marker recorded the root');
  assert.equal(worlds.preWorldEnv(env).AGENT_WORKFORCE_DATA, '/sandbox/data', 'leaving the world gives the root back');
});

worldTest('#5386: preWorldEnv with no marker leaves one spelling of each root', () => {
  const worlds = require('./worlds');
  const out = worlds.preWorldEnv({ Agent_Workforce_Data: 'C:\\a', PATH: '/bin' });
  assert.deepEqual(Object.keys(out).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA'), ['AGENT_WORKFORCE_DATA']);
  const over = Object.assign(out, { AGENT_WORKFORCE_DATA: 'C:\\w' });   // how worldWorkersDir lays a world's override over it
  assert.deepEqual(Object.keys(over).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA'), ['AGENT_WORKFORCE_DATA'], 'two spellings after an override');
});

worldTest('#5386: applyActiveWorldEnv given a copy (straight into applyWorldEnv) keeps one spelling and records the root', () => {
  const os = require('node:os');
  const worlds = require('./worlds');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'envcase-5386-'));
  try {
    const w = worlds.createWorld(base, 'probe');
    worlds.setActiveWorld(base, w.id);
    const env = { Agent_Workforce_Data: '/sandbox/data', PATH: '/bin' };
    worlds.applyActiveWorldEnv(env, base);
    assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'AGENT_WORKFORCE_DATA'), ['AGENT_WORKFORCE_DATA']);
    assert.equal(JSON.parse(env.KOSMOS_PRE_WORLD_ROOTS).roots.AGENT_WORKFORCE_DATA, '/sandbox/data', 'the marker recorded the root');
    assert.equal(env.KOSMOS_WORLD, w.id);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
