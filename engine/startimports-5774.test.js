'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5774 route 3: the token-only guard denies the files Claude Code's instruction files IMPORT (`@path`), which it
 * reads as instructions at every start wherever they sit, following imports as Claude Code 2.1.296 does. The
 * tests assert the CONFIG WRITTEN, as the #4491, #5516 and parts 1 and 2 tests do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'startimports-5774-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');

fs.mkdirSync(store.ROOT, { recursive: true });
const HOME = process.env.AGENT_WORKFORCE_HOME;
const MANAGED = path.join(SANDBOX, 'managed');
// The launch-PATH part is pinned empty, as in configstart-5516.test.js, so this host's PATH is not read.
const LAUNCH_PIN = { panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [] };
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), managedDir: MANAGED, managedPrefsDir: null, ...LAUNCH_PIN };   // review 19: no real managed preferences read in tests

function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function writeJson(file, j) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2)); }
function touch(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '#!/bin/sh\n'); }
/* Whether ANY Edit rule in a deny list covers path p, by Claude Code's rule shape (copied from configstart-5516.test.js,
   review 9 there: a control that looks for one literal rule cannot see a glob that denies the same path). */
function editDeniedBy(deny, p) {
  const abs = path.resolve(p);
  return deny.filter((r) => {
    const m = /^Edit\((.*)\)$/.exec(r);
    if (!m) return false;
    const pat = m[1].replace(/^\/\//, '/');
    const re = '^' + pat.split(/(\*\*|\*)/).map((t) => (t === '**' ? '.*' : t === '*' ? '[^/]*' : t.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('') + '(/.*)?$';
    return new RegExp(re).test(abs);
  });
}
function realOrLeaf(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { /* absent: climb, as the production helper does (review 22) */ }
  let dir = path.dirname(abs); const tail = [path.basename(abs)];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...tail); } catch { /* climb */ }
    const parent = path.dirname(dir); if (parent === dir) return abs;
    tail.unshift(path.basename(dir)); dir = parent;
  }
}
/* Whether the sandbox's denyWrite covers p (a listed path, or a folder above it). */
function sandboxDenies(dw, p) { const r = realOrLeaf(p); return dw.some((d) => r === d || r.startsWith(d + path.sep)); }

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude-acct'), { recursive: true });

const ENV0 = {};   // no ZDOTDIR, BASH_ENV or ENV unless a test sets one
// The Homebrew-style folders, pinned to the sandbox so this host's own are not read (review 3).
const USERDIRS = [path.join(SANDBOX, 'brew', 'share', 'zsh', 'site-functions'), path.join(SANDBOX, 'brew', 'share', 'fish', 'vendor_conf.d')];
DEPS.userShellDirs = USERDIRS;
DEPS.homebrewPrefixes = [];   // review 12: this host's own Homebrew is not read either (tests that need one pass theirs)
const si = require('./startimports');

test('#5774 route 3: imports are read as Claude Code reads them (code, comments, #, escaped spaces, the path shapes)', () => {
  const f = path.join(SANDBOX, 'p', 'CLAUDE.md');
  const home = '/h';
  const got = si.importsIn([
    '@a.md and @./b.md, @~/c.md, @/abs/d.md',
    'mid-word x@e.md and an email me@f.io are not imports; nor @@g or @#h or @(i) or a lone @/',
    'run `cat @inline.md` is code (a space before the @, so only the code span keeps it out); <!-- @comment.md --> is a comment',
    '```',
    '@fenced.md',
    '```',
    '~~~md',
    '@tilde-fenced.md',
    '~~~',
    '@j.md#section and @my\\ file.md',
    '    @indented.md is read (the safe direction)',
  ].join('\n'), f, home);
  const dir = path.dirname(f);
  // Every non-space character is part of the path, punctuation too: Claude Code reads `@./b.md,` as an import of "b.md,".
  assert.deepStrictEqual(got.sort(), [path.join(dir, 'a.md'), path.join(dir, 'b.md,'), '/h/c.md,', '/abs/d.md', path.join(dir, 'j.md'),
    path.join(dir, 'my file.md'), path.join(dir, 'indented.md')].sort());
});

