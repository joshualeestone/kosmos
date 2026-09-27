'use strict';

/**
 * A harness board never phones home (#4253).
 *
 * 🛑 WHAT WENT WRONG. The install ping (engine/createdbeacon.js) is skipped only
 * when NODE_TEST_CONTEXT is set, and only node's own test runner sets it. Every
 * board a harness boots from bash (tools/browser-checks.sh, the shell tests
 * run-tests.sh runs, the release bundle's smoke) has a sandboxed data folder, so
 * it minted a fresh install id and told installkosmos.com a new Mac install
 * exists. Measured 2026-09-27: one allowlisted browser-checks run sent 14, and the
 * public install count took about 7,000 a day of them.
 *
 * 🛑 THE BEACON IS NOT CHANGED, and must not be (Josh, 2026-09-14, #3038: the real
 * install ping is never removed or made opt-out-able). The fix is in the
 * harnesses: each points AGENT_WORKFORCE_CREATED_URL, and the daily report's
 * AGENT_WORKFORCE_FEEDBACK_URL, at a dead local port, the way browser-checks.sh
 * already points its other outbound URLs at 127.0.0.1:9.
 *
 * Two halves:
 *   1. the CONTROL: a board booted outside node's test runner really does send the
 *      install ping, to whatever the variable names. Without this the other half
 *      would pin a line nobody needs.
 *   2. each harness sets the variable as a top-level export (or on the smoke
 *      boot's own environment) BEFORE its first board boot.
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
   never called, or under `if false`, would otherwise pass a column-0 check. */
function topLevel(lines, i) {
  let depth = 0;
  for (let k = 0; k < i; k += 1) {
    const l = lines[k];
    if (/^\s*#/.test(l)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{?\s*$/.test(l) || /^(if|for|while|until|case)\b/.test(l)) {
      if (!/\b(fi|done|esac)\s*;?\s*$/.test(l) && !/\}\s*;?\s*$/.test(l.replace(/\(\)\s*\{\s*$/, ''))) depth += 1;
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
  ];
  assert.equal(topLevel(src, 3), true, 'an export after a closed function is top level');
  assert.equal(topLevel(src, 5), false, 'an export inside a function body is not');
  assert.equal(topLevel(src, 8), false, 'an export inside an if is not');
});

test('#4253: test-install.sh\'s first installer run is the first one in the file', () => {
  const lines = fs.readFileSync(path.join(REPO, 'tools/test-install.sh'), 'utf8').split('\n');
  const re = HARNESSES.find(([, n]) => n === 'test-install.sh')[2];
  const first = lines.findIndex((l) => !/^\s*#/.test(l) && /\$SETUP"? *\|/.test(l) && /\bsh\b/.test(l));
  const found = lines.findIndex((l) => !/^\s*#/.test(l) && re.test(l));
  assert.equal(found, first, `the boot pattern finds line ${found + 1}, but the first installer run is line ${first + 1}`);
});
