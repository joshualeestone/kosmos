'use strict';

/**
 * A harness board never phones home (#4253).
 *
 * 🛑 WHAT WENT WRONG. The install ping (engine/createdbeacon.js) is skipped only
 * when NODE_TEST_CONTEXT is set, and only node's own test runner sets it. Every
 * board a harness boots from bash (tools/browser-checks.sh, the shell tests
 * run-tests.sh runs, the release bundle's smoke) has a sandboxed data folder, so
 * it minted a fresh install id and told installkosmos.com a new Mac install
 * exists. Measured 2026-09-27: one allowlisted browser-checks run sent 14; the public
 * install count took thousands a day (7,086 on 09-25 alone), across every harness.
 *
 * 🛑 THE BEACON IS NOT CHANGED, and must not be (Josh, 2026-09-14, #3038: the real
 * install ping is never removed or made opt-out-able). The fix is in the
 * harnesses: each points AGENT_WORKFORCE_CREATED_URL, and the daily report's
 * AGENT_WORKFORCE_FEEDBACK_URL, at a dead local port, the way browser-checks.sh
 * already points its other outbound URLs at 127.0.0.1:9.
 *
 * Three parts:
 *   1. the CONTROL: a board booted outside node's test runner really does send the
 *      install ping, to whatever the variable names. Without this the other half
 *      would pin a line nobody needs.
 *   2. each harness sets the variable as a top-level export (or on the smoke
 *      boot's own environment) BEFORE its first board boot.
 *   3. every node test that spawns server.js either passes its own environment
 *      through (so NODE_TEST_CONTEXT reaches the board) or names the URL itself.
 *      A test that builds the child's env by hand does neither by default, and
 *      server.guide-on-connect-3660.test.js did exactly that.
 *
 * ⚠️ The daily report's URL is pinned by the second half only. Its send runs on
 * an hourly sweep, so a short harness boot does not reach it and there is no
 * cheap behavioural control; a renamed variable would slip past this file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { runUntilBanner } = require('./test-support/board-child');

const REPO = __dirname;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+\//;

function sink() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ seen, server, port: server.address().port }));
  });
}

test('#4253 CONTROL: a board booted outside node --test sends the install ping to AGENT_WORKFORCE_CREATED_URL', async () => {
  const s = await sink();
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-nph-4253-'));
  fs.writeFileSync(path.join(sb, 'panes.txt'), '');
  const env = {
    ...process.env,
    PORT: '0',
    AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
    AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
    AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
    AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
    AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
    AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
    AGENT_WORKFORCE_DRY_RUN: '1',
    AGENT_WORKFORCE_CREATED_URL: `http://127.0.0.1:${s.port}/api/created`,
    AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
  };
  /* 🔑 This is what makes the child a HARNESS boot rather than a test boot: a
     bash harness never has it, and with it set the beacon stays silent. */
  delete env.NODE_TEST_CONTEXT;
  try {
    const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
      env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await runUntilBanner(child, { settleMs: 1500 });
    for (let i = 0; i < 30 && s.seen.length === 0; i += 1) await new Promise((r) => setTimeout(r, 100));
    const pings = s.seen.filter((x) => x.url === '/api/created');
    assert.ok(pings.length >= 1, 'a harness boot sent no install ping, so the harness guards below pin nothing');
    const body = JSON.parse(pings[0].body);
    assert.equal(body.count, 0, 'the boot ping is the install ping (count 0)');
    assert.ok(body.installId && body.installId !== 'unknown', 'a sandboxed boot mints its own install id');
  } finally {
    s.server.close();
    fs.rmSync(sb, { recursive: true, force: true });
  }
});

/* Whether line i is at the script's top level: not inside a function body or an
   if/for/while/case block. Counted from column-0 openers and closers, which is how
   these scripts are written; a line-based count, not a shell parser, so a block
   opened and closed on one line is ignored. An export inside a function that is
   never called, or under `if false`, would otherwise pass a column-0 check.
   Like the JS lint below, it reads the shapes these three scripts use: it does not
   know heredocs, so a heredoc body with a column-0 `fi` or `}` before the export
   would miscount. None of the three has one there today. */
