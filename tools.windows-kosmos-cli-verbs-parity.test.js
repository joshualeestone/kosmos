'use strict';
/**
 * win32-cli-verbs (convention 5): every verb Kosmos teaches an agent exists in the
 * Windows agent's `kosmos` (tools/windows/kosmos-cli.js), and the Windows command
 * and the Mac one (install/kosmos) have the same verbs and subcommands.
 *
 * 🛑 WHY THIS EXISTS. BLOCKER 5 was fixed for reply/msg/post/react, and the Windows
 * command then shipped without `task message` (in every task notification),
 * `feedback write` (taught daily) and `room reopen`, and with `reply --help`
 * SENDING "--help". Nothing tied what agents are told to what the command does.
 *
 * 🔑 IT ASSERTS THE SHAPE, NOT A COUNT. The Mac's verbs and subcommands are read
 * out of install/kosmos itself; the Windows ones are the CLI's dispatch tables;
 * the taught ones are extracted from every source and from the texts agents are
 * actually given. A verb the Mac gains, a subcommand either side gains, or a
 * `kosmos <verb>` newly taught anywhere is red here until Windows implements it
 * (or, for a board verb a PERSON runs, until someone deliberately says so below).
 *
 *   node --test tools.windows-kosmos-cli-verbs-parity.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Sandbox the data root BEFORE any store-using require (repo convention 2):
   engine/messages.js freezes store.ROOT, and its colleagues block is rendered below. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-verbs-parity-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
// #4632: the ready-made roles are downloaded; sandbox the data root and store the signed fixture
// first, so the every-role verb sweep below covers the catalogue's roles too.
require('./test-support/catalogue-fixture').sandboxWithCatalogue('win-cli-verbs');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const REPO = __dirname;
const MAC_CLI = fs.readFileSync(path.join(REPO, 'install', 'kosmos'), 'utf8');

/* The Mac verbs Windows does not have, ON PURPOSE, each with the reason. They run
   or report on the BOARD, which on Windows is Kosmos.exe and its logon task, and
   they are taught to the person (recovery toasts, README), never to an agent: the
   last test below holds the agent-facing texts to that. Adding a verb here is a
   decision, not a way to make this file green. */
const PERSON_ONLY_VERBS = {
  start: 'starts the board; on Windows Kosmos.exe does (audit #47)',
  stop: 'stops the board; on Windows Task Scheduler ends it (audit #7)',
  restart: 'restarts the board; on Windows, double-click Kosmos.exe again (audit #18)',
  status: 'whether the board runs; the Windows board answers in the browser',
  open: 'opens the dashboard; Kosmos.exe does',
  agents: 'lists tmux agents for a person at a terminal',
  version: 'the bundle version; the Windows zip carries it in manifest.json',
  adopt: 'one-time tmux adoption (#570), which has no Windows arm (audit #39)',
};

// ── what the Mac command has, read out of install/kosmos ────────────────────

/* The verbs of the final top-level `case "${1:-}" in` dispatch. */
function macVerbsFromDispatch(text) {
  const start = text.lastIndexOf('\ncase "${1:-}" in\n');
  assert.ok(start >= 0, 'install/kosmos has no top-level `case "${1:-}" in` dispatch any more; this test reads its verbs from there');
  const block = text.slice(start, text.indexOf('\nesac', start));
  return [...block.matchAll(/^ {2}([a-z]+)\)/gm)].map((m) => m[1]);
}

/* The verbs its help lists: #4785 made it one row per command (`printf '  kosmos start   start Kosmos...'`)
   inside kosmos_command_list(), where it had been one `kosmos start | stop | ...` line. */
