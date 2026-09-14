'use strict';
/**
 * #1704 PR2 (plan §5): the Mac `kosmos` command (install/kosmos) against a board
 * that is serving ANOTHER Kosmos. Every call names this agent's Kosmos in its
 * header file; a 421 `{"wrongWorld":true}` on a reply keeps the words in this
 * agent's own Kosmos through `node engine/outbox.js keep` (the body in a file,
 * never argv); a report is dropped as stale. The shell's copies of the header
 * name, the header's character set and the sentences are pinned to the JS ones.
 *
 * 🔑 THE STUB IS A `curl` SHELL FUNCTION, defined through BASH_ENV (which a
 * non-interactive bash sources before the script), answering as a board serving
 * another Kosmos would and logging each call's `-H @file` header file. A function
 * rather than a `curl` on PATH because Git for Windows' bash.exe puts its own
 * /mingw64/bin ahead of the PATH it inherits, so a PATH stub never wins there; a
 * function beats any PATH lookup on bash 3.2 and Git Bash alike. `healthy()` calls
 * `/usr/bin/curl` by absolute path (Git for Windows has none), so the command runs
 * from a temp COPY with that one path pointed at the function. Nothing else in the
 * copy changes, and KOSMOS_HOME points at this checkout, so the engine it runs is
 * the real one (the source-checkout layout: a system node, engine/outbox.js).
 *
 *   node --test cli.world-outbox-1704.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Sandbox the data root BEFORE any store-using require (repo convention 2).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cli-world-1704-'));
const DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_DATA = DATA;

const test = require('node:test');
const assert = require('node:assert/strict');
const sendertoken = require('./engine/sendertoken');
const outbox = require('./engine/outbox');
const { WORLD_HEADER, WORLD_HEADER_CHARSET, worldIdForHeader } = require('./engine/launchidentity');

const CLI_SRC_PATH = path.join(__dirname, 'install', 'kosmos');
const CLI_SRC = fs.readFileSync(CLI_SRC_PATH, 'utf8');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

/* bash on macOS / Linux; Git for Windows' bash on Windows, which PowerShell does
   not put on PATH. KOSMOS_TEST_BASH overrides both. */
