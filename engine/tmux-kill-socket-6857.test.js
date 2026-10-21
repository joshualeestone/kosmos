'use strict';
/* kosmos#6857: every kill-server in the repo's JavaScript names its server with -S or -L.
   TMUX_TMPDIR alone is not enough: tmux 3.6a skips a TMUX_TMPDIR whose realpath() fails and falls back to
   /tmp/tmux-<uid>/default, the machine's own server, so a folder that went missing before the kill (a /tmp sweep,
   another cleanup, a reordered finally) ends every agent session on the machine. That is how every bot on Agent1s
   was restarted at 14:22 on 2026-10-21 (#6851, #6855). -S and -L never fall back.
   Shell scripts are not read here: tools/test-linux-systemd-live-4918.sh is #6852's (PR #6853). */
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

const NAMED = /['"`]-(S|L)['"`]/;            // a quoted -S or -L argument
const NAMED_IN = /(^|\s)-(S|L)(\s|$)/;       // -S or -L inside one command string

/* Comments out, line breaks kept (so line numbers still match): a socket named only in a comment names nothing,
   and prose about kill-server is not a call. A `//` counts only after a space or punctuation, so 'http://x' stays. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;,{}()])\/\/[^\n]*/gm, (c, lead) => lead + ' '.repeat(c.length - lead.length));
}

/* The statement that defines `name` nearest before offset `pos` (else the first after it: a hoisted function), from
   `const name =` / `function name(` to the end of that statement by bracket depth. '' when there is none. Review 1:
   the first same-named definition in the file, plus three lines, let an unrelated `run` with -L vouch for another. */
function definition(text, name, pos) {
  const esc = name.replace(/\$/g, '\\$');
  const re = new RegExp('(?:(?:const|let|var)\\s+' + esc + '\\s*=|function\\s+' + esc + '\\s*\\()', 'g');
  let start = -1, after = -1, m;
  while ((m = re.exec(text))) { if (m.index < pos) start = m.index; else if (after < 0) after = m.index; }
  if (start < 0) start = after;
  if (start < 0) return '';
  let depth = 0, opened = false, i = start;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if ('({['.includes(ch)) { depth += 1; opened = true; }
    else if (')}]'.includes(ch)) { depth -= 1; if (opened && depth === 0 && ch === '}') { i += 1; break; } }
    else if (ch === ';' && depth === 0) break;
  }
  return text.slice(start, i);
}

/* A kill-server whose server is not named. Two shapes:
   - an argument ('kill-server'): the call it sits in must carry a quoted -S or -L before it, or the function it is
     handed to (a wrapper like `tm(['kill-server'])`) must add one. Review 1: only that call's own arguments count,
     so a capture-pane's `-S -200` earlier on the line vouches for nothing. A wrapper is looked up in the same file,
     or for `mod.fn(...)` in the file `mod` is required from (`dir`).
   - inside a command string ('tmux kill-server', `${T} kill-server`): that string must say -S or -L itself
     (review 1). A command assembled across several strings is flagged even when it names a socket: write it as
     one string or as arguments. */
