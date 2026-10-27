'use strict';
/**
 * #7262: one reader (tools/lib/command-words.cjs) says which words a child_process call runs, and both test guards
 * use it: the Windows scheduler guard (tools/lib/schtasks-call.cjs) and the real-CLI guard (test-support/tool-guard.js).
 * The agreement table is the drift check: one call shape, with the program slot filled by schtasks for one guard and
 * by a stand-in real gh for the other, must get the same answer from both. Before #7262 tool-guard missed env given
 * as the file, -EncodedCommand, timeout, if, ! and a redirect in front; schtasks-call missed sudo; tool-guard read a
 * bare sudo but took the option itself (sudo -u root) for the command; and both missed a prefix word (nohup, timeout)
 * given as the file.
 * Pure: nothing is spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { callWords, lineWords } = require('./tools/lib/command-words.cjs');
const { callRuns, commandRuns } = require('./tools/lib/schtasks-call.cjs');
const { realToolInScript, refusedCall } = require('./test-support/tool-guard');

const b64 = (s) => Buffer.from(s, 'utf16le').toString('base64');
/* The stand-in for a real gh: a POSIX script with an execute bit, or on Windows gh.cmd, which is what PATH and PATHEXT
   find there (#7318: tool-guard reads Windows paths, extensions and PATH lookup). */
const WIN = process.platform === 'win32';
const GH = WIN ? 'gh.cmd' : 'gh';
const writeGh = (dir) => {
  const p = path.join(dir, GH);
  fs.writeFileSync(p, WIN ? '@echo off\r\n' : '#!/bin/sh\n');
  fs.chmodSync(p, 0o755);
  return p;
};

test('#7262: the words a call runs are the ones in command position, not its arguments', () => {
  assert.deepEqual(lineWords('X=1 nohup gh auth status'), ['nohup', 'gh']);
  assert.deepEqual(lineWords('git commit -m "fix; gh door"'), ['git']);
  assert.deepEqual(lineWords('cd /x && sudo -u root /opt/x/gh api'), ['cd', 'sudo', '/opt/x/gh']);
  assert.deepEqual(callWords('/usr/bin/env', ['A=b', 'gh', 'x']), ['/usr/bin/env', 'env', 'gh']);
  assert.deepEqual(callWords('pwsh', ['-EncodedCommand', b64('gh x')]), ['pwsh', 'gh']);
  assert.deepEqual(callWords('git', ['grep', 'gh']), ['git']);
  // cmd: node quotes "a & gh", so cmd only echoes it; ver&gh runs gh.
  assert.ok(!callWords('cmd.exe', ['/c', 'echo', 'a & gh']).includes('gh'));
  assert.ok(callWords('cmd.exe', ['/c', 'ver&gh']).includes('gh'));
});