function macVerbsFromBanner(text) {
  const open = text.indexOf('\nkosmos_command_list() {\n');
  assert.ok(open >= 0, 'install/kosmos has no kosmos_command_list() any more; this test reads the help\'s verbs from there');
  const body = text.slice(open, text.indexOf('\n}\n', open));
  const verbs = [...body.matchAll(/^\s*printf '  kosmos ([a-z]+) /gm)].map((m) => m[1]);
  assert.ok(verbs.length > 0, 'kosmos_command_list() lists no `kosmos <verb>` rows');
  return verbs;
}

/* A verb's subcommands: the arms of every `case "$sub" in` / `case "${1:-}" in` in
   its cmd_<verb>() (arms one level in only, so a nested flag case is not read), plus
   a literal `[ "$x" = "word" ]` or `!=` compare on the FIRST ARGUMENT: `$sub`, or a
   variable set from `${1:-}` / `$1` (how cmd_room spots `reopen`, cmd_community
   `post`). #4330: any variable at all read cmd_community's `[ "$status" = "held" ]`,
   the board's answer, as a subcommand. */
function macSubcommands(text, verb) {
  const open = text.indexOf('\ncmd_' + verb + '() {\n');
  if (open < 0) return [];
  const body = text.slice(open, text.indexOf('\n}\n', open));
  const subs = new Set();
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const c = /^(\s*)case "(?:\$sub|\$\{1:-\})" in\b(.*)$/.exec(lines[i]);
    if (!c) continue;
    const armIndent = c[1] + '  ';
    for (let j = i + 1; j < lines.length && !new RegExp('^' + c[1] + 'esac\\b').test(lines[j]); j++) {
      if (!lines[j].startsWith(armIndent) || /^\s/.test(lines[j].slice(armIndent.length))) continue;
      const arm = /^([^\s)]+)\)/.exec(lines[j].slice(armIndent.length));
      /* #4474: a subcommand may carry a hyphen (`agent role-draft`); a `-`-led arm (`-h`, `--help`) is still a flag. */
      if (arm) for (const word of arm[1].split('|')) if (/^[a-z][a-z_-]*$/.test(word) && word !== 'help') subs.add(word);
    }
  }
  const firstArg = new Set(['sub', ...[...body.matchAll(/\b([A-Za-z_]+)="\$(?:\{1:-\}|1)"/g)].map((m) => m[1])]);
  for (const m of body.matchAll(/\[ "\$([A-Za-z_]+)" !?= "([a-z][a-z_-]*)" \]/g)) if (firstArg.has(m[1])) subs.add(m[2]);
  return [...subs];
}

/* Verbs that refuse a first argument that is not one of their subcommands. */
function macSubcommandRequired(text) {
  return new Set([...text.matchAll(/Unknown: kosmos ([a-z]+) \$sub\b/g)].map((m) => m[1]));
}

const MAC_VERBS = macVerbsFromDispatch(MAC_CLI);
const WIN_VERBS = cli.VERBS;
const WIN_SUBS = (verb) => new Set(cli.SUBCOMMANDS[verb] || []);
const ALL_VERBS = new Set([...MAC_VERBS, ...WIN_VERBS]);
const sorted = (xs) => [...xs].sort();

/* Run the Windows command with nothing real behind it: every request and every
   engine module is a recorder, so a dispatch can be observed without a board. */
