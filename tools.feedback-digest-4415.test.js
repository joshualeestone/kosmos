'use strict';
require('./test-support/tmpscope');
/**
 * kosmos#4415 slice 2b: tools/feedback-digest.js, the daily digest runner. Every report here is INVENTED
 * (install ids fake-*, text written for this test); no real report is in this file.
 *
 * Arms, each with a control that can return the dangerous answer:
 *  1. fixture reports -> the expected digest (crash first, installs counted, an open card flagged, the inbox link)
 *  2. nothing new -> ONE line, and the old reports are not repeated (control: without --mark-posted they ARE)
 *  3. the store token is never in any argv (a fake secrets-map.sh logs its own argv; a stubbed fetch records URLs
 *     and headers; the gh call is stubbed and recorded). Control: the token IS seen in the Authorization header.
 *  4. a 401, a 503, and a token that is not filed each give "COULD NOT READ THE REPORTS", exit 2, no watermark
 *     (control: a 200 run gives neither)
 *  5. --dry-run writes no state
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const digest = require('./tools/feedback-digest');

const FAKE_TOKEN = 'FAKE-store-token-4415-not-real';
const NOW = new Date('2026-09-30T13:00:00Z');   // 08:00 CDT
const iso = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

const REPORTS = [
  { install: 'fake-aaa', date: '2026-09-30', generated_at: iso(2), body: '- The board crashed and I lost all my agent notes after the update.\n- Nothing appears broken in the rooms.' },
  { install: 'fake-bbb', date: '2026-09-30', generated_at: iso(3), body: '- The board crashed and I lost all my agent notes after updating.' },
  { install: 'fake-ccc', date: '2026-09-30', generated_at: iso(4), body: '- The weekly limit counter never resets on Monday morning, it stays stuck at full.' },
  { install: 'fake-ddd', date: '2026-09-30', generated_at: iso(5), body: '- Pasting a long message in the room composer fails and the text vanishes halfway.\n- I love it, thank you.' },
  // Older than the first run's 24 hour window: must never appear.
  { install: 'fake-old', date: '2026-09-27', generated_at: iso(72), body: '- OLDREPORT the settings page fails to save the provider key every single time.' },
];
const CARDS = '#9001 Weekly limit counter never resets on Monday\n#9002 Something unrelated about installers\n';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd4415-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const argvLog = path.join(root, 'secrets-argv.log');
  // A fake secrets-map.sh: logs its argv, prints the fake token (or fails, when told the token is not filed).
  fs.writeFileSync(path.join(bin, 'secrets-map.sh'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + argvLog + '"\n[ -f "' + path.join(root, 'nofile') + '" ] && exit 1\nprintf "%s" "' + FAKE_TOKEN + '"\n', { mode: 0o755 });
  const cards = path.join(root, 'cards.txt');
  fs.writeFileSync(cards, CARDS);
  return { root, bin, argvLog, cards, state: path.join(root, 'state') };
}

/** A stubbed global fetch serving REPORTS as a blob store (or failing the listing with `listStatus`). */
function stubFetch(reports, calls, listStatus) {
  return async (url, init) => {
    calls.push({ url: String(url), headers: (init && init.headers) || {} });
    const u = new URL(url);
    const json = (status, obj) => ({ ok: status === 200, status, json: async () => obj, text: async () => JSON.stringify(obj), body: null });
    if (u.hostname === 'blob.vercel-storage.com') {
      if (listStatus && listStatus !== 200) return json(listStatus, { error: 'no' });
      return json(200, { blobs: reports.map((r, i) => ({ url: 'https://store1.private.blob.vercel-storage.com/feedback/' + i + '.json', pathname: 'feedback/' + i + '.json' })), hasMore: false });
    }
    const i = Number(u.pathname.split('/').pop().replace('.json', ''));
    return json(200, { ...reports[i], consent: true });
  };
}

