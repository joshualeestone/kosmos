'use strict';
/* kosmos#6857: every kill-server in the repo's JavaScript names its server with -S or -L.
   TMUX_TMPDIR alone is not enough: tmux 3.6a skips a TMUX_TMPDIR whose realpath() fails and falls back to
   /tmp/tmux-<uid>/default, the machine's own server, so a folder that went missing before the kill (a /tmp sweep,
   another cleanup, a reordered finally) ends every agent session on the machine. That is how every bot on Agent1s
   was restarted at 14:22 on 2026-10-21 (#6851, #6855). -S and -L never fall back.
   Shell scripts are not read here: tools/test-linux-systemd-live-4918.sh is #6852's (PR #6853).

   The files are read as tokens, not lines (review 2: a glob like 'engine/*.test.js' read as a comment opener hid
   real code from a text scan). What it cannot see, by construction: a name split across strings
   ('kill-ser' + 'ver'), a flag built at run time, and a wrapper whose -L is only a default parameter's value. */
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

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const named = (tok) => tok.t === 'str' && (tok.v === '-S' || tok.v === '-L');

/* The bracket that directly holds token `i` (its '(' or '['), or -1. Review 3: the walk stops at a '{' and at a ';',
   so a kill-server inside a callback is never vouched for by an -S earlier in that callback. */
function holder(toks, i) {
  let d = 0;
  for (let j = i - 1; j >= 0; j -= 1) {
    const v = toks[j].t === 'p' ? toks[j].v : '';
    if (CLOSE.has(v)) d += 1;
    else if (OPEN.has(v)) { if (d > 0) { d -= 1; continue; } return v === '{' ? -1 : j; }
    else if (v === ';' && d === 0) return -1;
  }
  return -1;
}

/* The index of the '[' that matches the ']' at `j`, or -1. */
function openerOf(toks, j) {
  let d = 0;
  for (let k = j; k >= 0; k -= 1) {
    const v = toks[k].t === 'p' ? toks[k].v : '';
    if (CLOSE.has(v)) d += 1; else if (OPEN.has(v)) { d -= 1; if (d === 0) return k; }
  }
  return -1;
}

/* Tokens [a, b) of every definition of `name` (`const name = ...` to the end of that statement, or
   `function name(...) {...}`). Review 3: with several (a helper per test), every one must name the socket, since
   which one a call reaches depends on scope this does not model. */
function definitions(toks, name) {
  const out = [];
  for (let start = 0; start < toks.length - 2; start += 1) {
    const a = toks[start], b = toks[start + 1], c = toks[start + 2];
    const fn = a.t === 'id' && a.v === 'function' && b.t === 'id' && b.v === name && c.v === '(';
    if (!fn && !(a.t === 'id' && ['const', 'let', 'var'].includes(a.v) && b.t === 'id' && b.v === name && c.v === '=')) continue;
    let d = 0, k = fn ? start + 2 : start + 3;   // from the parameters' '(', or from the token after '='
    for (; k < toks.length; k += 1) {
      const v = toks[k].t === 'p' ? toks[k].v : '';
      if (OPEN.has(v)) d += 1;
      else if (CLOSE.has(v)) { d -= 1; if (fn && d === 0 && v === '}') { k += 1; break; } if (d < 0) break; }
      else if (!fn && d === 0 && (v === ';' || v === ',')) break;
      /* An arrow with no braces and no semicolon ends at a new line at depth 0, unless that line continues the
         expression (review 2: it ran into the next statement and took that one's -L). */
      if (!fn && d === 0 && k > start + 3 && toks[k].line > toks[k - 1].line
        && !['=', '=>', '(', ',', '+', '?', ':', '.', '||', '&&', '??'].includes(toks[k - 1].v)
        && !['.', '?', ':', '+', '||', '&&', '??'].includes(toks[k].v)) break;
    }
    out.push(toks.slice(start, k));
  }
  return out;
}

/* For `mod.fn(...)`, the tokens of the file `mod` is required from (relative to `dir`), or null. */
function requiredFile(toks, mod, dir) {
  for (let j = 0; j < toks.length - 4; j += 1) {
    if (toks[j].v === mod && toks[j + 1].v === '=' && toks[j + 2].v === 'require' && toks[j + 3].v === '(' && toks[j + 4].t === 'str' && toks[j + 4].v.startsWith('.')) {
      const f = path.resolve(dir, toks[j + 4].v);
      for (const p of [f, f + '.js']) { try { return lex(fs.readFileSync(p, 'utf8')); } catch { /* next */ } }
    }
  }
  return null;
}

/* A run of argument tokens names the socket: an '-S' or '-L' after the last ';' element (review 3: a capture-pane's
   -S before a ';' is not the kill's), and not under a '?' (a socket that is only sometimes there names nothing). */
