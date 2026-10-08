'use strict';
/**
 * #5584: the install gate's "only expected files added" check (tools/test-install.sh, EXPECTED_ADDS) ran only
 * inside a release cut, so a PR that made the board write a NEW file at start merged green and failed the next cut
 * hours in. It has happened at least four times: .world-confirmed.json (0.6.51), ping.json, prompter-nudges.json
 * (0.6.90), board-alive.json (0.7.28).
 *
 * This boots the real server.js the way the gate's smoke boot does (the same sandbox variables, the same seeded
 * person data, DRY_RUN), lets the board settle, and compares what it added to the gate's own list, read live from
 * tools/test-install.sh. So the PR that adds a board-start file is the one that goes red, and the fix is the same
 * one the cut would need: add the file to EXPECTED_ADDS with a comment saying why.
 *
 * The gate's list also holds what the INSTALLER writes (not the board). Those are named below, so a file moving
 * between the two, or the list gaining an entry nobody writes, is a red too.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopBoard } = require('./test-support/board-child');

// What setup.sh writes into the data folder itself; the board never does. Keep in step with the gate's comment
// ("plus Kosmos/source-channel, which setup.sh writes to record which channel pointer the build was fetched from").
const INSTALLER_WRITES = ['./Kosmos/source-channel'];
// Board-start writes that are deliberately inert under a test runner. engine/ping.js mints ping.json only when
// NODE_TEST_CONTEXT is unset (ping.underTest()), and this test cannot unset it for its child: some twenty modules
// (updating, remote, connect...) stay inert on the same variable, and a test must not wake them. The gate boots
// outside a test runner, so it sees these; this test does not. A new board-start file guarded the same way is the
// one thing this test cannot see (it then fails only in the cut, as before).
const WRITTEN_ONLY_OUTSIDE_TESTS = ['./Kosmos/ping.json'];

/** The gate's EXPECTED_ADDS, read from the script so the two can never be two copies of one list. */
function expectedAdds() {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'test-install.sh'), 'utf8');
  const m = src.match(/^EXPECTED_ADDS="\$\(printf '%s\\n' ([^)]*)\)"/m);
  assert.ok(m, 'could not find the EXPECTED_ADDS line in tools/test-install.sh; this test reads it, so update the pattern');
  return m[1].trim().split(/\s+/).filter(Boolean);
}

