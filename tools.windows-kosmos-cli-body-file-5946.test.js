'use strict';
/**
 * #5946: a body path that works the same in every shell, and a PowerShell pipe that names it.
 *
 * Measured on Windows 11 before this change (PowerShell 5.1, through the shipped kosmos.ps1 and kosmos-cli.js,
 * against a stub board): piping a post, comment or feedback report into `kosmos` from PowerShell never reached it.
 * With stdin closed it was refused at once as empty, naming only the here-string; with stdin a pipe a tool runner
 * holds open it waited the full 3 s first. So `feedback write`, `community post`, `comment`, `edit` and `endorse`
 * now take --body-file <file>, decoded by its byte order mark (PowerShell 5.1's Out-File and `>` write UTF-16LE),
 * and kosmos.ps1 tells the CLI when something was piped into it ($MyInvocation.ExpectingInput, never $input), so
 * the verb refuses at once and says what to type.
 *
 * The first part drives main() through its seams (any platform; nothing leaves the process). The last part runs
 * the shipped shim in real PowerShell against a local stub board, Windows only.
 *
 *   node --test tools.windows-kosmos-cli-body-file-5946.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');

const cli = require('./tools/windows/kosmos-cli');
const { removeTree } = require('./test-support/remove-tree');

const TOKEN = 'ab'.repeat(16);
/* What an agent writes: two lines, an accented letter, an emoji, and the characters a shell would run. */
const BODY = 'line one caf\u00e9 `echo PWNED` $HOME "q"\nline two \u{1F680} end';

function utf16le(s) { return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(s, 'utf16le')]); }
function utf8bom(s) { return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(s, 'utf8')]); }
const crlf = (s) => s.replace(/\n/g, '\r\n') + '\r\n';

function harness({ files = {}, stdin, psArgs, answer } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const written = [];
  let stdinReads = 0;
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => { stdinReads++; return stdin || { text: '', ended: true }; },
    readBodyFile: (f) => {
      if (!Object.prototype.hasOwnProperty.call(files, f)) { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; }
      const v = files[f];
      return v === 'OVERFLOW' ? { overflow: true } : { buf: v };
    },
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    engine: {
      feedback: { write: (b) => { written.push(b); return { ok: true, date: '2026-10-12' }; } },
      feedbacksend: { sendNow: async () => ({ state: 'sent' }), writeMessage: () => 'Saved.' },
    },
    fetch: async (u, init) => {
      sent.push({ url: u, body: init.body ? JSON.parse(init.body) : undefined });
      const [status, json] = (answer || (() => [200, { ok: true, status: 'published', id: 'p1' }]))();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  if (psArgs) io.readFile = () => JSON.stringify(psArgs);
  return { io, sent, lines, written, stdinReads: () => stdinReads, all: () => lines.out.concat(lines.err).join('\n') };
}
/* argv as kosmos.ps1 sends it: the words in a file, and the pipeline flag when PowerShell piped something in. */
function viaPowerShell(piped) {
  return ['--kosmos-argv-file', 'C:\\t\\argv.json'].concat(piped ? ['--kosmos-ps-pipeline'] : []);
}

// ── --body-file ────────────────────────────────────────────────────────────

test('#5946: community post --body-file reads a PowerShell Out-File file (UTF-16LE, BOM, CRLF) as written, LF line ends', async () => {
  const h = harness({ files: { 'b.txt': utf16le(crlf(BODY)) } });
  const code = await cli.main(['community', 'post', '--channel', 'engineering', '--topic', 'T', '--body-file', 'b.txt'], h.io);
  assert.equal(code, 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].url, /\/api\/community\/post$/);
  assert.equal(h.sent[0].body.body, BODY);
  assert.equal(h.sent[0].body.topic, 'T');
  assert.equal(h.sent[0].body.channel, 'engineering');
  assert.equal(h.stdinReads(), 0, 'stdin was read although the body came from a file');
});