/* [shape, runs]. A string is a shell command line; an array is [file, args, options]. P is the program slot. */
const SHAPES = [
  ['P /x', true],
  ['X=1 P', true],
  ['nohup P', true],
  ['sudo -u root P', true],
  ['timeout 5 P', true],
  ['if exist a.txt P', true],
  ['! P', true],
  ['2>&1 P', true],
  ['env A=b P', true],
  ['cmd /c "P /End"', true],
  ['cd /x && P', true],
  ['echo $(P api user)', true],
  ['TOKEN="$(P auth token)"', true],   // review 1: a substitution inside double quotes runs
  ['echo "a \\" b" ; P x', true],   // review 4: an escaped quote does not end the string
  ['\\P x', true],   // review 4: a leading backslash (past an alias) still runs the program
  ['echo "\\$(P)"', false],   // an escaped $( is text
  ['bash -c "echo \\" x; P"', true],   // the escape inside one word: the script after -c stays one word at its space
  ["echo 'a\\' ; P", true],   // inside single quotes a backslash is text, so the quote ends
  ['echo "`P`"', true],
  ['echo "$(echo P)"', false],
  ['echo "a (P) b"', false],   // parentheses inside double quotes are text
  ['sudo -iu root P', true],   // review 1: a cluster ending in a value-taking letter
  ['sudo -uroot P', true],   // review 5: an attached value (the t of root is not -t)
  ['sudo -ujosh P', true],
  ['time -a -o out.txt P', true],   // review 5: time -a takes no value
  ['echo "$(echo \')\' ; P)"', true],   // review 5: a ) inside quotes does not close the substitution
  ['"/opt/my tools/nohup" P', true],   // a quoted path to a prefix word
  // #7320: shapes the reader missed (main's readers too)
  ['bash -c -- "P x"', true],   // -c's script is the first operand after the options
  ['bash -c -x "P"', true],
  ['eval P auth', true],   // eval runs its arguments as a command line
  ['eval "P auth"', true],
  ['coproc P', true],
  ['sudo -R /x P', true],   // -R DIR (--chroot) takes a value
  ['echo \\>&P', true],   // an escaped > is text, so the & cuts and P runs
  ['eval echo P', false],
  ['bash -c -- "echo P"', false],
  ['echo P', false],
  ['git commit -m "fix P"', false],
  ['command -v P', false],
  ['ls | grep P', false],
  [['P', []], true],
  [['/usr/bin/env', ['P']], true],
  [['sudo', ['P', 'x']], true],
  [['nohup', ['P']], true],   // a prefix word given as the FILE runs its argument too (#7262; neither guard read it)
  [['timeout', ['5', 'P']], true],
  [['timeout', ['/t', '5']], false],   // Windows' timeout: a wait, which runs nothing
  [['cmd.exe', ['/c', 'ver&P']], true],
  [['cmd.exe', ['/c', 'echo', 'a & P']], false],
  [['pwsh', ['-Command', 'P x']], true],
  [['pwsh', ['-EncodedCommand', 'ENC(P x)']], true],
  [['pwsh', ['-Exec', 'Bypass', '-Command', 'P x']], true],   // review 5: a switch not listed, then -Command
  [['fish', ['-C', 'x', '-c', 'P']], true],   // review 5: fish -C takes a value
  [['fish', ['-C', 'P y', '-c', 'echo']], true],   // ...and runs it
  [['/bin/bash', ['-C', '-c', 'P']], true],   // bash -C takes none
  [['/bin/bash', ['-c', 'a && \\\nP x']], true],   // review 6: a backslash-newline joins the lines (POSIX only, read once)
  [['/bin/bash', ['-c', 'set -e; \\\n  P api']], true],
  [['/bin/bash', ['-c', 'a && \\\r\nP x']], true],
  [['/bin/bash', ['-c', "echo $'it\\'s'; P"]], true],   // review 6: $'...' honours a backslash
  [['/bin/bash', ['-c', "echo 'a\\'; P"]], true],   // ...while plain single quotes do not
  ['env --default-path /usr/bin P', true],   // review 6: env -P / --default-path takes a value (the table fills every capital P, so the long form)
  [['/bin/bash', ['-lc', 'nohup P x']], true],
  [['/bin/sh', ['-c', 'echo P']], false],
  [['/bin/sh', ['-c', 'bash -c "echo \\" x; P"']], true],   // review 4: POSIX only (no second reading), so words() must honour the escape
  [['/bin/bash', ['script.sh']], false],
  [['git', ['grep', 'P']], false],
  [['P x', [], { shell: true }], true],
];
/* One pass, so an ENC(...) row's base64 is never scanned for P again: a temp path whose base64 held a capital P was
   rewritten after encoding and the row failed about 4% of runs (Homer, measured on his box and in 2,000 paths). */
const fill = (shape, p) => {
  const one = (s) => s.replace(/ENC\(([^)]*)\)|P/g, (m, inner) => (inner === undefined ? p : b64(inner.replace(/P/g, p))));
  return typeof shape === 'string' ? one(shape) : [one(shape[0]), shape[1].map(one), shape[2]];
};

test('#7262: fill substitutes the program once, so an encoded row survives a base64 that contains P', () => {
  // A temp-shaped path whose encoded row holds a capital P, found by search (3 to 4% of random temp paths do: 614 of
  // 20,000 in review, 77 of 2,000 on Homer's box).
  const p = '/tmp/aw-cmdwords-7262-Oa/gh';
  assert.ok(b64(`${p} x`).includes('P'), 'the planted path no longer encodes with a capital P, so this test proves nothing');
  const [, args] = fill(['pwsh', ['-EncodedCommand', 'ENC(P x)']], p);
  assert.equal(Buffer.from(args[1], 'base64').toString('utf16le'), `${p} x`);
});

test('#7262: tool-guard judges a BARE name by the call\'s PATH through the shared reader (review 1)', () => {
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cmdwords-7262-path-'));
  writeGh(stub);
  try {
    const env = { PATH: stub };
    // Without the stand-in marked real, a PATH-stub fake is allowed: the CONTROL.
    assert.equal(realToolInScript('nohup gh x', undefined, env), null);
    assert.equal(refusedCall('/usr/bin/env', ['gh', 'x'], { env }), null);
    process.env.KOSMOS_TOOL_GUARD_REAL_DIRS = stub;
    assert.equal(realToolInScript('nohup gh x', undefined, env), 'gh');
    assert.equal(realToolInScript('TOKEN="$(gh auth token)"', undefined, env), 'gh');
    assert.equal(refusedCall('/usr/bin/env', ['gh', 'x'], { env }), 'gh');
    assert.equal(refusedCall('sudo', ['-iu', 'root', 'gh'], { env }), 'gh');
  } finally {
    delete process.env.KOSMOS_TOOL_GUARD_REAL_DIRS;
    fs.rmSync(stub, { recursive: true, force: true });
  }
});

