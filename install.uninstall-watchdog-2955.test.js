'use strict';
// #2955: --uninstall must remove the board WATCHDOG login job, not only the
// board's. The watchdog is a second LaunchAgent added by this change; if the
// uninstall left it behind it would wake on its interval and keep trying to
// `kosmos start` a board whose files the uninstall just deleted -- the exact
// orphan --uninstall exists to prevent. This drives the REAL install/setup.sh
// --uninstall against a sandboxed install and asserts BOTH login jobs are gone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');

test('#2955: --uninstall removes the board watchdog login job (and the board job)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstall2955-'));
  try {
    const home = path.join(root, 'kosmos-home');
    const dataParent = path.join(root, 'data');
    const launch = path.join(root, 'launch');
    fs.mkdirSync(path.join(home, 'app'), { recursive: true });
    fs.mkdirSync(path.join(dataParent, 'AgentWorkforce'), { recursive: true });
    fs.mkdirSync(launch, { recursive: true });

    // A non-default KOSMOS_HOME means both labels carry the #883 hash suffix, and
    // setup.sh derives it as `printf %s "$KOSMOS_HOME" | shasum -a 256 | cut -c1-8`.
    // A mkdtemp path has no repeated or trailing slash, so setup.sh's tr -s '/' +
    // trailing-slash normalization is a no-op and this raw hash matches. (Verified:
    // node's sha256 and the shell formula agree byte for byte on such a path.)
    const suffix = crypto.createHash('sha256').update(home).digest('hex').slice(0, 8);
    const boardPlist = path.join(launch, `com.kosmos.board.${suffix}.plist`);
    const wdPlist = path.join(launch, `com.kosmos.board.watchdog.${suffix}.plist`);
    // The explicit removal keys off the exact label + `[ -f ]`, so a minimal but
    // valid plist body is enough; the removal is an unconditional `rm -f` after the
    // sandbox-guarded launchctl, so it runs even under AGENT_WORKFORCE_LAUNCH.
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<plist version="1.0"><dict><key>ProgramArguments</key>'
      + '<array><string>/bin/bash</string></array></dict></plist>\n';
    fs.writeFileSync(boardPlist, body);
    fs.writeFileSync(wdPlist, body);

    // Controls BEFORE, or the assertions below are vacuous.
    assert.ok(fs.existsSync(boardPlist), 'control: the board plist was never seeded');
    assert.ok(fs.existsSync(wdPlist), 'control: the watchdog plist was never seeded');

    try {
      execFileSync('bash', [SETUP, '--uninstall'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          KOSMOS_HOME: home,
          AGENT_WORKFORCE_DATA: dataParent,
          AGENT_WORKFORCE_LAUNCH: launch,
          KOSMOS_APP_DIR: path.join(root, 'apps'),
          KOSMOS_SYS_APP_DIR: path.join(root, 'sysapps'),
        },
      });
    } catch (e) {
      // The uninstall's own exit code is not what this test asserts -- the removal
      // of the two plists happens early, before any later step could fail. What we
      // assert is the filesystem outcome below.
    }

    assert.ok(!fs.existsSync(wdPlist),
      'the board watchdog login job survived --uninstall: it would keep trying to start a deleted board');
    assert.ok(!fs.existsSync(boardPlist),
      'the board login job survived --uninstall');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
