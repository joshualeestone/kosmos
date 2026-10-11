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

test('#5774 route 3: imports are read as Claude Code reads them (#, escaped spaces, the path shapes); code and comments in a paragraph are not, in a list item they are', () => {
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
  // Review 3: a list item's raw text (its code spans and comments) is scanned by Claude Code, and this does not model
  // lists, so code and comments are scanned everywhere: the result is a superset, never a subset.
  // Review 5: a superset by design, so the test names what MUST be there and what must NOT.
  for (const w of [path.join(dir, 'a.md'), path.join(dir, 'b.md,'), '/h/c.md,', '/abs/d.md', path.join(dir, 'j.md'),
    path.join(dir, 'my file.md'), path.join(dir, 'indented.md')]) assert.ok(got.includes(w), `${w} missing from ${JSON.stringify(got)}`);
  // Review 7: in a PARAGRAPH, code (spans, fences) and comments are skipped by Claude Code, so they are not imports here
  // either (the raw pass reads list items only).
  for (const n of ['e.md', 'f.io', 'inline.md', 'inline.md`', 'comment.md', 'fenced.md', 'tilde-fenced.md']) assert.ok(!got.some((g) => path.basename(g) === n), `${n} read as an import: ${JSON.stringify(got)}`);
  assert.deepStrictEqual(si.importsIn('Example:\n\n```\nnpx tsx @src/index.ts\n@dataclass\n```\n', f, home), [], 'a top-level fenced example');
  // The cases review 3 measured in 2.1.296: list items scan code spans and comments.
  for (const [line, want] of [['- run `claude @notes.md --x` first', 'notes.md'], ['- see <!-- @hidden.md --> here', 'hidden.md'], ['1. step `cat @one.md | x`', 'one.md']]) {
    assert.ok(si.importsIn(line, f, home).includes(path.join(dir, want)), line);
  }
  // A fence opened inside a list item and never closed does not hide what follows.
  assert.ok(si.importsIn('- step one:\n  ```bash\n  run x\n- step two\n\n@./important.md\n', f, home).includes(path.join(dir, 'important.md')));
});

test('#5774 route 3: imports nest to the depth Claude Code loads (the root is 0, depth 5 is refused); a cycle ends', () => {
  const d = path.join(SANDBOX, 'chain');
  fs.mkdirSync(d, { recursive: true });
  const names = ['root', 'a', 'b', 'c', 'd', 'e'];
  names.slice(0, -1).forEach((n, i) => fs.writeFileSync(path.join(d, `${n}.md`), `@${names[i + 1]}.md\n`));
  fs.writeFileSync(path.join(d, 'e.md'), '@root.md\n');
  const r = si.importTargets([path.join(d, 'root.md')], { home: HOME });
  const baseNames = (fs_) => [...new Set(fs_.map((f) => path.basename(f)))].sort();   // a target may come by two spellings (the folder as given and its real one)
  assert.deepStrictEqual(baseNames(r.files), ['a.md', 'b.md', 'c.md', 'd.md'], 'd (depth 4) is loaded, so it is a target; its own import (depth 5) is not');
  // A cycle (x imports y imports x) ends, and nothing is named.
  fs.writeFileSync(path.join(d, 'x.md'), '@y.md\n'); fs.writeFileSync(path.join(d, 'y.md'), '@x.md\n');
  const c = si.importTargets([path.join(d, 'x.md')], { home: HOME });
  assert.deepStrictEqual(baseNames(c.files), ['y.md']);
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

test('#5774 route 3 review 1: emphasis and link marks are edges; a stray backtick or a comment mark in code does not hide imports; non-text files are not imports', () => {
  const f = path.join(SANDBOX, 'r1', 'CLAUDE.md');
  const dir = path.dirname(f);
  const got = si.importsIn([
    'see **@em.md** and *@it.md* and _@us.md_ and [@link.md](https://x)',
    'a stray ` backtick here',
    '',
    'a later paragraph: @after-stray.md',
    'code `<!--` here, then @after-comment-mark.md and a later --> mark',   // the import sits BETWEEN the span and the -->
    '@pic.png and @data.bin are not text; @noext and @UPPER.MD and @script.sh are',
    '',
    'a lone ` then @span-len.md and a double `` mark (a span closes only on a run of the same length)',
  ].join('\n'), f, '/h');
  const want = ['em.md', 'it.md', 'us.md', 'link.md', 'after-stray.md', 'after-comment-mark.md', 'pic.png', 'data.bin', 'noext', 'UPPER.MD', 'script.sh', 'span-len.md'];
  // importsIn returns every import Claude Code PARSES (a superset); whether it is read as text is the walk's question (below).
  const names = new Set(got.map((p) => path.basename(p)));
  for (const w of want) assert.ok(names.has(w), `${w} missing from ${[...names]}`);
  const d = path.join(SANDBOX, 'r1ext');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'root.md'), '@pic.png @noext @UPPER.MD @script.sh\n');
  const r = si.importTargets([path.join(d, 'root.md')], { home: HOME });
  assert.deepStrictEqual([...new Set(r.files.map((p) => path.basename(p)))].sort(), ['UPPER.MD', 'noext', 'script.sh'], 'a non-text import is not read, so not a target');
});