test('#5946: comment, edit, endorse and feedback write take --body-file (UTF-8 with and without a BOM, --body-file=)', async () => {
  const files = { 'c.txt': utf8bom(crlf(BODY)), 'd.txt': Buffer.from(BODY + '\n', 'utf8') };
  const c = harness({ files });
  assert.equal(await cli.main(['community', 'comment', 'p-1', '--reply-to', 'c-9', '--body-file', 'c.txt'], c.io), 0, c.all());
  assert.equal(c.sent[0].body.body, BODY);
  assert.equal(c.sent[0].body.servicePostId, 'p-1');
  assert.equal(c.sent[0].body.serviceParentId, 'c-9');
  const c2 = harness({ files });
  assert.equal(await cli.main(['community', 'comment', '--body-file=d.txt', 'p-2'], c2.io), 0, c2.all());
  assert.equal(c2.sent[0].body.body, BODY);
  assert.equal(c2.sent[0].body.servicePostId, 'p-2');
  const e = harness({ files, answer: () => [200, { ok: true, kind: 'post', state: 'changed' }] });
  assert.equal(await cli.main(['community', 'edit', 'post', 'id-1', '--topic', 'New', '--body-file', 'd.txt'], e.io), 0, e.all());
  assert.equal(e.sent[0].body.body, BODY);
  assert.equal(e.sent[0].body.topic, 'New');
  const e2 = harness({ files, answer: () => [200, { ok: true, kind: 'comment', state: 'changed' }] });
  assert.equal(await cli.main(['community', 'edit', '--body-file', 'd.txt', 'comment', 'id-2'], e2.io), 0, e2.all());
  assert.equal(e2.sent[0].body.body, BODY, 'a leading --body-file works for edit too');
  assert.equal(e2.sent[0].body.id, 'id-2');
  const n = harness({ files, answer: () => [200, { ok: true, text: 'Endorsed.' }] });
  assert.equal(await cli.main(['community', 'endorse', 'Some Agent', '4', '--body-file', 'd.txt'], n.io), 0, n.all());
  assert.equal(n.sent[0].body.text, BODY);
  assert.equal(n.sent[0].body.stars, 4);
  const f = harness({ files });
  assert.equal(await cli.main(['feedback', 'write', '--body-file', 'c.txt'], f.io), 0, f.all());
  assert.deepEqual(f.written, [BODY]);
  for (const h of [c, c2, e, n, f]) assert.equal(h.stdinReads(), 0);
});

test('#5946: a --body-file that cannot be used is refused with the reason, and nothing is sent', async () => {
  const cases = [
    ['missing.txt', /could not read missing\.txt \(there is no such file\)/],
    ['~\\post.txt', /there is no such file; ~ was not turned into your home folder, so give the full path \(in PowerShell, \$HOME\\post\.txt\)/],
    ['ansi.txt', /ansi\.txt is not UTF-8 text.*Set-Content -Encoding UTF8 <file> or Out-File <file>/],
    ['nul.txt', /nul\.txt holds NUL characters/],
    ['odd.txt', /odd\.txt is not whole UTF-16 text/],
    ['surrogate.txt', /surrogate\.txt is not whole UTF-16 text, so some of its letters would change/],
    ['empty.txt', /empty\.txt is empty/],
    ['big.txt', /big\.txt is over the 6 MB kosmos reads from a file/],
  ];
  const files = {
    'ansi.txt': Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0D, 0x0A]),   // PowerShell 5.1's plain Set-Content: cp1252 "café"
    'nul.txt': Buffer.from('hi', 'utf16le'),   // UTF-16 with no mark
    'odd.txt': Buffer.concat([utf16le('hi'), Buffer.from([0x41])]),   // a UTF-16 mark and an odd byte count
    'surrogate.txt': Buffer.from([0xFF, 0xFE, 0x00, 0xD8, 0x41, 0x00]),   // a lone high surrogate: refused, not U+FFFD
    'empty.txt': utf16le('\r\n'),
    'big.txt': 'OVERFLOW',
  };
  for (const [file, why] of cases) {
    for (const argv of [['community', 'post', '--body-file', file], ['community', 'comment', 'p-1', '--body-file', file], ['feedback', 'write', '--body-file', file]]) {
      const h = harness({ files });
      assert.equal(await cli.main(argv, h.io), 2, argv.join(' ') + ': ' + h.all());
      assert.match(h.lines.err.join('\n'), why, argv.join(' '));
      assert.equal(h.sent.length, 0);
      assert.equal(h.written.length, 0);
    }
  }
});

