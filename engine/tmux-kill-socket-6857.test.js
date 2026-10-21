'use strict';
/* kosmos#6857: every kill-server in the repo's JavaScript names its server with -S or -L.
   TMUX_TMPDIR alone is not enough: tmux 3.6a skips a TMUX_TMPDIR whose realpath() fails and falls back to
   /tmp/tmux-<uid>/default, the machine's own server, so a folder that went missing before the kill (a /tmp sweep,
   another cleanup, a reordered finally) ends every agent session on the machine. That is how every bot on Agent1s
   was restarted at 14:22 on 2026-10-21 (#6851, #6855). -S and -L never fall back.
   Shell scripts are not read here: tools/test-linux-systemd-live-4918.sh is #6852's (PR #6853).

   The rule is a SHAPE, not an inference (four review rounds found new ways to fool a check that tried to work out
   whether arbitrary code names a socket). A kill-server is accepted only as:
     1. an element of an array literal whose first element is '-S' or '-L': ['-S', sock, 'kill-server']
     2. an element of an array handed straight to a wrapper listed in WRAPPERS below, whose own definition is
        checked here to start its tmux arguments with '-S' or '-L'
     3. inside a string only as one whole command: "[tmux] -S|-L <name> kill-server", nothing else in it
   Anything else fails, including tmux's shortened spellings (kill-ser, kill-serv): write it in one of the shapes.
   Files are read as tokens, so comments and regex literals are not code. Not seen, by construction: a name built at
   run time ('kill-ser' + 'ver'), and a listed wrapper whose -L comes from somewhere it does not say. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'build']);

function jsFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/* JavaScript as tokens: { t: 'str' | 'id' | 'p' | 'num', v, line }. Comments and regex literals are skipped. A
   template is one 'str' whose v is its text with each ${...} written as ${}; the code inside ${...} is read as code,
   so a regex or a string in it cannot open a false string (a backtick in a regex there swallowed a whole file). A '/'
   starts a regex when the token before it cannot end an expression. */
const REGEX_AFTER_ID = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
function lex(src) {
  const toks = [];
  const stack = [];   // 'brace', or a template waiting for its ${...} to close: { acc, line }
  let i = 0, line = 1;
  const n = src.length;
  const count = (a, b) => { for (let k = a; k < b; k += 1) if (src[k] === '\n') line += 1; };
  const regexOk = () => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === 'str' || p.t === 'num') return false;
    if (p.t === 'id') return REGEX_AFTER_ID.has(p.v);
    return !(p.v === ')' || p.v === ']' || p.v === '}' || p.v === '++' || p.v === '--');   // n++ / 2 divides
  };
  /* Reads template text from `k` (just after a backtick or a closing ${...}) to its end or its next ${. */
  const template = (k, tpl) => {
    const from = k;
    while (k < n && src[k] !== '`' && !(src[k] === '$' && src[k + 1] === '{')) k += src[k] === '\\' ? 2 : 1;
    tpl.acc += src.slice(from, k);
    count(from, Math.min(k, n));
    if (k < n && src[k] === '$') { tpl.acc += '${}'; stack.push(tpl); return k + 2; }
    toks.push({ t: 'str', v: tpl.acc, line: tpl.line });
    return k + 1;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; count(i, end); i = end; continue; }
    if (c === '`') { i = template(i + 1, { acc: '', line }); continue; }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      toks.push({ t: 'str', v: src.slice(i + 1, k), line });
      count(i, k + 1); i = k + 1; continue;
    }
    if (c === '/' && regexOk()) {
      let k = i + 1, cls = false;
      while (k < n && src[k] !== '\n' && (cls || src[k] !== '/')) {
        if (src[k] === '\\') k += 1; else if (src[k] === '[') cls = true; else if (src[k] === ']') cls = false;
        k += 1;
      }
      if (k < n && src[k] === '/') k += 1;   // a regex cut short by a new line leaves that line to be counted
      while (k < n && /[a-z]/i.test(src[k])) k += 1;
      i = k; continue;
    }
    if (c === '{') { stack.push('brace'); toks.push({ t: 'p', v: c, line }); i += 1; continue; }
    if (c === '}') {
      const top = stack.pop();
      if (top && top !== 'brace') { i = template(i + 1, top); continue; }
      toks.push({ t: 'p', v: c, line }); i += 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let k = i + 1; while (k < n && /[\w$]/.test(src[k])) k += 1; toks.push({ t: 'id', v: src.slice(i, k), line }); i = k; continue; }
    if (/[0-9]/.test(c)) { let k = i + 1; while (k < n && /[\w.]/.test(src[k])) k += 1; toks.push({ t: 'num', v: src.slice(i, k), line }); i = k; continue; }
    const two = src.slice(i, i + 2);
    if (['=>', '||', '&&', '++', '--', '??'].includes(two)) { toks.push({ t: 'p', v: two, line }); i += 2; continue; }
    toks.push({ t: 'p', v: c, line }); i += 1;
  }
  return toks;
}