test('#5774 route 3 review 1: an import past 256 KB is read (Claude Code reads to 4 MB); a larger file is skipped; the read cap counts files read, not absent roots', () => {
  const d = path.join(SANDBOX, 'r1big');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'big.md'), 'x '.repeat(200 * 1024) + '\n@late.md\n');   // about 400 KB
  assert.deepStrictEqual(si.importTargets([path.join(d, 'big.md')], { home: HOME }).files.map((p) => path.basename(p)).filter((n, i, a) => a.indexOf(n) === i), ['late.md']);
  fs.writeFileSync(path.join(d, 'huge.md'), '@huge-import.md\n' + 'x'.repeat(4194304));
  assert.deepStrictEqual(si.importTargets([path.join(d, 'huge.md')], { home: HOME }).files, [], 'Claude Code skips a file over 4 MB, and its imports');
  const absent = Array.from({ length: 50 }, (_, i) => path.join(d, `absent-${i}.md`));
  const one = si.importTargets([...absent, path.join(d, 'big.md')], { home: HOME, maxFiles: 3 });
  assert.deepStrictEqual(one.unsafe, [], 'absent roots spent the cap');
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, `real-${i}.md`), 'nothing\n');
  const five = si.importTargets(Array.from({ length: 5 }, (_, i) => path.join(d, `real-${i}.md`)), { home: HOME, maxFiles: 3 });
  assert.equal(five.unsafe.length, 1, 'a scan past the cap is named');
});

test('#5774 route 3 review 1: a linked instruction file\'s imports resolve from where it really is; a connected agent\'s own imports are its own', () => {
  // A home with no link above it (the sandbox sits under /var, itself a link).
  const base = path.join(fs.realpathSync.native(SANDBOX), 'r1link');
  const A = path.join(base, 'A'), B = path.join(base, 'B');
  fs.mkdirSync(A, { recursive: true }); fs.mkdirSync(B, { recursive: true });
  fs.writeFileSync(path.join(A, 'CLAUDE.md'), '@./x.md\n');
  fs.symlinkSync(path.join(A, 'CLAUDE.md'), path.join(B, 'CLAUDE.md'));
  const r = si.importTargets([path.join(B, 'CLAUDE.md')], { home: HOME });
  assert.ok(r.files.includes(path.join(A, 'x.md')), `the real folder's x.md: ${JSON.stringify(r.files)}`);
  // A connected agent (its folder outside the agents' folder): its CLAUDE.md is its own, so what it imports stays its own.
  const repo = path.join(SANDBOX, 'repo-r1');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'See @README.md and @package.json\n');
  touch(path.join(repo, 'README.md'));
  const g = setup.guardTokenOnlyFolder(repo, 'pilot-connected-r1', { ...DEPS, env: ENV0 });
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(repo);
  for (const n of ['README.md', 'package.json']) {
    assert.ok(!editDeniedBy(s.permissions.deny, path.join(repo, n)).length, `${n} denied to a connected agent`);
    assert.ok(!sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(repo, n)), `${n} in denyWrite`);
  }
});