test('#5774 route 3: imports nest to the depth Claude Code loads (the root is 0, depth 5 is refused); a cycle ends', () => {
  const d = path.join(SANDBOX, 'chain');
  fs.mkdirSync(d, { recursive: true });
  const names = ['root', 'a', 'b', 'c', 'd', 'e'];
  names.slice(0, -1).forEach((n, i) => fs.writeFileSync(path.join(d, `${n}.md`), `@${names[i + 1]}.md\n`));
  fs.writeFileSync(path.join(d, 'e.md'), '@root.md\n');
  const r = si.importTargets([path.join(d, 'root.md')], { home: HOME });
  assert.deepStrictEqual(r.files.map((f) => path.basename(f)).sort(), ['a.md', 'b.md', 'c.md', 'd.md'], 'd (depth 4) is loaded, so it is a target; its own import (depth 5) is not');
  // A cycle (x imports y imports x) ends, and nothing is named.
  fs.writeFileSync(path.join(d, 'x.md'), '@y.md\n'); fs.writeFileSync(path.join(d, 'y.md'), '@x.md\n');
  const c = si.importTargets([path.join(d, 'x.md')], { home: HOME });
  assert.deepStrictEqual(c.files.map((f) => path.basename(f)), ['y.md']);
  assert.deepStrictEqual(c.unsafe, []);
});

test('#5774 route 3: what each instruction file imports is denied: config home, folder above, managed (both layers); inside agents\' folders by one glob per name', () => {
  const write = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  const homeMd = path.join(HOME, '.claude', 'CLAUDE.md');
  const shared = path.join(HOME, 'notes', 'shared.md');
  const ancMd = path.join(SANDBOX, 'CLAUDE.md');   // a folder above every agent folder here
  const managedMd = path.join(MANAGED, 'CLAUDE.md');
  const sib = path.join(SANDBOX, 'workers', 'sib-r3', 'CLAUDE.md');
  const made = [homeMd, shared, ancMd, managedMd, sib];
  write(homeMd, '# home\n@~/notes/shared.md\n@./rules/inner.md\n');
  write(shared, 'shared, which imports @deep.md\n');
  write(ancMd, '@./anc-shared.md\n');
  write(managedMd, `@${path.join(SANDBOX, 'managed-shared.md')}\n`);
  write(sib, 'Josh @-mentions you in the room.\n');
  try {
    const d = agentDir('pilot-imports');
    write(path.join(d, 'CLAUDE.md'), '@./own-import.md\n');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-imports', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(d);
    const deny = s.permissions.deny, dw = s.sandbox.filesystem.denyWrite;
    for (const t of [shared, path.join(HOME, 'notes', 'deep.md'), path.join(SANDBOX, 'anc-shared.md'), path.join(SANDBOX, 'managed-shared.md')]) {
      assert.ok(editDeniedBy(deny, t).length > 0, `${t}: file tools`);
      assert.ok(sandboxDenies(dw, t), `${t}: sandbox`);
    }
    // Inside a folder denied whole (a config home's rules): left to that rule, not named again.
    assert.ok(editDeniedBy(deny, path.join(HOME, '.claude', 'rules', 'inner.md')).length > 0, 'the rules folder covers it');
    assert.ok(!deny.some((r) => r.includes('inner.md')), 'named again inside a folder denied whole');
    // Inside the agents' folder: one glob per name (a sibling's "@-mentions", the agent's own import), never a name per agent.
    const workers = path.join(SANDBOX, 'workers');
    for (const t of [path.join(workers, 'sib-r3', '-mentions'), path.join(workers, 'another', '-mentions'), path.join(d, 'own-import.md')]) {
      assert.ok(editDeniedBy(deny, t).length > 0, `${t}: the glob`);
    }
    assert.ok(![...deny, ...dw].some((r) => r.includes(path.join('sib-r3', '-mentions'))), 'a name per agent');
  } finally { for (const f of made) fs.rmSync(f, { force: true }); }
});

test('#5774 route 3: an import the rules cannot carry is named when it exists (the rest still written) and skipped when absent', () => {
  const homeMd = path.join(HOME, '.claude-acct', 'CLAUDE.md');
  const odd = path.join(HOME, 'odd (r3)', 'a.md');
  fs.writeFileSync(homeMd, '@~/odd\\ (r3)/a.md\n');
  try {
    const d1 = agentDir('pilot-oddabsent');
    assert.equal(setup.guardTokenOnlyFolder(d1, 'pilot-oddabsent', { ...DEPS, env: ENV0 }).ok, true, 'an absent one made the guard not whole');
    touch(odd);
    const d2 = agentDir('pilot-oddthere');
    const g = setup.guardTokenOnlyFolder(d2, 'pilot-oddthere', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false, 'not whole');
    const said = JSON.stringify(g);
    assert.ok(said.includes('odd (r3)') && said.includes('cannot carry'), said);
    assert.ok(fs.existsSync(path.join(d2, '.claude', 'settings.json')), 'the rest of the guard was not written');
  } finally { fs.rmSync(homeMd, { force: true }); fs.rmSync(path.dirname(odd), { recursive: true, force: true }); }
});
