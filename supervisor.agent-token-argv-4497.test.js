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
const refusedDoors = (root) => ({
  PATH: '/not-a-provider-path-4514', BASH_ENV: '/not-a-bash-env-4514', ENV: '/not-an-env-4514',
  SHELLOPTS: 'xtrace', DYLD_INSERT_LIBRARIES: '/not-a-dylib-4514', LD_PRELOAD: '/not-an-so-4514',
  NODE_OPTIONS: `--require=${path.join(root, 'node-options-attack.js')}`, NODE_PATH: '/not-a-node-path-4514',
  NODE_EXTRA_CA_CERTS: '/not-a-ca-file-4514', PYTHONPATH: '/not-a-python-path-4514',
  PYTHONSTARTUP: '/not-a-python-startup-4514', PERL5LIB: '/not-a-perl-path-4514', RUBYOPT: '-rnot-a-gem-4514',
  GIT_CONFIG_COUNT: '994514', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: '/not-a-hook-4514',
  GIT_SSH_COMMAND: '/not-an-ssh-4514', GIT_ASKPASS: '/not-an-askpass-4514', GIT_EXEC_PATH: '/not-a-git-path-4514',
  SSH_ASKPASS: '/not-an-ssh-askpass-4514', EDITOR: '/not-an-editor-4514', VISUAL: '/not-a-visual-4514',
  ZDOTDIR: '/not-a-zdotdir-4514', NPM_CONFIG_PREFIX: '/not-an-npm-prefix-4514', HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9', ANTHROPIC_BASE_URL: 'https://wrong-anthropic.invalid',
  OPENAI_BASE_URL: 'https://wrong-openai.invalid', KOSMOS_AGENT_TOKEN: 'wrong-sender-token-4514',
  HOME: '/wrong-home-4514', CLAUDE_CONFIG_DIR: '/wrong-claude-home-4514', KOSMOS_PORT: '94514',
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-token-argv-4497-'));
  for (const dir of ['bin', 'engine', 'data', 'work', 'secrets/env', 'gemini-home', 'grok-home']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(SHIPPED, path.join(root, 'bin', 'agent-supervisor.sh'));
  fs.writeFileSync(path.join(root, 'secrets', 'github.token'), GH_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'secrets', 'cloudflare.token'), CF_SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'secrets', 'env', 'DISCORD_BOT_TOKEN'), DOOR_SECRET, { mode: 0o600 });
  const refused = refusedDoors(root);
  fs.writeFileSync(path.join(root, 'node-options-attack.js'), `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'node-options-ran'))}, 'ran');\n`);
  fs.writeFileSync(path.join(root, 'engine', 'tokendoors.js'), "module.exports.SPECS = [{ envVar: 'DISCORD_BOT_TOKEN' }];\n");
  for (const [name, value] of Object.entries(refused)) {
    fs.writeFileSync(path.join(root, 'secrets', 'env', name), value, { mode: 0o600 });
  }
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
    'printf "%s" "${KOSMOS_AGENT_TOKEN:-<missing>}|${GH_TOKEN:-<missing>}|${DISCORD_BOT_TOKEN:-<missing>}|${CLOUDFLARE_API_TOKEN:-<missing>}|${GEMINI_API_KEY:-<missing>}|${XAI_API_KEY:-<missing>}|${INJECTED_SECRET:-<missing>}" >> "$EVIDENCE"',
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
  return { root, runner, tmux, refused };
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
    assert.equal(fs.readFileSync(evidence, 'utf8'), '<missing>|<missing>|<missing>|<missing>|<missing>|<missing>|<missing>', 'the provider starts without any held secret');
    assert.match(result.stderr, /GH_TOKEN was not handed to the agent \(the launch entrypoint is unavailable\)/, 'the fallback names an omitted variable');
    const argv = fs.readFileSync(argvRecord);
    assert.ok(!argv.includes(Buffer.from('--pane-entry')), 'an unreadable entrypoint is never put on pane argv');
    for (const secret of [TOKEN, GH_SECRET, DOOR_SECRET, CF_SECRET]) {
      assert.ok(!argv.includes(Buffer.from(secret)), `fallback argv does not expose ${secret}`);
      assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), `fallback logs do not expose ${secret}`);
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
    assert.equal(received[6], '<missing>', 'the second line cannot become another environment variable');
    assert.match(result.stderr, /GH_TOKEN was not handed to the agent \(value has a line break\)/, 'the refusal says which variable was omitted without logging its value');
    const argv = fs.readFileSync(argvRecord);
    assert.ok(!argv.includes(Buffer.from('held-value')) && !argv.includes(Buffer.from('INJECTED_SECRET')), 'neither line reaches tmux argv');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a NODE_OPTIONS door cannot require code in the provider', () => {
  const f = fixture();
  const marker = path.join(f.root, 'node-options-ran');
  for (const name of Object.keys(f.refused)) {
    if (name !== 'NODE_OPTIONS') fs.unlinkSync(path.join(f.root, 'secrets', 'env', name));
  }
  fs.writeFileSync(f.runner, [
    `#!${process.execPath}`,
    "if (process.argv[2] === '--version') { console.log('agy 1.2.10'); process.exit(0); }",
  ].join('\n') + '\n', { mode: 0o755 });
  try {
    const result = spawnSync('/bin/bash', [
      path.join(f.root, 'bin', 'agent-supervisor.sh'), 'agent-node-options', path.join(f.root, 'work'),
      f.runner, f.tmux, '', '', 'claude',
    ], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: f.root,
        ARGV_RECORD: path.join(f.root, 'argv.bin'),
        MODE_RECORD: path.join(f.root, 'mode.txt'),
        AGENT_WORKFORCE_HOME: f.root,
        AGENT_WORKFORCE_DATA: path.join(f.root, 'data'),
      },
    });
    assert.equal(result.status, 0, result.stderr || 'NODE_OPTIONS control launch failed');
    assert.ok(!fs.existsSync(marker), 'NODE_OPTIONS=--require cannot run its file in the provider');
    assert.match(result.stderr, /NODE_OPTIONS was not handed to the agent/, 'the refusal names NODE_OPTIONS');
    assert.ok(!result.stdout.includes(f.refused.NODE_OPTIONS) && !result.stderr.includes(f.refused.NODE_OPTIONS), 'the log never contains the NODE_OPTIONS value');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('only engine-listed token doors reach the provider and Kosmos launch values stay intact', () => {
  const f = fixture();
  const evidence = path.join(f.root, 'evidence.txt');
  const environment = path.join(f.root, 'provider.env');
  fs.writeFileSync(f.runner, [
    `#!${process.execPath}`,
    "if (process.argv[2] === '--version') { console.log('agy 1.2.10'); process.exit(0); }",
    "require('node:fs').writeFileSync(process.env.ENV_RECORD, Object.entries(process.env).map(([k, v]) => `${k}=${v}`).join('\\n') + '\\n');",
    "require('node:fs').writeFileSync(process.env.EVIDENCE, process.env.DISCORD_BOT_TOKEN || '<missing>');",
  ].join('\n') + '\n', { mode: 0o755 });
  try {
    const result = spawnSync('/bin/bash', [
      path.join(f.root, 'bin', 'agent-supervisor.sh'), 'agent-name-boundary', path.join(f.root, 'work'),
      f.runner, f.tmux, '', '', 'claude',
    ], {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        HOME: f.root,
        CLAUDE_CONFIG_DIR: path.join(f.root, 'right-claude-home'),
        KOSMOS_PORT: '4514',
        EVIDENCE: evidence,
        ENV_RECORD: environment,
        ARGV_RECORD: path.join(f.root, 'argv.bin'),
        MODE_RECORD: path.join(f.root, 'mode.txt'),
        AGENT_WORKFORCE_HOME: f.root,
        AGENT_WORKFORCE_DATA: path.join(f.root, 'data'),
      },
    });
    assert.equal(result.status, 0, result.stderr || 'name-boundary launch failed');
    assert.equal(fs.readFileSync(evidence, 'utf8'), DOOR_SECRET, 'an ordinary service token still reaches the provider');
    const providerEnv = fs.readFileSync(environment, 'utf8');
    const argv = fs.readFileSync(path.join(f.root, 'argv.bin'));
    for (const [name, value] of Object.entries(f.refused)) {
      assert.ok(!providerEnv.includes(`${name}=${value}`), `${name} stays out of the provider environment`);
      assert.ok(!argv.includes(Buffer.from(value)), `${name} value stays out of tmux argv`);
      assert.match(result.stderr, new RegExp(`${name} was not handed to the agent`), `the log names refused ${name}`);
      assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value), `${name} log never contains its value`);
    }
    assert.ok(!fs.existsSync(path.join(f.root, 'node-options-ran')), 'NODE_OPTIONS cannot execute code in the provider');
    assert.match(providerEnv, new RegExp(`^KOSMOS_AGENT_TOKEN=${TOKEN}$`, 'm'), 'the minted Kosmos sender token stays intact');
    assert.match(providerEnv, new RegExp(`^HOME=${f.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'Kosmos HOME stays intact');
    assert.match(providerEnv, new RegExp(`^CLAUDE_CONFIG_DIR=${path.join(f.root, 'right-claude-home').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'Kosmos provider config home stays intact');
    assert.match(providerEnv, /^KOSMOS_PORT=4514$/m, 'Kosmos board port stays intact');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
