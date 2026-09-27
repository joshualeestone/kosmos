'use strict';
/**
 * #3568: a stand-in for Google's agy (Antigravity CLI) on Windows, run as `node fake-agy.js <agy args>`.
 * Its shapes are agy 1.2.11's, measured on a Windows 11 box (2026-09-26); see engine/win32agy.js and
 * engine/win32agysignin.js. FAKE_AGY_MODE picks the behaviour:
 *   turn     print mode, signed in: one JSON line {conversation_id,status:"SUCCESS",response,...}.
 *            It records what it was started with (argv, cwd, PATH's first entry, TEMP, whether stdin
 *            is closed) in FAKE_AGY_RECORD, and answers FAKE_AGY_REPLY (default "ok").
 *   slow     like turn, but sleeps FAKE_AGY_SLEEP_MS first (a turn that runs too long).
 *   lost     a --conversation it does not know: exit 1, "conversation not found".
 *   signin   print mode, signed out: prints Google's link and the paste prompt on stderr, reads one
 *            line on stdin (the tests' typer writes there; real agy reads its console), then: a code starting "good"
 *            answers and exits 0, anything else is Google's invalid_grant and exit 1. No line within
 *            FAKE_AGY_WAIT_MS is agy's own timeout.
 *   badlink  like signin, but the link is not Google's.
 */
const fs = require('node:fs');

const mode = process.env.FAKE_AGY_MODE || 'turn';
const args = process.argv.slice(2);
const conv = (() => { const i = args.indexOf('--conversation'); return i >= 0 ? args[i + 1] : null; })();

function record(probeStdin) {
  const file = process.env.FAKE_AGY_RECORD;
  if (!file) return;
  let stdinClosed = null;   // probed only where stdin is meant to be closed: a live pipe would block the read on a Mac
  if (probeStdin) try { stdinClosed = fs.readSync(0, Buffer.alloc(1), 0, 1, null) === 0; } catch (e) { stdinClosed = e.code === 'EOF' || e.code === 'EBADF' || e.code === 'EINVAL' ? true : String(e.code); }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
  const line = JSON.stringify(Object.assign({ args, cwd: process.cwd(), pathFirst: String(process.env[pathKey] || '').split(';')[0],
    temp: process.env.TEMP || null, perTurn: process.env.KOSMOS_PER_TURN || null, claudeConfig: process.env.CLAUDE_CONFIG_DIR || null, stdinClosed }));   // agyEnv joins PATH with ';' (Windows), whatever the host
  fs.appendFileSync(file, line + '\n');
}
const result = (response) => JSON.stringify({ conversation_id: conv || 'conv-' + process.pid, status: 'SUCCESS', response,
  duration_seconds: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 } });
const LINK = 'https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=1071006060591-x.apps.googleusercontent.com'
  + '&code_challenge=abcDEF123&code_challenge_method=S256&prompt=consent&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback'
  + '&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform+openid&state=xyz789';

if (mode === 'turn' || mode === 'slow') {
  record(true);
  const go = () => { process.stdout.write(result(process.env.FAKE_AGY_REPLY || 'ok') + '\n'); process.exit(0); };
  if (mode === 'slow') setTimeout(go, Number(process.env.FAKE_AGY_SLEEP_MS || 60000)); else go();
} else if (mode === 'lost') {
  record(true);
  process.stderr.write('Error: failed to start conversation: conversation ' + conv + ' not found\n');
  process.stdout.write(JSON.stringify({ conversation_id: '', status: 'ERROR', response: '', error: 'conversation ' + conv + ' not found' }) + '\n');
  process.exit(1);
} else if (mode === 'signin' || mode === 'badlink') {
  record();
  const link = mode === 'badlink' ? LINK.replace('accounts.google.com', 'accounts.example.com') : LINK;
  process.stderr.write('Authentication required. Please visit the URL to log in:\n  ' + link + '\n\nWaiting for authentication (timeout 60s)...\nOr, paste the authorization code here and press Enter:\n');
  let buf = '';
  const timer = setTimeout(() => {
    process.stderr.write('Error: authentication timed out.\nerror: authentication failed or timed out\n');
    process.stdout.write(JSON.stringify({ conversation_id: '', status: 'ERROR', response: '', error: 'authentication failed or timed out' }) + '\n');
    process.exit(1);
  }, Number(process.env.FAKE_AGY_WAIT_MS || 60000));
  process.stdin.on('data', (d) => {
    buf += String(d);
    if (!/\n/.test(buf)) return;
    clearTimeout(timer);
    const code = buf.split(/\r?\n/)[0].trim();
    if (process.env.FAKE_AGY_RECORD) fs.appendFileSync(process.env.FAKE_AGY_RECORD, JSON.stringify({ code }) + '\n');
    if (/^good/.test(code)) { process.stdout.write(result('ok') + '\n'); process.exit(0); }
    process.stderr.write('Error: authentication failed: token exchange failed: oauth2: "invalid_grant" "Malformed auth code."\nerror: authentication failed or timed out\n');
    process.stdout.write(JSON.stringify({ conversation_id: '', status: 'ERROR', response: '', error: 'authentication failed or timed out' }) + '\n');
    process.exit(1);
  });
}