function topLevel(lines, i) {
  let depth = 0;
  for (let k = 0; k < i; k += 1) {
    const l = lines[k];
    if (/^\s*#/.test(l)) continue;
    if (/^(function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*(\(\))?\s*\{?\s*$/.test(l) && (/\(\)/.test(l) || /^function\s/.test(l))
        || /^(if|for|while|until|case)\b/.test(l)) {
      if (!/\b(fi|done|esac)\s*;?\s*$/.test(l) && !/\}\s*;?\s*$/.test(l.replace(/\{\s*$/, ''))) depth += 1;
    } else if (/^\}(?:[\s;]|$)|^(fi|done|esac)\b/.test(l)) {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth === 0;
}

/* The first line of a script that starts a board. Comments are skipped, so a
   comment naming server.js cannot stand in for a boot. */
function firstBootLine(lines) {
  return lines.findIndex((l) => !/^\s*#/.test(l) && /server\.js/.test(l) && /\bnode\b|runtime\/bin\/node/.test(l));
}

/* test-install.sh boots boards through install/setup.sh (never `node server.js`
   in its own text), and a release cut runs it as the install gate, so its first
   boot is the first run of the installer. */
const HARNESSES = [
  ['tools/browser-checks.sh', 'browser-checks.sh', null],
  ['tools/run-tests.sh', 'run-tests.sh', null],
  ['tools/test-install.sh', 'test-install.sh', /\$SETUP"? *\| *(env .*|(\S+=\S* +)*)sh\b/],
];

for (const [file, name, bootRe] of HARNESSES) {
  test(`#4253: ${name} exports both phone-home URLs to a loopback address at top level`, () => {
    const lines = fs.readFileSync(path.join(REPO, file), 'utf8').split('\n');
    for (const v of ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL']) {
      /* Column 0: a top-level statement, not a comment and not inside a function
         that may never run. */
      const i = lines.findIndex((l) => l.startsWith(`export ${v}=`));
      assert.ok(i >= 0, `${name} has no top-level \`export ${v}=\``);
      assert.ok(topLevel(lines, i), `${name}'s \`export ${v}=\` on line ${i + 1} is inside a function or block that may never run`);
      const value = lines[i].slice(`export ${v}=`.length).replace(/^["']|["']$/g, '');
      assert.match(value, LOOPBACK, `${name} points ${v} somewhere other than this machine: ${value}`);
      /* run-tests.sh boots no board in its own text (its children do), so it has no
         boot line and only the top-level check applies to it. */
      const boot = bootRe ? lines.findIndex((l) => !/^\s*#/.test(l) && bootRe.test(l)) : firstBootLine(lines);
      if (bootRe) assert.ok(boot >= 0, `could not find ${name}'s first installer run`);
      if (boot >= 0) assert.ok(i < boot, `${name} sets ${v} on line ${i + 1}, after its first board boot on line ${boot + 1}`);
    }
  });
}

test('#4253: the release bundle smoke boot carries both phone-home URLs on its own environment', () => {
  const lines = fs.readFileSync(path.join(REPO, 'tools/build-kosmos-bundle.sh'), 'utf8').split('\n');
  const boot = lines.findIndex((l) => !/^\s*#/.test(l) && /"\$STAGE\/app\/server\.js"/.test(l) && /runtime\/bin\/node/.test(l));
  assert.ok(boot >= 0, 'could not find the smoke boot line in build-kosmos-bundle.sh');
  /* The environment is the backslash-continued block ending at the boot line. */
  let start = boot;
  while (start > 0 && /\\\s*$/.test(lines[start - 1])) start -= 1;
  const block = lines.slice(start, boot + 1).join('\n');
  for (const v of ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL']) {
    const m = block.match(new RegExp(`\\b${v}=("?)([^\\s"\\\\]+)\\1`));
    assert.ok(m, `the smoke boot does not set ${v}`);
    assert.match(m[2], LOOPBACK, `the smoke boot points ${v} off this machine: ${m[2]}`);
  }
});

test('#4253: test-install.sh\'s env -i reboot simulation carries both phone-home URLs', () => {
  const lines = fs.readFileSync(path.join(REPO, 'tools/test-install.sh'), 'utf8').split('\n');
  /* env -i starts from an EMPTY environment, so the top-level export does not
     reach this board; the block has to name the two variables itself. */
  const start = lines.findIndex((l) => !/^\s*#/.test(l) && /\benv -i\b/.test(l));
  assert.ok(start >= 0, 'could not find the env -i reboot simulation');
  let end = start;
  while (end < lines.length - 1 && /\\\s*$/.test(lines[end])) end += 1;
  const block = lines.slice(start, end + 1).join('\n');
  assert.match(block, /bin\/kosmos"? start/, 'the env -i block found is not the board start');
  for (const v of ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL']) {
    assert.ok(new RegExp(`\\b${v}=`).test(block), `the env -i reboot simulation does not set ${v}, so that board phones home`);
  }
});

test('#4253: the block-depth reader closes a function at its column-0 brace', () => {
  const src = [
    'helper() {',
    '  echo hi',
    '}',
    'export AFTER=1',
    'wrapped() {',
    'export INSIDE=1',
    '}',
    'if true; then',
    'export IN_IF=1',
    'fi',
    'function kw {',
    'export IN_KW=1',
    '}',
    'function kwp() {',
    'export IN_KWP=1',
    '}',
    'export LAST=1',
  ];
  assert.equal(topLevel(src, 3), true, 'an export after a closed function is top level');
  assert.equal(topLevel(src, 5), false, 'an export inside a function body is not');
  assert.equal(topLevel(src, 8), false, 'an export inside an if is not');
  assert.equal(topLevel(src, 11), false, 'an export inside a `function name {` body is not');
  assert.equal(topLevel(src, 14), false, 'an export inside a `function name() {` body is not');
  assert.equal(topLevel(src, 16), true, 'and depth returns to zero after both');
});

test('#4253: test-install.sh\'s first installer run is the first one in the file', () => {
  const lines = fs.readFileSync(path.join(REPO, 'tools/test-install.sh'), 'utf8').split('\n');
  const re = HARNESSES.find(([, n]) => n === 'test-install.sh')[2];
  const first = lines.findIndex((l) => !/^\s*#/.test(l) && /\$SETUP"? *\|/.test(l) && /\bsh\b/.test(l));
  const found = lines.findIndex((l) => !/^\s*#/.test(l) && re.test(l));
  assert.equal(found, first, `the boot pattern finds line ${found + 1}, but the first installer run is line ${first + 1}`);
});

/* ---- the per-call boot analyzer (#4253 reviews 3 to 6) ----
   Judges each spawn of a board ON ITS OWN, not the file it sits in: a file with
   one safe spawn and one hand-built env is not safe, and a comment naming the URL
   is not a fix.
   🛑 IT IS A LINT FOR THE SHAPES THIS TREE USES, NOT A PROOF. It reads text: it
   balances brackets and skips comments, and it knows node spawns (process.execPath
   or 'node'), fork(module), exec strings and `sh -c` strings that name server.js,
   options passed literally, by name or by a helper, and an env that spreads
   process.env unless it then drops or blanks NODE_TEST_CONTEXT. A shape it does
   not model is invisible to it, which is the one direction a partial reader fails
   in. What actually keeps a test board quiet is NODE_TEST_CONTEXT reaching it (or
   the harness's export); this catches the ways that has been lost here so far. */
/* Naming the URL counts only when it names THIS machine, the rule the harness checks
   above apply to their exports. */
const NAMED_LOOPBACK_URL = /AGENT_WORKFORCE_CREATED_URL['"]?\s*[:=]\s*['"`]http:\/\/127\.0\.0\.1:[\d${}.\w]*\//;
const SAFE_ENV = /\.\.\.process\.env\b|Object\.(keys|entries)\(process\.env\)|Object\.assign\(\{\}, *process\.env|^\s*process\.env\s*$/;
/* Taking NODE_TEST_CONTEXT back out undoes a spread of process.env: the board then
   believes it is not under test and pings for real (unless the URL is named). */
const DROPS_TEST_CONTEXT = /NODE_TEST_CONTEXT\s*:\s*(undefined|null|''|""|``|false|0)\b|NODE_TEST_CONTEXT\s*:\s*(''|""|``)|delete\s+[\w$.]+\.NODE_TEST_CONTEXT|\.NODE_TEST_CONTEXT\s*=\s*(undefined|null|''|""|``)/;
const safeText = (t) => NAMED_LOOPBACK_URL.test(t) || (SAFE_ENV.test(t) && !DROPS_TEST_CONTEXT.test(t));

/* Blanks every comment, block or line, whole-line or trailing, that is outside a
   string, in ONE pass over the whole source, so a string (a template literal
   especially) that runs across lines keeps its `//` and its `/*`. Newlines are
   kept, so line numbers still hold. A `${...}` inside a template is read as part
   of the template, which is how these files use it. */
function stripComments(src) {
  let out = '';
  let q = null; // the quote we are inside, or null
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 1; continue; }
      if (c === q) q = null;
      else if (c === '\n' && q !== '`') q = null; // a '...' or "..." never spans lines
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      if (i < src.length) out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i, end < 0 ? src.length : end + 2);
      out += body.replace(/[^\n]/g, ' ');
      i += body.length - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/* The text from `open` (an opening bracket) to its match. */
function balanced(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

/* The definition text of a name, if the file defines it. */
function definition(src, name) {
  const fn = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
  if (fn) { const b = src.indexOf('{', fn.index); return b < 0 ? '' : balanced(src, b); }
  const v = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(src);
  if (!v) return null;
  const at = v.index + v[0].length;
  if ('([{'.includes(src[at])) return balanced(src, at);
  if (src[at] === '`') { let i = at + 1; while (i < src.length && !(src[i] === '`' && src[i - 1] !== '\\')) i += 1; return src.slice(at, i + 1); }
  const semi = src.indexOf(';', at);
  return src.slice(at, semi < 0 ? undefined : semi);
}

/* A call's arguments, split at its own top level. `call` starts at its `(`. */
function argsOf(call) {
  const inner = call.slice(1, -1);
  const out = [];
  let depth = 0; let from = 0; let q = null;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (q) { if (c === q && inner[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) { out.push(inner.slice(from, i).trim()); from = i + 1; }
  }
  const last = inner.slice(from).trim();
  if (last) out.push(last);
  return out;
}

/* The env a spawn's OPTIONS argument gives the child. Returns null when the child
   inherits (no options, or options without env), an expression string otherwise,
   and UNKNOWN when the options cannot be read, which is judged unsafe. */
const UNKNOWN = '\u0000unknown';
function envOfOptions(src, opts, callAt, depth = 0) {
  if (opts === undefined) return null;
  if (opts.startsWith('{')) return envOf(opts);
  const whole = /^([A-Za-z_$][\w$]*)\s*(\(|$)/.exec(opts);
  if (!whole || depth > MAX_DEPTH) return UNKNOWN;
  const name = whole[1];
  if (whole[2] === '(') {
    // a helper that builds the options: judge what its body returns
    const body = definition(src, name);
    if (!body) return UNKNOWN;
    /* EVERY return must give a safe env: which branch runs is not knowable here. */
    const rets = [...body.matchAll(/\breturn\s+/g)].map((r) => {
      const from = r.index + r[0].length;
      return '([{'.includes(body[from]) ? balanced(body, from) : body.slice(from).split(/[;\n]/)[0].trim();
    });
    if (!rets.length) return UNKNOWN;
    const envs = rets.map((r) => envOfOptions(body, r, body.length, depth + 1));
    return envs.every((e) => envIsSafe(body, e, body.length, depth + 1)) ? envs[0] : UNKNOWN;
  }
  const r = region(src, name, callAt);
  if (!r) return UNKNOWN;
  // `name.env = <expr>` after the declaration wins over the declaration's own env
  const set = new RegExp(`(?<![.\\w$])${name}\\.env\\s*=\\s*([^;\\n]+)`).exec(r.later);
  if (set) return set[1].trim();
  if (r.stmt.trim().startsWith('{')) return envOf(r.stmt);
  return envOfOptions(src, r.stmt.trim(), callAt, depth + 1);
}

/* The `env` option of a call, or null when there is none (the child inherits). */
function envOf(call) {
  const short = /[{,]\s*env\s*[,}]/.exec(call);
  if (short) return 'env';
  const m = /\benv\s*:\s*/.exec(call);
  if (!m) return null;
  let i = m.index + m[0].length;
  if ('([{'.includes(call[i])) return balanced(call, i);
  const rest = call.slice(i);
  const end = rest.search(/[,}\n]/);
  return rest.slice(0, end < 0 ? undefined : end).trim();
}

/* The names that carry a WHOLE environment into an expression: the expression
   itself when it is one name or a call (`env`, `launchEnv()`), a spread
   (`...base`), or an argument of Object.assign. A property value (`HOME: sb`)
   brings one key, never NODE_TEST_CONTEXT, so it is not followed. */
function flows(expr) {
  const t = String(expr).trim();
  const out = new Set();
  const whole = /^([A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec(t);
  if (whole) out.add(whole[1]);
  for (const x of t.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) out.add(x[1]);
  for (const x of t.matchAll(/Object\.assign\(([^)]*)\)/g)) {
    for (const n of x[1].match(/(?<![.\w$])[A-Za-z_$][\w$]*/g) || []) out.add(n);
  }
  out.delete('process');
  return out;
}

/* A name's LAST declaration before the call (the whole statement), plus the later
   lines up to the call that mention it (a loop filling it from process.env), or a
   function's body. The later lines are checked for safe text, never followed. */
function region(src, name, callAt) {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`, 'g');
  let decl = null; let m;
  while ((m = re.exec(src)) && m.index < callAt) decl = m;
  if (!decl) { const d = definition(src, name); return d === null ? null : { stmt: d, later: '' }; }
  const at = decl.index + decl[0].length;
  let stmt;
  if ('([{'.includes(src[at])) stmt = balanced(src, at);
  else { const semi = src.indexOf(';', at); stmt = src.slice(at, semi < 0 ? callAt : Math.min(semi, callAt)); }
  const word = new RegExp(`(?<![.\\w$])${name}\\b`);
  const between = src.slice(at + stmt.length, callAt);
  const later = between.split('\n').filter((l) => word.test(l)).join('\n');
  /* A later bare reassignment (`env = ...`) replaces the declaration: judge the
     LAST one's value instead of the stale declaration. */
  const reassign = new RegExp(`(?<![.\\w$])${name}\\s*=(?![=>])\\s*`, 'g');
  let last = null; let x;
  while ((x = reassign.exec(between))) last = x;
  if (last) {
    const from = last.index + last[0].length;
    const val = '([{'.includes(between[from]) ? balanced(between, from) : between.slice(from).split(/[;\n]/)[0];
    return { stmt: val, later };
  }
  return { stmt, later };
}

/* How many names deep a safe environment is followed. Past it the spawn is judged
   unsafe (loud, never silent); raise it if a correct helper chain is ever deeper. */
const MAX_DEPTH = 6;

function envIsSafe(src, expr, callAt, depth = 0) {
  if (expr === null) return true;
  if (expr === UNKNOWN) return false;
  if (DROPS_TEST_CONTEXT.test(expr) && !NAMED_LOOPBACK_URL.test(expr)) return false;
  if (safeText(expr)) return true;
  if (depth > MAX_DEPTH) return false;
  /* Every name that carries a whole environment in must be safe on its own: a
     later spread overrides an earlier one, so one safe source cannot vouch for
     the rest. */
  const names = [...flows(expr)];
  if (!names.length) return false;
  return names.every((name) => {
    const r = region(src, name, callAt);
    if (!r) return false;
    if (DROPS_TEST_CONTEXT.test(r.later) && !NAMED_LOOPBACK_URL.test(r.stmt + r.later)) return false;
    return safeText(r.later) || envIsSafe(src, r.stmt, callAt, depth + 1);
  });
}

/* Every spawn in `raw` that boots a board: server.js as the script (literally, or
   through a name defined with it), or a `node -e` child whose code requires it.
   Returns [{ line, safe }]. */
function boots(raw) {
  const src = stripComments(raw);
  const out = [];
  const push = (at, opts) => out.push({ line: src.slice(0, at).split('\n').length, safe: envIsSafe(src, envOfOptions(src, opts, at), at) });
  const namesServer = (text) => /server\.js/.test(text)
    || (text.match(/\b[A-Za-z_$][\w$]*\b/g) || []).some((n) => /server\.js/.test(definition(src, n) || ''));
  let m;
  // node as the program: spawn/execFile(process.execPath | 'node', [args], opts)
  const node = /\b(spawn|spawnSync|execFile|execFileSync)\(\s*(process\.execPath|['"]node['"])\s*,\s*/g;
  while ((m = node.exec(src))) {
    const call = balanced(src, src.indexOf('(', m.index));
    const a = argsOf(call);
    const args = a[1] && a[1].startsWith('[') ? a[1] : '';
    const names = args.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
    const direct = namesServer(args);
    const code = args + '\n' + names.map((n) => definition(src, n) || '').join('\n');
    const inner = (code.match(/\b[A-Z_][A-Z0-9_]*\b/g) || []).map((n) => definition(src, n) || '').join('\n');
    const viaE = /^\[\s*['"]-e['"]/.test(args) && /\brequire\(/.test(code)
      && (/['"`/]server(\.js)?['"`]/.test(code) || /server\.js/.test(inner));
    if (direct || viaE) push(m.index, a[2]);
  }
  // fork(modulePath, [args], opts): the module is the FIRST argument
  const fork = /\bfork\(/g;
  while ((m = fork.exec(src))) {
    const a = argsOf(balanced(src, m.index + 4));
    if (a[0] && namesServer(a[0])) push(m.index, a[1] && a[1].startsWith('[') ? a[2] : a[1]);
  }
  // a shell: exec/execSync(command, opts), or spawn/execFile('sh'|'bash', ['-c', command], opts)
  const shell = /\b(exec|execSync)\(/g;
  while ((m = shell.exec(src))) {
    const a = argsOf(balanced(src, src.indexOf('(', m.index)));
    if (a[0] && namesServer(a[0]) && /\bnode\b|execPath/.test(a[0] + (definition(src, (a[0].match(/^[A-Za-z_$][\w$]*/) || [''])[0]) || ''))) push(m.index, a[1]);
  }
  const sh = /\b(spawn|spawnSync|execFile|execFileSync)\(\s*['"](\/bin\/)?(ba)?sh['"]\s*,\s*/g;
  while ((m = sh.exec(src))) {
    const a = argsOf(balanced(src, src.indexOf('(', m.index)));
    if (a[1] && /['"]-c['"]/.test(a[1]) && namesServer(a[1]) && /\bnode\b|execPath/.test(a[1])) push(m.index, a[2]);
  }
  return out;
}

test('#4253: the boot analyzer judges each spawn, not the file', () => {
  const two = [
    "spawn(process.execPath, [path.join(REPO, 'server.js')], { env: { ...process.env, PORT: '0' } });",
    "spawn(process.execPath, [path.join(REPO, 'server.js')], { env: { PATH: process.env.PATH, PORT: '0' } });",
  ].join('\n');
  assert.deepEqual(boots(two).map((b) => b.safe), [true, false], 'a safe spawn does not clear its unsafe neighbour');
  const mention = "// AGENT_WORKFORCE_CREATED_URL is not needed here\nspawn(process.execPath, ['server.js'], { env: { HOME: h } });";
  assert.deepEqual(boots(mention).map((b) => b.safe), [false], 'a comment naming the URL is not a fix');
  const viaName = "const SERVER = path.join(REPO, 'server.js');\nspawn('node', [SERVER], { env: { HOME: h } });";
  assert.deepEqual(boots(viaName).map((b) => b.safe), [false], 'a server.js path held in a name is still a boot');
  const prop = "const env = { ...process.env };\nfunction other() {}\nspawn(process.execPath, ['server.js'], { env: { PATH: process.env.PATH, HOME: sb } });";
  assert.deepEqual(boots(prop).map((b) => b.safe), [false], 'process.env.PATH does not make an unrelated env variable the spawn\'s env');
  const named1 = "const opts = { stdio: 'pipe' };\nopts.env = { HOME: sb };\nspawn(process.execPath, ['server.js'], opts);";
  assert.deepEqual(boots(named1).map((b) => b.safe), [false], 'opts.env assigned after the literal is the env');
  const named2 = "const opts = { env: { HOME: sb } };\nspawn(process.execPath, ['server.js'], opts);";
  assert.deepEqual(boots(named2).map((b) => b.safe), [false], 'an options object declared elsewhere is read');
  const named3 = "function mkOpts(e) { return { env: e }; }\nspawn(process.execPath, ['server.js'], mkOpts({ HOME: sb }));";
  assert.deepEqual(boots(named3).map((b) => b.safe), [false], 'options built by a helper cannot be proven safe, so they are not');
  const namedOk = "const opts = { env: { ...process.env, PORT: '0' } };\nspawn(process.execPath, ['server.js'], opts);";
  assert.deepEqual(boots(namedOk).map((b) => b.safe), [true], 'a named options object that spreads process.env is safe');
  const namedInherit = "const opts = { stdio: 'pipe' };\nspawn(process.execPath, ['server.js'], opts);";
  assert.deepEqual(boots(namedInherit).map((b) => b.safe), [true], 'named options without env inherit');
  const undone = "spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_TEST_CONTEXT: undefined } });";
  assert.deepEqual(boots(undone).map((b) => b.safe), [false], 'a spread then NODE_TEST_CONTEXT: undefined is not safe');
  const deleted = "const env = { ...process.env, PORT: '0' };\ndelete env.NODE_TEST_CONTEXT;\nspawn(process.execPath, ['server.js'], { env });";
  assert.deepEqual(boots(deleted).map((b) => b.safe), [false], 'deleting NODE_TEST_CONTEXT after a spread is not safe');
  const deletedButNamed = "const env = { ...process.env, AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created' };\ndelete env.NODE_TEST_CONTEXT;\nspawn(process.execPath, ['server.js'], { env });";
  assert.deepEqual(boots(deletedButNamed).map((b) => b.safe), [true], 'dropping NODE_TEST_CONTEXT is fine when the URL is named (the CONTROL does this)');
  const forked = "fork(path.join(REPO, 'server.js'), [], { env: { HOME: h } });";
  assert.deepEqual(boots(forked).map((b) => b.safe), [false], 'fork(module) with server.js as the module is a boot');
  const execd = "exec(`${process.execPath} ${path.join(REPO, 'server.js')}`, { env: { HOME: h } });";
  assert.deepEqual(boots(execd).map((b) => b.safe), [false], 'an exec string that runs server.js is a boot');
  const shelled = "spawn('sh', ['-c', `${process.execPath} ${path.join(REPO, 'server.js')}`], { env: { HOME: h } });";
  assert.deepEqual(boots(shelled).map((b) => b.safe), [false], 'sh -c running server.js is a boot');
  const trailing = "spawn(process.execPath, ['server.js'], { env: {\n  HOME: sb, // AGENT_WORKFORCE_CREATED_URL not needed here\n} });";
  assert.deepEqual(boots(trailing).map((b) => b.safe), [false], 'a trailing comment naming the URL is not a fix');
  const realUrl = "spawn(process.execPath, ['server.js'], { env: { HOME: sb, AGENT_WORKFORCE_CREATED_URL: 'https://installkosmos.com/api/created' } });";
  assert.deepEqual(boots(realUrl).map((b) => b.safe), [false], 'naming the URL counts only when it is this machine');
  const loop = "spawn(process.execPath, ['server.js'], { env: { HOME: sb, AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created' } });";
  assert.deepEqual(boots(loop).map((b) => b.safe), [true], 'a loopback URL is a fix');
  const inString = "spawn(process.execPath, ['server.js'], { env: { ...process.env, X: 'http://a//b' } });";
  assert.deepEqual(boots(inString).map((b) => b.safe), [true], 'a // inside a string is not a comment');
  const multi = "const cmd = `echo http://127.0.0.1:9/x &&\n  node server.js`;\nexec(`${process.execPath} ${path.join(REPO, 'server.js')}`, { env: { HOME: h } });";
  assert.equal(stripComments(multi).includes('http://127.0.0.1:9/x'), true, 'a // inside a multi-line template is not a comment');
  const hidden = "exec(`${process.execPath} \\\n  --from=http://h/ ${path.join(REPO, 'server.js')}`, { env: { HOME: h } });";
  assert.deepEqual(boots(hidden).map((b) => b.safe), [false], 'server.js after a // on a continuation line of a multi-line command is still seen');
  const blockInString = "spawn(process.execPath, ['server.js'], { env: { ...process.env, GLOB: 'a/*b' } });\nconst x = 1; // */";
  assert.deepEqual(boots(blockInString).map((b) => b.safe), [true], 'a /* inside a string does not open a comment');
  const lastWins = "const unsafeOverrides = { NODE_TEST_CONTEXT: undefined };\nconst safeBase = { ...process.env };\nspawn(process.execPath, ['server.js'], { env: { ...safeBase, ...unsafeOverrides } });";
  assert.deepEqual(boots(lastWins).map((b) => b.safe), [false], 'one safe spread cannot vouch for a later one');
  const branches = "function mkOpts(bad) { if (!bad) { return { env: { ...process.env } }; } return { env: { HOME: sb } }; }\nspawn(process.execPath, ['server.js'], mkOpts(true));";
  assert.deepEqual(boots(branches).map((b) => b.safe), [false], 'every return of an options helper must be safe');
  const reassigned = "let env = { ...process.env };\nspawn(process.execPath, ['server.js'], { env });\nenv = { HOME: sb };\nspawn(process.execPath, ['server.js'], { env });";
  assert.deepEqual(boots(reassigned).map((b) => b.safe), [true, false], 'a bare reassignment replaces the declaration');
  const filled = "const env = {};\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];\nspawnSync(process.execPath, ['server.js'], { env: { ...env, PORT: '0' } });";
  assert.deepEqual(boots(filled).map((b) => b.safe), [true], 'an env filled from process.env after its declaration is safe');
  const helper = "function launchEnv() { const e = {}; for (const [k, v] of Object.entries(process.env)) e[k] = v; return e; }\nspawn(process.execPath, ['server.js'], { env: launchEnv() });";
  assert.deepEqual(boots(helper).map((b) => b.safe), [true], 'an env built by a helper is judged by the helper');
  assert.deepEqual(boots("spawn(process.execPath, ['server.js'], { stdio: 'pipe' });").map((b) => b.safe), [true], 'no env option inherits');
  assert.deepEqual(boots("execFileSync(process.execPath, ['-e', 'require(\"./server.js\")'], { env: { A: 1 } });").map((b) => b.safe), [false], 'a -e child that requires server.js is a boot');
  const named = "const SERVER = path.join(__dirname, 'server.js');\nconst code = `require(${JSON.stringify(SERVER)});`;\nspawnSync(process.execPath, ['-e', code], { env: { HOME: h } });";
  assert.deepEqual(boots(named).map((b) => b.safe), [false], 'a -e child that requires a NAMED server.js path is a boot');
});

test('#4253: every test and browser check that boots server.js keeps the board from phoning home', () => {
  /* A test run under node --test has NODE_TEST_CONTEXT, and a board that inherits
     it stays silent; a browser check inherits browser-checks.sh's export. A child
     env built by hand drops both, so such a spawn must name the URL itself. */
  /* This file is left out: its self-test above holds deliberately unsafe spawns as
     strings, and its one real boot (the CONTROL) names the URL. */
  const files = require('node:child_process').execFileSync('git', ['-C', REPO, 'ls-files', '*.test.js', 'docs/browser-checks/*.js', 'test-support/*.js'], { encoding: 'utf8' })
    .trim().split('\n').filter((f) => f && f !== 'tools.no-phone-home-4253.test.js');
  const all = [];
  for (const f of files) for (const b of boots(fs.readFileSync(path.join(REPO, f), 'utf8'))) all.push({ f, ...b });
  const bootFiles = new Set(all.map((b) => b.f));
  assert.ok(bootFiles.size >= 40, `found only ${bootFiles.size} files that boot server.js; the matcher has gone blind`);
  const bad = all.filter((b) => !b.safe).map((b) => `${b.f}:${b.line}`);
  assert.deepEqual(bad, [], `these spawns boot server.js with an env that neither passes process.env through nor names AGENT_WORKFORCE_CREATED_URL: ${bad.join(', ')}`);
});
