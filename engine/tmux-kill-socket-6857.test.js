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

const NAMED = /['"`]-(S|L)['"`]/;

/* The few lines that define `name` (`const name = ...` or `function name(`) in `text`, or '' when it is not there. */
function definition(text, name) {
  const m = new RegExp('(?:(?:const|let|var)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=|function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\()').exec(text);
  return m ? text.slice(m.index).split('\n').slice(0, 4).join('\n') : '';
}

/* A kill-server written as an argument ('kill-server' or "kill-server") whose server is not named: no '-S' or '-L'
   before it on its line, and the function it is handed to (a wrapper like `tm(['kill-server'])`) does not add one
   either. A wrapper is looked up in the same file, or for `mod.fn(...)` in the file `mod` is required from (`dir`).
   Prose about kill-server in a comment is not quoted that way, so it is not read as a call. */
function bareKills(text, dir) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    const at = line.search(/['"`]kill-server['"`]/);
    if (at < 0) return;
    const before = line.slice(0, at);
    if (NAMED.test(before)) return;
    const call = /(?:([A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)\s*\([^()]*$/.exec(before);
    if (call) {
      let def = definition(text, call[2]);
      if (!def && call[1] && dir) {
        const req = new RegExp('\\b' + call[1] + "\\s*=\\s*require\\('(\\.[^']+)'\\)").exec(text);
        if (req) {
          const f = path.resolve(dir, req[1]);
          for (const p of [f, f + '.js']) { try { def = definition(fs.readFileSync(p, 'utf8'), call[2]); break; } catch { /* next */ } }
        }
      }
      if (NAMED.test(def)) return;
    }
    found.push({ line: i + 1, text: line.trim() });
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
});

test('#6857: no kill-server in the repo\'s JavaScript runs without -S or -L', () => {
  const files = jsFiles(ROOT, []);
  let seen = 0;
  const bad = [];
  for (const f of files) {
    // This file's own controls hold bare examples on purpose, and would pad the count below.
    if (f === __filename) continue;
    const text = fs.readFileSync(f, 'utf8');
    seen += (text.match(/['"`]kill-server['"`]/g) || []).length;
    for (const k of bareKills(text, path.dirname(f))) bad.push(path.relative(ROOT, f) + ':' + k.line + '  ' + k.text);
  }
  // The scan reads real calls: nine kill-servers exist today (live-connect, last-look, sandbox x2, agysignin,
  // musesignin, sessionccd, tmuxsignin, provider-key-inject). Under that, the walk is not reaching the files and a
  // clean result means nothing.
  assert.ok(seen >= 9, 'the scan found only ' + seen + ' kill-server calls; it is not reading the repo');
  assert.deepEqual(bad, [], 'kill-server with no -S or -L (name the socket, kosmos#6857):\n' + bad.join('\n'));
});