test('#5774 route 3 review 2: a target in a store gets the store\'s one rule, never its hashed name; a read-only target is not listed (its link is)', () => {
  const store = path.join(fs.realpathSync.native(SANDBOX), 'store-r2');
  const hashed = path.join(store, 'h1abc-CLAUDE.md');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(hashed, '@./x.md\n');
  const homeMd = path.join(HOME, '.claude-acct', 'CLAUDE.md');
  fs.rmSync(homeMd, { force: true }); fs.symlinkSync(hashed, homeMd);
  const ro = path.join(SANDBOX, 'ro-r2', 'ro.md');
  touch(ro);
  const roReal = fs.realpathSync.native(ro);
  const linkRo = path.join(HOME, 'notes-r2', 'linkro.md');
  fs.mkdirSync(path.dirname(linkRo), { recursive: true }); fs.rmSync(linkRo, { force: true }); fs.symlinkSync(ro, linkRo);
  const anc = path.join(SANDBOX, 'CLAUDE.md');
  fs.writeFileSync(anc, `@${ro}\n@${linkRo}\n`);
  try {
    const d = agentDir('pilot-store-r2');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-store-r2', { ...DEPS, env: ENV0, storeRoots: [store], readOnlyTarget: (t) => t === roReal });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(d);
    const deny = s.permissions.deny, dw = s.sandbox.filesystem.denyWrite;
    assert.ok(![...deny, ...dw].some((r) => r.includes(path.join('store-r2', 'x.md'))), 'a hashed store path was listed by name');
    assert.ok(editDeniedBy(deny, path.join(store, 'h9-new.md')).length > 0, 'the store, file tools');
    assert.ok(sandboxDenies(dw, path.join(store, 'h9-new.md')), 'the store, sandbox');
    // Review 3: for a CLAUDE.md that is itself a link, the folder as given is a different file nobody loads: not named.
    assert.ok(!deny.includes(`Edit(${'/' + path.join(HOME, '.claude-acct', 'x.md')})`), 'the linked file\'s folder as given was named');
    assert.ok(![...deny, ...dw].some((r) => r.includes('ro-r2')), 'a read-only target was listed');
    assert.ok(editDeniedBy(deny, linkRo).length > 0, 'the link to a read-only target, which can be replaced');
  } finally { for (const f of [homeMd, anc, linkRo]) fs.rmSync(f, { force: true }); }
});