/* Wrappers that start every tmux call with a named socket, by the file that calls them: { callee: file it is defined
   in, relative to the repo }. A new wrapper fails until it is added here, which is the point: someone reads it. */
const WRAPPERS = {
  'engine/sessionccd-6095.test.js': { tm: 'engine/sessionccd-6095.test.js' },
  'supervisor.provider-key-inject-3296.test.js': { run: 'supervisor.provider-key-inject-3296.test.js' },
  'engine/tmuxsignin.test.js': { runTmux: 'engine/tmuxsignin.js' },
};

const KILL = /kill-ser/;   // tmux takes any unique prefix, and kill-ser is the shortest that is not kill-session
const ONE_COMMAND = /^(?:\S+\s+)?-[SL]\s+\S+\s+kill-server$/;
const named = (tok) => tok && tok.t === 'str' && (tok.v === '-S' || tok.v === '-L');

/* The index of the bracket that directly holds token `i`, or -1. */
function holder(toks, i) {
  let d = 0;
  for (let j = i - 1; j >= 0; j -= 1) {
    const v = toks[j].t === 'p' ? toks[j].v : '';
    if (v === ')' || v === ']' || v === '}') d += 1;
    else if (v === '(' || v === '[' || v === '{') { if (d === 0) return j; d -= 1; }
  }
  return -1;
}

/* Whether `name` is defined in `toks` (`const name = ...` or `function name(`) and that definition's first array
   literal starts with '-S' or '-L', with no '?' before it. */
function wrapperNamesSocket(toks, name) {
  for (let j = 0; j < toks.length - 3; j += 1) {
    const a = toks[j], b = toks[j + 1], c = toks[j + 2];
    const def = (a.v === 'function' && b.v === name && c.v === '(') || (['const', 'let', 'var'].includes(a.v) && b.v === name && c.v === '=');
    if (!def) continue;
    for (let k = j + 3; k < Math.min(toks.length - 1, j + 60); k += 1) {
      if (toks[k].t === 'p' && toks[k].v === '?') return false;   // a socket only sometimes there names nothing
      if (toks[k].t === 'p' && toks[k].v === '[') return named(toks[k + 1]);
    }
    return false;
  }
  return false;
}

/* Every kill-server in `src` that is not in one of the three shapes. `rel` is the file's path from the repo root
   (for WRAPPERS); `read(rel)` returns another repo file's text. */
function bareKills(src, rel, read) {
  const toks = lex(src);
  const found = [];
  toks.forEach((tok, i) => {
    if (tok.t !== 'str' || !KILL.test(tok.v)) return;
    const flag = (why) => found.push({ line: tok.line, text: why });
    if (tok.v !== 'kill-server') {
      if (!ONE_COMMAND.test(tok.v.trim())) flag(JSON.stringify(tok.v.slice(0, 60)) + ': write it as arguments, or as one command that names its socket');
      return;
    }
    const h = holder(toks, i);
    if (h < 0 || toks[h].v !== '[') return flag("'kill-server' not in an array");
    if (named(toks[h + 1])) return;   // shape 1
    const call = holder(toks, h);
    const prev = toks[h - 1];
    if (call > 0 && toks[call].v === '(' && prev && (prev.v === '(' || prev.v === ',')) {
      const callee = toks[call - 1];
      const home = callee && callee.t === 'id' && (WRAPPERS[rel] || {})[callee.v];
      if (home) {
        const text = home === rel ? src : read(home);
        if (text != null && wrapperNamesSocket(lex(text), callee.v)) return;   // shape 2
        return flag("'kill-server' handed to " + callee.v + '(), whose definition in ' + home + ' does not start with -S or -L');
      }
      return flag("'kill-server' handed to " + (callee && callee.t === 'id' ? callee.v + '()' : 'a call') + ', which is not a listed wrapper');
    }
    flag("'kill-server' in an array that does not start with '-S' or '-L'");
  });
  return found;
}

