'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9203 (follow-up to #9188): engine/markwords.js usesListMarkWord is a hand-built list of the task list's mark
 * words, and #9188's review rounds 1 to 3 each found marks it missed. Nothing kept it complete: a mark added to a
 * printer later would be forgeable by a task's own title until someone added its words by hand.
 *
 * This renders a row for every mark state through the REAL printers (engine/tasklist.js compactLines and acrossLines,
 * the Windows CLI taskList with a stub context, and install/kosmos's long list, its own node program lifted out of the
 * script and fed the same JSON the board sends). Each row's title is a sentinel; everything else on the row is split
 * into its bracket and parenthesis groups, and every group, set in the MIDDLE of a title, must be caught by
 * usesListMarkWord. Two groups are allowed through, on purpose: the row's own label "[N]", and the owner's bare names
 * "(otto)" (a name has no fixed word; #9201 catches it where it could forge an owner, at the END of a title).
 *
 * What is left of a row once its groups are out must be the printer's fixed columns, so a mark printed without
 * brackets is caught too (review 1).
 *
 * The second test keeps the first honest: every field a printer reads must be set by some fixture, and every helper a
 * printer calls with the task must be inside the source read. A read is found as `x.<field>` or `x?.<field>`, as a
 * helper's own parameter wherever x is passed to it (in any position, destructured or not), as destructuring
 * (`const { f } = x`), and one level
 * down for an object field (`x.subtasks.<name>`, or through a name for it: `const u = x && x.onHoldUntil; u.task`).
 * The row loops must call the task x (checked). A qualified call that passes the task (`mod.fn(x)`) is reported as a
 * helper outside the source read, so a module helper that reads the task goes red until its source is read here too. A read written any other way (a computed `x[k]`, a second alias of an
 * alias, a helper reached only through another helper's renamed parameter) is not seen.
 * NOT COVERED, stated (review 1): a new mark on a new VALUE of a field the fixtures already set (builtWaitingOn ===
 * 'deploy'). No field scan can see a value; only a fixture with that value can. Lines without the title (done when,
 * still to finish, the fingerprint) are not checked: a title is folded onto one line, so it can never start one.
 * A group is checked whole: a new word added INSIDE a group that already has a mark word ("(last activity today;
 * zebra crossing)") passes. Splitting groups on commas would turn harmless parts red ("1 dropped", "next Monday"), and a
 * title passes for the group only by carrying its known word too. The wake mark's words ("[waits for ...]") come from
 * the board (engine/taskwake.js, which always starts them "waits until" or "waits for"), not from the printer; the
 * fixture uses the board's form.
 * Rows are matched to fixtures by order (every printer keeps the board's order); a printer that sorted would give a
 * false red here, never a false pass.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-listmarks-render-9203.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-listmarks-render-9203-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const tasklist = require('./engine/tasklist');
const markwords = require('./engine/markwords');
const cli = require('./tools/windows/kosmos-cli');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const T = 'ZQZTITLE';   // the sentinel title: no mark word, so every printer prints it as it is
const BUILT = '2026-11-20T10:00:00.000Z';
const FP = 'sha256:' + 'a'.repeat(64);
/* One fixture per mark state. Every printer gets every fixture (the printers do not filter, they render what the
   board sent), so a field set here reaches every printer that reads it. */
const FIXTURES = [
  {},                                                                   // open, nobody on it
  { whoNames: ['otto'] },
  { whoNames: ['otto', 'mara'], addedVia: 'process', addedBy: 'ruth' },
  { addedVia: 'process', addedBy: 'mara' },
  { ownerNames: ['mara'], ownerFrom: 3 },
  { addedVia: 'webhook', addedBy: 'hook' },
  { addedVia: 'webhook', addedBy: 'hook', whoNames: ['otto'] },
  { isClosed: true, closedHow: 'change' },
  { isClosed: true, replacedBy: 9 },
  { isClosed: true, closedUnrun: true },
  { onHold: true },
  { onHold: true, onHoldUntil: { task: 4 } },
  { onHold: true, onHoldUntil: { at: '2099-01-01 09:00' }, onHoldByPerson: true, onHoldForPerson: true, projectPaused: true, builtAt: BUILT },
  { onHold: true, onHoldUntil: { at: '2000-01-01 09:00' }, holdUntilMet: true, onHoldByPerson: true, onHoldForPerson: true },
  { builtAt: BUILT },
  { builtAt: BUILT, builtWaitingOn: 'person', projectPaused: true, seenByPerson: '2026-11-21T10:00:00.000Z' },
  { builtAt: BUILT, builtWaitingOn: 'review', seenByPerson: null },
  { builtAt: BUILT, builtWaitingOn: 'release', builtByPerson: true, seenByPerson: null },
  { builtAt: BUILT, builtForCaller: false, projectPaused: true },
  { builtAt: BUILT, builtFingerprint: FP, builtFingerprintBy: 'otto', builtFiles: [{ fingerprint: FP }, { fingerprint: FP }], builtFilesAt: BUILT },
  { projectPaused: true },
  { parent: 2, subtasks: { done: 3, total: 5, built: 1, unrun: 1, held: 1 } },
  { repeatWords: 'every Monday', repeatNextWords: 'Monday 30 November' },
  { repeatNextWords: 'Monday 30 November' },
  { wakeWords: 'waits for #3 to merge' },
  { wakeMetWords: 'the branch moved' },
  { wakeMetWords: 'the branch moved', wakeToldAt: BUILT },
  { doneWhen: ['tests pass', 'the page loads'], doneWhenByPerson: true, doneWhenResults: [{ met: true, how: 'ran' }, { met: false, how: 'saw' }] },
  { doneWhen: ['tests pass'], doneWhenBy: 'mara' },
  { whoNames: ['otto', 'mara'], whoIsLeft: { left: ['otto'], finished: ['mara'] } },
  { lastActivityAt: '2026-11-20T10:00:00.000Z', leftUnder: 5 },
  { lastActivityAt: null },
  // Every row has a last activity (unless it says otherwise), so the --all and --mine rows print what each waits on.
].map((f, i) => ({ number: i + 1, sentence: T, projectId: 'p', lastActivityAt: '2026-11-26T10:00:00.000Z', ...f }));

/* ---- the printers ---- */
const NOW = Date.parse('2026-11-27T12:00:00.000Z');
function compactRows(state) {
  return tasklist.compactLines({ tasks: FIXTURES, count: FIXTURES.length, listState: tasklist.COMPACT[state] }, state, 'p').lines;
}
function acrossRows(flag, opts) {
  const group = flag === 'stale' ? 'open' : tasklist.COMPACT[flag];
  const body = { tasks: FIXTURES, listState: group, all: !opts.project, mine: opts.mine === true, quietDays: opts.days };
  return tasklist.acrossLines(body, flag, { now: NOW, ...opts }).lines;
}
async function windowsRows() {
  const out = [];
  const ctx = {
    call: async () => ({ reached: true, json: { tasks: FIXTURES, count: FIXTURES.length } }),
    refusedBy: () => null, unreachable: () => 1, out: (s) => out.push(s), err: (s) => out.push(s),
  };
  assert.equal(await cli.taskList(ctx, ['p']), 0, out.join('\n'));
  return out;
}
/* install/kosmos's long list is one inline node program (its only `KOSMOS_MARKWORDS=` line); it uses no single quote
   (it writes \x27), so the shell's '...' around it holds it whole. */
const KOSMOS_SRC = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
function macProgram() {
  const m = KOSMOS_SRC.match(/KOSMOS_MARKWORDS="\$\(kosmos_engine_module markwords\)\.js" "\$NODE" -e '([^']*)'/);
  assert.ok(m, 'install/kosmos long task list program not found: the test can no longer reach that printer');
  assert.match(m[1], /console\.log\("\["\+/, 'the program found is not the long task list');
  return m[1];
}
function macRows() {
  const out = execFileSync(process.execPath, ['-e', macProgram()], {
    input: JSON.stringify({ tasks: FIXTURES }),
    env: { ...process.env, KOSMOS_MARKWORDS: path.join(__dirname, 'engine', 'markwords.js') },
    encoding: 'utf8',
  });
  return out.split('\n');
}

/* ---- the groups ---- */
// The top-level bracket and parenthesis groups of a text, as written.
function groupsOf(text) {
  const groups = []; let depth = 0; let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' || c === '(') { if (depth === 0) start = i; depth++; }
    else if ((c === ']' || c === ')') && depth > 0) { depth--; if (depth === 0) groups.push(text.slice(start, i + 1)); }
  }
  return groups;
}
// The groups a row prints around its title, with the two allowed through (the row label, the owner's bare names).
function markGroups(row, x) {
  const at = row.indexOf(T);
  assert.ok(at >= 0, 'no title in row: ' + row);
  const before = row.slice(0, at); const after = row.slice(at + T.length);
  const owner = x.whoNames && x.whoNames.length ? '(' + x.whoNames.join(', ') + ')' : null;
  return groupsOf(before).filter((g, i) => !(i === 0 && /^\[(\d+|\?)\]$/.test(g) && before.startsWith(g)))
    .concat(groupsOf(after).filter((g) => g !== owner));
}

/* Review 1: a mark printed WITHOUT brackets would be invisible to the groups. So what is left of a row once its groups
   are taken out must be exactly the printer's fixed words: before the title, the compact and across lists' columns
   (project, #N, the state, the owner's names or "nobody") or nothing on a long list; after it, nothing but a webhook
   title's closing quote. */
function leftover(text) { let out = text; for (const g of groupsOf(text)) out = out.replace(g, ''); return out; }
const COLUMNS = /^(?:p {2})?#\d+ {2}(?:open|blocked|built) {2}(?:nobody|(?:otto|mara)(?:, (?:otto|mara))*) ?(?: {2})"?$/;
function unbracketed(label, row) {
  const at = row.indexOf(T);
  const before = leftover(row.slice(0, at)); const after = leftover(row.slice(at + T.length));
  const long = /long list/.test(label);
  const okBefore = long ? /^ ?"?$/.test(before.replace(/^\s+/, '')) : COLUMNS.test(before);
  const okAfter = /^"?\s*$/.test(after);
  return okBefore && okAfter ? null : label + ': words outside any bracket: before ' + JSON.stringify(before) + ', after ' + JSON.stringify(after) + '    (row: ' + row + ')';
}

async function everyRow() {
  const runs = [
    ...['open', 'blocked', 'built'].map((s) => ['compact --' + s, compactRows(s)]),
    ...['open', 'blocked', 'built'].map((s) => ['across --all --' + s, acrossRows(s, { project: '' })]),
    ...['open', 'blocked', 'built'].map((s) => ['across --mine --' + s, acrossRows(s, { project: 'p', mine: true })]),
    ['across --stale', acrossRows('stale', { project: '', days: 3 })],
    ['Windows long list', await windowsRows()],
    ['Mac long list', macRows()],
  ];
  const rows = [];
  for (const [label, lines] of runs) {
    const titled = lines.filter((l) => l.includes(T));
    assert.equal(titled.length, FIXTURES.length, label + ': expected one titled row per fixture:\n' + lines.join('\n'));
    titled.forEach((row, i) => rows.push({ label, row, x: FIXTURES[i] }));
  }
  return rows;
}

test('#9203 every mark the printers print, set in a title, is caught by usesListMarkWord', async () => {
  const rows = await everyRow();
  const missed = [];
  let checked = 0;
  for (const { label, row, x } of rows) {
    for (const g of markGroups(row, x)) {
      checked++;
      if (!markwords.usesListMarkWord('fix ' + g + ' now')) missed.push(label + ': ' + g + '    (row: ' + row + ')');
    }
    const loose = unbracketed(label, row);
    if (loose) missed.push(loose);
  }
  assert.deepEqual(missed, [], 'marks a title could print unquoted:\n' + missed.join('\n'));
  // The marks reached are real ones: these must all have been printed and checked somewhere.
  const seen = rows.map((r) => r.row).join('\n');
  for (const m of ['[done]', '[not run]', '[replaced by 9]', '[on hold]', '[project paused]', '[built, waiting on the person]',
    '[added by mara]', 'subtasks done', '[repeats every Monday', '[woke: the branch moved]', '(under task 2)', '(owner: mara',
    '(through #3)', 'outside text from webhook', 'still to finish', 'last activity', 'quiet ', 'left under closed task #5',
    'seen by the person since built', 'marked built by the person', 'only the person can lift it']) {
    assert.ok(seen.includes(m), 'no printer printed "' + m + '": a fixture stopped reaching its mark');
  }
  assert.ok(checked > 200, 'only ' + checked + ' groups checked');
});

test('#9203 the groups test can fail: an unknown mark, and the owner name outside its allowance, are reported', () => {
  const x = { whoNames: ['otto'] };
  assert.deepEqual(markGroups('[3] ' + T + ' (otto) [zebra crossing]', x), ['[zebra crossing]']);
  assert.equal(markwords.usesListMarkWord('fix [zebra crossing] now'), false);
  assert.deepEqual(markGroups('[3] ' + T + ' (mara)', x), ['(mara)'], 'a name that is not the owner is not allowed through');
  assert.deepEqual(markGroups('[3] [4] ' + T, {}), ['[4]'], 'only the row\'s own first label is allowed through');
});

/* ---- the fields ---- */
const ID = '[A-Za-z_$][\\w$]*';
const esc = (n) => n.replace(/\$/g, '\\$');
const GET = '\\??\\.';   // . or ?.
/* The names the task goes by in a piece of source: x (the row loop's name, pinned by the test below), and (reviews 2
   and 3) a helper's own parameter wherever x is passed to it, in ANY argument position: "function zebraOf(now, t)"
   called as zebraOf(now, x) reads the task as t. A destructured parameter ("({ zebra })") gives its fields directly. */
const splitTop = (str) => { const out = []; let d = 0; let cur = '';
  for (const c of str) { if ('{[('.includes(c)) d++; if ('}])'.includes(c)) d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c; }
  if (cur.trim()) out.push(cur); return out.map((a) => a.trim()); };
/* [name, argument index] for every call that passes x as a whole argument. Review 4: the argument list is read with
   balanced brackets (so "zebraOf(x, Date.now())" counts), and a qualified call ("zebra.zebraOf(x)") is kept with its
   whole dotted name, which is never defined in the source, so it is reported as a helper outside it. */
function callsWithX(src) {
  const out = [];
  for (const m of src.matchAll(new RegExp('(?<![\\w$])((?:' + ID + '\\s*\\.\\s*)*' + ID + ')\\s*\\(', 'g'))) {
    let d = 1; let i = m.index + m[0].length; const from = i;
    for (; i < src.length && d > 0; i++) { const c = src[i]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; }
    if (d !== 0) continue;
    const name = m[1].replace(/\s+/g, '');
    splitTop(src.slice(from, i - 1)).forEach((a, k) => { if (a === 'x') out.push([name, k]); });
  }
  return out;
}
function paramsOf(src, n) {
  const d = src.match(new RegExp('function\\s+' + esc(n) + '\\s*\\(([^)]*)\\)'))
    || src.match(new RegExp('(?:const|let)\\s+' + esc(n) + '\\s*=\\s*(?:function\\s*)?\\(([^)]*)\\)\\s*(?:=>|\\{)'))
    || src.match(new RegExp('(?:const|let)\\s+' + esc(n) + '\\s*=\\s*(' + ID + ')\\s*=>'));
  return d ? splitTop(d[1]) : null;
}
function taskNames(src) {
  const names = new Set(['x']);
  for (const [n, i] of callsWithX(src)) {
    const ps = paramsOf(src, n);
    const p = ps && ps[i] ? ps[i].replace(/=.*$/s, '').trim() : '';
    if (/^[A-Za-z_$][\w$]*$/.test(p)) names.add(p);
  }
  return [...names];
}
function destructuredParams(src) {
  const out = new Set();
  for (const [n, i] of callsWithX(src)) {
    const ps = paramsOf(src, n);
    const p = ps && ps[i] ? ps[i] : '';
    if (p.startsWith('{')) for (const part of splitTop(p.replace(/^\{|\}\s*(=.*)?$/gs, ''))) { const k = part.split(/[:=]/)[0].trim(); if (k) out.add(k); }
  }
  return out;
}
// <name>.<field> reads in a piece of source, for each name the task goes by: not part of a longer name (ctx.x.y does
// not count), with ?. too, and (review 2) destructuring: const { a, b: c } = x.
function fieldsRead(src) {
  const out = new Set();
  for (const n of taskNames(src)) {
    for (const m of src.matchAll(new RegExp('(?<![\\w$.])' + esc(n) + GET + '(' + ID + ')', 'g'))) out.add(m[1]);
    for (const m of src.matchAll(new RegExp('(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*' + esc(n) + '(?![\\w$])', 'g'))) {
      for (const part of m[1].split(',')) { const k = part.split(':')[0].trim(); if (k) out.add(k); }
    }
  }
  for (const k of destructuredParams(src)) out.add(k);
  // A field asked for by its name as a string: Object.prototype.hasOwnProperty.call(x, 'f'), Object.hasOwn(x, 'f').
  for (const m of src.matchAll(/(?:hasOwnProperty\.call|Object\.hasOwn)\(\s*x\s*,\s*(['"])([^'"]+)\1/g)) out.add(m[2]);
  return out;
}
/* Review 1: a mark can also hang off a SUB-field of a field the fixtures already set ("x.subtasks.zebra"), read either
   directly or through a name for the field ("const u = x.onHoldUntil; u.task"; review 2: also "= x && x.onHoldUntil",
   followed by anything, and ?.). Each such read of an OBJECT field (an array's or a string's methods are not fields)
   must be set by some fixture too. */
function subFieldsRead(src) {
  const out = new Set();
  for (const n of taskNames(src)) {
    const N = esc(n);
    for (const m of src.matchAll(new RegExp('(?<![\\w$.])' + N + GET + '(' + ID + ')' + GET + '(' + ID + ')', 'g'))) out.add(m[1] + '.' + m[2]);
    for (const a of src.matchAll(new RegExp('(?:const|let|var)\\s+(' + ID + ')\\s*=\\s*(?:' + N + '\\s*&&\\s*)?' + N + GET + '(' + ID + ')', 'g'))) {
      for (const m of src.matchAll(new RegExp('(?<![\\w$.])' + esc(a[1]) + GET + '(' + ID + ')', 'g'))) out.add(a[2] + '.' + m[1]);
    }
  }
  return out;
}
// Review 1: a helper called with the task must be inside the source the field check reads, or its reads are unseen.
function helpersOutside(src) {
  const defined = new Set([...src.matchAll(new RegExp('(?:function\\s+|(?:const|let)\\s+)(' + ID + ')\\s*(?:\\(|=)', 'g'))].map((m) => m[1]));
  return [...new Set(callsWithX(src).map(([n]) => n))]
    // Built-ins that only test or convert the task (the two string-keyed field reads are counted by fieldsRead).
    .filter((n) => !defined.has(n) && !['String', 'Number', 'Boolean', 'Array', 'Object', 'Array.isArray',
      'Object.prototype.hasOwnProperty.call', 'Object.hasOwn'].includes(n));
}
function between(src, from, to) {
  const a = src.indexOf(from); const b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, 'source moved: ' + from + ' .. ' + to);
  return src.slice(a, b);
}
test('#9203 the fixtures set every field the list printers read', () => {
  const tl = fs.readFileSync(path.join(__dirname, 'engine', 'tasklist.js'), 'utf8');
  const win = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');
  const sources = {
    // compactLines and acrossLines and every helper they call sit before whenWords (task show's helpers follow it).
    'engine/tasklist.js (compact and across)': between(tl, 'function whoLeftWords', 'function whenWords'),
    'tools/windows/kosmos-cli.js taskList': between(win, 'async function taskList(', 'async function taskAdd(')
      + between(win, 'function builtTag(', 'function holdUntilWords(') + between(win, 'function holdUntilWords(', '\n}\n'),
    'install/kosmos long list': macProgram(),
  };
  // Review 3: the scan follows the name x, so each printer's row loop must still call its task x (a rename goes red
  // here instead of blinding the scan).
  const loops = { 'engine/tasklist.js (compact and across)': [/const lines = tasks\.map\(\(x\) =>/g, 2], 'tools/windows/kosmos-cli.js taskList': [/for \(const x of tasks\)/g, 1],
    'install/kosmos long list': [/for\(const x of t\)/g, 1] };
  for (const [where, [re, n]] of Object.entries(loops)) {
    assert.equal((sources[where].match(re) || []).length, n, where + ': its row loop no longer names the task x, so the field scan below cannot follow it');
  }
  const set = new Set(FIXTURES.flatMap((f) => Object.keys(f)));
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const unset = [];
  for (const [where, src] of Object.entries(sources)) {
    const read = fieldsRead(src);
    assert.ok(read.size > 15, where + ': only ' + read.size + ' fields found, so the source cut is wrong');
    for (const f of read) if (!set.has(f)) unset.push(where + ': x.' + f);
    for (const fb of subFieldsRead(src)) {
      const [a, b] = fb.split('.');
      const objs = FIXTURES.map((x) => x[a]).filter(isObj);
      if (objs.length && !objs.some((o) => Object.hasOwn(o, b))) unset.push(where + ': x.' + fb);
    }
    for (const h of helpersOutside(src)) unset.push(where + ': calls ' + h + '(..., x, ...) from outside the source read here');
  }
  assert.deepEqual(unset, [], 'a printer reads a field no fixture sets, so its mark is never rendered here:\n' + unset.join('\n'));
});
