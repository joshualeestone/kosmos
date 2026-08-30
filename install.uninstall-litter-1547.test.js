'use strict';

/**
 * The uninstall removes OUR bookkeeping and keeps THEIRS (#1547).
 *
 * ⭐ WHY: `engine/wouldping.js` writes a would-ping log into the data folder
 * during normal running (#1494), and the uninstall left it there. Somebody who
 * removed Kosmos found our ping-logs sitting in their AgentWorkforce folder.
 * Leave-no-trace applies to what we generated; it must never apply to what they
 * made.
 *
 * 🛑 THE CONTROL IS THE POINT. An assertion that `wouldping/` is gone is easy to
 * satisfy by deleting the whole data folder, which is the catastrophe this
 * card's fix must not become. So every arm that asserts our litter is gone also
 * asserts a seeded USER file survived, byte for byte.
 *
 *   node --test install.uninstall-litter-1547.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SETUP = path.join(__dirname, 'install', 'setup.sh');

/* A sandboxed install: its own KOSMOS_HOME and its own data root, so the
   uninstall's sandbox refusal is satisfied and nothing real is in reach. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstall1547-'));
  const home = path.join(root, 'kosmos-home');
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.mkdirSync(path.join(data, 'wouldping'), { recursive: true });
  fs.mkdirSync(path.join(data, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(data, 'wouldping', 'needs-you.jsonl'), '{"seen":1}\n');
  // the person's own data, which must survive byte for byte
  fs.writeFileSync(path.join(data, 'projects.json'), '{"mine":true}\n');
  fs.writeFileSync(path.join(data, 'profiles', 'angel.json'), '{"name":"Angel"}\n');
  return { root, home, data };
}

function runUninstall(sb) {
  try {
    return execFileSync('bash', [SETUP, '--uninstall'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        KOSMOS_HOME: sb.home,
        AGENT_WORKFORCE_DATA: sb.data,
        AGENT_WORKFORCE_LAUNCH: path.join(sb.root, 'launch'),
        KOSMOS_APP_DIR: path.join(sb.root, 'apps'),
        KOSMOS_SYS_APP_DIR: path.join(sb.root, 'sysapps'),
      },
    });
  } catch (e) {
    return String((e.stdout || '') + (e.stderr || ''));
  }
}

test('the ping log goes and the person\'s files stay', () => {
  const sb = sandbox();
  try {
    // control BEFORE: both exist, or the assertions below are vacuous
    assert.ok(fs.existsSync(path.join(sb.data, 'wouldping', 'needs-you.jsonl')),
      'control: the ping log was never seeded');
    assert.ok(fs.existsSync(path.join(sb.data, 'projects.json')),
      'control: the user file was never seeded');

    runUninstall(sb);

    assert.ok(!fs.existsSync(path.join(sb.data, 'wouldping')),
      'our own ping log survived the uninstall, so Kosmos left its bookkeeping behind');

    // 🛑 THE ARM THAT STOPS THE FIX BECOMING THE DISASTER. Deleting the whole
    // data folder would satisfy the assertion above and destroy the person's work.
    assert.equal(fs.readFileSync(path.join(sb.data, 'projects.json'), 'utf8'), '{"mine":true}\n',
      'the uninstall removed or altered the person\'s own data');
    assert.equal(fs.readFileSync(path.join(sb.data, 'profiles', 'angel.json'), 'utf8'), '{"name":"Angel"}\n',
      'the uninstall reached into a user subfolder');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('a data folder with no ping log is left entirely alone', () => {
  /* The sweep must be conditional: a machine that never logged a would-ping
     should see no removal message and lose nothing. */
  const sb = sandbox();
  fs.rmSync(path.join(sb.data, 'wouldping'), { recursive: true, force: true });
  try {
    const out = runUninstall(sb);
    assert.doesNotMatch(out, /removing Kosmos's own ping log/,
      'the uninstall announced removing a ping log that was never there');
    assert.ok(fs.existsSync(path.join(sb.data, 'projects.json')),
      'the person\'s data did not survive an uninstall with no litter to sweep');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('the sweep names one folder rather than pattern-matching the data root', () => {
  /**
   * ⚠️ A PROPERTY OF THE SOURCE, deliberately. The behavioural arms above
   * cannot tell "removed wouldping/" from "removed everything matching a
   * pattern that happened to hit only wouldping/ in this fixture". This file's
   * whole rule is that an uninstall proves ownership before it deletes, and a
   * glob over somebody's data folder is how an uninstaller removes the thing it
   * promised to keep.
   */
  const src = fs.readFileSync(SETUP, 'utf8');
  assert.match(src, /rm -rf "\$_data_root\/wouldping"/,
    'the ping-log sweep is gone, or no longer names its target exactly');
  assert.doesNotMatch(src, /rm -rf "\$_data_root"\s*$/m,
    'something removes the whole data root, which is the person\'s own data');
  assert.doesNotMatch(src, /rm -rf "\$_data_root\/\*/,
    'the sweep became a glob over the data folder');
});