test('#5946: --body-file with words too, twice, or with no path is refused; after -- it is just text', async () => {
  const files = { 'd.txt': Buffer.from('x') };
  for (const [argv, why] of [
    [['community', 'post', '--body-file', 'd.txt', 'more', 'words'], /as words or in --body-file, not both/],
    [['community', 'post', '--body-file', 'd.txt', '--body-file', 'd.txt'], /Give --body-file once/],
    [['community', 'comment', 'p-1', '--body-file'], /--body-file needs the path/],
    [['community', 'post', '--body-file', '--', 'words'], /--body-file needs the path/],
    [['feedback', 'write', '--body-file', '--topic'], /--body-file needs a value, and --topic is an option/],
    /* The word after one of the verb's own value options stays its value, so the option refuses it, as the Mac CLI
       does (#5970); it is never taken as --body-file, which would publish the next word as the topic. */
    [['community', 'post', '--topic', '--body-file', 'd.txt', 'Hello'], /--topic needs a value, and --body-file is an option/],
    [['community', 'post', '--channel', '--body-file', 'd.txt'], /--channel needs a value, and --body-file is an option/],
    [['community', 'comment', 'p-1', '--reply-to', '--body-file', 'd.txt'], /--reply-to needs a value, and --body-file is an option/],
    [['community', 'edit', 'post', 'id-1', '--topic', '--body-file', 'd.txt'], /--topic needs a value, and --body-file is an option/],
  ]) {
    const h = harness({ files });
    assert.equal(await cli.main(argv, h.io), 2, argv.join(' ') + ': ' + h.all());
    assert.match(h.lines.err.join('\n'), why);
    assert.equal(h.sent.length, 0);
  }
  const h = harness({ files });
  assert.equal(await cli.main(['community', 'post', '--', '--body-file', 'd.txt'], h.io), 0, h.all());
  assert.equal(h.sent[0].body.body, '--body-file d.txt');
});

test('#5946: the default file reader reads a real file, and refuses a folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-body-file-5946-'));
  try {
    const file = path.join(dir, 'body.txt');
    fs.writeFileSync(file, utf16le(crlf(BODY)));
    const h = harness();
    delete h.io.readBodyFile;
    assert.equal(await cli.main(['community', 'post', '--body-file', file], h.io), 0, h.all());
    assert.equal(h.sent[0].body.body, BODY);
    /* A longer file arrives whole: the reader sizes its reads to the file, not to the 6 MB cap. */
    const long = Array.from({ length: 3000 }, (_, i) => 'line ' + i + ' café').join('\n');
    const longFile = path.join(dir, 'long.txt');
    fs.writeFileSync(longFile, long, 'utf8');
    const l = harness();
    delete l.io.readBodyFile;
    assert.equal(await cli.main(['community', 'post', '--body-file', longFile], l.io), 0, l.all());
    assert.equal(l.sent[0].body.body, long);
    const d = harness();
    delete d.io.readBodyFile;
    assert.equal(await cli.main(['community', 'post', '--body-file', dir], d.io), 2, d.all());
    assert.match(d.lines.err.join('\n'), /it is a folder, not a file/);
    assert.equal(d.sent.length, 0);
  } finally { removeTree(dir); }
});

// ── a PowerShell pipe names the working path ─────────────────────────────────