async function runWindows(argv) {
  const calls = [];
  const out = [];
  const err = [];
  const stubEngine = {
    feedback: { write: () => ({ ok: true }), today: () => '2026-09-12', isDateKey: () => true, readBody: () => 'body', list: () => [], reportsForTriage: () => ({ ok: true, reports: [], notes: [] }) },
    'feedback-triage': { digestFor: () => 'digest' },
    feedbackpull: { pull: async () => ({ ok: false, because: 'stub' }) },
  };
  const code = await cli.main(argv, {
    env: {},
    url: 'http://127.0.0.1:1',
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => null, agentToken: () => null },
    fetch: async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{}' }; },
    engine: stubEngine,
    readStdin: () => ({ text: '', ended: true }),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

// ── the two commands agree ───────────────────────────────────────────────────

test('install/kosmos\'s dispatch and its help banner list the same verbs (the source this test reads)', () => {
  assert.deepEqual(sorted(MAC_VERBS), sorted(macVerbsFromBanner(MAC_CLI)));
});

test('every Mac verb Windows lacks is a declared person-only verb, and every declared one really is missing', () => {
  const missing = MAC_VERBS.filter((v) => !WIN_VERBS.includes(v));
  assert.deepEqual(sorted(missing), sorted(Object.keys(PERSON_ONLY_VERBS)),
    'a Mac verb is missing from tools/windows/kosmos-cli.js: implement it there, or (only for a verb a person runs against the board) add it to PERSON_ONLY_VERBS with the reason');
});

test('reverse: every Windows verb exists on the Mac', () => {
  assert.deepEqual(WIN_VERBS.filter((v) => !MAC_VERBS.includes(v)), [], 'the Windows command has a verb install/kosmos does not');
});

test('every shared verb has the same subcommands on both, in both directions', () => {
  for (const verb of WIN_VERBS) {
    assert.deepEqual(sorted(WIN_SUBS(verb)), sorted(macSubcommands(MAC_CLI, verb)), 'kosmos ' + verb + ': the Windows and Mac subcommands differ');
  }
});

test('the parser really reads subcommands (a guard that cannot find any would pass everything)', () => {
  assert.deepEqual(sorted(macSubcommands(MAC_CLI, 'task')), ['add', 'assign', 'built', 'close', 'hold', 'list', 'message', 'unhold']);   // built: #3951; hold, unhold: #4771; assign: #4914
  assert.deepEqual(sorted(macSubcommands(MAC_CLI, 'room')), ['reopen']);
  assert.ok(macSubcommands(MAC_CLI, 'feedback').includes('write'));
  assert.deepEqual(sorted(macSubcommands(MAC_CLI, 'community')), ['comment', 'follow', 'post', 'read', 'unfollow'], 'the first-argument compare is not read, or a board answer ($status) is');   // #4330; read: #4373; comment: #4373 part B; follow, unfollow: #4774
});

test('the verbs that require a subcommand are the same on both (Windows by behaviour)', async () => {
  const windowsRequired = new Set();
  for (const verb of WIN_VERBS) {
    const r = await runWindows([verb, 'no-such-subcommand', 'x']);
    if (new RegExp('^Unknown: kosmos ' + verb + ' no-such-subcommand').test(r.err)) windowsRequired.add(verb);
  }
  assert.deepEqual(sorted(windowsRequired), sorted(macSubcommandRequired(MAC_CLI)));
});

// ── the table is the dispatch, and --help never sends ───────────────────────

test('every Windows verb and subcommand is dispatched: none answers "Unknown" or the verb list', async () => {
  for (const verb of WIN_VERBS) {
    for (const argv of [[verb], ...[...WIN_SUBS(verb)].map((s) => [verb, s])]) {
      const r = await runWindows(argv);
      assert.doesNotMatch(r.err, /^Unknown:|^Usage: kosmos </, 'kosmos ' + argv.join(' ') + ' is not dispatched: ' + r.err);
    }
  }
});

test('#1674: --help and -h on every verb and subcommand print that verb\'s usage, exit 0, and send NOTHING', async () => {
  for (const verb of WIN_VERBS) {
    assert.equal(typeof cli.USAGE[verb], 'string', 'kosmos ' + verb + ' has no usage text for --help to print');
    for (const sub of WIN_SUBS(verb)) assert.ok(cli.USAGE[verb].includes('kosmos ' + verb + ' ' + sub), 'the usage for kosmos ' + verb + ' does not name ' + sub);
    for (const flag of cli.HELP_FLAGS) {
      for (const argv of [[verb, flag], [verb, 'some words', flag], ...[...WIN_SUBS(verb)].map((s) => [verb, s, 'p1', '1', flag])]) {
        const r = await runWindows(argv);
        assert.equal(r.calls.length, 0, 'kosmos ' + argv.join(' ') + ' SENT a request');
        assert.equal(r.code, 0, 'kosmos ' + argv.join(' '));
        assert.equal(r.out, cli.USAGE[verb]);
      }
    }
  }
});

// ── what Kosmos teaches ──────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude', 'test-support']);
/* #4478: other test files run BESIDE this one and make throwaway files in the tree (server.test.js's
   `.probe-freshness-<pid>/x.js` and server.engine-restart-4408.test.js's `.probe-restart-<pid>/x.js`, #4408),
   so a folder or file listed here can be gone by the time it is
   read. Gone is skipped: a file that no longer exists teaches nobody a verb (a symlink to a missing FILE reads
   as gone too, for the same reason; one to a missing folder is not a directory to the walk, so it is read and
   skipped the same way). Only ENOENT; anything else (a permission error, an
   EISDIR from reading a folder as a file) still fails the test. */
const gone = (e) => Boolean(e && e.code === 'ENOENT');
function listIfThere(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (gone(e)) return []; throw e; }
}
function readIfThere(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (gone(e)) return null; throw e; }
}
function sourceFiles(dir, acc) {
  for (const e of listIfThere(dir)) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (!e.name.endsWith('.test.js') && (/\.(js|md|sh|ps1|html|txt)$/.test(e.name) || p === path.join(REPO, 'install', 'kosmos'))) acc.push(p);
  }
  return acc;
}