async function runWith(sb, argv, { reports = REPORTS, listStatus, now = NOW } = {}) {
  const calls = [];
  const ghArgs = [];
  const saved = { fetch: globalThis.fetch, PATH: process.env.PATH, BLOB: process.env.AGENT_WORKFORCE_BLOB_API, HOME: process.env.HOME };
  globalThis.fetch = stubFetch(reports, calls, listStatus);
  process.env.PATH = sb.bin + ':' + process.env.PATH;
  // HOME too: feedbackpull falls back to ~/.local/bin/secrets-map.sh, and the REAL map must never be read here
  // (a first version of the not-filed arm read the operator's real token through that fallback).
  process.env.HOME = sb.root;
  delete process.env.AGENT_WORKFORCE_BLOB_API;
  try {
    const execFileImpl = (file, args, o, cb) => { ghArgs.push([file, ...args]); cb(null, CARDS, ''); };
    const r = await digest.main(argv.concat(['--state', sb.state]), { now: () => now, execFileImpl, tmpRoot: sb.root });
    return { ...r, calls, ghArgs };
  } finally {
    globalThis.fetch = saved.fetch;
    process.env.PATH = saved.PATH;
    process.env.HOME = saved.HOME;
    if (saved.BLOB !== undefined) process.env.AGENT_WORKFORCE_BLOB_API = saved.BLOB;
  }
}

