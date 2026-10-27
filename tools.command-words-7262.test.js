'use strict';
/**
 * #7262: one reader (tools/lib/command-words.cjs) says which words a child_process call runs, and both test guards
 * use it: the Windows scheduler guard (tools/lib/schtasks-call.cjs) and the real-CLI guard (test-support/tool-guard.js).
 * The agreement table is the drift check: one call shape, with the program slot filled by schtasks for one guard and
 * by a stand-in real gh for the other, must get the same answer from both. Before #7262 tool-guard missed env,
 * -EncodedCommand, timeout, if, ! and a redirect in front; schtasks-call missed sudo; tool-guard read a bare sudo but
 * took an option's value (sudo -u root) for the command; and both missed a prefix word (nohup, timeout) given as the
 * file.
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
/* tool-guard's verdict is POSIX-shaped: a word is a path only when it has a '/', its name must be exactly gh, vercel
   or cloudflared (so gh.exe never matches), and a bare name resolves only to an executable file on PATH. It does not
   judge Windows paths, although tools/run-tests.sh preloads it on Windows too (#7318). So on win32 its arms here are
   skipped and the schtasks arms still run (measured on Homer's box, 10-27). */
const TOOL_GUARD_HOST = process.platform !== 'win32';

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
  ['echo "`P`"', true],
  ['echo "$(echo P)"', false],
  ['echo "a (P) b"', false],   // parentheses inside double quotes are text
  ['sudo -iu root P', true],   // review 1: a cluster ending in a value-taking letter
  ['"/opt/my tools/nohup" P', true],   // a quoted path to a prefix word
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
  [['/bin/bash', ['-lc', 'nohup P x']], true],
  [['/bin/sh', ['-c', 'echo P']], false],
  [['/bin/bash', ['script.sh']], false],
  [['git', ['grep', 'P']], false],
  [['P x', [], { shell: true }], true],
];
const fill = (shape, p) => {
  const one = (s) => s.replace(/ENC\(([^)]*)\)/, (m, inner) => b64(inner.replace(/P/g, p))).replace(/P/g, p);
  return typeof shape === 'string' ? one(shape) : [one(shape[0]), shape[1].map(one), shape[2]];
};

test('#7262: tool-guard judges a BARE name by the call\'s PATH through the shared reader (review 1)', { skip: !TOOL_GUARD_HOST && 'tool-guard does not judge Windows paths or executables (#7318)' }, () => {
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cmdwords-7262-path-'));
  fs.writeFileSync(path.join(stub, 'gh'), '#!/bin/sh\n');
  fs.chmodSync(path.join(stub, 'gh'), 0o755);
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
  const gh = path.join(stub, 'gh');
  fs.writeFileSync(gh, '#!/bin/sh\n');
  fs.chmodSync(gh, 0o755);
  process.env.KOSMOS_TOOL_GUARD_REAL_DIRS = stub;   // the stand-in counts as a real install
  try {
    for (const [shape, runs] of SHAPES) {
      const label = JSON.stringify(shape);
      const s = fill(shape, 'schtasks');
      const t = fill(shape, gh);
      const sched = typeof s === 'string' ? commandRuns(s) : callRuns(s[0], s[1], s[2]);
      assert.equal(sched, runs, `schtasks guard on ${label}`);
      if (!TOOL_GUARD_HOST) continue;   // nothing tool-guard does on Windows is measured here (#7318)
      const tool = (typeof t === 'string' ? realToolInScript(t) : refusedCall(t[0], t[1], t[2])) === 'gh';
      assert.equal(tool, runs, `tool guard on ${label}`);
    }
  } finally {
    delete process.env.KOSMOS_TOOL_GUARD_REAL_DIRS;
    fs.rmSync(stub, { recursive: true, force: true });
  }
});