test('#5946: text piped in PowerShell is refused AT ONCE (stdin never read), naming --body-file and the here-string', async () => {
  const verbs = [
    [['community', 'post', '--topic', 'T'], 'Nothing was posted', 'kosmos community post --body-file <file>'],
    [['community', 'comment', 'p-1'], 'Nothing was sent', 'kosmos community comment <post-id> --body-file <file>'],
    [['community', 'edit', 'post', 'id-1'], 'Nothing was changed', 'kosmos community edit <post|comment> <id> --body-file <file>'],
    [['community', 'endorse', 'Some Agent', '5'], 'Nothing was sent', 'kosmos community endorse <agent-name> <1-5> --body-file <file>'],
    [['feedback', 'write'], 'Nothing was saved', 'kosmos feedback write --body-file <file>'],
  ];
  for (const [words, nothing, example] of verbs) {
    const h = harness({ psArgs: words, stdin: { text: 'a tool runner\'s stdin, not the agent\'s text', ended: true } });
    assert.equal(await cli.main(viaPowerShell(true), h.io), 2, words.join(' ') + ': ' + h.all());
    const err = h.lines.err.join('\n');
    assert.ok(err.startsWith(nothing + ': text piped into kosmos in PowerShell does not reach it. Save the text in a file and give its path: ' + example), err);
    assert.match(err, /single-quoted here-string after the command: @' at the end of the first line/);
    assert.equal(h.stdinReads(), 0, words.join(' ') + ': stdin was read');
    assert.equal(h.sent.length, 0);
    assert.equal(h.written.length, 0);
  }
});

test('#5946: from PowerShell with words, or with --body-file, a pipe flag changes nothing', async () => {
  const words = ['community', 'post', 'hello there'];
  const h = harness({ psArgs: words });
  assert.equal(await cli.main(viaPowerShell(true), h.io), 0, h.all());
  assert.equal(h.sent[0].body.body, 'hello there');
  const fw = ['community', 'post', '--body-file', 'd.txt'];
  const f = harness({ psArgs: fw, files: { 'd.txt': utf16le(crlf(BODY)) } });
  assert.equal(await cli.main(viaPowerShell(true), f.io), 0, f.all());
  assert.equal(f.sent[0].body.body, BODY);
});

test('#5946: with nothing piped and no text, the refusal names --body-file in every reader', async () => {
  for (const words of [['community', 'post'], ['community', 'comment', 'p-1'], ['feedback', 'write']]) {
    const h = harness({ psArgs: words });
    assert.equal(await cli.main(viaPowerShell(false), h.io), 2, h.all());
    assert.equal(h.stdinReads(), 1, 'without the pipe flag stdin is still read, as before');
    assert.match(h.lines.err.join('\n'), /give --body-file <file>/);
    assert.match(h.lines.err.join('\n'), /in PowerShell, text piped into kosmos does not reach it: save the (text|report) in a file and give its path with --body-file <file>/);
  }
  /* edit and endorse print the PowerShell note in every shell, as post and comment do (no argument file here). */
  for (const words of [['community', 'edit', 'post', 'id-1'], ['community', 'endorse', 'A', '3']]) {
    const plain = harness();
    assert.equal(await cli.main(words, plain.io), 2, plain.all());
    assert.match(plain.lines.err.join('\n'), /in PowerShell, text piped into kosmos does not reach it: save the text in a file/);
  }
  for (const words of [['community', 'edit', 'post', 'id-1'], ['community', 'endorse', 'A', '3']]) {
    const h = harness({ psArgs: words });
    assert.equal(await cli.main(viaPowerShell(false), h.io), 2, h.all());
    assert.match(h.lines.err.join('\n'), /--body-file <file>/);
    assert.match(h.lines.err.join('\n'), /in PowerShell, text piped into kosmos does not reach it/);
  }
});

test('#5946: --help names --body-file for each verb that takes it', async () => {
  for (const argv of [['feedback', '--help'], ['community', '--help'], ['community', 'comment', '--help']]) {
    const h = harness();
    assert.equal(await cli.main(argv, h.io), 0);
    assert.match(h.lines.out.join('\n'), /--body-file <file>/, argv.join(' '));
  }
});

// ── the shipped shim, in real PowerShell (Windows only) ──────────────────────

const ON_WINDOWS = process.platform === 'win32';
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/* A throwaway zip: the shipped shim and the REAL CLI in bin, node in runtime, and app a junction to this checkout. */
function zipRoot() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-')));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'runtime'));
  const node = path.join(root, 'runtime', 'node.exe');
  try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
  fs.copyFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos.ps1'), path.join(root, 'bin', 'kosmos.ps1'));
  fs.copyFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), path.join(root, 'bin', 'kosmos-cli.js'));
  /* The Git Bash shim, as the build copies it: any CR stripped. */
  fs.writeFileSync(path.join(root, 'bin', 'kosmos'), fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos.sh'), 'utf8').replace(/\r/g, ''));
  fs.symlinkSync(__dirname, path.join(root, 'app'), 'junction');
  return root;
}
function removeZip(root) {
  try { fs.unlinkSync(path.join(root, 'app')); } catch { /* no junction */ }
  removeTree(root);
}
/* A stub board that records each request; nothing reaches the real board or the network. */
function stubBoard() {
  const got = [];
  const server = http.createServer((q, s) => {
    const chunks = [];
    q.on('data', (c) => chunks.push(c));
    q.on('end', () => {
      got.push({ url: q.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') });
      s.setHeader('content-type', 'application/json');
      s.end(JSON.stringify({ ok: true, status: 'published', id: '00000000-0000-0000-0000-000000000001' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ got, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}
/* Claude Code's PowerShell tool, as measured in tools.windows-kosmos-shims-570.test.js: chcp 65001, then -Command
   running the script with Invoke-Expression, and stdin an OPEN pipe that is never written to or closed. */
function claudeCodePowerShell(bin, script, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const e = Object.assign({}, process.env, env);
    for (const k of ['KOSMOS_WORLD', 'NODE_OPTIONS', 'KOSMOS_AGENT_TOKEN_ONLY']) delete e[k];
    const key = Object.keys(e).find((k) => k.toUpperCase() === 'PATH') || 'Path';
    e[key] = bin + ';' + e[key];
    /* Base64 so the script's own quotes and non-ASCII letters reach PowerShell as typed. */
    e.KOSMOS_TEST_SCRIPT_B64 = Buffer.from(script, 'utf8').toString('base64');
    const inner = '"' + path.join(SYSTEM32, 'chcp.com') + '" 65001 >nul & "' + POWERSHELL + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KOSMOS_TEST_SCRIPT_B64)); Invoke-Expression -Command $s"';
    const child = cp.spawn('cmd.exe', ['/d', '/s', '/c', '"' + inner + '"'], { env: e, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let killed = false;
    const timer = setTimeout(() => { killed = true; try { cp.execFileSync(path.join(SYSTEM32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }, 60000);
    child.on('exit', () => {
      clearTimeout(timer);
      try { child.stdin.destroy(); } catch { /* closed */ }
      resolve({ exited: !killed, ms: Date.now() - started, out: out.trim() });
    });
  });
}

const PS_BODY = "@'\nline one caf\u00e9\nline two \u{1F680} end\n'@";
const PS_BODY_TEXT = 'line one caf\u00e9\nline two \u{1F680} end';

test('#5946 PowerShell: piping a post into kosmos is refused at once, naming --body-file, and nothing is sent', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  const board = await stubBoard();
  try {
    const env = { KOSMOS_PORT: String(board.port), AGENT_WORKFORCE_DATA: data, KOSMOS_AGENT_TOKEN: TOKEN, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:' + board.port + '/collector' };
    const script = [
      '$t0 = Get-Date',
      PS_BODY + " | kosmos community post --channel engineering --topic 'T'",
      '"KEXIT=$LASTEXITCODE KMS=$([int]((Get-Date) - $t0).TotalMilliseconds)"',
      '$t0 = Get-Date',
      '"a`nb" | kosmos feedback write',
      '"FEXIT=$LASTEXITCODE FMS=$([int]((Get-Date) - $t0).TotalMilliseconds)"',
    ].join('\n');
    const r = await claudeCodePowerShell(path.join(root, 'bin'), script, env);
    assert.equal(r.exited, true, 'kosmos hung: ' + r.out);
    assert.match(r.out, /Nothing was posted: text piped into kosmos in PowerShell does not reach it\. Save the text in a file and give its path: kosmos community post --body-file <file>/);
    assert.match(r.out, /KEXIT=2/);
    assert.match(r.out, /Nothing was saved: text piped into kosmos in PowerShell does not reach it/);
    assert.match(r.out, /FEXIT=2/);
    /* Before #5946 EACH call waited out the 3 s quiet limit on the open stdin (measured 3.1-3.4 s). Each is timed on
       its own inside PowerShell, so a single quiet-limit wait fails here; measured 0.1-0.2 s with the change. */
    const PER_CALL_CEILING_MS = cli.STDIN_QUIET_LIMIT_MS - 500;
    for (const key of ['KMS', 'FMS']) {
      const m = new RegExp(key + '=(\\d+)').exec(r.out);
      assert.ok(m, key + ' missing: ' + r.out);
      assert.ok(Number(m[1]) < PER_CALL_CEILING_MS, key + ' took ' + m[1] + ' ms, a quiet-limit wait: ' + r.out);
    }
    assert.equal(board.got.length, 0, 'something reached the board: ' + JSON.stringify(board.got));
  } finally { await board.close(); try { removeZip(root); } finally { removeTree(data); } }
});

test('#5946 PowerShell: a multi-line post and comment written with Out-File or Set-Content -Encoding UTF8 arrive exactly with --body-file', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  const board = await stubBoard();
  try {
    const env = { KOSMOS_PORT: String(board.port), AGENT_WORKFORCE_DATA: data, KOSMOS_AGENT_TOKEN: TOKEN, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:' + board.port + '/collector' };
    const f1 = path.join(data, 'post.txt');
    const f2 = path.join(data, 'comment.txt');
    const f3 = path.join(data, 'report.txt');
    const script = [
      PS_BODY + " | Out-File '" + f1 + "'",
      "kosmos community post --channel engineering --topic 'T' --body-file '" + f1 + "'",
      '"PEXIT=$LASTEXITCODE"',
      PS_BODY + " | Set-Content -Encoding UTF8 -Path '" + f2 + "'",
      "kosmos community comment p-123 --body-file '" + f2 + "'",
      '"CEXIT=$LASTEXITCODE"',
      PS_BODY + " > '" + f3 + "'",
      "kosmos feedback write --body-file '" + f3 + "'",
      '"FEXIT=$LASTEXITCODE"',
      'kosmos feedback show',
    ].join('\n');
    const r = await claudeCodePowerShell(path.join(root, 'bin'), script, env);
    assert.equal(r.exited, true, 'kosmos hung: ' + r.out);
    assert.match(r.out, /PEXIT=0/, r.out);
    assert.match(r.out, /CEXIT=0/, r.out);
    assert.match(r.out, /FEXIT=0/, r.out);
    const post = board.got.find((g) => g.url === '/api/community/post');
    const comment = board.got.find((g) => g.url === '/api/community/service-comment');
    assert.ok(post && comment, 'the board did not get both: ' + JSON.stringify(board.got));
    assert.equal(post.body.body, PS_BODY_TEXT);
    assert.equal(comment.body.body, PS_BODY_TEXT);
    assert.equal(comment.body.servicePostId, 'p-123');
    assert.ok(r.out.includes(PS_BODY_TEXT.split('\n')[1]), 'the saved report changed on the way: ' + r.out);
  } finally { await board.close(); try { removeZip(root); } finally { removeTree(data); } }
});

test('#5946 PowerShell: `powershell -File kosmos.ps1 feedback write` with a report on stdin still saves it (no pipe flag there)', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  /* Measured: under -File a redirected stdin also reads as ExpectingInput, and node DOES get that stdin. Sending
     the pipe flag there would refuse a report that arrives (the shim's GetCommandLineArgs check prevents it). */
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  try {
    const env = Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: data, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/collector' });
    for (const k of ['KOSMOS_WORLD', 'NODE_OPTIONS', 'KOSMOS_AGENT_TOKEN_ONLY']) delete env[k];
    const ps1 = path.join(root, 'bin', 'kosmos.ps1');
    /* The -File value as a caller may write it: absolute, relative to the working folder, and with forward slashes. */
    const forms = [
      { label: 'absolute', file: ps1, cwd: undefined },
      { label: 'relative', file: 'kosmos.ps1', cwd: path.join(root, 'bin') },
      { label: 'forward slashes', file: ps1.replace(/\\/g, '/'), cwd: undefined },
    ];
    for (const form of forms) {
      const report = 'caf\u00e9 from a -File pipe, ' + form.label;
      const w = cp.spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', form.file, 'feedback', 'write'], { env, cwd: form.cwd, input: report + '\n', encoding: 'utf8', timeout: 60000 });
      assert.equal(w.status, 0, form.label + ': ' + w.stdout + w.stderr);
      const s = cp.spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, 'feedback', 'show'], { env, input: '', encoding: 'utf8', timeout: 60000 });
      assert.ok(s.stdout.includes('from a -File pipe, ' + form.label), form.label + ': ' + s.stdout + s.stderr);
    }
    /* The same report on the host's stdin with -Command running the script (no pipe written in the command text):
       measured, ExpectingInput is false there and node gets the stdin, as before #5946. */
    const viaCommand = 'café from -Command with the host stdin';
    const c = cp.spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '&', ps1, 'feedback', 'write'], { env, input: viaCommand + '\n', encoding: 'utf8', timeout: 60000 });
    assert.equal(c.status, 0, '-Command: ' + c.stdout + c.stderr);
    const cs = cp.spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, 'feedback', 'show'], { env, input: '', encoding: 'utf8', timeout: 60000 });
    assert.ok(cs.stdout.includes(viaCommand), '-Command: ' + cs.stdout + cs.stderr);
  } finally { try { removeZip(root); } finally { removeTree(data); } }
});

test('#5946 PowerShell: under -File, an agent word after the script that looks like a host switch (/c, -e) does not cost the piped body', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  /* Only the host's arguments BEFORE the script's path are read for -Command/-EncodedCommand; reading the agent's
     words too made a topic of /c or -e pass for -Command, sent the pipe flag, and refused a body that arrives. */
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  const board = await stubBoard();
  try {
    const env = Object.assign({}, process.env, { KOSMOS_PORT: String(board.port), AGENT_WORKFORCE_DATA: data, KOSMOS_AGENT_TOKEN: TOKEN, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:' + board.port + '/collector' });
    for (const k of ['KOSMOS_WORLD', 'NODE_OPTIONS', 'KOSMOS_AGENT_TOKEN_ONLY']) delete env[k];
    const ps1 = path.join(root, 'bin', 'kosmos.ps1');
    for (const topic of ['/c', '-e', '-Command']) {
      const body = 'body under -File, topic ' + topic;
      /* Async spawn: the stub board answers on this process's event loop, which spawnSync would block. */
      const r = await new Promise((resolve) => {
        const child = cp.spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, 'community', 'post', '--channel', 'engineering', '--topic', topic], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 60000);
        child.on('exit', (status) => { clearTimeout(timer); resolve({ status, out }); });
        child.stdin.end(body + '\n');
      });
      assert.equal(r.status, 0, topic + ': ' + r.out);
      const post = board.got.find((g) => g.url === '/api/community/post' && g.body && g.body.body === body);
      assert.ok(post, topic + ': the body did not reach the board: ' + JSON.stringify(board.got) + ' ' + r.out);
    }
  } finally { await board.close(); try { removeZip(root); } finally { removeTree(data); } }
});

test('#5946 PowerShell: a pipe inside ANOTHER script run with -File is refused at once, even when kosmos.ps1 is one of that script\'s arguments', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  /* The value after -File ends the host-argument scan: it names the script that was started, and the arguments
     after it are that script's own, never read as the host's. */
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  try {
    const env = Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: data, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/collector' });
    for (const k of ['KOSMOS_WORLD', 'NODE_OPTIONS', 'KOSMOS_AGENT_TOKEN_ONLY']) delete env[k];
    const ps1 = path.join(root, 'bin', 'kosmos.ps1');
    const runner = path.join(data, 'runner.ps1');
    fs.writeFileSync(runner, "param($k)\n'a report' | & $k feedback write\n\"REXIT=$LASTEXITCODE\"\n");
    const r = cp.spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, ps1], { env, input: '', encoding: 'utf8', timeout: 60000 });
    const out = r.stdout + r.stderr;
    assert.match(out, /Nothing was saved: text piped into kosmos in PowerShell does not reach it/, out);
    assert.match(out, /REXIT=2/, out);
  } finally { try { removeZip(root); } finally { removeTree(data); } }
});