function bareKills(raw, dir) {
  const text = stripComments(raw);
  const found = [];
  let offset = 0;
  text.split('\n').forEach((line, i) => {
    const flag = () => found.push({ line: i + 1, text: raw.split('\n')[i].trim() });
    const at = line.search(/['"`]kill-server['"`]/);
    if (at >= 0) {
      const before = line.slice(0, at);
      const call = /(?:([A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)\s*\([^()]*$/.exec(before);
      const own = call ? before.slice(call.index) : before.slice(before.lastIndexOf(';') + 1);
      if (!NAMED.test(own)) {
        let def = call ? definition(text, call[2], offset + call.index) : '';
        if (!def && call && call[1] && dir) {
          const req = new RegExp('\\b' + call[1] + "\\s*=\\s*require\\('(\\.[^']+)'\\)").exec(text);
          if (req) {
            const f = path.resolve(dir, req[1]);
            for (const p of [f, f + '.js']) { try { def = definition(stripComments(fs.readFileSync(p, 'utf8')), call[2], Infinity); break; } catch { /* next */ } }
          }
        }
        if (!NAMED.test(def)) flag();
      }
    }
    for (const s of line.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) {
      if (s[2] !== 'kill-server' && /(^|[^\w-])kill-server\b/.test(s[2]) && !NAMED_IN.test(s[2])) { flag(); break; }
    }
    offset += line.length + 1;
  });
  return found;
}

test('#6857: the checker flags a kill-server with no named socket, and passes one with -S or -L (control)', () => {
  assert.equal(bareKills("execFileSync(T, ['kill-server'], { env })").length, 1, 'a bare kill-server must be flagged');
  assert.equal(bareKills("run({ ...base, TMUX_TMPDIR: d }, ['kill-server']);").length, 1, 'TMUX_TMPDIR alone must be flagged');
  assert.equal(bareKills("execFileSync(T, ['-S', sock, 'kill-server'])").length, 0);
  assert.equal(bareKills("execFileSync(T, ['-L', name, 'kill-server'])").length, 0);
  assert.equal(bareKills('// never a bare kill-server here').length, 0, 'prose in a comment is not a call');
  // A wrapper that names the socket passes; one that does not is flagged where it is called.
  assert.equal(bareKills("const tm = (a) => execFileSync(T, ['-L', sock, ...a]);\ntm(['kill-server']);").length, 0);
  assert.equal(bareKills("const tm = (a) => execFileSync(T, a, { env });\ntm(['kill-server']);").length, 1, 'a wrapper with no socket must be flagged');
  assert.equal(bareKills("run(['kill-server']);").length, 1, 'a wrapper that cannot be found must be flagged');
  // Review 1's six shapes, each a bare kill-server the first version let through.
  assert.equal(bareKills("execSync('tmux kill-server')").length, 1, 'a command string must be flagged');
  assert.equal(bareKills('execSync(`${T} kill-server`)').length, 1, 'a template string must be flagged');
  assert.equal(bareKills("tm(['capture-pane','-S','-200']); tm(['kill-server']);").length, 1, "another call's -S vouches for nothing");
  assert.equal(bareKills("const run = (a) => spawnSync(T, ['-L', x, ...a]);\n{ const run = (a) => spawnSync(T, a); run(['kill-server']); }").length, 1, 'the nearest definition is the one called');
  assert.equal(bareKills("const tm = (a) => execFileSync(T, a); // never '-L' here\ntm(['kill-server']);").length, 1, 'a -L in a comment names nothing');
  assert.equal(bareKills("function tm(a) {\n  return execFileSync(T, a);\n}\nconst other = ['-L', 'x'];\ntm(['kill-server']);").length, 1, "a -L after the wrapper's end is not its own");
  // And their passing twins.
  assert.equal(bareKills('execSync(`${T} -S ${sock} kill-server`)').length, 0);
  assert.equal(bareKills("execSync('tmux -L k1 kill-server')").length, 0);
  assert.equal(bareKills("function tm(a) {\n  const full = ['-L', s].concat(a);\n  return execFileSync(T, full);\n}\ntm(['kill-server']);").length, 0);
});

test('#6857: no kill-server in the repo\'s JavaScript runs without -S or -L', () => {
  const files = jsFiles(ROOT, []);
  let seen = 0;
  const bad = [];
  for (const f of files) {
    // This file's own controls hold bare examples on purpose, and would pad the count below.
    if (f === __filename) continue;
    const text = fs.readFileSync(f, 'utf8');
    seen += (stripComments(text).match(/(^|[^\w-])kill-server\b/gm) || []).length;   // arguments and command strings
    for (const k of bareKills(text, path.dirname(f))) bad.push(path.relative(ROOT, f) + ':' + k.line + '  ' + k.text);
  }
  // The scan reads real calls: nine kill-servers exist today (live-connect, last-look, sandbox x2, agysignin,
  // musesignin, sessionccd, tmuxsignin, provider-key-inject). Under that, the walk is not reaching the files and a
  // clean result means nothing.
  assert.ok(seen >= 9, 'the scan found only ' + seen + ' kill-server calls; it is not reading the repo');
  assert.deepEqual(bad, [], 'kill-server with no -S or -L (name the socket, kosmos#6857):\n' + bad.join('\n'));
});
