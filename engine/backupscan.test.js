/**
 * kosmos#5535 (E0.6) slice 3, first pure part: engine/backupscan.js. "Never credentials" (design v2.1) as a SET
 * of cases, each with a control, as the design's test (c) asks: base64, line-split, inside a binary, in an
 * archive, in a git remote URL, behind a symlink, plus the deny-list and the fail-closed paths.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const bs = require('./backupscan');

const KEY = 'sk-ant-api03-' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0';
const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACDDummyDummyDummyDummyDummyDummyDummyDummyAAAA\n-----END OPENSSH PRIVATE KEY-----';

test('#5535 deny-list: credential-shaped paths are skipped by name; ordinary work files are not', () => {
  for (const p of ['.env', 'agents/a/.env.local', 'keys/server.pem', 'x/id_ed25519', 'x/id_rsa.pub', 'home/.ssh/config',
    '.npmrc', 'proj/.git/config', '.config/gh/hosts.yml', 'agents/b/.claude/.credentials.json', '.codex/auth.json',
    'agents/c/credentials.json', 'secrets/github', 'out/report.zip', 'out/data.tar.gz', 'store.kdbx']) {
    assert.equal(bs.pathDecision(p).include, false, `${p} must be skipped`);
  }
  for (const p of ['agents/a/notes.md', 'projects/site/index.html', 'agents/a/transcript.jsonl', 'docs/credentials-howto.md',
    'agents/a/environment.md', 'work/token-budget.csv']) {
    assert.equal(bs.pathDecision(p).include, true, `CONTROL: ${p} is ordinary work and is kept`);
  }
  assert.equal(bs.pathDecision('../escape.md').include, false, 'a path climbing out');
  assert.equal(bs.pathDecision('/etc/passwd').include, false, 'an absolute path');
  assert.equal(bs.pathDecision(['agents', 'a', '.env'].join(path.sep)).include, false, 'OS separators are normalized');
});

test('#5535 insideWorkKosmos: a symlink that resolves outside the work Kosmos is refused', () => {
  assert.equal(bs.insideWorkKosmos('/u/k/agents/a/notes.md', '/u/k'), true, 'CONTROL: a file inside');
  assert.equal(bs.insideWorkKosmos('/u/k', '/u/k'), true, 'CONTROL: the root itself');
  assert.equal(bs.insideWorkKosmos('/u/.ssh/id_ed25519', '/u/k'), false, 'a link to ~/.ssh');
  assert.equal(bs.insideWorkKosmos('/u/kosmos-other/x', '/u/k'), false, 'a sibling whose name starts the same');
  assert.equal(bs.insideWorkKosmos('/u/k/../.ssh/x', '/u/k'), false, 'an unresolved .. that leaves');
  assert.equal(bs.insideWorkKosmos('relative/x', '/u/k'), false, 'a relative path');
});

test('#5535 redact in place: a pasted key is removed and everything around it is kept', () => {
  const text = `line one\nthe key is ${KEY} ok\nline three\n`;
  const r = bs.scanFile('agents/a/transcript.md', Buffer.from(text));
  assert.equal(r.action, 'store');
  const out = r.data.toString();
  assert.ok(!out.includes(KEY), 'the key is gone');
  assert.ok(out.includes('line one') && out.includes('line three') && out.includes('the key is'), 'the rest is kept');
  assert.deepEqual(r.redacted, [{ kind: 'anthropic_key', count: 1 }]);
  const clean = bs.scanFile('agents/a/notes.md', Buffer.from('nothing secret here\n'));
  assert.deepEqual(clean, { action: 'store', data: Buffer.from('nothing secret here\n'), redacted: [] }, 'CONTROL: clean text is stored byte for byte');
});

test('#5535 a PEM private key is cut whole even though it spans lines; an unterminated one skips the file', () => {
  const r = bs.scanFile('agents/a/notes.md', Buffer.from(`before\n${PEM}\nafter\n`));
  assert.equal(r.action, 'store');
  const out = r.data.toString();
  assert.ok(!out.includes('b3BlbnNzaC1rZXktdjEAAAAABG5vbmU') && !out.includes('DummyDummy'), 'no line of the key body survives');
  assert.ok(out.includes('before') && out.includes('after'));
  assert.ok(r.redacted.some((x) => x.kind === 'private_key'));
  const open = bs.scanFile('agents/a/notes.md', Buffer.from(`x\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow${'A'.repeat(50)}\n`));
  assert.equal(open.action, 'skip', 'a key with no END line cannot be bounded, so the file is skipped');
});

test('#5535 when the whole-text search gives up, the text is masked line by line; a line that still gives up skips the file', () => {
  /* secretmask withholds a whole text when its search for the board's KNOWN secrets runs out of budget. That needs
     held values (the walker feeds the board's own secrets) and text that keeps many of them half-matched: the same
     shape secretmask.test.js uses to prove its budget. Without held values nothing withholds even at 2 MB
     (measured), so a plain long filler would never reach the fallback. */
  const sm = require('./secretmask');
  const held = Array.from({ length: 2000 }, (_, i) => `hq7x-vzlq-${String(i).padStart(8, '0')}-k9z`);
  const rows = Array.from({ length: 1000 }, (_, i) => `| hq7x-vzlq- | 0000 | ${i % 10} | 00 | -k9z |`).join('\n');
  sm.setKnownSecrets(held);
  try {
    const text = `${rows}\nkey ${GH}\n`;
    const whole = sm.mask(text).text;
    assert.ok(whole === sm.WITHHELD || whole === sm.UNCHECKED, 'PRECONDITION: the whole text must be withheld, or this test proves nothing');
    const r = bs.scanFile('agents/a/transcript.md', Buffer.from(text));
    assert.equal(r.action, 'store', 'stored through the line-by-line pass, not skipped');
    assert.ok(!r.data.toString().includes(GH), 'the token is masked on its own line');
    assert.ok(r.data.toString().includes('| 0000 | 9 | 00 |'), 'the rows are kept');
    const oneLine = rows.split('\n').join(' ');
    assert.equal(bs.scanFile('agents/a/one.md', Buffer.from(oneLine)).action, 'skip', 'a single line that still cannot be checked skips the file');
  } finally { sm.setKnownSecrets([]); }
});

