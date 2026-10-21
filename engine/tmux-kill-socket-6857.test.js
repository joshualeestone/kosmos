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
    return !(p.v === ')' || p.v === ']' || p.v === '}');
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
      k += 1;
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
    if (src.startsWith('=>', i)) { toks.push({ t: 'p', v: '=>', line }); i += 2; continue; }
    toks.push({ t: 'p', v: c, line }); i += 1;
  }
  return toks;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const named = (tok) => tok.t === 'str' && (tok.v === '-S' || tok.v === '-L');

/* The '(' of the call that `i` is an argument of (passing through arrays and objects), or -1. */
function enclosingCall(toks, i) {
  let d = 0;
  for (let j = i - 1; j >= 0; j -= 1) {
    const v = toks[j].t === 'p' ? toks[j].v : '';
    if (CLOSE.has(v)) d += 1;
    else if (OPEN.has(v)) { if (d === 0) { if (v === '(') return j; } else d -= 1; }
  }
  return -1;
}

/* Tokens [a, b) of the definition of `name` nearest before token `at` (else the first after it: a hoisted function):
   `const name = ...` to the end of that statement, or `function name(...) {...}`. Null when there is none. */
function definition(toks, name, at) {
  let start = -1, after = -1;
  for (let j = 0; j < toks.length - 2; j += 1) {
    const a = toks[j], b = toks[j + 1], c = toks[j + 2];
    const hit = (a.t === 'id' && ['const', 'let', 'var'].includes(a.v) && b.t === 'id' && b.v === name && c.v === '=')
      || (a.t === 'id' && a.v === 'function' && b.t === 'id' && b.v === name && c.v === '(');
    if (!hit) continue;
    if (j < at) start = j; else if (after < 0) after = j;
  }
  if (start < 0) start = after;
  if (start < 0) return null;
  const fn = toks[start].v === 'function';
  let d = 0, k = fn ? start + 2 : start + 3;   // from the parameters' '(', or from the token after '='
  for (; k < toks.length; k += 1) {
    const v = toks[k].t === 'p' ? toks[k].v : '';
    if (OPEN.has(v)) d += 1;
    else if (CLOSE.has(v)) { d -= 1; if (fn && d === 0 && v === '}') { k += 1; break; } if (d < 0) break; }
    else if (!fn && d === 0 && (v === ';' || v === ',')) break;
    /* An arrow with no braces and no semicolon ends at a new line at depth 0, unless that line continues the
       expression (review 2: it ran into the next statement and took that one's -L). */
    if (!fn && d === 0 && k > start + 3 && toks[k].line > toks[k - 1].line
      && !['=', '=>', '(', ',', '+', '?', ':', '.', '||', '&&'].includes(toks[k - 1].v) && !['.', '?', ':', '+'].includes(toks[k].v)) break;
  }
  return [start, k];
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

/* Every kill-server whose server is not named. Two shapes:
   - an argument ('kill-server'): the call it is handed to must carry '-S' or '-L' among its arguments before it (a
     `[..].concat([...])` counts the array it extends), or the wrapper it is handed to (`tm(['kill-server'])`) must
     add one in its own definition.
   - inside a command string ('tmux kill-server', a template): the one tmux command it is part of (split at ; && ||
     | and new lines) must say -S or -L itself (review 2: another command's -L in the same string vouched for it). */
function bareKills(src, dir) {
  const toks = lex(src);
  const found = [];
  toks.forEach((tok, i) => {
    if (tok.t !== 'str') return;
    if (tok.v !== 'kill-server') {
      if (!/(^|[^\w-])kill-server\b/.test(tok.v)) return;
      const cmd = tok.v.split(/;|&&|\|\||\||\n/).find((s) => /(^|[^\w-])kill-server\b/.test(s));
      if (!/(^|\s)-(S|L)(\s|$)/.test(cmd)) found.push({ line: tok.line, text: tok.v });
      return;
    }
    let cp = enclosingCall(toks, i);
    while (cp > 0 && toks[cp - 1].v === 'concat' && toks.slice(cp + 1, i).every((t) => !named(t))) cp = enclosingCall(toks, cp);
    if (cp > 0 && toks.slice(cp + 1, i).some(named)) return;
    const callee = cp > 0 ? toks[cp - 1] : null;
    if (callee && callee.t === 'id') {
      let span = null, from = toks;
      if (cp > 2 && toks[cp - 2].v === '.' && toks[cp - 3].t === 'id' && dir) {
        from = requiredFile(toks, toks[cp - 3].v, dir) || toks;
        span = from === toks ? null : definition(from, callee.v, Infinity);
      } else span = definition(toks, callee.v, cp);
      if (span && from.slice(span[0], span[1]).some(named)) return;
    }
    found.push({ line: tok.line, text: "'kill-server'" + (callee ? ' handed to ' + callee.v + '()' : '') });
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
    assert.ok((reached[rel] || 0) >= n, rel + ': the scan saw ' + (reached[rel] || 0) + ' kill-server calls, expected ' + n + '; it is not reading that file');
  }
  assert.deepEqual(bad, [], 'kill-server with no -S or -L (name the socket, kosmos#6857):\n' + bad.join('\n'));
});
