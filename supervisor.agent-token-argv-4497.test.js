'use strict';
/**
 * #4497/#4507: launch secrets must reach every provider without becoming part of
 * tmux's process arguments. This executes the shipped supervisor and a tmux
 * stand-in which records the exact argv it receives, applies tmux -e entries,
 * and then executes the pane command. On the old code the runner receives the
 * token, but the argv assertion fails because it is carried as
 * `-e KOSMOS_AGENT_TOKEN=<token>`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHIPPED = process.env.SUPERVISOR_UNDER_TEST || path.join(__dirname, 'bin', 'agent-supervisor.sh');
const TOKEN = '49'.repeat(32);
const GH_SECRET = 'ghp_argv_secret_4507';
const DOOR_SECRET = 'discord_argv_secret_4507';
const CF_SECRET = 'cloudflare_argv_secret_4507';
const GEMINI_SECRET = 'gemini_argv_secret_4507';
const GROK_SECRET = 'grok_argv_secret_4507';
const PROVIDERS = ['claude', 'codex', 'gemini', 'grok', 'antigravity', 'muse'];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-token-argv-4497-'));
  for (const dir of ['bin', 'engine', 'data', 'work', 'secrets/env', 'gemini-home', 'grok-home']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(SHIPPED, path.join(root, 'bin', 'agent-supervisor.sh'));
  fs.writeFileSync(path.join(root, 'secrets', 'github.token'), GH_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'secrets', 'cloudflare.token'), CF_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'secrets', 'env', 'DISCORD_BOT_TOKEN'), DOOR_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'gemini-home', '.kosmos-gemini-apikey'), GEMINI_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'grok-home', '.kosmos-grok-apikey'), GROK_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'engine', 'sendertoken.js'), `module.exports.mint = () => ({ ok: true, token: '${TOKEN}' });\n`);
  fs.writeFileSync(path.join(root, 'engine', 'musefront.js'), [
    "'use strict';",
    "require('node:fs').appendFileSync(process.env.EVIDENCE, [process.env.KOSMOS_AGENT_TOKEN, process.env.GH_TOKEN, process.env.DISCORD_BOT_TOKEN, process.env.CLOUDFLARE_API_TOKEN, process.env.GEMINI_API_KEY, process.env.XAI_API_KEY].map((v) => v || '<missing>').join('|'));",
  ].join('\n') + '\n');

  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, [
    '#!/bin/bash',
    'if [ "${1:-}" = --version ]; then printf "agy 1.2.10\\n"; exit 0; fi',
    'printf "%s" "${KOSMOS_AGENT_TOKEN:-<missing>}|${GH_TOKEN:-<missing>}|${DISCORD_BOT_TOKEN:-<missing>}|${CLOUDFLARE_API_TOKEN:-<missing>}|${GEMINI_API_KEY:-<missing>}|${XAI_API_KEY:-<missing>}" >> "$EVIDENCE"',
  ].join('\n') + '\n', { mode: 0o755 });

  const tmux = path.join(root, 'tmux.sh');
  fs.writeFileSync(tmux, [
    '#!/bin/bash',
    'case "${1:-}" in',
    '  has-session) [ -n "${DELETE_SUPERVISOR:-}" ] && rm -f -- "$SUPERVISOR_PATH"; exit 1 ;;',
    '  new-session)',
    '    printf "%s\\0" "$@" >> "$ARGV_RECORD"',
    '    before=""',
    '    for arg in "$@"; do',
    '      if [ "$before" = --pane-entry ]; then',
    '        (stat -f %Lp "$arg" 2>/dev/null || stat -c %a "$arg" 2>/dev/null) > "$MODE_RECORD"',
    '        break',
    '      fi',
    '      before="$arg"',
    '    done',
    '    shift',
    '    print_pane=0',
    '    while [ "$#" -gt 0 ]; do',
    '      case "$1" in',
    '        -d) shift ;;',
    '        -P) print_pane=1; shift ;;',
    '        -s|-c|-F) shift 2 ;;',
    '        -e) export "$2"; shift 2 ;;',
    '        *) break ;;',
    '      esac',
    '    done',
    '    [ -n "${REFUSE_LAUNCH:-}" ] && exit 9',
    '    "$@"',
    '    rc=$?',
    '    [ "$print_pane" -eq 1 ] && printf "%%4497\\n"',
    '    exit "$rc"',
    '    ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, runner, tmux };
}

for (const provider of PROVIDERS) {
  test(`${provider}: token reaches the provider but never tmux argv or logs`, () => {
    const f = fixture();
    const evidence = path.join(f.root, 'evidence.txt');
    const argvRecord = path.join(f.root, 'argv.bin');
    const modeRecord = path.join(f.root, 'mode.txt');
    try {
      const result = spawnSync('/bin/bash', [
        path.join(f.root, 'bin', 'agent-supervisor.sh'),
        `agent-${provider}`,
        path.join(f.root, 'work'),
        f.runner,
        f.tmux,
        '',
        '',
        provider,
      ], {
        encoding: 'utf8',
        timeout: 20000,
        env: {
          PATH: process.env.PATH,
          HOME: f.root,
          EVIDENCE: evidence,
          ARGV_RECORD: argvRecord,
          MODE_RECORD: modeRecord,
          AGENT_WORKFORCE_HOME: f.root,
          AGENT_WORKFORCE_DATA: path.join(f.root, 'data'),
          GEMINI_CLI_HOME: path.join(f.root, 'gemini-home'),
          GROK_HOME: path.join(f.root, 'grok-home'),
        },
      });
      assert.equal(result.status, 0, result.stderr || `${provider} supervisor failed`);
      const received = fs.readFileSync(evidence, 'utf8').split('|');
      assert.equal(received[0], TOKEN, 'the provider receives the exact minted token');
      assert.equal(received[1], GH_SECRET, 'the provider receives GH_TOKEN');
      assert.equal(received[2], DOOR_SECRET, 'the provider receives its stored token door');
      assert.equal(received[3], CF_SECRET, 'the provider receives the held Cloudflare token');
      if (provider === 'gemini') assert.equal(received[4], GEMINI_SECRET, 'Gemini receives its per-account key');
      if (provider === 'grok') assert.equal(received[5], GROK_SECRET, 'Grok receives its per-account key');
      const argv = fs.readFileSync(argvRecord);
      for (const secret of [TOKEN, GH_SECRET, DOOR_SECRET, CF_SECRET, GEMINI_SECRET, GROK_SECRET]) {
        assert.ok(!argv.includes(Buffer.from(secret)), `secret ${secret} is absent from the real tmux spawn arguments`);
      }
      assert.ok(!argv.includes(Buffer.from('KOSMOS_AGENT_TOKEN=')), 'tmux receives no agent-token environment argument');
      assert.ok(argv.includes(Buffer.from('--pane-entry')), 'the pane uses the secret-file entrypoint');
      for (const secret of [TOKEN, GH_SECRET, DOOR_SECRET, CF_SECRET, GEMINI_SECRET, GROK_SECRET]) {
        assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), `secret ${secret} is absent from supervisor logs`);
      }
      const secretDir = path.join(f.root, 'data', 'launch-secrets');
      assert.equal(fs.readFileSync(modeRecord, 'utf8').trim(), '600', 'the token file is owner-only before the pane reads it');
      assert.equal(fs.statSync(secretDir).mode & 0o777, 0o700, 'the token directory is owner-only');
      assert.deepEqual(fs.readdirSync(secretDir), [], 'the consumed token file is removed');
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('a refused tmux launch removes the unconsumed secret file without logging it', () => {
  const f = fixture();
  const argvRecord = path.join(f.root, 'argv.bin');
  const modeRecord = path.join(f.root, 'mode.txt');
  try {
    const result = spawnSync('/bin/bash', [
      path.join(f.root, 'bin', 'agent-supervisor.sh'), 'agent-refused', path.join(f.root, 'work'),
      f.runner, f.tmux, '', '', 'claude',
    ], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: f.root,
        EVIDENCE: path.join(f.root, 'unused-evidence.txt'),
        ARGV_RECORD: argvRecord,
        MODE_RECORD: modeRecord,
        REFUSE_LAUNCH: '1',
        AGENT_WORKFORCE_HOME: f.root,
        AGENT_WORKFORCE_DATA: path.join(f.root, 'data'),
      },
    });
    assert.notEqual(result.status, 0, 'the launch refusal reaches the supervisor');
    assert.ok(!result.stdout.includes(TOKEN) && !result.stderr.includes(TOKEN), 'the failed launch does not log the token');
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'data', 'launch-secrets')), [], 'the EXIT trap removes the unconsumed token file');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('an unavailable supervisor entry path launches without handing secrets to the provider', () => {
  const f = fixture();
  const evidence = path.join(f.root, 'evidence.txt');
  const argvRecord = path.join(f.root, 'argv.bin');
  const supervisorPath = path.join(f.root, 'bin', 'agent-supervisor.sh');
  try {
    const result = spawnSync('/bin/bash', [
      supervisorPath, 'agent-fallback', path.join(f.root, 'work'), f.runner, f.tmux, '', '', 'claude',
    ], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: f.root,
        EVIDENCE: evidence,
        ARGV_RECORD: argvRecord,
        MODE_RECORD: path.join(f.root, 'mode.txt'),
        AGENT_WORKFORCE_HOME: f.root,
        AGENT_WORKFORCE_DATA: path.join(f.root, 'data'),
        DELETE_SUPERVISOR: '1',
        SUPERVISOR_PATH: supervisorPath,
      },
    });
    assert.equal(result.status, 0, result.stderr || 'the fallback launch failed');
    assert.equal(fs.readFileSync(evidence, 'utf8'), '<missing>|<missing>|<missing>|<missing>|<missing>|<missing>', 'the provider starts without any held secret');
    const argv = fs.readFileSync(argvRecord);
    assert.ok(!argv.includes(Buffer.from('--pane-entry')), 'an unreadable entrypoint is never put on pane argv');
    for (const secret of [TOKEN, GH_SECRET, DOOR_SECRET, CF_SECRET]) {
      assert.ok(!argv.includes(Buffer.from(secret)), `fallback argv does not expose ${secret}`);
    }
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('an inherited secret with a newline cannot inject another environment variable', () => {
  const f = fixture();
  const evidence = path.join(f.root, 'evidence.txt');
  const argvRecord = path.join(f.root, 'argv.bin');
  fs.unlinkSync(path.join(f.root, 'secrets', 'github.token'));
  try {
    const result = spawnSync('/bin/bash', [
      path.join(f.root, 'bin', 'agent-supervisor.sh'), 'agent-newline', path.join(f.root, 'work'),
      f.runner, f.tmux, '', '', 'claude',
    ], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: f.root,
        GH_TOKEN: 'held-value\nINJECTED_SECRET=wrong',
        EVIDENCE: evidence,
        ARGV_RECORD: argvRecord,
        MODE_RECORD: path.join(f.root, 'mode.txt'),
        AGENT_WORKFORCE_HOME: f.root,
        AGENT_WORKFORCE_DATA: path.join(f.root, 'data'),
      },
    });
    assert.equal(result.status, 0, result.stderr || 'newline control launch failed');
    const received = fs.readFileSync(evidence, 'utf8').split('|');
    assert.equal(received[1], '<missing>', 'the malformed inherited GH token is refused');
    const argv = fs.readFileSync(argvRecord);
    assert.ok(!argv.includes(Buffer.from('held-value')) && !argv.includes(Buffer.from('INJECTED_SECRET')), 'neither line reaches tmux argv');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