function namesSocket(args) {
  let k = args.length;
  for (let j = args.length - 1; j >= 0; j -= 1) if (args[j].t === 'str' && args[j].v === ';') { k = j; break; }
  const own = k === args.length ? args : args.slice(k + 1);
  return own.some(named) && !own.some((t) => t.t === 'p' && t.v === '?');
}

/* Every kill-server whose server is not named. Two shapes:
   - an argument ('kill-server'): it must sit directly in an array or a call (one held in a variable is flagged:
     nothing can see which call gets it). That array, or the call's arguments before it, must name the socket; or,
     for an array handed straight to a call, the call's earlier arguments, the array a `.concat(...)` extends, or
     every definition of the wrapper it is handed to (`tm(['kill-server'])`, `mod.fn(...)` through its require).
   - inside a command string ('tmux kill-server', a template): each tmux command holding it (split at ; && || | and
     new lines) must say -S or -L itself. */
function bareKills(src, dir) {
  const toks = lex(src);
  const found = [];
  const CMD = /(^|[^\w-])kill-server\b/;
  toks.forEach((tok, i) => {
    if (tok.t !== 'str') return;
    if (tok.v !== 'kill-server') {
      if (!CMD.test(tok.v)) return;
      const cmds = tok.v.split(/;|&&|\|\||\||\n/).filter((s) => CMD.test(s));
      if (!cmds.every((s) => /(^|\s)-(S|L)(\s|$)/.test(s))) found.push({ line: tok.line, text: tok.v });
      return;
    }
    const flag = (why) => found.push({ line: tok.line, text: "'kill-server' " + why });
    let h = holder(toks, i);
    if (h < 0) return flag('outside any array or call');
    if (namesSocket(toks.slice(h + 1, i))) return;
    let call = h;
    if (toks[h].v === '[') {
      const prev = toks[h - 1];
      if (!prev || !(prev.v === '(' || prev.v === ',')) return flag('in an array no call is handed');
      call = holder(toks, h);
      if (call < 0 || toks[call].v !== '(') return flag('in an array no call is handed');
      if (namesSocket(toks.slice(call + 1, h))) return;
    }
    const callee = toks[call - 1];
    if (!callee || callee.t !== 'id') return flag('handed to a call with no name');
    if (callee.v === 'concat' && toks[call - 2] && toks[call - 2].v === '.' && toks[call - 3] && toks[call - 3].v === ']') {
      const o = openerOf(toks, call - 3);
      if (o >= 0 && namesSocket(toks.slice(o + 1, call - 3))) return;
      return flag('concatenated onto an array with no socket');
    }
    let defs;
    if (toks[call - 2] && toks[call - 2].v === '.' && toks[call - 3] && toks[call - 3].t === 'id') {
      const from = dir ? requiredFile(toks, toks[call - 3].v, dir) : null;
      defs = from ? definitions(from, callee.v) : [];
    } else defs = definitions(toks, callee.v);
    if (defs.length && defs.every((d) => d.some(named))) return;
    flag('handed to ' + callee.v + '()' + (defs.length ? ', which does not name a socket' : ''));
  });
  return found;
}

/* Exact 'kill-server' arguments in a file's code (comments, regex literals and longer strings not counted). */
const killArgs = (src) => lex(src).filter((t) => t.t === 'str' && t.v === 'kill-server').length;

