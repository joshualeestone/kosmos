'use strict';
/**
 * #4497: a sender token must reach every provider without becoming part of
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
const PROVIDERS = ['claude', 'codex', 'gemini', 'grok', 'antigravity', 'muse'];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-token-argv-4497-'));
  for (const dir of ['bin', 'engine', 'data', 'work']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(SHIPPED, path.join(root, 'bin', 'agent-supervisor.sh'));
  fs.writeFileSync(path.join(root, 'engine', 'sendertoken.js'), `module.exports.mint = () => ({ ok: true, token: '${TOKEN}' });\n`);
  fs.writeFileSync(path.join(root, 'engine', 'musefront.js'), [
    "'use strict';",
    "require('node:fs').appendFileSync(process.env.EVIDENCE, process.env.KOSMOS_AGENT_TOKEN || '<missing>');",
  ].join('\n') + '\n');

  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, [
    '#!/bin/bash',
    'if [ "${1:-}" = --version ]; then printf "agy 1.2.10\\n"; exit 0; fi',
    'printf "%s" "${KOSMOS_AGENT_TOKEN:-<missing>}" >> "$EVIDENCE"',
  ].join('\n') + '\n', { mode: 0o755 });

  const tmux = path.join(root, 'tmux.sh');
  fs.writeFileSync(tmux, [
    '#!/bin/bash',
    'case "${1:-}" in',
    '  has-session) exit 1 ;;',
    '  new-session)',
    '    printf "%s\\0" "$@" >> "$ARGV_RECORD"',
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
    '    if [ "${2:-}" = --pane-entry ]; then',
    '      (stat -f %Lp "$3" 2>/dev/null || stat -c %a "$3" 2>/dev/null) > "$MODE_RECORD"',
    '    fi',
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
        },
      });
      assert.equal(result.status, 0, result.stderr || `${provider} supervisor failed`);
      assert.equal(fs.readFileSync(evidence, 'utf8'), TOKEN, 'the provider receives the exact minted token');
      const argv = fs.readFileSync(argvRecord);
      assert.ok(!argv.includes(Buffer.from(TOKEN)), 'the token is absent from the real tmux spawn arguments');
      assert.ok(!argv.includes(Buffer.from('KOSMOS_AGENT_TOKEN=')), 'tmux receives no agent-token environment argument');
      assert.ok(argv.includes(Buffer.from('--pane-entry')), 'the pane uses the secret-file entrypoint');
      assert.ok(!result.stdout.includes(TOKEN) && !result.stderr.includes(TOKEN), 'the token is absent from supervisor logs');
      const secretDir = path.join(f.root, 'data', 'launch-secrets');
      assert.equal(fs.readFileSync(modeRecord, 'utf8').trim(), '600', 'the token file is owner-only before the pane reads it');
      assert.equal(fs.statSync(secretDir).mode & 0o777, 0o700, 'the token directory is owner-only');
      assert.deepEqual(fs.readdirSync(secretDir), [], 'the consumed token file is removed');
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('a refused tmux launch removes the unconsumed token file without logging it', () => {
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