test('#5774 route 3 review 2: an import inside an agent folder that is a link (or dangles) has where it leads denied; sibling CLAUDE.local.md and rules, and a folder-above rules file, are roots', () => {
  const workers = path.join(SANDBOX, 'workers');
  const sib = path.join(workers, 'sib-l2');
  const elsewhere = path.join(SANDBOX, 'elsewhere-r2');
  touch(path.join(elsewhere, 'notes.md'));
  fs.mkdirSync(sib, { recursive: true });
  for (const [l, t] of [['notes.md', path.join(elsewhere, 'notes.md')], ['dang.md', path.join(elsewhere, 'gone', 'dang.md')]]) {
    fs.rmSync(path.join(sib, l), { force: true }); fs.symlinkSync(t, path.join(sib, l));
  }
  const made = [path.join(sib, 'CLAUDE.md'), path.join(sib, 'CLAUDE.local.md'), path.join(sib, '.claude', 'rules', 'deep', 'r.md'), path.join(SANDBOX, '.claude', 'rules', 'a.md')];
  const bodies = ['@notes.md @dang.md\n', `@${path.join(elsewhere, 'from-local.md')}\n`, `@${path.join(elsewhere, 'from-rules.md')}\n`, `@${path.join(elsewhere, 'from-anc-rules.md')}\n`];
  made.forEach((f, i) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bodies[i]); });
  try {
    const d = agentDir('pilot-links-r2');
    assert.equal(setup.guardTokenOnlyFolder(d, 'pilot-links-r2', { ...DEPS, env: ENV0 }).ok, true);
    const s = readSettings(d);
    const elsewhereR = fs.realpathSync.native(elsewhere);   // a link's destination is named by its real path, as withTarget does
    for (const t of ['notes.md', path.join('gone', 'dang.md'), 'from-local.md', 'from-rules.md', 'from-anc-rules.md'].map((n) => path.join(elsewhereR, n))) {
      assert.ok(editDeniedBy(s.permissions.deny, t).length > 0, `${t}: file tools`);
      assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, t), `${t}: sandbox`);
    }
  } finally { for (const f of made) fs.rmSync(f, { force: true }); }
});

test('#5774 route 3 review 3: a connected agent\'s own .claude rules, the managed rules and a sibling named ..x are roots; a too-wide store is named; a rules walk past its budget is named', () => {
  const write = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  const elsewhere = path.join(SANDBOX, 'elsewhere-r3');
  const repo = path.join(SANDBOX, 'repo-r3');
  write(path.join(repo, '.claude', 'rules', 'style.md'), `@${path.join(elsewhere, 'style.md')}\n`);
  write(path.join(repo, 'CLAUDE.md'), '@README.md\n');
  const managedRule = path.join(MANAGED, '.claude', 'rules', 'm.md');
  write(managedRule, `@${path.join(elsewhere, 'managed-rule.md')}\n`);
  try {
    const g = setup.guardTokenOnlyFolder(repo, 'pilot-connected-r3', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(repo);
    const er = fs.realpathSync.native(SANDBOX);
    for (const n of ['style.md', 'managed-rule.md']) assert.ok(editDeniedBy(s.permissions.deny, path.join(er, 'elsewhere-r3', n)).length > 0, `${n}: what a denied rules file imports`);
    assert.ok(!editDeniedBy(s.permissions.deny, path.join(repo, 'README.md')).length, 'the connected agent\'s own CLAUDE.md import was denied');
  } finally { fs.rmSync(managedRule, { force: true }); }
  // A sibling whose folder name starts with ".." is still an agent folder: one glob, not a name.
  const odd = path.join(SANDBOX, 'workers', '..odd-r3');
  write(path.join(odd, 'CLAUDE.md'), 'ask @-pinged here\n');
  try {
    const d = agentDir('pilot-dotdot-r3');
    setup.guardTokenOnlyFolder(d, 'pilot-dotdot-r3', { ...DEPS, env: ENV0 });
    const deny = readSettings(d).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join(SANDBOX, 'workers', 'any', '-pinged')).length > 0, 'the glob');
    assert.ok(!deny.some((r) => r.includes(path.join('..odd-r3', '-pinged'))), 'named per agent');
  } finally { fs.rmSync(path.join(odd, 'CLAUDE.md'), { force: true }); }
  // A store root that holds the agent's own folder is too wide to deny whole: named.
  const homeMd = path.join(HOME, '.claude', 'CLAUDE.md');
  write(homeMd, `@${path.join(SANDBOX, 'wide-r3', 'x.md')}\n`);
  try {
    const d = agentDir('pilot-widestore-r3');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-widestore-r3', { ...DEPS, env: ENV0, storeRoots: [fs.realpathSync.native(SANDBOX)] });
    assert.equal(g.ok, false);
    // The import's own reason (part 2's shell files can name the same store too, so match this one by its path).
    assert.ok(JSON.stringify(g).includes(path.join('wide-r3', 'x.md') + ' (an import that leads into'), JSON.stringify(g));
  } finally { fs.rmSync(homeMd, { force: true }); }
  // A rules walk past its budget is named, never silently short.
  for (let i = 0; i < 4; i++) fs.mkdirSync(path.join(HOME, '.claude', 'rules', `sub${i}`), { recursive: true });
  try {
    const d = agentDir('pilot-rulesbudget-r3');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-rulesbudget-r3', { ...DEPS, env: ENV0, rulesWalkBudget: 2 });
    assert.equal(g.ok, false);
    assert.ok(JSON.stringify(g).includes('rules folders'), JSON.stringify(g));
  } finally { fs.rmSync(path.join(HOME, '.claude', 'rules'), { recursive: true, force: true }); }
});