function findBash() {
  if (process.env.KOSMOS_TEST_BASH) return process.env.KOSMOS_TEST_BASH;
  if (process.platform !== 'win32') return 'bash';
  const candidates = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
const BASH = findBash();
const posixPath = (p) => p.replace(/\\/g, '/');

const TMP = path.join(SANDBOX, 'tmp');
const CLI_COPY = path.join(SANDBOX, 'kosmos');
const STUB = path.join(SANDBOX, 'curl-stub.sh');
const BASH_ENV_FILE = path.join(SANDBOX, 'bash-env.sh');
const LOG = path.join(SANDBOX, 'stub.log');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(CLI_COPY, CLI_SRC.replace(/\r\n/g, '\n').replace(/\/usr\/bin\/curl/g, 'curl'), { mode: 0o755 });
fs.writeFileSync(STUB, [
  '# A board serving ANOTHER Kosmos: every /api/ call gets server.js\'s 421 body;',
  '# the page (healthy()) gets the Kosmos page. Each call\'s header file is logged.',
  'url=""; prev=""; hf=""',
  'for a in "$@"; do',
  '  case "$a" in http://*) url="$a" ;; esac',
  '  if [ "$prev" = "-H" ]; then case "$a" in @*) hf="${a#@}" ;; esac; fi',
  '  prev="$a"',
  'done',
  '# Logged after the loop: kosmos_curl passes -H @file BEFORE the url.',
  'if [ -n "$hf" ] && [ -f "$hf" ]; then { echo "===HEADERS $url"; cat "$hf"; } >> "$STUB_LOG"; fi',
  'case "$url" in',
  '  */api/*) printf \'%s\' \'{"wrongWorld":true,"serving":"default","because":"That came from an agent in a different Kosmos from the one open right now, so this board did not take it."}\' ;;',
  '  *) printf \'%s\' \'<title>Kosmos</title>Agent Workforce\' ;;',
  'esac',
  '',
].join('\n'));
fs.writeFileSync(BASH_ENV_FILE, 'curl() { /bin/bash "$KOSMOS_TEST_CURL_STUB" "$@"; }\n');

const minted = sendertoken.mint('ava');

function runCli(args, extraEnv) {
  const env = {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter),
    BASH_ENV: posixPath(BASH_ENV_FILE),
    KOSMOS_TEST_CURL_STUB: posixPath(STUB),
    STUB_LOG: posixPath(LOG),
    KOSMOS_HOME: __dirname,
    KOSMOS_PORT: '1',                                   // never dialled: curl is the stub
    AGENT_WORKFORCE_DATA: DATA,
    AGENT_WORKFORCE_TMUX_BIN: path.join(SANDBOX, 'no-tmux'),   // an explicit pick: skips the tmux probe
    KOSMOS_TMUX_BIN_PICKED: '',
    KOSMOS_AGENT_TOKEN: minted.token,
    TMUX_PANE: '',
    TMPDIR: posixPath(TMP),
    ...extraEnv,
  };
  return new Promise((resolve) => {
    execFile(BASH, [posixPath(CLI_COPY), ...args], { env, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
function clear() {
  fs.rmSync(outbox.outboxDir(), { recursive: true, force: true });
  fs.rmSync(LOG, { force: true });
}

test('the shell\'s header name, its character set and its 421 sentences are the JS ones', () => {
  const header = CLI_SRC.match(/printf '([a-z-]+): %s\\n' "\$_world"/);
  assert.ok(header, 'kosmos_curl no longer writes the world header line this test knows how to find');
  assert.equal(header[1], WORLD_HEADER, 'install/kosmos and launchidentity.WORLD_HEADER name the header differently, so the board would never see it');
  assert.ok(CLI_SRC.includes("tr -cd '" + WORLD_HEADER_CHARSET + "'"),
    'install/kosmos strips KOSMOS_WORLD with a different character set from launchidentity.worldIdForHeader');
  assert.ok(CLI_SRC.includes(outbox.WRONG_WORLD_SENTENCES.staleReport), 'the report-dropped sentence drifted from outbox.js');
  assert.ok(CLI_SRC.includes(outbox.WRONG_WORLD_SENTENCES.notOpen), 'the not-open sentence drifted from outbox.js');
});

test('worldIdForHeader: a real world id is unchanged, anything else is stripped, and nothing left is default', () => {
  assert.equal(worldIdForHeader('mars'), 'mars');
  assert.equal(worldIdForHeader('te st!\n'), 'test', 'a newline must never reach a header');
  assert.equal(worldIdForHeader(''), 'default');
  assert.equal(worldIdForHeader(undefined), 'default');
  assert.equal(worldIdForHeader('!!'), 'default');
});

test('a reply that meets a 421 is kept in this agent\'s Kosmos through the Node entry, and every call names the Kosmos', { skip: !BASH && 'no bash on this machine' }, async () => {
  clear();
  const r = await runCli(['reply', 'kept for later'], { KOSMOS_WORLD: 'test' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(outbox.WRONG_WORLD_SENTENCES.kept), 'the kept sentence: ' + r.stdout);
  const kept = outbox.list();
  assert.equal(kept.length, 1, 'exactly one entry kept');
  assert.equal(kept[0].entry.verb, 'reply');
  assert.equal(kept[0].entry.from, 'ava', 'the sender comes from the agent\'s own token');
  assert.deepEqual(kept[0].entry.body, { text: 'kept for later', from_pane: '' }, 'the body is exactly the JSON the board was sent');
  const log = fs.readFileSync(LOG, 'utf8');
  assert.match(log, /===HEADERS [^\n]*\/api\/reply\n[^=]*x-kosmos-world: test/, 'the reply\'s header file names the Kosmos');
  const leftover = fs.readdirSync(TMP).filter((n) => n.startsWith('kosmos-outbox.') || n.startsWith('kosmos-auth.'));
  assert.deepEqual(leftover, [], 'no temp file holding the agent\'s words or tokens is left behind');
});

test('with no KOSMOS_WORLD the header says default, and an odd one is stripped exactly as the JS clients strip it', { skip: !BASH && 'no bash on this machine' }, async () => {
  clear();
  const r = await runCli(['reply', 'x'], { KOSMOS_WORLD: '' });
  assert.ok(fs.existsSync(LOG), 'the stub was never called: ' + r.stdout + r.stderr);
  assert.match(fs.readFileSync(LOG, 'utf8'), /x-kosmos-world: default/);
  clear();
  await runCli(['reply', 'x'], { KOSMOS_WORLD: 'te st!' });
  assert.match(fs.readFileSync(LOG, 'utf8'), new RegExp('x-kosmos-world: ' + worldIdForHeader('te st!') + '\\n'));
  clear();
});

test('a report that meets a 421 is dropped as stale: exit 0, the sentence, nothing kept', { skip: !BASH && 'no bash on this machine' }, async () => {
  clear();
  const r = await runCli(['report', 'working', 'on', 'it'], { KOSMOS_WORLD: 'test' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(outbox.WRONG_WORLD_SENTENCES.staleReport), r.stdout);
  assert.deepEqual(outbox.list(), []);
});