function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push('./' + path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

test('the list the gate reads is found, sorted, and names the installer\'s own writes', () => {
  const list = expectedAdds();
  assert.ok(list.length >= 5, 'EXPECTED_ADDS parsed to fewer entries than it has ever had: ' + JSON.stringify(list));
  // The gate compares a sorted find against this string literally, so an unsorted list reds every cut.
  assert.deepEqual(list, [...list].sort(), 'EXPECTED_ADDS is not in sort order; the gate compares it literally');
  for (const f of INSTALLER_WRITES) assert.ok(list.includes(f), f + ' is no longer in EXPECTED_ADDS; update INSTALLER_WRITES here');
  for (const f of WRITTEN_ONLY_OUTSIDE_TESTS) {
    assert.ok(list.includes(f), f + ' is no longer in EXPECTED_ADDS; update WRITTEN_ONLY_OUTSIDE_TESTS here');
  }
  // The reason ping.json is set aside: its writer is inert under a test runner. If that ever changes, it is back in.
  const ping = fs.readFileSync(path.join(__dirname, 'engine', 'ping.js'), 'utf8');
  assert.match(ping, /process\.env\.NODE_TEST_CONTEXT/, 'engine/ping.js no longer goes inert under test; drop ping.json from WRITTEN_ONLY_OUTSIDE_TESTS');
});

test('#5584: a board start adds exactly the gate\'s expected files, so a new one fails here and not in the cut', async () => {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-bootadds-')));
  const data = path.join(sb, 'data');
  // The person data the gate seeds before installing, so what the board does with an existing home is the same.
  fs.mkdirSync(path.join(data, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(data, 'agents', 'harness-agent'), { recursive: true });
  fs.writeFileSync(path.join(data, 'you.json'), '{"name":"Josh","does":"Runs a company"}');
  fs.writeFileSync(path.join(data, 'agents', 'harness-agent', 'CLAUDE.md'), 'their own words\n');
  fs.writeFileSync(path.join(data, 'projects', 'projects.json'), '[{"id":"p1","name":"A project"}]');
  fs.writeFileSync(path.join(data, '.hidden-record'), 'x');
  for (const d of ['home', 'bin', 'apps', 'launch', 'projects', 'workers']) fs.mkdirSync(path.join(sb, d), { recursive: true });
  const before = new Set(filesUnder(data));

  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: sb,
    env: {
      ...process.env,
      PORT: '0',
      // The gate's exports (tools/test-install.sh), pointed into this sandbox.
      KOSMOS_HOME: path.join(sb, 'home'),
      AGENT_WORKFORCE_HOME: path.join(sb, 'home'),
      KOSMOS_BIN_DIR: path.join(sb, 'bin'),
      KOSMOS_APP_DIR: path.join(sb, 'apps'),
      AGENT_WORKFORCE_DATA: data,
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:9/api/created',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
      AGENT_WORKFORCE_COMMUNITY_URL: 'http://127.0.0.1:9/',
      AGENT_WORKFORCE_PERSON_LOCALE: 'en',
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'),
      // Review 1: the rest of the gate's sandbox, so a test-booted board can reach nothing of the real home: the
      // Claude config file and root (else trust and onboarding read and write the operator's ~/.claude.json),
      // the shell profile, the system app folder, no browser, and a Claude binary path inside the sandbox.
      AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(sb, 'claude.json'),
      AGENT_WORKFORCE_CONFIG_ROOT: path.join(sb, 'config'),
      AGENT_WORKFORCE_CLAUDE_BIN: path.join(sb, 'claude-shared', 'claude'),
      KOSMOS_PROFILE_FILE: path.join(sb, 'zprofile'),
      KOSMOS_SYS_APP_DIR: path.join(sb, 'sysnever'),
      KOSMOS_NO_OPEN: '1',
      SHELL: '/bin/zsh',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  let added;
  try {
    const upAt = Date.now();
    while (!/Kosmos on http/.test(out)) {
      if (Date.now() - upAt > 20000) throw new Error('the board did not report startup in time:\n' + out.slice(-2000));
      await new Promise((r) => setTimeout(r, 50));
    }
    // The gate waits by asking the board for its page (curl http://127.0.0.1:$PORT/) until it answers, and that
    // first request is itself part of the start (ping.json is written on it). Ask the same way.
    const port = (out.match(/Kosmos on http:\/\/[^:\s]+:(\d+)/) || [])[1];
    assert.ok(port, 'no port in the startup line: ' + out.slice(-500));
    for (let i = 0; i < 60; i++) {
      const ok = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(3000) })
        .then((r) => r.status > 0, () => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // The gate diffs once the board answers; some start writes (the supervisor install, the first runner tick) land
    // just after listen. Wait until the added set has not changed for 3s (bounded), so a late write is counted
    // rather than raced: a file the board writes at start belongs in the list whether or not one cut saw it.
    // Review 1: stop early only once every expected board write has landed AND the set has been still for 3s; a
    // loaded machine gets up to 45s before anything is called missing.
    const boardWrites = expectedAdds().filter((f) => !INSTALLER_WRITES.includes(f) && !WRITTEN_ONLY_OUTSIDE_TESTS.includes(f));
    const t0 = Date.now();
    let last = '';
    let stableSince = Date.now();
    for (;;) {
      const now = filesUnder(data).filter((f) => !before.has(f));
      const joined = now.join('\n');
      if (joined !== last) { last = joined; stableSince = Date.now(); }
      const complete = boardWrites.every((f) => now.includes(f));
      if ((complete && Date.now() - stableSince >= 3000) || Date.now() - t0 > 45000) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // The gate filters the board's wouldping runtime logs as a class (#1494); so does this.
    added = last.split('\n').filter((f) => f && !f.startsWith('./Kosmos/wouldping/'));
  } finally {
    await stopBoard(child, { signal: 'SIGKILL' });
    fs.rmSync(sb, { recursive: true, force: true });
  }

  const expected = expectedAdds().filter((f) => !INSTALLER_WRITES.includes(f) && !WRITTEN_ONLY_OUTSIDE_TESTS.includes(f));
  const extra = added.filter((f) => !expected.includes(f));
  const missing = expected.filter((f) => !added.includes(f));
  assert.deepEqual(
    { extra, missing },
    { extra: [], missing: [] },
    'the board start no longer adds exactly the install gate\'s expected files.\n' +
      '  extra (written at start, not in EXPECTED_ADDS): the next cut fails step 4b on these. Add each to\n' +
      '    EXPECTED_ADDS in tools/test-install.sh, in sort order, with a comment saying what writes it and why.\n' +
      '  missing (in EXPECTED_ADDS, no longer written at start): remove it there, or say here why the board\n' +
      '    should write it.'
  );
});