test('#5774 route 3 review 4: a link in the middle of an import\'s chain is denied; a store root the rules cannot carry is named; the text extensions are 2.1.296\'s', () => {
  assert.equal(si.TEXT_EXTS.size, 106, '2.1.296 lists 107, one of them ".R", which the lowercased lookup makes the same as ".r"');
  const base = fs.realpathSync.native(SANDBOX);
  const dots = path.join(base, 'dots-r4');
  fs.mkdirSync(dots, { recursive: true });
  fs.writeFileSync(path.join(dots, 'c.md'), 'end\n');
  for (const [l, t] of [[path.join(dots, 'b.md'), path.join(dots, 'c.md')], [path.join(base, 'notes-r4', 'a.md'), path.join(dots, 'b.md')]]) {
    fs.mkdirSync(path.dirname(l), { recursive: true }); fs.rmSync(l, { force: true }); fs.symlinkSync(t, l);
  }
  const homeMd = path.join(HOME, '.claude', 'CLAUDE.md');
  // A store root the rules cannot carry: every path under it carries the same character, so the target's own check
  // names it (present) or skips it (absent) before any store rule is built. Present here.
  touch(path.join(base, 'st (r4)', 'h1-x.md'));
  fs.writeFileSync(homeMd, `@${path.join(base, 'notes-r4', 'a.md')}\n@${path.join(base, 'st\\ (r4)', 'h1-x.md')}\n`);   // a space in an import is written \\ 
  try {
    const d = agentDir('pilot-hops-r4');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-hops-r4', { ...DEPS, env: ENV0, storeRoots: [path.join(base, 'st (r4)')] });
    const said = JSON.stringify(g);
    assert.ok(said.includes('h1-x.md (a file an instruction file imports, whose path the permission rules cannot carry)'), said);
    assert.ok(!readSettings(d).permissions.deny.some((r) => r.includes('st (r4)')), 'a rule the syntax cannot carry was written');
    const deny = readSettings(d).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join(dots, 'b.md')).length > 0, 'the middle link');
    assert.ok(editDeniedBy(deny, path.join(dots, 'c.md')).length > 0, 'the end');
  } finally { fs.rmSync(homeMd, { force: true }); }
});