/* Exact 'kill-server' arguments in a file's code (comments, regex literals and longer strings not counted). */
const killArgs = (src) => lex(src).filter((t) => t.t === 'str' && t.v === 'kill-server').length;

test('#6857: the checker passes the three shapes and flags everything else (control)', () => {
  const flags = (s, rel, read) => bareKills(s, rel || 'x.js', read || (() => null)).length;
  // Shape 1, and its failing twins.
  assert.equal(flags("execFileSync(T, ['-S', sock, 'kill-server'])"), 0);
  assert.equal(flags("execFileSync(T, ['-L', name, 'kill-server'], { env })"), 0);
  assert.equal(flags("execFileSync(T, [\n  '-S', sock,\n  'kill-server',\n]);"), 0, 'an array over several lines');
  assert.equal(flags("execFileSync(T, ['kill-server'], { env })"), 1, 'a bare kill-server');
  assert.equal(flags("run({ ...base, TMUX_TMPDIR: d }, ['kill-server']);"), 1, 'TMUX_TMPDIR alone');
  assert.equal(flags("const args = ['kill-server']; execFileSync(T, args);"), 1, 'an array in a variable');
  assert.equal(flags("execFileSync(T, ['capture-pane', '-p', '-S', '-50', ';', 'kill-server'])"), 1, "another command's -S");
  assert.equal(flags("execFileSync(T, [...(sock ? ['-S', sock] : []), 'kill-server'])"), 1, 'a socket only sometimes there');
  assert.equal(flags("spawnSync(T, ['-S'].concat(['kill-server']))"), 1, 'concat is not a listed wrapper');
  assert.equal(flags("run(['-S', s, 'new'], ['kill-server'])"), 1, "an earlier argument's -S");
  assert.equal(flags("execFileSync(T, ['-S', s, 'kill-serv'])"), 1, 'a shortened spelling');
  assert.equal(flags("execFileSync(T, ['kill-ser'])"), 1, 'the shortest spelling');
  // Shape 2: a listed wrapper, checked at its definition.
  const sess = 'engine/sessionccd-6095.test.js';
  assert.equal(flags("const tm = (a) => execFileSync(T, ['-L', sock, '-f', '/dev/null', ...a]);\ntm(['kill-server']);", sess), 0);
  assert.equal(flags("const tm = (a) => execFileSync(T, ['-L', sock, ...a]);\ntm(['kill-server']);"), 1, 'an unlisted wrapper fails until it is listed');
  assert.equal(flags("const tm = (a) => execFileSync(T, a, ['x']);\ntm(['kill-server']);", sess), 1, "a listed wrapper whose array does not start with -L");
  assert.equal(flags("const tm = (a) => execFileSync(T, sock ? ['-S', sock, ...a] : a);\ntm(['kill-server']);", sess), 1, 'a listed wrapper with a conditional socket');
  assert.equal(flags("const tm = (a) => capture(['x', '-S', '-200']) || execFileSync(T, a);\ntm(['kill-server']);", sess), 1, "a listed wrapper whose -S is another call's");
  const sig = 'engine/tmuxsignin.test.js';
  const good = "function runTmux(owner, socketName, args) {\n  const full = ['-L', socketName].concat(args);\n}";
  assert.equal(flags("sig.runTmux('o', 'sock', ['kill-server'])", sig, (r) => (r === 'engine/tmuxsignin.js' ? good : null)), 0, 'a wrapper in another file');
  assert.equal(flags("sig.runTmux('o', 'sock', ['kill-server'])", sig, (r) => (r === 'engine/tmuxsignin.js' ? 'function runTmux(o, s, a) { return run(a); }' : null)), 1, 'that wrapper without its -L');
  assert.equal(flags("sig.runTmux('o', 'sock', ['kill-server'])", sig), 1, 'that wrapper missing');
  // Shape 3: one whole command in a string.
  assert.equal(flags("execSync('tmux -L k1 kill-server')"), 0);
  assert.equal(flags('execSync(`${T} -S ${sock} kill-server`)'), 0);
  assert.equal(flags("assert.deepEqual(r, ['-L sock kill-server'])"), 0, 'an expected value');
  assert.equal(flags("execSync('tmux kill-server')"), 1, 'a command string');
  assert.equal(flags('execSync(`${T} kill-server`)'), 1, 'a template');
  assert.equal(flags("execSync('tmux -L a kill-server; tmux kill-server')"), 1, 'two commands');
  assert.equal(flags("execSync('tmux -L a new\\ntmux kill-server')"), 1, 'two commands over an escaped new line');
  assert.equal(flags("execSync('tmux -L a new & tmux kill-server')"), 1, 'two commands joined by &');
  // Reading code as code.
  assert.equal(flags("// never a bare 'kill-server' here\n/* nor ['kill-server'] */"), 0, 'a comment is not a call');
  assert.equal(flags("glob('engine/*.test.js'); execFileSync(T, ['kill-server']); /* end */"), 1, 'a /* inside a string opens no comment');
  assert.equal(flags("const r = x.replace(/\\/*$/, ''); execFileSync(T, ['kill-server']); /* end */"), 1, 'a /* inside a regex opens no comment');
  assert.equal(flags("const u = 'http: //h'; execFileSync(T, ['kill-server']);"), 1, 'a // inside a string opens no comment');
  assert.equal(flags("let n = 1; n++ / 2; execFileSync(T, ['kill-server']);"), 1, 'n++ / 2 is a division, not a regex');
  assert.equal(flags('const s = `${x.replace(/[`]/g, "")}`; execFileSync(T, [\'kill-server\']);'), 1, 'a backtick in a regex inside ${} opens no template');
  assert.deepEqual(bareKills("#!/usr/bin/env node\nconst a = /x/;\n\nexecFileSync(T, ['kill-server']);", 'x.js', () => null).map((k) => k.line), [4], 'line numbers hold after a hashbang');
});

