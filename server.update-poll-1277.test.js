'use strict';
/* #1277: THE WIRING, not the mechanism.
 *
 * engine/update.test.js proves the poll works when something starts it. This
 * file proves SOMETHING STARTS IT, which is a different claim and the one the
 * card is actually about. #1277 was never a broken function: `poke()` was
 * correct and well tested, and had exactly one caller in the whole product,
 * the status route. A board nobody looked at therefore never checked for a
 * release and never installed one, with its own preference reading on.
 *
 * 🛑 SO A GUARD THAT ONLY DRIVES `startAutoPoll()` DIRECTLY WOULD REPRODUCE
 * THE DEFECT IT IS GUARDING. Delete the one call in server.js and every arm
 * in engine/update.test.js stays green while the bug returns in full.
 * Measured before this file existed: removing that line broke nothing.
 *
 * This boots the real server and asks whether the poll is running, which is
 * the only question that distinguishes "the machinery exists" from "the
 * machinery is driven".
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-update-poll-1277-'));
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
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* Long, so the boot never actually reaches the release host during the suite.
   This test asks whether the poll is RUNNING, never what it fetched. */
process.env.AGENT_WORKFORCE_UPDATE_POLL_MS = String(60 * 60 * 1000);

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const update = require('./engine/update');

test.before(async () => { await start(0); });
test.after(() => {
  update.stopAutoPoll();
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('#1277: booting the board starts the updater poll, so a machine nobody watches still updates', () => {
  assert.equal(update.autoPollRunning(), true,
    'the board booted without starting the update poll: poke() is back to having one caller, '
    + 'the status route, and a headless machine will sit frozen at its installed version');
});

test('#1277: startAutoPoll unrefs its timer, so a poll cannot hold the process open', () => {
  /* If this ever goes red, `kosmos start` stops exiting and every suite that
     boots the server hangs at the end instead of failing, which is far harder
     to diagnose than an assertion.

     🛑 SCOPE, STATED BECAUSE THE OLD NAME OVERCLAIMED. This drives
     startAutoPoll DIRECTLY, so it proves the MECHANISM unrefs. It does NOT
     inspect the timer the board started at boot: this call replaces that timer
     with a fresh one and asserts on the new object, so a `start()` that wired a
     ref'd poll by some other route would leave this green. That is the same
     wiring-versus-mechanism distinction this file's header is built on, and
     this arm is on the mechanism side of it.

     Closing it needs an accessor for the live timer, and I did not add one:
     an export only tests can reach is what the repo's engine.reachable guard
     catches, and it caught exactly that on this branch one iteration ago.
     I also tried observing it without an accessor, via
     process._getActiveHandles(); measured, that returns 0 Timeouts even for a
     deliberately ref'd interval, so the probe cannot tell the two apart and
     would have been a check that always passes. Recorded as a known gap rather
     than covered by an instrument that cannot fail. */
  const t = update.startAutoPoll({ every: 60 * 60 * 1000 });
  assert.equal(t.hasRef(), false, 'a ref\'d poll would keep the board process alive forever');
  update.stopAutoPoll();
});

test('#1277: every test file that boots the server sets DRY_RUN, so none can reach the release host', () => {
  /* The poll's fetch gate is a CONVENTION across sixteen files and nothing
     enforced it. All sixteen set it today, so the exposure is closed, but the
     next file somebody writes inherits nothing. The failure it prevents is not
     a red test: it is a test run that reaches installkosmos.com and, from an
     installed layout, spawns a real curl-pipe-sh installer. */
  const fs = require('node:fs'); const path = require('node:path');
  /* 🛑 THE RUNNER RUNS `engine/*.test.js` TOO, and the first version of this
     guard read only the repo root. There are over a hundred files under
     engine/, any of which could `require('../server')`, boot it, start this
     poll, and be invisible to a root-only scan. That is the exact "the next
     file somebody writes inherits nothing" case this arm's own reason names,
     one directory across. Measured today: zero engine tests require the
     server, so the exposure was latent rather than live. Matched on
     `require('...server')` rather than the literal './server' for the same
     reason. */
  const root = path.resolve(__dirname);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const full = path.join(d, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.test.js') ? [full] : [];
  });
  const files = walk(root);
  const boots = files.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
      /* IN-PROCESS boot: require the server and call start(). */
      if (/require\((['"])[^'"]*server\1\)/.test(src) && /\bstart\s*\(/.test(src)) return true;
      /* 🛑 CHILD-PROCESS boot, AND THE DETECTOR WAS BLIND TO IT. Seven files run
         `spawn(process.execPath, [path.join(REPO, 'server.js')])` instead of
         requiring it. That child runs server.js, which calls start(), which
         starts the poll, so they boot the server exactly as much as the
         in-process files do. A reviewer demonstrated the hole by planting two
         files: a require-shaped plant with no DRY_RUN was NAMED, a spawn-shaped
         plant with no DRY_RUN was NOT DETECTED.

         Nothing is exposed today, because all seven happen to set the variable
         in the child env. That is exactly the point: the guard's stated purpose
         is "so none can reach the release host", and it was accidentally true
         rather than enforced. The next file written in this shape passes
         silently. Verified after widening by planting a spawn-shaped file with
         no DRY_RUN and confirming it is NAMED. */
      return /server\.js['"]/.test(src) && /\b(spawn|fork|execFile)\s*\(/.test(src);
  }).map((f) => path.relative(root, f));
  assert.ok(boots.length >= 10,
    `only ${boots.length} files looked like they boot the server; the detector is probably wrong, `
    + 'and a detector that finds nothing would make this arm pass for the wrong reason');
  /* 🛑 MATCH THE VALUE, NOT THE NAME. The production gate is `=== '1'`, so a
     file that sets the variable to '' or '0', or that only names it in a
     comment or an assertion string, satisfies a bare-name search while its
     poll fetches for real. That is not hypothetical here: engine/remove.test.js
     sets AGENT_WORKFORCE_DRY_RUN to '' in a child env. A guard whose stated
     purpose is "none can reach the release host" must check the thing the
     product checks. */
  const SETS_IT = /AGENT_WORKFORCE_DRY_RUN\s*[:=]\s*['"]1['"]/;
  /* Excused BY NAME WITH A REASON, the same shape engine.reachable.test.js uses.
     An entry here is a claim someone can check, not a way to quiet the guard. */
  const EXCUSED = {
    'server.switch-account-1373.test.js':
      'sets it DELIBERATELY NOT: its header records that DRY_RUN also disables the account block, '
      + 'so a test that set it would measure a world where the feature never ran. It intercepts with '
      + 'setRunner(fake) instead, which engine/create.js checks BEFORE DRY_RUN (create.js:266 runs '
      + 'the runner, :267 reads DRY_RUN, verified by reading them). '
      + '⚠️ CORRECTED. This entry used to end "Checkable: delete its setRunner(fake) and its own '
      + 'control at the bottom goes red." I RAN THAT AND IT IS FALSE: removing the module-level '
      + 'create.setRunner leaves all 6 of that file own tests GREEN. Instrumenting the seam explains '
      + 'why, and the numbers are the point: a control marker proving the probe ran fired ONCE, and '
      + 'recorded invocations of the create runner were ZERO. That file never reaches the seam at '
      + 'all, so the interception is defence in depth rather than the thing protecting it. '
      + 'What actually protects it is the #1598 fail-closed live-execution gate at create.js:268, '
      + 'which THROWS in a test process unless server.js has called allowLiveExecution() on its real '
      + 'start path. The exception stands and its stated reason did not. '
      + 'A check that works: instrument create.setRunner to append on every call, run this file, and '
      + 'require the control marker to be non-zero and the invocation count to be zero. '
      + 'AND THE EXPOSURE IS CLOSED, not merely explained: that file now calls '
      + 'stopAutoPoll() immediately after start(), so it boots the server without leaving a live '
      + 'poll behind. An excuse that only says why a file cannot comply leaves the hole open.',
  };
  /* 🛑 AN EXCUSE MUST BE CHECKED, NOT JUST WRITTEN. The entry above says the
     exposure is closed because that file calls stopAutoPoll() right after
     start(), and NOTHING VERIFIED THAT. A reviewer deleted the line and both
     files stayed green, so the excuse closed its hole in prose only. Same defect
     as an unrun "checkable" claim, one layer up: the more carefully an excuse is
     argued, the less likely anyone re-reads it. Each excused file must now name a
     mitigation the guard actually checks. */
  const MITIGATION = {
    'server.switch-account-1373.test.js': {
      pattern: /\.stopAutoPoll\(\)/,
      says: 'calls stopAutoPoll() after start(), so it boots the server without leaving a live poll',
    },
  };
  const unmitigated = Object.keys(EXCUSED).filter((f) => {
    const m = MITIGATION[f];
    if (!m) return true;
    let src = '';
    try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch { return true; }
    return !m.pattern.test(src);
  });
  assert.deepEqual(unmitigated, [],
    'these files are EXCUSED from the DRY_RUN convention on the strength of a mitigation that is no '
    + 'longer present, so the excuse is now just an exemption: '
    + unmitigated.map((f) => `${f} (claimed: ${(MITIGATION[f] || {}).says || 'unstated'})`).join(', '));

  const missing = boots.filter((f) => !EXCUSED[f]
    && !SETS_IT.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(missing, [],
    `these files boot the server without setting AGENT_WORKFORCE_DRY_RUN: ${missing.join(', ')}. `
    + 'Booting the server starts the update poll, and without the gate that poll uses the real '
    + 'fetch against the real release host.');
});

test('#1277 convention: a test that opens installedRoot must inject an install runner', () => {
  /* 🛑 THIS GUARD EXISTS BECAUSE THE SUITE RAN THE REAL PRODUCTION INSTALLER.
     Two arms on this branch set setInstalledRoot() to a truthy path and opened
     every other gate without injecting a runner, so `node --test` spawned
     `curl -fsSL https://installkosmos.com/setup?v=9.9.9 | sh` twice per run, as
     the developer, with their real HOME. Measured, not inferred: that endpoint
     serves a real 201KB installer even for a version that does not exist, and
     the only thing that stopped it was the installer's own refusal to run under
     a live board, which is somebody else's last line of defence.

     engine/update.js now also refuses at the spawn site via the shared
     live-execution gate. This is the static half: the runtime gate stops it
     happening, and this stops it being WRITTEN, which is the cheaper place to
     catch it because it names the file and line for the author. */
  const fs = require('node:fs'); const path = require('node:path');
  const root = __dirname;
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.test.js')) files.push(f);
    }
  }(root));
  assert.ok(files.length > 50, `only ${files.length} test files found, the walk is broken`);

  /* ⚠️ THE PREDICATE IS NARROWED ON PURPOSE, AND THE FIRST VERSION WAS WRONG.
     Flagging every test that opens installedRoot caught FOUR MORE than the
     hazard, including two that predate this branch. The spawn probe measured
     exactly TWO real installer spawns across the whole suite, so a guard on
     installedRoot alone names a class wider than the defect and manufactures
     work on safe tests, which is how a guard gets excused into uselessness.
     Reaching the spawn needs installedRoot AND the preference open, because
     maybeAutoInstall gates on both. Verified: this predicate yields exactly the
     two arms the probe caught, and zero after they inject a runner. */
  const OPENS = /setInstalledRoot\(\(\)\s*=>\s*['"`]?[/\w]/;
  const PREF_ON = /setAutoPref\(\(\)\s*=>\s*\(\{\s*on:\s*true/;
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!OPENS.test(src)) continue;
    // split per test() so a runner in one arm does not excuse another
    const parts = src.split(/\n(?=test\()/);
    for (const part of parts) {
      if (!OPENS.test(part) || !PREF_ON.test(part)) continue;
      if (/setInstallRunner/.test(part)) continue;
      const name = (part.match(/^test\(\s*['"`](.{0,70})/) || [, '(module scope)'])[1];
      offenders.push(`${path.relative(root, f)} :: ${name}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these tests open installedRoot without injecting an install runner, so they can spawn the '
    + 'real production installer:\n  ' + offenders.join('\n  '));
});