test('#5774 route 3 review 5: an @ just after any token edge is an import, cut where the token ends; the strips are linear', () => {
  const f = path.join(SANDBOX, 'r5', 'CLAUDE.md');
  const dir = path.dirname(f);
  for (const [line, want] of [['see <b>@x1.md</b>', 'x1.md'], ['press <kbd>K</kbd>@x2.md', 'x2.md'], ['a [link](u)@x3.md', 'x3.md'],
    ['an ![img](i.png)@x4.md', 'x4.md'], ['esc \\#@x5.md', 'x5.md'], ['auto <http://a>@x6.md', 'x6.md'], ['plain @x8.md', 'x8.md'], ['**b**@x9.md', 'x9.md']]) {
    assert.ok(si.importsIn(line, f, '/h').includes(path.join(dir, want)), `${line}: ${JSON.stringify(si.importsIn(line, f, '/h'))}`);
  }
  assert.deepStrictEqual(si.importsIn('mail me@f.io or x@e.md', f, '/h'), [], 'a letter before the @ is not an edge');
  assert.deepStrictEqual(si.importsIn('install `@playwright/mcp` first', f, '/h'), [], 'an opening backtick before the @ is never an edge');
  // Review 6: punctuation inside one text token is not an edge (marked's text runs on through / : and merges neighbours).
  for (const line of ['see https://x.com/@user', 'a/@b.md', 'node_modules/@types/node', 'key:@x.md']) assert.deepStrictEqual(si.importsIn(line, f, '/h'), [], line);
  // Agent-written text cannot stall the guard: an unclosed comment opener repeated, and backtick runs of many lengths.
  // Review 6: inputs large enough that a quadratic strip takes tens of seconds, so a generous bound (3 s) survives a
  // loaded machine and still fails on the old forms (about 28 s and 6 s at these sizes).
  let t0 = Date.now();
  si.proseOf('<!--'.repeat(200000));
  assert.ok(Date.now() - t0 < 3000, `comments: ${Date.now() - t0} ms`);
  t0 = Date.now();
  si.proseOf(Array.from({ length: 3000 }, (_, i) => '`'.repeat(i + 1) + ' x ').join(''));
  assert.ok(Date.now() - t0 < 3000, `code spans: ${Date.now() - t0} ms`);
});

test('#5774 route 3 review 5: a link on the way, or a store reached through one, the rules cannot carry is named and the rest written', () => {
  const base = fs.realpathSync.native(SANDBOX);
  const odd = path.join(base, 'Drop (r5)');
  fs.mkdirSync(odd, { recursive: true });
  touch(path.join(base, 'real-r5.md'));
  const mk = (l, t) => { fs.mkdirSync(path.dirname(l), { recursive: true }); fs.rmSync(l, { force: true }); fs.symlinkSync(t, l); };
  mk(path.join(odd, 'link2.md'), path.join(base, 'real-r5.md'));
  mk(path.join(base, 'notes-r5', 'a.md'), path.join(odd, 'link2.md'));                       // a hop in an odd folder
  const store = path.join(odd, 'Cellar', 'pkg', '1');
  touch(path.join(store, 'n.md'));
  mk(path.join(base, 'notes-r5', 'b.md'), path.join(store, 'n.md'));                          // a Cellar reached through a link
  const homeMd = path.join(HOME, '.claude', 'CLAUDE.md');
  fs.writeFileSync(homeMd, `@${path.join(base, 'notes-r5', 'a.md')}\n@${path.join(base, 'notes-r5', 'b.md')}\n`);
  try {
    const d = agentDir('pilot-oddhop-r5');
    const g = setup.guardTokenOnlyFolder(d, 'pilot-oddhop-r5', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false, 'not whole');
    const said = JSON.stringify(g);
    assert.ok(said.includes('link2.md (a link on the way'), said);
    assert.ok(said.includes('(a store or Cellar'), said);
    assert.ok(fs.existsSync(path.join(d, '.claude', 'settings.json')), 'the rest of the guard was not written');
    const s = readSettings(d);
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(odd, 'Cellar', 'pkg', '2', 'n.md')), 'the sandbox keeps the Cellar');
    assert.ok(editDeniedBy(s.permissions.deny, path.join(base, 'real-r5.md')).length > 0, 'the end of the chain');
  } finally { fs.rmSync(homeMd, { force: true }); }
});