test('#7262: both guards give the same answer for every call shape (the readers cannot drift)', () => {
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cmdwords-7262-'));
  const gh = writeGh(stub);
  process.env.KOSMOS_TOOL_GUARD_REAL_DIRS = stub;   // the stand-in counts as a real install
  try {
    for (const [shape, runs] of SHAPES) {
      const label = JSON.stringify(shape);
      const s = fill(shape, 'schtasks');
      const t = fill(shape, gh);
      const sched = typeof s === 'string' ? commandRuns(s) : callRuns(s[0], s[1], s[2]);
      assert.equal(sched, runs, `schtasks guard on ${label}`);
      const tool = (typeof t === 'string' ? realToolInScript(t) : refusedCall(t[0], t[1], t[2])) === 'gh';
      assert.equal(tool, runs, `tool guard on ${label}`);
    }
  } finally {
    delete process.env.KOSMOS_TOOL_GUARD_REAL_DIRS;
    fs.rmSync(stub, { recursive: true, force: true });
  }
});

test('#7320: a word a shell unescapes is read in both spellings; an unclosed "$( repeated stays cheap', () => {
  // POSIX: $'...' and a backslash inside a word are removed by bash, so these run schtasks
  for (const cmd of ["$'schtasks' /Query", 'sch\\tasks /Query', "x=1 $'sch''tasks'"]) assert.equal(commandRuns(cmd), true, cmd);
  // cmd: ^ is cmd's escape, so schtas^ks runs schtasks
  assert.equal(callRuns('cmd.exe', ['/c', 'schtas^ks /Query']), true);
  assert.deepEqual(lineWords("$'gh' auth").includes('gh'), true);
  // CONTROL: the escape of another word, and a caret in an argument
  for (const cmd of ["$'node' x.js", 'echo sch\\tasks']) assert.equal(commandRuns(cmd), false, cmd);
  assert.equal(callRuns('cmd.exe', ['/c', 'echo schtas^ks']), false);
  // the recursion over an unclosed "$( is capped (it was quadratic: 3000 repeats took 1.5 s)
  const t0 = Date.now();
  commandRuns('echo "$('.repeat(3000));
  callRuns('bash', ['-c', 'echo "$('.repeat(3000)]);
  assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0) + ' ms');
});

test('#7320 review 1: eval unescapes double quotes, an escaped launcher is a launcher, ANSI-C codes, no unescaping without a shell', () => {
  // each ran its middle command under Git Bash or cmd (checked live with echo in its place)
  for (const cmd of ["eval \"echo a\\\\'; schtasks; echo b\\\\'\"", 'b\\ash -c schtasks', "$'bash' -c schtasks", 'e\\nv schtasks',
    'e\\val schtasks', "$'eval' schtasks", "$'sch\\x74asks' /q", "$'sch\\164asks' /q"])
    assert.equal(commandRuns(cmd), true, cmd);
  assert.equal(callRuns('cmd', ['/c', 'c^md /c schtasks']), true);
  // CONTROL: eval of an escaped quote only prints; no shell reads a spawn argument
  assert.equal(commandRuns('eval "echo \\"x; schtasks\\""'), false);
  assert.equal(callRuns('env', ['sch\\tasks']), false);
  // after /c, cmd drops the outer quotes, so the caret escapes again: "ec^ho" hi printed hi (measured live)
  assert.equal(callRuns('cmd', ['/c', '"sch^tasks"'], { windowsVerbatimArguments: true }), true);
  assert.equal(commandRuns('echo "sch^tasks"'), false, 'a caret inside quotes in an argument is text');
});

test('#7320 review 2: a flat chain of escaped prefixes; \\U and NUL in $\'...\'; one-pass unescaping', () => {
  // bash ran each (checked live with echo in place of schtasks)
  for (const cmd of ['n\\ice '.repeat(8) + 'schtasks', 'e\\val '.repeat(5) + 'schtasks', "$'\\U73'chtasks /q", "$'schtasks\\0junk' /q"])
    assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL: spellings bash does not produce (it runs sch\tasks, or reads A=1 as a command)
  for (const cmd of ["$'sch\\\\tasks' /q", "\\$'sch'tasks /q", "$'sch\\x27tasks' /q"]) assert.equal(commandRuns(cmd), false, cmd);
  const t0 = Date.now();
  commandRuns('n\\ice '.repeat(16000) + 'schtasks');
  assert.ok(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0) + ' ms');
});