test('#5535 binary files: stored as-is when nothing is found; skipped when they hold anything key-shaped', () => {
  const bin = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200, 7)]);
  const ok = bs.scanFile('agents/a/data.sqlite', bin);
  assert.equal(ok.action, 'store', 'CONTROL: a clean binary is stored');
  assert.ok(ok.data.equals(bin), 'unchanged');
  const leaky = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from(`row:${GH};`), Buffer.alloc(50)]);
  assert.equal(bs.scanFile('agents/a/data.sqlite', leaky).action, 'skip', 'a token inside a sqlite file');
  const pemBin = Buffer.concat([Buffer.alloc(10), Buffer.from(PEM)]);
  assert.equal(bs.scanFile('agents/a/blob.bin', pemBin).action, 'skip', 'a PEM key inside a binary');
  const notUtf8 = Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x20, ...Buffer.from(KEY)]);
  assert.equal(bs.scanFile('agents/a/odd.txt', notUtf8).action, 'skip', 'bytes that are not UTF-8 are treated as binary');
});

test('#5535 the design\'s case set: base64, line-split, git remote URL, archive (each decided, each with a control)', () => {
  // base64 of a key: secretmask matches known VALUES in any encoding only once setKnownSecrets is fed (the walker
  // feeds the board's own secrets); an unknown base64 blob is not a recognizable key, and is kept. Stated, not hidden.
  const b64 = Buffer.from(KEY).toString('base64');
  assert.equal(bs.scanFile('agents/a/notes.md', Buffer.from(`blob ${b64}\n`)).action, 'store');
  // A key split across two lines is not a key to any detector; documented as a known limit of shape matching.
  const split = `${KEY.slice(0, 12)}\n${KEY.slice(12)}\n`;
  assert.equal(bs.scanFile('agents/a/notes.md', Buffer.from(split)).action, 'store');
  // A token in a git remote URL: the config file is deny-listed whole.
  assert.deepEqual(bs.scanFile('proj/.git/config', Buffer.from(`[remote "origin"]\n url = https://x:${GH}@github.com/o/r\n`)).action, 'skip');
  // The same URL in an ordinary file: the token itself is masked.
  const url = bs.scanFile('agents/a/notes.md', Buffer.from(`clone https://x:${GH}@github.com/o/r\n`));
  assert.ok(url.action === 'store' && !url.data.toString().includes(GH), 'a token in a URL inside a note is masked');
  assert.equal(bs.scanFile('out/bundle.zip', Buffer.from('PK\u0003\u0004')).action, 'skip', 'a compressed archive is skipped by name');
});

test('#5535 scanFile never throws and fails closed on junk input', () => {
  for (const [rel, buf] of [[null, Buffer.from('x')], ['a.md', 'not a buffer'], ['a\0b.md', Buffer.from('x')], ['', Buffer.from('x')]]) {
    let r; assert.doesNotThrow(() => { r = bs.scanFile(rel, buf); });
    assert.equal(r.action, 'skip', `${JSON.stringify(rel)} skipped`);
  }
});