/* `kosmos <verb> [<word>]` as written, and as built from the resolved command
   (`${cliShown} task add`, `cli + ' msg`, `kosmosCliShown() + ' post`), which
   the plain spelling never shows. */
const TAUGHT_PATTERNS = [
  /\bkosmos ([a-z][a-z_-]*)(?: ([a-z][a-z_-]*))?/g,
  /(?:\$\{(?:cli|cliShown)\}|\b(?:cli|cliShown|kosmosCliShown\(\))\s*\+\s*') ([a-z][a-z_-]*)(?: ([a-z][a-z_-]*))?/g,
];
/* `everyWord`: count every word after `kosmos`, not only words that are a verb of
   one CLI or the other. The whole-tree scan cannot (its comments say "kosmos and",
   "kosmos is"); the texts agents are given can, and must, or a verb NEITHER command
   has (`kosmos handoff`) would be taught and pass unseen (review round 1). */
function taught(text, where, opts) {
  const everyWord = Boolean(opts && opts.everyWord);
  const found = [];
  for (const re of TAUGHT_PATTERNS) for (const m of text.matchAll(re)) if (everyWord || ALL_VERBS.has(m[1])) found.push({ verb: m[1], word: m[2] || '', where });
  return found;
}

/* What every listed file teaches. The whole-tree test and the #4478 race test both go through THIS loop,
   so the race test covers the scan's own read, not only the helpers (review round 1). */
function taughtIn(files, root) {
  const uses = [];
  for (const f of files) {
    const text = readIfThere(f);
    if (text !== null) uses.push(...taught(text, path.relative(root, f)));
  }
  return uses;
}

const REQUIRED = macSubcommandRequired(MAC_CLI);
function problemsWith(use) {
  if (!WIN_VERBS.includes(use.verb)) {
    return PERSON_ONLY_VERBS[use.verb] ? null : use.where + ': teaches kosmos ' + use.verb + ', which the Windows command does not have';
  }
  if (!use.word) return null;
  const isSubcommandSomewhere = WIN_SUBS(use.verb).has(use.word) || macSubcommands(MAC_CLI, use.verb).includes(use.word);
  if ((isSubcommandSomewhere || REQUIRED.has(use.verb)) && !WIN_SUBS(use.verb).has(use.word)) {
    return use.where + ': teaches kosmos ' + use.verb + ' ' + use.word + ', which the Windows command does not have';
  }
  return null;
}

test('every kosmos verb and subcommand named anywhere in the tree is one the Windows command has (or a person-only board verb)', () => {
  const uses = [];
  uses.push(...taughtIn(sourceFiles(REPO, []), REPO));
  assert.ok(uses.some((u) => u.verb === 'task' && u.word === 'message'), 'the scan did not see server.js\'s task notification; it is not reading what it claims to');
  assert.ok(uses.some((u) => u.verb === 'task' && u.word === 'add' && u.where.includes('projects.js')), 'the scan did not see the `${cliShown} task add` line');
  assert.deepEqual(uses.map(problemsWith).filter(Boolean), []);
});

test('#4478: a folder or file removed between the listing and the read is skipped; any other error is not', () => {
  const tmp = fs.mkdtempSync(path.join(SANDBOX, 'race-4478-'));
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.writeFileSync(path.join(tmp, 'sub', 'x.js'), '// kosmos msg\n');
  const listed = sourceFiles(tmp, []);
  assert.deepEqual(listed.map((f) => path.relative(tmp, f)), [path.join('sub', 'x.js')], 'CONTROL: the file is listed while it exists');
  fs.rmSync(path.join(tmp, 'sub'), { recursive: true, force: true });   // what server.test.js does beside this file
  assert.equal(readIfThere(listed[0]), null, 'a file gone before its read must be skipped, not throw');
  /* Through the scan's own loop: a vanished file among real ones is skipped and the real ones are still read. */
  const kept = path.join(tmp, 'kept.js');
  fs.writeFileSync(kept, '// kosmos msg\n');
  const uses = taughtIn([listed[0], kept], tmp);
  assert.deepEqual(uses.map((u) => u.where + ':' + u.verb), ['kept.js:msg'], 'the scan loop did not skip the vanished file, or did not read the one that exists');
  assert.deepEqual(sourceFiles(path.join(tmp, 'sub'), []), [], 'a folder gone before its walk must be skipped, not throw');
  /* Not every error is "gone": reading a folder as a file (EISDIR here) and walking a file as a folder (ENOTDIR)
     still fail. Asserted as "any code but ENOENT", not the exact code: this file also runs on Windows (review
     round 4), where the code for the same mistake has not been measured. */
  assert.throws(() => readIfThere(tmp), (e) => Boolean(e && e.code && e.code !== 'ENOENT'));
  assert.throws(() => sourceFiles(kept, []), (e) => Boolean(e && e.code && e.code !== 'ENOENT'));
});

test('the texts agents are actually given name only verbs the Windows command has: no person-only verb, no missing subcommand', () => {
  const texts = [
    ['engine/defaults.js block()', require('./engine/defaults').block()],
    ['engine/messages.js blockBody()', require('./engine/messages').blockBody()],
    ['engine/communityblock.js blockBody()', require('./engine/communityblock').blockBody()],
    ...require('./engine/roles').ROLES.map((r) => ['engine/roles.js ' + r.key, r.instructions]),
  ];
  const uses = texts.flatMap(([where, text]) => taught(String(text), where, { everyWord: true }));
  assert.ok(uses.some((u) => u.verb === 'feedback' && u.word === 'write'), 'the roles were not read (feedback write is taught there)');
  assert.ok(uses.some((u) => u.verb === 'community' && u.word === 'read' && u.where.includes('communityblock')), 'the community block was not read (community read is taught there)');
  const problems = uses.map((u) => (PERSON_ONLY_VERBS[u.verb] ? u.where + ': teaches an agent the person-only kosmos ' + u.verb : problemsWith(u))).filter(Boolean);
  assert.deepEqual(problems, []);
});

test('#4632 premise: the verb sweep covers the downloaded catalogue roles', () => {
  assert.ok(require('./engine/roles').byKey('cmo'), 'the catalogue fixture is not merged, so the sweep covers only the built-in roles');
});