test('#7320 review 3: nested env -S with escaped values stays cheap; $"..." quoting; C escapes in $\'...\'', () => {
  // was 98 s at n = 4000 (each level branched eight ways); main took 0 ms
  const line = 'env -S A=\\\\\'1\' '.repeat(6) + 'x '.repeat(4000);
  const t0 = Date.now();
  commandRuns(line);
  callRuns('bash', ['-c', line]);
  assert.ok(Date.now() - t0 < 1500, 'took ' + (Date.now() - t0) + ' ms');
  // and the memo does not hide a real one: the same nesting still finds schtasks at its end
  assert.equal(commandRuns('env -S A=\\\\\'1\' '.repeat(3) + 'schtasks'), true);
  // bash runs $"echo" HIT (checked live)
  for (const cmd of ['$"schtasks" /q', 'sch$"t"asks /q']) assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL: \t in $'...' is a tab, so sch<TAB>asks is not schtasks
  assert.equal(commandRuns("$'sch\\tasks' /q"), false);
});

test('#7320 review 4: the env -S memo tells apart word lists that join to the same text', () => {
  // the second command really runs schtasks (GNU env runs env -u x schtasks); a memo keyed on joined text hid it
  assert.equal(callRuns('bash', ['-c', "env -S \"-S -u 'x\\\" \\\"schtasks'\"; bash -c 'env -S -u \"x\" \"schtasks\"'"]), true);
  assert.equal(callRuns('env', ['-S', 'env -S -u', 'x" "schtasks']), true);
  // CONTROL: the one-argument form alone runs nothing
  assert.equal(callRuns('env', ['-S', '-u', 'x" "schtasks']), false);

test('#7318: tool-guard reads Windows names, paths and PATH lookup on Windows, and only there', () => {
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-toolguard-7318-'));
  try {
    if (!WIN) {
      // CONTROL: the POSIX reading is unchanged; gh.exe is not gh, and a backslash is not a path separator.
      assert.equal(refusedCall('/opt/x/gh.exe', []), null);
      assert.equal(refusedCall('/opt/x/gh', []), 'gh');
      return;
    }
    const bin = path.join(stub, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh.exe'), '');
    fs.writeFileSync(path.join(bin, 'vercel.cmd'), '@echo off\r\n');
    fs.writeFileSync(path.join(bin, 'cloudflared.ps1'), '');   // not on PATHEXT: not something PATH lookup runs
    // Not real yet: a stand-in under the temp dir is a fake (the CONTROL), whichever way it is spelled.
    assert.equal(refusedCall(path.join(bin, 'gh.exe'), []), null);
    assert.equal(refusedCall(path.join(bin, 'gh.exe').toUpperCase(), []), null, 'the allowed roots compare case-insensitively');
    process.env.KOSMOS_TOOL_GUARD_REAL_DIRS = bin;
    // A path with a backslash or a drive letter, any case, any PATHEXT extension.
    assert.equal(refusedCall(path.join(bin, 'gh.exe'), ['auth', 'status']), 'gh');
    assert.equal(refusedCall(path.join(bin, 'GH.EXE'), []), 'gh');
    assert.equal(refusedCall(path.join(bin, 'vercel.cmd'), ['whoami']), 'vercel');
    assert.equal(realToolInScript('"' + path.join(bin, 'gh.exe') + '" auth status'), 'gh');
    // A bare name through PATH plus PATHEXT, with PATH spelled as a copy of process.env spells it (Path).
    assert.equal(refusedCall('gh', ['x'], { env: { Path: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' } }), 'gh');
    assert.equal(refusedCall('vercel', ['x'], { env: { PATH: bin } }), 'vercel', 'PATHEXT defaults when the env has none');
    assert.equal(realToolInScript('cmd /c "vercel whoami"', undefined, { PATH: bin }), 'vercel');
    // CONTROL: a name PATH plus PATHEXT does not find, and a tool named only in an argument.
    assert.equal(refusedCall('cloudflared', [], { env: { PATH: bin } }), null);
    assert.equal(refusedCall('git', ['commit', '-m', 'fix gh.exe'], { env: { PATH: bin } }), null);
    assert.equal(refusedCall('gh', ['x'], { env: { PATH: path.join(stub, 'empty') } }), null, 'a name found nowhere runs nothing');
  } finally {
    delete process.env.KOSMOS_TOOL_GUARD_REAL_DIRS;
    fs.rmSync(stub, { recursive: true, force: true });
  }
});