test('fixture reports give the expected digest: crash first, installs counted, an open card flagged, the inbox', async () => {
  const sb = sandbox();
  const r = await runWith(sb, ['--dry-run', '--cards-file', sb.cards]);
  assert.strictEqual(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.match(lines[0], /^Kosmos feedback: 4 new reports since /);
  assert.strictEqual(lines[1], 'Crash or data loss:');
  assert.match(lines[2], /board crashed and I lost all my agent notes.*\(2 installs\)$/, 'the crash, raised by two installs, is first');
  assert.match(r.out, /To review \(1 of 1\):\n- `Pasting a long message.*vanishes halfway.*\(1 install\)/);
  assert.match(r.out, /Maybe already carded \(1\):\n- #9001 Weekly limit counter never resets on Monday \(1 install\)/);
  assert.match(lines[lines.length - 1], /^Inbox: https:\/\/installkosmos\.com\/admin \(Reports\)\. No card was opened\.$/);
  assert.ok(!/OLDREPORT/.test(r.out), 'a report older than the window was included');
  assert.ok(!/Nothing appears broken|thank you/.test(r.out), 'a clean line or praise reached the digest');
  assert.ok(!/fake-(aaa|bbb|ccc|ddd)/.test(r.out), 'an install id reached the digest');
  assert.ok(r.out.length <= 1900);
});

test('nothing new says so in one line, and a posted digest is never repeated (control: unposted, it is)', async () => {
  const sb = sandbox();
  const first = await runWith(sb, ['--cards-file', sb.cards]);
  assert.strictEqual(first.code, 0, first.err);
  assert.match(first.out, /4 new reports/);
  // CONTROL: without --mark-posted the next run covers the same window again, so the check below can see a repeat.
  const again = await runWith(sb, ['--dry-run', '--cards-file', sb.cards], { now: new Date(NOW.getTime() + 3600000) });
  assert.match(again.out, /4 new reports/, 'control: an unposted digest must be offered again');
  const mark = await digest.main(['--mark-posted', '--state', sb.state]);
  assert.strictEqual(mark.code, 0, mark.err);
  // One hour on: the reports are still inside a 24 hour window, so only the watermark keeps them out.
  const next = await runWith(sb, ['--dry-run', '--cards-file', sb.cards], { now: new Date(NOW.getTime() + 3600000) });
  assert.strictEqual(next.code, 0);
  assert.strictEqual(next.out.split('\n').length, 1, 'nothing new must be one line: ' + next.out);
  assert.match(next.out, /^Kosmos feedback: no new reports since .*\. Inbox: https:\/\/installkosmos\.com\/admin \(Reports\)\.$/);
  assert.ok(!/crashed|OLDREPORT/.test(next.out), 'an old report was repeated');
  // --mark-posted with nothing pending is an error, not a silent success.
  const twice = await digest.main(['--mark-posted', '--state', sb.state]);
  assert.strictEqual(twice.code, 1);
});

test('the store token is never in any argv, URL or output (control: it IS in the Authorization header)', async () => {
  const sb = sandbox();
  const r = await runWith(sb, ['--dry-run']);   // no --cards-file: the gh call goes through the stubbed execFile
  assert.strictEqual(r.code, 0, r.err);
  const secretsArgv = fs.readFileSync(sb.argvLog, 'utf8');
  assert.match(secretsArgv, /^value vercel-blob-feedback$/m, 'control: the fake secrets map was asked for the store token');
  assert.ok(!secretsArgv.includes(FAKE_TOKEN));
  assert.ok(!/kosmos-admin-dashboard/.test(secretsArgv), 'least access: the admin token must not be read');
  assert.ok(r.ghArgs.length === 1 && r.ghArgs[0][0] === 'gh', 'control: the card list went through the stub');
  for (const a of r.ghArgs) assert.ok(!a.join(' ').includes(FAKE_TOKEN), 'the token reached gh argv');
  assert.ok(r.calls.length >= 2);
  for (const c of r.calls) assert.ok(!c.url.includes(FAKE_TOKEN), 'the token reached a URL');
  assert.ok(r.calls.every((c) => c.headers.authorization === 'Bearer ' + FAKE_TOKEN), 'control: the token must travel in the header');
  assert.ok(!r.out.includes(FAKE_TOKEN) && !r.err.includes(FAKE_TOKEN), 'the token reached the output');
});

for (const [name, setup] of [
  ['a 401 from the store', { listStatus: 401 }],
  ['a 503 from the store', { listStatus: 503 }],
  ['a token that is not filed', { nofile: true }],
]) {
  test('could not read the reports, never a quiet digest: ' + name, async () => {
    const sb = sandbox();
    if (setup.nofile) fs.writeFileSync(path.join(sb.root, 'nofile'), '');
    const r = await runWith(sb, ['--cards-file', sb.cards], { listStatus: setup.listStatus });
    assert.strictEqual(r.code, 2);
    assert.match(r.out, /^Kosmos feedback: COULD NOT READ THE REPORTS \(.+\)\. This is not a quiet day;/);
    assert.ok(!/no new reports/.test(r.out), 'a failed read read as a quiet day');
    assert.match(r.err, /could not read the reports/);
    if (setup.listStatus) assert.ok(r.err.includes(String(setup.listStatus)), 'the status is named');
    assert.ok(!fs.existsSync(path.join(sb.state, 'pending')), 'a failed read must not offer a watermark');
    assert.ok(!r.out.includes(FAKE_TOKEN) && !r.err.includes(FAKE_TOKEN));
  });
}

test('control for the failure arm: a 200 with nothing new is quiet, not a failure', async () => {
  const sb = sandbox();
  const r = await runWith(sb, ['--cards-file', sb.cards], { reports: [REPORTS[4]] });
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^Kosmos feedback: no new reports since /);
  assert.ok(!/COULD NOT READ/.test(r.out));
});

test('--dry-run writes no state, and the temp dir of pulled reports is removed', async () => {
  const sb = sandbox();
  const r = await runWith(sb, ['--dry-run', '--cards-file', sb.cards]);
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(sb.state), 'a dry run created state');
  assert.deepStrictEqual(fs.readdirSync(sb.root).filter((n) => n.startsWith('kfd-')), [], 'the pulled reports were left on disk');
  // CONTROL: a real run does write the digest, mode 600, in a mode 700 folder.
  await runWith(sb, ['--cards-file', sb.cards]);
  assert.strictEqual(fs.statSync(path.join(sb.state, 'digest.txt')).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(sb.state).mode & 0o777, 0o700);
});

test('an unknown argument is a usage error on stderr', async () => {
  const r = await digest.main(['--bogus']);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /unknown argument/);
});