test('#6857: the checker flags a kill-server with no named socket, and passes one with -S or -L (control)', () => {
  const flags = (s) => bareKills(s).length;
  assert.equal(flags("execFileSync(T, ['kill-server'], { env })"), 1, 'a bare kill-server must be flagged');
  assert.equal(flags("run({ ...base, TMUX_TMPDIR: d }, ['kill-server']);"), 1, 'TMUX_TMPDIR alone must be flagged');
  assert.equal(flags("execFileSync(T, ['-S', sock, 'kill-server'])"), 0);
  assert.equal(flags("execFileSync(T, ['-L', name, 'kill-server'])"), 0);
  assert.equal(flags("// never a bare 'kill-server' here\n/* nor ['kill-server'] */"), 0, 'a comment is not a call');
  assert.equal(flags("const tm = (a) => execFileSync(T, ['-L', sock, ...a]);\ntm(['kill-server']);"), 0);
  assert.equal(flags("const tm = (a) => execFileSync(T, a, { env });\ntm(['kill-server']);"), 1, 'a wrapper with no socket must be flagged');
  assert.equal(flags("run(['kill-server']);"), 1, 'a wrapper that cannot be found must be flagged');
  // Review 1.
  assert.equal(flags("execSync('tmux kill-server')"), 1, 'a command string must be flagged');
  assert.equal(flags('execSync(`${T} kill-server`)'), 1, 'a template string must be flagged');
  assert.equal(flags("tm(['capture-pane','-S','-200']); tm(['kill-server']);"), 1, "another call's -S vouches for nothing");
  assert.equal(flags("const run = (a) => spawnSync(T, ['-L', x, ...a]);\n{ const run = (a) => spawnSync(T, a); run(['kill-server']); }"), 1, 'the nearest definition is the one called');
  assert.equal(flags("const tm = (a) => execFileSync(T, a); // never '-L' here\ntm(['kill-server']);"), 1, 'a -L in a comment names nothing');
  assert.equal(flags("function tm(a) {\n  return execFileSync(T, a);\n}\nconst other = ['-L', 'x'];\ntm(['kill-server']);"), 1, "a -L after the wrapper's end is not its own");
  // Review 2.
  assert.equal(flags("glob('engine/*.test.js'); execFileSync(T, ['kill-server']); /* end */"), 1, 'a /* inside a string opens no comment');
  assert.equal(flags("const r = x.replace(/\\/*$/, ''); execFileSync(T, ['kill-server']); /* end */"), 1, 'a /* inside a regex opens no comment');
  assert.equal(flags("const u = 'http: //h'; execFileSync(T, ['kill-server']);"), 1, 'a // inside a string opens no comment');
  assert.equal(flags("const tm = (a) => execFileSync(T, a)\nconst o = ['-L', 'x']\ntm(['kill-server'])"), 1, 'an arrow with no semicolon ends at its line');
  assert.equal(flags("const tm = (a) => execFileSync(T, a, `[`)\nconst o = ['-L', 'x']\ntm(['kill-server'])"), 1, 'a bracket in a string does not move the depth');
  assert.equal(flags('execSync(`tmux -L k new -d; tmux kill-server`)'), 1, "another command's -L in the same string vouches for nothing");
  // Review 3.
  assert.equal(flags("test('t', () => { execFileSync(T, ['-L', s, 'new']); const args = ['kill-server']; execFileSync(T, args); })"), 1, 'an array in a variable is flagged');
  assert.equal(flags("test('t', () => { tm(['capture-pane', '-S', '-200']); x(); run(['kill-server']); })"), 1, "a callback's earlier -S vouches for nothing");
  assert.equal(flags("execSync('tmux -L a kill-server; tmux kill-server')"), 1, 'every kill-server in a command string');
  assert.equal(flags("execFileSync(T, ['capture-pane', '-p', '-S', '-50', ';', 'kill-server'])"), 1, "a -S before a ';' is another command's");
  assert.equal(flags("test('a', () => { const tm = (a) => execFileSync(T, ['-L', s, ...a]); });\nconst tm = (a) => execFileSync(T, a);\ntm(['kill-server']);"), 1, 'every definition of a wrapper must name the socket');
  assert.equal(flags("execFileSync(T, [...(sock ? ['-S', sock] : []), 'kill-server'])"), 1, 'a socket that is only sometimes there names nothing');
  assert.equal(flags("let n = 1; n++ / 2; execFileSync(T, ['kill-server']);"), 1, 'n++ / 2 is a division, not a regex');
  assert.deepEqual(bareKills("#!/usr/bin/env node\nconst a = /x/;\n\nexecFileSync(T, ['kill-server']);").map((k) => k.line), [4], 'line numbers hold after a hashbang');
  // Passing twins.
  assert.equal(flags('execSync(`${T} -S ${sock} kill-server`)'), 0);
  assert.equal(flags("execSync('tmux -L k1 kill-server')"), 0);
  assert.equal(flags("function tm(a) {\n  const full = ['-L', s].concat(a);\n  return execFileSync(T, full);\n}\ntm(['kill-server']);"), 0);
  assert.equal(flags("execFileSync(T, [\n  '-S', sock,\n  'kill-server',\n]);"), 0, 'an array over several lines');
  assert.equal(flags("spawnSync(T, ['-S', s].concat(['kill-server']))"), 0, 'concat onto a named socket');
  assert.equal(flags("const tm = (a) => execFileSync(T, a)\nconst o = ['-L', 'x']\ntm(['kill-server'])\nconst tn = (a) => execFileSync(T, ['-L', s, ...a])\ntn(['kill-server'])"), 1, 'only the bare one');
});

/* Every file that holds a real kill-server today, and how many. The scan must reach each with at least that many, so
   a walk or a lexer that stops seeing code fails here instead of passing clean (review 2: a count over the whole repo
   was padded by a regex literal and an expected string). */
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
  const files = jsFiles(ROOT, []);
  const bad = [];
  const reached = {};
  for (const f of files) {
    if (f === __filename) continue;   // this file's controls hold bare examples on purpose
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes('kill-server')) continue;
    reached[rel] = killArgs(src);
    for (const k of bareKills(src, path.dirname(f))) bad.push(rel + ':' + k.line + '  ' + k.text);
  }
  for (const [rel, n] of Object.entries(EXPECTED)) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' is gone: if its kill-server moved, update EXPECTED here');
    assert.ok((reached[rel] || 0) >= n, rel + ': the scan saw ' + (reached[rel] || 0) + ' kill-server calls, expected ' + n + '; it is not reading that file');
  }
  assert.deepEqual(bad, [], 'kill-server with no -S or -L (name the socket, kosmos#6857):\n' + bad.join('\n'));
});