test('#5774 route 3 review 7: a chain that starts inside an agent folder has its middle link denied; an uncarriable target in another agent folder is named', () => {
  const base = fs.realpathSync.native(SANDBOX);
  const workers = path.join(SANDBOX, 'workers');
  const sib = path.join(workers, 'sib-r7');
  fs.mkdirSync(sib, { recursive: true });
  touch(path.join(base, 'y-r7', 'real.md'));
  const mk = (l, t) => { fs.mkdirSync(path.dirname(l), { recursive: true }); fs.rmSync(l, { force: true }); fs.symlinkSync(t, l); };
  mk(path.join(base, 'x-r7', 'hop.md'), path.join(base, 'y-r7', 'real.md'));
  mk(path.join(sib, 'imp.md'), path.join(base, 'x-r7', 'hop.md'));
  try {
    fs.writeFileSync(path.join(sib, 'CLAUDE.md'), '@./imp.md\n');
    const d = agentDir('pilot-chain-r7');
    assert.equal(setup.guardTokenOnlyFolder(d, 'pilot-chain-r7', { ...DEPS, env: ENV0 }).ok, true);
    const deny = readSettings(d).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join(base, 'x-r7', 'hop.md')).length > 0, 'the middle link');
    assert.ok(editDeniedBy(deny, path.join(base, 'y-r7', 'real.md')).length > 0, 'the end');
    // An existing target inside ANOTHER agent folder whose path the rules cannot carry: named, never dropped silently.
    touch(path.join(workers, 'other-r7', 'odd (1).md'));
    mk(path.join(sib, 'imp2.md'), path.join(workers, 'other-r7', 'odd (1).md'));
    fs.writeFileSync(path.join(sib, 'CLAUDE.md'), '@./imp2.md\n');
    const d2 = agentDir('pilot-oddsib-r7');
    const g = setup.guardTokenOnlyFolder(d2, 'pilot-oddsib-r7', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, false, 'not whole');
    assert.ok(JSON.stringify(g).includes('odd (1).md (a file an instruction file imports'), JSON.stringify(g));
  } finally { fs.rmSync(path.join(sib, 'CLAUDE.md'), { force: true }); }
});

test('#5774 route 3 review 9: an import shaped like the guard\'s own globs never becomes a wildcard rule; an escaped backtick is text; a list line inside a top-level fence is code; a bare folder name is no rule', () => {
  const f = path.join(SANDBOX, 'r9', 'CLAUDE.md');
  const dir = path.dirname(f);
  assert.ok(si.importsIn('Use \\`@x.md\\` here.', f, '/h').includes(path.join(dir, 'x.md')), 'an escaped backtick is not a code span');
  assert.deepStrictEqual(si.importsIn('Example:\n\n```\n- @docs/x.md\n- npx @scope/tool\n```\n', f, '/h'), [], 'list lines inside a top-level fence');
  assert.ok(si.importsIn('- item\n  ```\n  - @in-list.md\n  ```\n', f, '/h').includes(path.join(dir, 'in-list.md')), 'a fence inside a list item is still raw text');
  const write = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  const sib = path.join(SANDBOX, 'workers', 'sib-r9', 'CLAUDE.md');
  const homeMd = path.join(HOME, '.claude', 'CLAUDE.md');
  const wild = ['- edit files under @src/** only', '- or @lib/* and @a/*/b.md and @conf/.* too', '- see @src please'].join('\n') + '\n';
  write(sib, wild);
  write(homeMd, '- keep @notes/** tidy\n');
  try {
    const d = agentDir('pilot-wild-r9');
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });   // a folder named src in an agent's folder
    const g = setup.guardTokenOnlyFolder(d, 'pilot-wild-r9', { ...DEPS, env: ENV0 });
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(d).permissions.deny;
    for (const t of [path.join(d, 'src', 'index.ts'), path.join(d, 'lib', 'x.js'), path.join(d, 'a', 'q', 'b.md'), path.join(d, 'conf', '.env'), path.join(HOME, '.claude', 'notes', 'n.md')]) {
      assert.ok(!editDeniedBy(deny, t).length, `${t} denied by an import-shaped wildcard: ${JSON.stringify(editDeniedBy(deny, t))}`);
    }
  } finally { fs.rmSync(sib, { force: true }); fs.rmSync(homeMd, { force: true }); }
});
