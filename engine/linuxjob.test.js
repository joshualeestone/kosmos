'use strict';
/**
 * #4918: unit tests for Linux systemd user units (agents).
 *
 * Verifies systemd unit generation, parsing, and lifecycle commands.
 * Runs on any platform (macOS/Linux) via injectable runners and temp directories.
 *
 *   node --test engine/linuxjob.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const linuxjob = require('./linuxjob');
const launchidentity = require('./launchidentity');

test.afterEach(() => {
  linuxjob.setRunnerForTests(null);
  linuxjob.setSystemdDirForTests(null);
});

test('unitName and unitPath derive correct service names', () => {
  const name = 'scorpion';
  const u = linuxjob.unitName(name, '');
  assert.equal(u, 'kosmos-agent-scorpion.service');

  const uCustom = linuxjob.unitName(name, 'testworld');
  assert.equal(uCustom, 'kosmos-agent-scorpion\\x2btestworld.service', 'a named world\'s "+" is systemd-escaped (#4918 review 1)');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-test-'));
  try {
    linuxjob.setSystemdDirForTests(() => tmp);
    const p = linuxjob.unitPath(name, '');
    assert.equal(p, path.join(tmp, 'kosmos-agent-scorpion.service'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unitFor generates valid systemd unit with all parameters', () => {
  const content = linuxjob.unitFor(
    'subzero',
    '/usr/bin/claude',
    '/usr/bin/tmux',
    'claude-3-5-sonnet-20241022',
    '/home/user/.claude-custom',
    'claude'
  );

  assert.match(content, /^\[Unit\]/m);
  assert.match(content, /^Description=Kosmos agent subzero/m);
  assert.match(content, /^After=network.target/m);
  assert.match(content, /^\[Service\]/m);
  assert.match(content, /^ExecStart="\/bin\/bash" .* "subzero" .* "\/usr\/bin\/claude" "\/usr\/bin\/tmux" .* "claude-3-5-sonnet-20241022"/m);
  assert.match(content, /^Restart=always/m);
  assert.match(content, /^RestartSec=5/m);
  assert.match(content, /^Environment="CLAUDE_CONFIG_DIR=\/home\/user\/\.claude-custom"/m);
  assert.match(content, /^Environment="LANG=C\.UTF-8"/m);
  assert.match(content, /^\[Install\]/m);
  assert.match(content, /^WantedBy=default\.target/m);
});

test('unitFor handles non-Claude runners (e.g. codex)', () => {
  const content = linuxjob.unitFor(
    'raiden',
    '/usr/bin/codex',
    '/usr/bin/tmux',
    'gpt-4o',
    '/home/user/.codex-home',
    'codex'
  );

  assert.match(content, /^ExecStart=.* "raiden" .* "\/usr\/bin\/codex" "\/usr\/bin\/tmux" .* "gpt-4o" "codex"/m);
  assert.match(content, /^Environment="CODEX_HOME=\/home\/user\/\.codex-home"/m);
});

test('unitFor quotes empty model argument for non-Claude runners to prevent argument shifting', () => {
  const content = linuxjob.unitFor(
    'raiden',
    '/usr/bin/codex',
    '/usr/bin/tmux',
    '',
    '/home/user/.codex-home',
    'codex'
  );

  // Must emit "" explicitly so systemd does not collapse spaces and shift codex into position 6
  assert.match(content, /^ExecStart=.* "raiden" .* "\/usr\/bin\/codex" "\/usr\/bin\/tmux" .* "" "codex"/m);
  const parsed = linuxjob.readUnitJob(content);
  assert.ok(parsed);
  assert.equal(parsed.model, null);
  assert.equal(parsed.runner, 'codex');
});

test('readUnitJob accurately round-trips unit properties', () => {
  const content = linuxjob.unitFor(
    'liukang',
    '/usr/local/bin/custom-runner',
    '/usr/local/bin/tmux',
    'custom-model-v1',
    '/home/user/custom-config',
    'codex'
  );

  const parsed = linuxjob.readUnitJob(content);
  assert.ok(parsed);
  assert.equal(parsed.claude, '/usr/local/bin/custom-runner');
  assert.equal(parsed.tmux, '/usr/local/bin/tmux');
  assert.equal(parsed.model, 'custom-model-v1');
  assert.equal(parsed.runner, 'codex');
  assert.equal(parsed.configDir, '/home/user/custom-config');
});

test('lifecycle commands execute correct systemctl arguments', () => {
  const calls = [];
  linuxjob.setRunnerForTests((cmd, args) => {
    calls.push({ cmd, args });
    if (args[1] === 'is-active') {
      return { ok: true, stdout: 'active\n' };
    }
    if (args[1] === 'is-enabled') {
      return { ok: true, stdout: 'enabled\n' };
    }
    return { ok: true, stdout: '' };
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-lifecycle-'));
  try {
    linuxjob.setSystemdDirForTests(() => tmp);
    const unitFile = linuxjob.unitPath('sonya', '');

    // Write file and verify presence
    linuxjob.writeUnitFile(unitFile, 'dummy-unit-content');
    assert.equal(linuxjob.presence('sonya', ''), true);

    // enable
    linuxjob.enable('sonya', '');
    assert.deepEqual(calls[calls.length - 1], {
      cmd: 'systemctl',
      args: ['--user', 'enable', 'kosmos-agent-sonya.service'],
    });

    // start
    linuxjob.start('sonya', '');
    assert.deepEqual(calls[calls.length - 3], {
      cmd: 'systemctl',
      args: ['--user', 'daemon-reload'],
    });
    assert.deepEqual(calls[calls.length - 2], {
      cmd: 'systemctl',
      args: ['--user', 'enable', 'kosmos-agent-sonya.service'],
    });
    assert.deepEqual(calls[calls.length - 1], {
      cmd: 'systemctl',
      args: ['--user', 'start', 'kosmos-agent-sonya.service'],
    });

    // status and loaded
    const st = linuxjob.status('sonya', '');
    assert.equal(st.active, true);
    assert.equal(st.enabled, true);
    assert.equal(linuxjob.loaded('sonya', ''), true);

    // stop
    linuxjob.stop('sonya', '');
    assert.deepEqual(calls[calls.length - 1], {
      cmd: 'systemctl',
      args: ['--user', 'stop', 'kosmos-agent-sonya.service'],
    });

    // disable
    linuxjob.disable('sonya', '');
    assert.deepEqual(calls[calls.length - 1], {
      cmd: 'systemctl',
      args: ['--user', 'disable', 'kosmos-agent-sonya.service'],
    });

    // remove
    linuxjob.remove('sonya', '');
    assert.equal(linuxjob.presence('sonya', ''), false);

    // enableLinger
    linuxjob.enableLinger();
    const lingerCalls = calls.filter((c) => c.cmd === 'loginctl');
    assert.equal(lingerCalls[lingerCalls.length - 2].args[0], 'enable-linger');
    assert.equal(lingerCalls[lingerCalls.length - 1].args[0], 'show-user', 'linger is read back, not assumed (#4918 review 1)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loaded recognizes activating status even when runner returns non-zero code', () => {
  linuxjob.setRunnerForTests(() => {
    return { ok: false, code: 3, stdout: 'activating\n' };
  });
  assert.equal(linuxjob.loaded('testagent', ''), true);
});

test('rewriteAgentJob succeeds on Linux using runnerBin and tmux fields', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemd-rewrite-'));
  try {
    linuxjob.setSystemdDirForTests(() => tmp);
    const calls = [];
    linuxjob.setRunnerForTests((cmd, args) => {
      calls.push({ cmd, args });
      return { ok: true, stdout: '' };
    });

    const create = require('./create');
    const result = create.rewriteAgentJob(
      'subzero',
      'Sub-Zero',
      {
        runnerBin: '/usr/bin/claude',
        tmux: '/usr/bin/tmux',
        model: 'claude-3-5-sonnet',
        configDir: '/home/user/.claude',
        runner: 'claude',
      },
      'linux'
    );
    assert.equal(result, null);
    const unitFile = linuxjob.unitPath('subzero');
    assert.equal(fs.existsSync(unitFile), true);
    const content = fs.readFileSync(unitFile, 'utf8');
    assert.match(content, /claude-3-5-sonnet/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// #4918 review 1 (Ice Cream Kitty): the adopted PR's blockers and warnings.
test('#4918 the agent and board units stop only their own process, never the shared tmux server (KillMode=process)', () => {
  const linuxboard = require('./linuxboard');
  assert.match(linuxjob.unitFor('subzero', '/usr/bin/claude', '/usr/bin/tmux', null, null, 'claude'), /^KillMode=process$/m);
  assert.match(linuxboard.boardUnitFor('/tmp/kosmos-home-4918', 16180), /^KillMode=process$/m);
});

test('#4918 unit names are valid systemd names: anything outside [A-Za-z0-9:_.-] is \\xHH-escaped', () => {
  assert.equal(linuxjob.escapeUnitNamePart('a+b'), 'a\\x2bb');
  assert.equal(linuxjob.escapeUnitNamePart('plain-1.x_y:z'), 'plain-1.x_y:z', 'CONTROL: allowed characters stay');
  for (const n of ['scorpion', 'a.b-c']) assert.match(linuxjob.unitName(n, 'w1'), /^kosmos-agent-[A-Za-z0-9:_.\\-]+\.service$/);
});

test('#4918 a value systemd would expand or split is refused, never written', () => {
  for (const bad of ['/tmp/a%b', '/tmp/a$b', '/tmp/a\\b', '/tmp/a"b', '/tmp/a\nExecStartPre=/bin/x']) {
    assert.throws(() => linuxjob.unitSafe(bad, 'x'), /cannot go into a systemd unit/, JSON.stringify(bad));
  }
  assert.equal(linuxjob.unitSafe('/tmp/a b/c', 'x'), '/tmp/a b/c', 'CONTROL: a space is fine (the value is quoted)');
  assert.throws(() => linuxjob.unitFor('subzero', '/usr/bin/claude', '/usr/bin/tmux', 'evil\nExecStartPre=/bin/x', null, 'claude'), /model name/);
});

test('#4918 start reports a failed daemon-reload or enable instead of starting anyway', () => {
  const calls = [];
  linuxjob.setRunnerForTests((cmd, args) => { calls.push(args[1]); return args[1] === 'enable' ? { ok: false, stderr: 'Unit file is not valid' } : { ok: true, stdout: '' }; });
  try {
    const r = linuxjob.start('sonya', '');
    assert.equal(r.ok, false);
    assert.match(r.because, /did not enable/);
    assert.ok(!calls.includes('start'), 'it went on to start a unit systemd would not enable');
  } finally { linuxjob.setRunnerForTests(null); }
});

test('#4918 enableLinger says whether linger is on, read back from loginctl', () => {
  for (const [out, on] of [['Linger=yes\n', true], ['Linger=no\n', false]]) {
    linuxjob.setRunnerForTests((cmd, args) => (args[0] === 'show-user' ? { ok: true, stdout: out } : { ok: true, stdout: '' }));
    try { assert.equal(linuxjob.enableLinger().lingering, on, out.trim()); } finally { linuxjob.setRunnerForTests(null); }
  }
});