test('#5946: reply/msg/post --stdin and connect refuse a PowerShell pipe at once too (their read waits up to 120 s / 3 s)', async () => {
  for (const [words, why] of [
    [['reply', '--stdin'], /Nothing was kept: text piped into kosmos in PowerShell does not reach it, so --stdin has nothing to read there\.\nPass it as one single-quoted here-string after the command instead, without --stdin.*plain single quotes end at an apostrophe/],
    [['msg', '--stdin', 'bart'], /Nothing was sent: text piped into kosmos in PowerShell does not reach it/],
    [['post', '--stdin', 'proj-1'], /Nothing was posted: text piped into kosmos in PowerShell does not reach it/],
    [['feedback', 'triage', '--cards', '-'], /Nothing was triaged: a list piped into kosmos in PowerShell does not reach it. Save the titles in a file instead: --cards <file>/],
    [['connect', 'brave-search'], /a token piped into kosmos in PowerShell does not reach it\. A token is never put on a command line, so there is no PowerShell form: run it from Git Bash/],
  ]) {
    const h = harness({ psArgs: words, stdin: { text: 'not the agent\'s text', ended: true } });
    assert.equal(await cli.main(viaPowerShell(true), h.io), 2, words.join(' ') + ': ' + h.all());
    assert.match(h.lines.err.join('\n'), why, words.join(' '));
    assert.equal(h.stdinReads(), 0, words.join(' ') + ': stdin was read');
    assert.equal(h.sent.length, 0);
  }
});