/* Every file that holds a real kill-server today, and how many. The scan must reach each with at least that many, so
   a walk or a lexer that stops seeing code fails here instead of passing clean. */
const EXPECTED = {
  'docs/browser-checks/live-connect.js': 1,
  'engine/last-look.test.js': 1,
  'engine/sandbox.test.js': 2,
  'engine/agysignin.test.js': 1,
  'engine/musesignin.test.js': 1,
  'engine/sessionccd-6095.test.js': 1,
  'engine/tmuxsignin.test.js': 1,
  'supervisor.provider-key-inject-3296.test.js': 1,
};

test('#6857: no kill-server in the repo\'s JavaScript runs without -S or -L', () => {
  const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
  const bad = [];
  const reached = {};
  for (const f of jsFiles(ROOT, [])) {
    if (f === __filename) continue;   // this file's controls hold bare examples on purpose
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    if (!KILL.test(src)) continue;
    reached[rel] = killArgs(src);
    for (const k of bareKills(src, rel, read)) bad.push(rel + ':' + k.line + '  ' + k.text);
  }
  for (const [rel, n] of Object.entries(EXPECTED)) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' is gone: if its kill-server moved, update EXPECTED here');
    assert.ok((reached[rel] || 0) >= n, rel + ': the scan saw ' + (reached[rel] || 0) + ' kill-server calls, expected ' + n + '; it is not reading that file');
  }
  for (const rel of Object.keys(WRAPPERS)) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' is gone: update WRAPPERS here');
  assert.deepEqual(bad, [], 'kill-server with no -S or -L (name the socket, kosmos#6857):\n' + bad.join('\n'));
});