const USR_BASH = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
test('#5946 Git Bash: --body-file with a POSIX path (/tmp, mktemp) reaches the file; words after -- are left alone', { skip: (!ON_WINDOWS || !fs.existsSync(USR_BASH)) && 'Windows with Git Bash only' }, async () => {
  /* The shim turns MSYS path conversion off for every argument, so it converts --body-file's own value with cygpath:
     /tmp/x.txt would otherwise reach Windows node as C:/tmp/x.txt (drive root) and be refused as missing. */
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  const board = await stubBoard();
  try {
    const env = Object.assign({}, process.env, { KOSMOS_PORT: String(board.port), AGENT_WORKFORCE_DATA: data, KOSMOS_AGENT_TOKEN: TOKEN });
    for (const k of ['KOSMOS_WORLD', 'NODE_OPTIONS', 'KOSMOS_AGENT_TOKEN_ONLY']) delete env[k];
    const posixBin = '/' + path.join(root, 'bin').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/');
    const script = [
      'export PATH="' + posixBin + ':/usr/bin:$PATH"',
      'f=$(mktemp)',
      "printf 'line one caf\\303\\251\\nline two\\n' > \"$f\"",
      'case $f in /*) ;; *) echo "NOT-POSIX $f"; exit 9 ;; esac',
      'kosmos community post --topic T --body-file "$f"; echo "PEXIT=$?"',
      'kosmos community comment p-1 --body-file="$f"; echo "CEXIT=$?"',
      'kosmos community post -- see /c/Users/x and /tmp/y; echo "TEXIT=$?"',    ].join('\n');
    /* Async, never spawnSync: the stub board answers on this same event loop. */
    const out = await new Promise((resolve) => {
      const child = cp.spawn(USR_BASH, ['-c', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      const timer = setTimeout(() => child.kill(), 60000);
      child.on('exit', () => { clearTimeout(timer); resolve(text); });
    });
    assert.match(out, /PEXIT=0/, out);
    assert.match(out, /CEXIT=0/, out);
    assert.match(out, /TEXIT=0/, out);
    const bodies = board.got.map((g) => g.body.body);
    assert.equal(bodies[0], 'line one caf\u00e9\nline two');
    assert.equal(bodies[1], 'line one caf\u00e9\nline two');
    assert.equal(bodies[2], 'see /c/Users/x and /tmp/y', 'a path in the words after -- was rewritten');  } finally { await board.close(); try { removeZip(root); } finally { removeTree(data); } }
});

test('#5946: a piped body that stops without ending names --body-file for feedback, edit and endorse too (never a double-quoted argument)', async () => {
  for (const [words, example] of [
    [['feedback', 'write'], 'kosmos feedback write --body-file <file>'],
    [['community', 'edit', 'post', 'id-1'], 'kosmos community edit <post|comment> <id> --body-file <file>'],
    [['community', 'endorse', 'A', '4'], 'kosmos community endorse <agent-name> <1-5> --body-file <file>'],
    [['community', 'post'], 'kosmos community post --body-file <file>'],
    [['community', 'comment', 'p-1'], 'kosmos community comment <post-id> --body-file <file>'],
  ]) {
    const h = harness({ stdin: { text: 'part of it', ended: false } });
    assert.equal(await cli.main(words, h.io), 2, words.join(' ') + ': ' + h.all());
    const err = h.lines.err.join('\n');
    assert.ok(err.includes('Save it') || err.includes('Save them'), words.join(' ') + ': ' + err);
    assert.ok(err.includes(example), words.join(' ') + ': ' + err);
    assert.ok(!err.includes('"<the report>"'), 'a double-quoted argument was offered: ' + err);
    assert.equal(h.sent.length, 0);
    assert.equal(h.written.length, 0);
  }
});

test('#5946 PowerShell: a pipe inside -Command is refused at once even when the script path is its own argument', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  /* -Command words are joined into one command, so the script's path can be a host argument of its own while the
     pipe is a real in-session one. The -File exception must not swallow it. */
  const root = zipRoot();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-5946-data-'));
  try {
    const env = Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: data, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/collector' });
    for (const k of ['KOSMOS_WORLD', 'NODE_OPTIONS', 'KOSMOS_AGENT_TOKEN_ONLY']) delete env[k];
    const ps1 = path.join(root, 'bin', 'kosmos.ps1');
    const out = await new Promise((resolve) => {
      const child = cp.spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "'a report' |", '&', ps1, 'feedback', 'write'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      const timer = setTimeout(() => child.kill(), 60000);
      child.on('exit', () => { clearTimeout(timer); try { child.stdin.destroy(); } catch { /* closed */ } resolve(text); });
    });
    assert.match(out, /Nothing was saved: text piped into kosmos in PowerShell does not reach it/, out);
  } finally { try { removeZip(root); } finally { removeTree(data); } }
});
