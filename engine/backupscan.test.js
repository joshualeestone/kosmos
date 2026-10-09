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

test('#5686 deny-list: Kosmos credential stores in the data root are skipped by name, under a world prefix too', () => {
  for (const p of ['Kosmos/sendertokens/a.json', 'Kosmos/sendertokens/a.json.tmp-60291', 'worlds/w1/Kosmos/sendertokens/b.json',
    'sendertokens/a.json', 'Kosmos/launch-secrets/agent-secrets.Ab12Cd', 'worlds/w1/launch-secrets/agent-secrets.Ab12Cd',
    'Kosmos/communitysend/234a7f2dbb0a/keys.json', 'worlds/w1/Kosmos/communitysend/234a7f2dbb0a/keys.json',
    'Kosmos/communitysend/234a7f2dbb0a/keys.json.0a1b2c3d4e5f.tmp', 'Kosmos/fed-seal-key.json', 'Kosmos/fed-seal-rooms.json',
    'worlds/w1/Kosmos/fed-seal-key.json', 'Kosmos/fed-seal-rooms.json.4711.0a1b2c3d4e5f.tmp', 'Kosmos/remote/mac_key',
    'worlds/w1/Kosmos/remote/mac_key', 'remote/mac_key', 'Kosmos/remote/phone-notify.json', 'Kosmos/remote/phone-notify.json.a1b2.tmp',
    'acct/.kosmos-claude-apikey', 'acct/.kosmos-gemini-apikey', 'workers/a/.cfg/.kosmos-grok-apikey']) {
    assert.equal(bs.pathDecision(p).include, false, `${p} must be skipped`);
  }
  for (const p of ['Kosmos/communitysend/234a7f2dbb0a/sent.json', 'Kosmos/chats/direct..mikey.json', 'Kosmos/messages.jsonl',
    'Kosmos/task-chats/a.task-7.jsonl', 'Kosmos/agent-token-only.json', 'projects/site/keys.json', 'notes/launch-secrets.md',
    'Kosmos/fed-seal-notes.md', 'projects/site/keys.jsonc.md',
    'Kosmos/remote/mac_id', 'Kosmos/remote/pending.json', 'Kosmos/remote/tls.crt', 'projects/site/remote/notes.md', 'docs/kosmos-apikey-howto.md']) {
    assert.equal(bs.pathDecision(p).include, true, `CONTROL: ${p} is a conversation or ordinary work and is kept`);
  }
});

test('#5686 review 3: a writer\'s temp copy of a denied file is denied with it, whatever shape the writer names it', () => {
  for (const p of ['Kosmos/remote/install_key', 'worlds/w1/Kosmos/remote/install_key', 'Kosmos/remote/.mac_key.tmp',
    'Kosmos/remote/.install_key.tmp', 'Kosmos/remote/.tls.key.tmp', 'Kosmos/remote/.signin-device.key.tmp',
    'Kosmos/remote/signin-device.key.new-4711-0a1b2c', 'Kosmos/.board.token.4711.primary.tmp',
    'Kosmos/board.token.kosmos-1-t0-2-3.tmp', 'acct/auth.json.kosmos-1-t0-2-3.tmp', 'Kosmos/win32-channel/a.key.tmp',
    'agents/a/.env.kosmos-9-t1-2-3.tmp', 'Kosmos/fed-seal-key.json.4711.0a1b2c3d4e5f.tmp', 'worlds/w1/Kosmos/remote/.mac_key.tmp',
    'Kosmos/remote/mac_key-123.tmp', 'x/id_rsa-new.tmp', 'Kosmos/remote/mac_key~', 'Kosmos/remote/.mac_key.swp',
    'keys/server.key.bak', 'keys/server.key_old.tmp', 'w/' + 'a.'.repeat(200) + 'tmp',
    // review 5: copy shapes of Kosmos stores (matched anywhere in the name) and of other credentials (COPY_SHAPED)
    'Kosmos/board.token.tmp-123', 'Kosmos/remote/.mac_key.tmp-9', 'Kosmos/remote/signin-device.key.tmp-9',
    'Kosmos/remote/tls.key.4711.new', 'Kosmos/remote/mac_key copy', 'Kosmos/remote/..mac_key.tmp', 'Kosmos/remote/#mac_key#',
    'Kosmos/.#board.token', 'Kosmos/#board.token#', 'Kosmos/#fed-seal-key.json#', 'Kosmos/communitysend/ab/#keys.json#', 'acct/#.kosmos-grok-apikey#', 'Kosmos/communitysend/ab/.keys.json.tmp-7', 'Kosmos/fed-seal-rooms.json.save',
    'acct/.kosmos-claude-apikey.1', 'x/id_rsa (1)', 'x/id_rsa.backup', 'x/id_rsa.save', 'x/id_rsa.part', 'x/id_rsa.temp',
    'x/id_rsa.prev', 'keys/tls.key.1', 'x/.env.tmp.4711', 'x/id_rsa.tmp-k3j9z', 'x/id_rsa.tmp1', 'x/id_rsa 2', 'x/id_rsa.bak2',
    // review 6: a Kosmos store is never lifted by the template exemption
    'Kosmos/remote/mac_key.example', 'Kosmos/board.token.sample', 'Kosmos/fed-seal-key.json.template',
    // the documented over-skip: a copy is judged by its leading runs, so this is skipped though server.key.md is kept
    'x/server.key.md.bak',
    // review 7: a copied, renamed or moved store folder, and the store files outside their usual folder
    'Kosmos/remote copy/mac_key', 'Kosmos/remote.bak/mac_key', 'Kosmos/remote 2/install_key', 'Kosmos/sendertokens copy/a.json',
    'Kosmos/sendertokens.bak/a.json', 'Kosmos/launch-secrets.old/agent-secrets.Ab12Cd', 'Kosmos/communitysend copy/ab/keys.json',
    'Kosmos/communitysend/keys.json', 'Kosmos/communitysend/ab/old/keys.json', 'Kosmos/mac_key', 'Kosmos/phone-notify.json',
    'Kosmos/remote copy/signin-device.key', 'acct/.claude-work/.credentials.json',
    // review 8: a store folder copied with its name in front, a keys backup named before .json, other account dirs,
    // and the documented over-skip of a project's own communitysend/keys.json
    'old sendertokens/a.json', 'x/.sendertokens/a.json', 'Kosmos/communitysend/ep/keys.bak.json',
    'a/.gemini-work/oauth_creds.json', 'a/.codex-2/auth.json', 'projects/x/communitysend/keys.json',
    // review 9: a staging tail whose random hex is letters only; undo's copies under a hash or a hash prefix
    'Kosmos/remote/signin-device.key.new-4711-abcdef', 'x/tls.key.new-12-fe', 'Kosmos/undo/blobs/' + 'a1'.repeat(32),
    'Kosmos/undo-saved/20261009T1200/0123456789abcdef-id_rsa', 'Kosmos/undo-saved/s/0123456789abcdef-.npmrc',
    'worlds/w1/Kosmos/undo/blobs/' + 'b2'.repeat(32), 'Kosmos/undo copy/blobs/' + 'c3'.repeat(32), 'Kosmos/undo.old/blobs/x',
    'agents/a/.kosmos-undo-0a1b2c3d',
    // review 11: Kosmos's other key files are judged before the template exemption too
    'Kosmos/remote/signin-device.key.example', 'Kosmos/remote/tls.key.sample', 'Kosmos/win32-channel/a.key.dist',
    // review 12: digits glued onto a store name
    'x/mac_key2', 'x/board.token2', 'x/phone-notify2.json', 'x/fed-seal-key2.json', 'x/.kosmos-gemini-apikey2', 'x/sendertokens2/a',
    'x/communitysend/keys2.json', 'x/undo2/blobs/a']) {
    assert.equal(bs.pathDecision(p).include, false, `${p} must be skipped`);
  }
  for (const p of ['agents/a/notes.md.tmp', 'projects/site/draft.tmp', 'agents/a/secrets-plan.md', 'Kosmos/remote/.mac_id.tmp',
    'Kosmos/remote/.pending.json.tmp', 'Kosmos/.chats.tmp', 'projects/site/build.new-version.md', 'agents/a/keys.md.tmp',
    'agents/a/.tmp', 'agents/a/a..b.tmp', 'agents/a/secrets.md', 'agents/a/server.key.md', 'agents/a/id_rsa.md',
    'agents/a/notes~', 'agents/a/report-final.bak', 'w/' + 'a'.repeat(250) + '.md',
    'notes/secrets.new-approach.md', 'notes/plan.v1.2.md', 'agents/a/.env.example', 'notes/secrets.tmp-abcxyz.md',
    'notes/keyboard.tokens.csv', 'notes/billboard.token-ideas.md', 'projects/site/remote/api.keys.md',
    'projects/site/remote/talk.keynote', 'projects/site/remote/imac_keyboard.md', 'projects/site/communitysend-notes.md',
    'projects/site/undo/notes.md', 'notes/undo-saved-ideas.md', 'projects/site/undo/blobs.md', 'notes/mac_keyboard2.md', 'projects/site/remote/notes.md.bak', 'w/' + '\u{1F600}'.repeat(130) + '.tmp']) {
    assert.equal(bs.pathDecision(p).include, true, `CONTROL: ${p} is a temp of ordinary work, or not a temp, and is kept`);
  }
});

test('#5686 review 7: a hostile copy-shaped name cannot backtrack exponentially (the old tail took 1.6 s at 32 characters)', () => {
  const t0 = process.hrtime.bigint();
  for (const end of ['.tmp', '.bak', '.new']) bs.pathDecision('w/a' + end + '1'.repeat(28) + '!');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `took ${ms} ms (exponential backtracking takes seconds here; the fixed pattern takes well under 1 ms)`);
  const t1 = process.hrtime.bigint();
  bs.pathDecision('communitysend/'.repeat(15000) + 'x');   // 210 KB: a quadratic community pattern took 7 s here
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(ms1 < 1000, `a path repeating communitysend/ took ${ms1} ms`);
  const t2 = process.hrtime.bigint();
  for (const seg of ['mac_key-', 'board.token-', '-kosmos-a-apikey', 'sendertokens-']) {
    assert.equal(bs.pathDecision('w/' + seg.repeat(32000) + '/x').include, false, 'a segment longer than any name is refused');
  }
  const ms2 = Number(process.hrtime.bigint() - t2) / 1e6;
  assert.ok(ms2 < 1000, `long single segments took ${ms2} ms (uncapped token patterns took 2 to 17 s each)`);
  assert.equal(bs.pathDecision('w/' + 'a'.repeat(1017) + '.md').include, true, 'CONTROL: a 1020-character name, at the loose cap, is judged, not refused');
  assert.equal(bs.pathDecision('w/' + 'a'.repeat(1018) + '.md').include, false, 'one character over is refused');
});

test('#5686 review 4: a copy-shaped name too long for a filesystem is skipped, not widened (uncapped, 100000 dots exhausts the heap)', () => {
  for (const n of [1000, 100000]) assert.equal(bs.pathDecision('w/' + '.'.repeat(n) + 'tmp').include, false);
  assert.equal(bs.pathDecision('w/' + 'a-'.repeat(120) + '.tmp').include, true, 'CONTROL: a 244-character temp of ordinary work is kept');
});

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

test('#5535 when secretmask cannot finish checking a text, the file is skipped (no partial fallback)', () => {
  /* secretmask withholds a whole text when its search for the board's KNOWN secrets runs out of budget: held values
     plus rows that keep many of them half-matched (the shape secretmask.test.js uses). Without held values nothing
     withholds even at 2 MB (measured). */
  const sm = require('./secretmask');
  const held = Array.from({ length: 2000 }, (_, i) => `hq7x-vzlq-${String(i).padStart(8, '0')}-k9z`);
  const rows = Array.from({ length: 1000 }, (_, i) => `| hq7x-vzlq- | 0000 | ${i % 10} | 00 | -k9z |`).join('\n');
  sm.setKnownSecrets(held);
  try {
    const text = `${rows}\nkey ${GH}\n`;
    const whole = sm.mask(text).text;
    assert.ok(whole === sm.WITHHELD || whole === sm.UNCHECKED, 'PRECONDITION: the whole text is withheld, or this proves nothing');
    const r = bs.scanFile('agents/a/transcript.md', Buffer.from(text));
    assert.deepEqual(r, { action: 'skip', why: 'text that could not be fully checked' }, 'skipped by name, never stored unchecked');
  } finally { sm.setKnownSecrets([]); }
  const plain = Array.from({ length: 20000 }, (_, i) => `plain prose line ${i} about the work`).join('\n') + `\nkey ${GH}\n`;
  const r2 = bs.scanFile('agents/a/long.md', Buffer.from(plain));
  assert.ok(r2.action === 'store' && !r2.data.toString().includes(GH), 'CONTROL: a long ordinary transcript (with no held secrets) is checked whole and stored masked');
});

test('#5535 a held value split across lines is caught by secretmask\'s whole-text pass (the reason there is no line-by-line fallback)', () => {
  const sm = require('./secretmask');
  const secret = 'Zq8Lp3Vw7Kx2Rn5Tj9Hm';
  sm.setKnownSecrets([secret]);
  try {
    for (const half of [secret.slice(0, 10), secret.slice(10)]) assert.ok(!sm.mask(half).fired.length, `PRECONDITION: the half ${half} alone does not fire`);
    const r = bs.scanFile('agents/a/notes.md', Buffer.from(`pw:\n${secret.slice(0, 10)}\n${secret.slice(10)}\ndone\n`));
    assert.equal(r.action, 'store');
    const out = r.data.toString();
    assert.ok(!out.includes(secret.slice(0, 10)) && !out.includes(secret.slice(10)), 'neither half survives');
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
  const nu = bs.scanFile('agents/a/odd.txt', notUtf8);  // invalid UTF-8 with no NUL: read as Latin-1 and redacted
  assert.ok(nu.action === 'skip' || !nu.data.toString('latin1').includes(KEY), 'bytes that are not UTF-8 never keep the key');
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

test('#5535 UTF-16 text is decoded and scanned as text (a key in it would pass a byte scan), and written back in its own encoding', () => {
  const text = `note\r\nkey ${KEY}\r\nend line\r\n`;
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const leNoBom = Buffer.from(text, 'utf16le');
  const be = Buffer.from(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])); be.swap16();
  for (const [what, buf, decode] of [['UTF-16LE with BOM', le, (b) => b.subarray(2).toString('utf16le')],
    ['UTF-16LE without BOM', leNoBom, (b) => b.toString('utf16le')],
    ['UTF-16BE with BOM', be, (b) => { const c = Buffer.from(b); c.swap16(); return c.subarray(2).toString('utf16le'); }]]) {
    const r = bs.scanFile('agents/a/out.txt', buf);
    assert.equal(r.action, 'store', what);
    assert.ok(r.redacted.length >= 1, `${what}: something was recorded as removed`);
    const back = decode(r.data);
    assert.ok(!back.includes(KEY) && back.includes('note') && back.includes('line'), `${what}: key gone, text kept, same encoding`);
    assert.equal(r.data[0], buf[0], `${what}: the BOM (or first byte) is kept`);
  }
  const clean = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('nothing here\r\n', 'utf16le')]);
  assert.ok(bs.scanFile('agents/a/clean.txt', clean).data.equals(clean), 'CONTROL: clean UTF-16 is stored byte for byte');
});

test('#5535 compressed content is skipped by its magic, whatever it is called (a scan cannot read deflated bytes)', () => {
  const zlib = require('zlib');
  const secret = Buffer.from(`API=${KEY}\n`);
  for (const [what, buf] of [['a git loose object (zlib)', zlib.deflateSync(secret)], ['gzip', zlib.gzipSync(secret)],
    ['a zip container named .txt', Buffer.concat([Buffer.from('PK\u0003\u0004'), secret])], ['bzip2', Buffer.from('BZh91AY&SY')],
    ['a git pack', Buffer.concat([Buffer.from('PACK'), Buffer.from('00000002', 'hex'), Buffer.alloc(4)])], ['a PDF with Flate streams', Buffer.from('%PDF-1.7\n1 0 obj << /Filter /FlateDecode >>')]]) {
    assert.equal(bs.scanFile('agents/a/blob.txt', buf).action, 'skip', what);
  }
  assert.equal(bs.scanFile('agents/a/plain.pdf', Buffer.from('%PDF-1.4\n(uncompressed text)')).action, 'store', 'CONTROL: a PDF with no deflated streams is scanned and kept');
});

test('#5535 deny-list round 1: the gaps are closed and ordinary code is kept', () => {
  for (const p of ['.envrc', 'deploy/prod.env', 'credentials.tfrc.json', 'infra/terraform.tfstate', 'infra/terraform.tfstate.backup',
    'client_secret_123.apps.json', 'proj/.git/modules/sub/config', 'proj/.git/objects/ab/cdef', '.yarnrc.yml', 'kubeconfig',
    '.vault-token', '.boto', '.s3cfg', '.config/rclone/rclone.conf', '.m2/settings.xml', 'pip.conf', 'AuthKey_ABC.p8',
    'Chrome/Default/Cookies', 'Chrome/Default/Login Data', 'reports/q3.docx', 'model.whl', 'secrets.yaml', 'auth.json']) {
    assert.equal(bs.pathDecision(p).include, false, `${p} must be skipped`);
  }
  for (const p of ['src/auth.ts', 'pkg/auth.go', 'src/tokens.ts', 'styles/tokens.css', 'docs/secrets-handling.md', '..notes.md', 'a/..b.md']) {
    assert.equal(bs.pathDecision(p).include, true, `CONTROL: ${p} is ordinary work and is kept`);
  }
});

test('#5535 PGP armored private keys are cut whole too', () => {
  const pgp = '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBF4xyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef\nqrstuvwxyz0123456789ABCDEFGH\n=AbCd\n-----END PGP PRIVATE KEY BLOCK-----';
  const r = bs.scanFile('agents/a/notes.md', Buffer.from(`before\n${pgp}\nafter\n`));
  assert.equal(r.action, 'store');
  const out = r.data.toString();
  assert.ok(!out.includes('lQOYBF4xyz') && !out.includes('qrstuvwxyz0123') && !out.includes('=AbCd'), 'no line of the PGP key survives');
  assert.ok(out.includes('before') && out.includes('after'));
  assert.equal(bs.scanFile('agents/a/k.txt', Buffer.from('PuTTY-User-Key-File-3: ssh-ed25519\nPrivate-Lines: 1\nAAAA\n')).action, 'skip', 'a PuTTY key in a text file');
});

test('#5535 known, documented loss: a redacted file loses invisible format characters; a clean file keeps every byte', () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = 'family \u{1F468}‍\u{1F469}‍\u{1F467} and soft­hyphen\n';
  const clean = Buffer.concat([bom, Buffer.from(body)]);
  assert.ok(bs.scanFile('agents/a/clean.md', clean).data.equals(clean), 'CONTROL: nothing fires, so the BOM, joiners and soft hyphen all stay');
  const dirty = Buffer.concat([bom, Buffer.from(body + `key ${KEY}\n`)]);
  const r = bs.scanFile('agents/a/dirty.md', dirty);
  assert.equal(r.action, 'store');
  assert.ok(!r.data.toString().includes(KEY), 'the key is gone');
  // The documented loss: pin it, so a change in secretmask's rewriting shows up here instead of silently.
  assert.ok(!r.data.subarray(0, 3).equals(bom) || !r.data.toString().includes('‍') || !r.data.toString().includes('­'),
    'the stated loss no longer happens: update the header comment and this test');
});

test('#5535 binary scan: a NUL-split key never stored readable; a clean binary is stored', () => {
  const nulSplit = Buffer.concat([Buffer.from('xx\0'), Buffer.from(KEY.split('').join('\0'))]);  // every character NUL-separated
  const ns = bs.scanFile('agents/a/b.bin', nulSplit);  // every character NUL-separated: read as UTF-16 and masked, or skipped
  assert.ok(ns.action === 'skip' || !ns.data.toString('latin1').replace(/\0/g, '').includes(KEY), 'a NUL-separated key is never stored readable');
  const clean = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from('ordinary bytes')]);
  assert.equal(bs.scanFile('agents/a/c.bin', clean).action, 'store', 'CONTROL: a clean binary is stored');
});

test('#5535 the final raw check: views a decode gets wrong never let a key through', () => {
  const ascii = Buffer.from(`note\nkey ${KEY}\n`);
  const utf32le = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), ...[...`key ${KEY}\n`].map((c) => { const b = Buffer.alloc(4); b.writeUInt32LE(c.codePointAt(0)); return b; })]);
  for (const [what, buf] of [['a UTF-32LE file with a BOM (read as UTF-16 by its first two bytes)', utf32le],
    ['a false UTF-16LE BOM in front of ASCII', Buffer.concat([Buffer.from([0xff, 0xfe]), ascii.length % 2 ? Buffer.concat([ascii, Buffer.from(' ')]) : ascii])],
    ['a false UTF-16BE BOM in front of ASCII', Buffer.concat([Buffer.from([0xfe, 0xff]), ascii.length % 2 ? Buffer.concat([ascii, Buffer.from(' ')]) : ascii])],
    ['9000 bytes of ASCII, then UTF-16LE text holding the key', Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from(`key ${KEY}\n`, 'utf16le')])]]) {
    const r = bs.scanFile('agents/a/f.txt', buf);
    const leaked = r.action === 'store' && (r.data.toString('latin1').includes(KEY) || r.data.toString('latin1').replace(/\0/g, '').includes(KEY));
    assert.equal(leaked, false, `${what}: the key must not be stored readable (got ${r.action}${r.why ? ': ' + r.why : ''})`);
  }
  assert.equal(bs.scanFile('agents/a/ok.txt', Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from('plain\n', 'utf16le')])).action, 'store', 'CONTROL: the same shape with no key is stored');
});

test('#5535 compressed magic: every listed format is skipped, and ordinary text that merely starts like one is kept', () => {
  const zlib = require('zlib');
  for (const [what, hex] of [['xz', 'fd377a585a000004'], ['zstd', '28b52ffd0000'], ['7z', '377abcaf271c0004'], ['lz4', '04224d1864'],
    ['rar', '526172211a0700'], ['compress .Z', '1f9d90'], ['zip central directory', '504b01021400'], ['git pack v2', '5041434b00000002'],
    ['bzip2', Buffer.from('BZh9').toString('hex') + '314159265359']]) {
    assert.equal(bs.scanFile('agents/a/blob', Buffer.from(hex + '00'.repeat(8), 'hex')).action, 'skip', what);
  }
  const stubbed = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('MZ stub'), Buffer.from('504b0304', 'hex'), zlib.deflateRawSync(Buffer.from(KEY)), Buffer.from('504b0506', 'hex'), Buffer.alloc(18)]);  // a real appended zip ends with its end record
  assert.equal(bs.scanFile('agents/a/setup.exe', stubbed).action, 'skip', 'a zip appended after a stub');
  for (const text of ['x^2 + y^2 = r^2\n', 'BZhello there\n', 'PACKAGE LIST\n', 'PK notes\n', ']\u0000\u0000 not quite'.replace(/\u0000/g, '')]) {
    assert.equal(bs.scanFile('agents/a/notes.md', Buffer.from(text)).action, 'store', `CONTROL: ordinary text ${JSON.stringify(text)} is kept`);
  }
});

test('#5535 deny-list round 2: more credential files skipped; templates kept', () => {
  for (const p of ['infra/prod.tfvars', '.terraformrc', '.dockercfg', '.my.cnf', 'gcp/service-account-prod.json', 'api.secret', 'deploy.token',
    '.ssh2/authorized_keys', 'authorized_keys', '.config/op/config', '.config/doctl/config.yaml', 'Firefox/logins.json', 'Firefox/key4.db',
    'Firefox/cookies.sqlite', '.zsh_history', '.bash_history', '.python_history']) {
    assert.equal(bs.pathDecision(p).include, false, `${p} must be skipped`);
  }
  for (const p of ['.env.example', '.env.sample', 'config/.env.template', 'credentials.json.example', 'secrets.yaml.dist']) {
    assert.equal(bs.pathDecision(p).include, true, `CONTROL: the template ${p} is kept (its content is still scanned)`);
  }
  const tpl = bs.scanFile('.env.example', Buffer.from(`API_KEY=${KEY}\n`));
  assert.ok(tpl.action === 'skip' || !tpl.data.toString().includes(KEY), 'a template holding a REAL key is still masked or skipped');
});

test('#5535 content cannot hide a password behind the masking placeholder (secretmask trusts a value starting with it)', () => {
  const bin = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('password=••••Hunter2Real!pass9', 'utf8')]);
  const r = bs.scanFile('agents/a/blob.bin', bin);
  assert.ok(r.action === 'skip' || !r.data.toString('latin1').includes('Hunter2Real'), 'a binary hiding a password behind bullets');
  assert.equal(bs.scanFile('agents/a/a.txt', Buffer.from('password=••••Hunter2Real!pass9\n')).action, 'skip', 'a text file hiding a password behind bullets');
  assert.equal(bs.scanFile('agents/a/list.md', Buffer.from('• one\n• two\n')).action, 'store', 'CONTROL: ordinary bullet lists are kept');
  const url = bs.scanFile('agents/a/notes.md', Buffer.from(`clone https://x:${GH}@github.com/o/r\n`));
  assert.ok(url.action === 'store' && !url.data.toString().includes(GH), 'CONTROL: our OWN placeholder in a URL still passes the final check');
});

test('#5535 the binary scan reads printable runs, so real images and libraries are kept, and a key in one is still caught', () => {
  const fs = require('fs');
  const real = [];
  for (const dir of ['/System/Library/Desktop Pictures', '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources']) {
    try { for (const f of fs.readdirSync(dir).filter((n) => /\.(heic|icns|png)$/i.test(n)).slice(0, 12)) real.push(`${dir}/${f}`); } catch { /* not on this machine */ }
  }
  for (const p of ['/usr/lib/dyld']) { try { fs.accessSync(p); real.push(p); } catch { /* absent */ } }
  let checked = 0;
  for (const p of real) {
    let buf; try { buf = fs.readFileSync(p); } catch { continue; }
    if (buf.length > 40 * 1024 * 1024) continue;
    checked++;
    const r = bs.scanFile('agents/a/' + require('path').basename(p), buf);
    assert.equal(r.action, 'store', `a real ${p} was skipped as credential-shaped: ${r.why}`);
  }
  if (real.length) assert.ok(checked > 0, 'PRECONDITION: some real files were checked');
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7), Buffer.from(`tEXt key=${GH}`), Buffer.alloc(64, 9)]);
  assert.equal(bs.scanFile('agents/a/shot.png', png).action, 'skip', 'a token in a PNG text chunk is still caught');
});

test('#5535 the binary scan withholds and skips; a lone private-key opening inside UTF-32 skips', () => {
  const sm = require('./secretmask');
  const held = Array.from({ length: 2000 }, (_, i) => `hq7x-vzlq-${String(i).padStart(8, '0')}-k9z`);
  sm.setKnownSecrets(held);
  try {
    const rows = Array.from({ length: 1000 }, (_, i) => `| hq7x-vzlq- | 0000 | ${i % 10} | 00 | -k9z |`).join('\n');
    const bin = Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(rows)]);
    assert.equal(bs.scanFile('agents/a/blob.bin', bin).action, 'skip', 'a binary whose scan withholds is skipped');
  } finally { sm.setKnownSecrets([]); }
  const u32 = Buffer.concat([...'-----BEGIN RSA PRIVATE KEY-----\n'].map((c) => { const b = Buffer.alloc(4); b.writeUInt32LE(c.codePointAt(0)); return b; }));
  assert.equal(bs.scanFile('agents/a/k.dat', u32).action, 'skip', 'a private-key opening alone, inside UTF-32');
});

test('#5535 Latin-1 (Windows-1252) text is redacted in place, not skipped whole', () => {
  const buf = Buffer.concat([Buffer.from('caf', 'latin1'), Buffer.from([0xe9]), Buffer.from(` note\nkey ${KEY}\nend.\n`, 'latin1')]);
  const r = bs.scanFile('agents/a/j.txt', buf);
  assert.equal(r.action, 'store');
  assert.ok(!r.data.toString('latin1').includes(KEY), 'the key is gone');
  assert.equal(r.data[3], 0xe9, 'the Latin-1 byte is kept as it was');
  const clean = Buffer.concat([Buffer.from('caf', 'latin1'), Buffer.from([0xe9, 0x0a])]);
  assert.ok(bs.scanFile('agents/a/k.txt', clean).data.equals(clean), 'CONTROL: clean Latin-1 is stored byte for byte');
});

test('#5535 generic kinds are ignored only for media and fonts: a long_token key in a database is still caught', () => {
  const azure = 'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=' + 'Zm9vYmFyYmF6cXV4'.repeat(5) + 'AbCdEf==';
  const sqlite = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(20), Buffer.from(azure), Buffer.alloc(20)]);
  const sm = require('./secretmask');
  assert.ok(sm.mask(azure).fired.length, 'PRECONDITION: secretmask fires on this key at all');
  assert.equal(bs.scanFile('agents/a/app.db', sqlite).action, 'skip', 'an Azure-style key inside a SQLite file');
  const sg = 'SG.' + 'aB3dE5fG7hJ9kL1mN3pQ5r'.slice(0, 22) + '.' + 'x'.repeat(10) + 'Y7z9A1b3C5d7E9f1G3h5J7k9L1m3N5p7Q9';
  const plist = Buffer.concat([Buffer.from('bplist00'), Buffer.alloc(8), Buffer.from(sg), Buffer.alloc(8)]);
  if (sm.mask(sg).fired.length) assert.equal(bs.scanFile('agents/a/prefs.plist', plist).action, 'skip', 'a SendGrid-style key inside a binary plist');
});

test('#5535 a key split by one control byte in a non-media binary is still caught', () => {
  const key = 'sk-ant-api03-' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0';
  const bin = Buffer.concat([Buffer.from([0, 0, 1]), Buffer.from('sk-ant-'), Buffer.from([1]), Buffer.from(key.slice(7)), Buffer.from([0, 0])]);
  assert.equal(bs.scanFile('agents/a/blob.bin', bin).action, 'skip', 'sk-ant- then \\x01 then the rest');
  const pw = Buffer.concat([Buffer.from([0, 2]), Buffer.from('password=Hunter'), Buffer.from([1]), Buffer.from('2Hunter2xyzQ'), Buffer.from([0])]);
  const sm = require('./secretmask');
  if (sm.mask('password=Hunter2Hunter2xyzQ').fired.length) assert.equal(bs.scanFile('agents/a/blob2.bin', pw).action, 'skip', 'an assigned password split by \\x01');
});

test('#5535 the binary guards each have a case: XMP-only metadata kept, UTF-16 key skipped, lone key opening skipped, one NUL keeps text binary', () => {
  const xmp = Buffer.concat([Buffer.from([0, 1, 2, 3, 0]), Buffer.from('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta/>'), Buffer.from([0, 0])]);
  assert.equal(bs.scanFile('agents/a/meta.dat', xmp).action, 'store', 'CONTROL: a non-media binary with ordinary XMP metadata is kept');
  const u16 = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(`key ${KEY} x`, 'utf16le'), Buffer.from([7, 7, 7])]);
  assert.equal(bs.scanFile('agents/a/u16.dat', u16).action, 'skip', 'a UTF-16 key inside a binary (the NUL-removed view)');
  const open = Buffer.concat([Buffer.from([0, 1, 0, 1]), Buffer.from('-----BEGIN RSA PRIVATE KEY-----'), Buffer.from([0, 0, 0])]);
  assert.equal(bs.scanFile('agents/a/k.dat', open).action, 'skip', 'a private-key opening alone inside a binary');
  const longText = Buffer.from('x'.repeat(5000) + `\0key ${KEY}\n` + 'y'.repeat(5000));
  const r = bs.scanFile('agents/a/t.txt', longText);
  assert.equal(r.action, 'skip', 'text with a NUL stays binary (never redacted in place): skipped because it holds a key');
});

test('#5535 Latin-1 redaction writes an ASCII marker, never a quote', () => {
  const buf = Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from(` key ${KEY}\n`, 'latin1')]);
  const r = bs.scanFile('agents/a/j.txt', buf);
  assert.equal(r.action, 'store');
  const out = r.data.toString('latin1');
  assert.ok(!out.includes(KEY) && out.includes('****') && !out.includes('""""'), `marker written as asterisks: ${JSON.stringify(out)}`);
});

const pngHead = () => Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.from('IHDR'), Buffer.alloc(13, 1)]);
const machoHead = () => Buffer.concat([Buffer.from('cffaedfe0c000001', 'hex'), Buffer.alloc(24, 2)]);

test('#5535 media exemptions are per format: code keeps url_credential; a weak or spoofed prefix is not media', () => {
  const pg = 'postgres://admin:S3cretPassw0rd@db.internal:5432/app';
  const sm = require('./secretmask');
  assert.ok(sm.mask(pg).fired.length, 'PRECONDITION: a URL credential fires');
  assert.equal(bs.scanFile('agents/a/tool', Buffer.concat([machoHead(), Buffer.from(pg), Buffer.alloc(8)])).action, 'skip', 'a database URL compiled into a Mach-O');
  const azure = 'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=' + 'Zm9vYmFyYmF6cXV4'.repeat(5) + 'AbCdEf==';
  const fakePng = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('SQLite format 3\0'), Buffer.from(azure), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/x.db', fakePng).action, 'skip', 'PNG magic without IHDR is not media: the long_token key counts');
  const fakeFont = Buffer.concat([Buffer.from('00010000ffff', 'hex'), Buffer.from(azure), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/y.db', fakeFont).action, 'skip', 'a font magic with an absurd table count is not a font');
});

test('#5535 media-only guards: the placeholder rule and the NUL-removed view apply to real media too', () => {
  const pw = Buffer.concat([pngHead(), Buffer.from('tEXtpassword=••••Hunter2Real!pass9', 'utf8'), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/shot.png', pw).action, 'skip', 'a PNG hiding a password behind the placeholder');
  const u16 = Buffer.concat([pngHead(), Buffer.from(`note ${KEY} x`, 'utf16le'), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/shot2.png', u16).action, 'skip', 'a PNG carrying a UTF-16 key');
  assert.equal(bs.scanFile('agents/a/shot3.png', Buffer.concat([pngHead(), Buffer.alloc(64, 3)])).action, 'store', 'CONTROL: a clean PNG is kept');
});

test('#5535 compressed magic, the remaining formats, each with a deflated key behind it; BZh9 without block magic is kept', () => {
  const zlib = require('zlib');
  const key = zlib.deflateRawSync(Buffer.from(`API=${KEY}`));
  for (const [what, hex] of [['lzma', '5d00000100'], ['zip 0708', '504b0708']]) {
    assert.equal(bs.scanFile('agents/a/blob', Buffer.concat([Buffer.from(hex, 'hex'), Buffer.alloc(4), key])).action, 'skip', what);
  }
  const eocd = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from('stub'), key, Buffer.from('504b0506', 'hex'), Buffer.alloc(18)]);
  assert.equal(bs.scanFile('agents/a/setup.bin', eocd).action, 'skip', 'a zip end record after a stub');
  assert.equal(bs.scanFile('agents/a/notes.md', Buffer.from('BZh9hello there\n')).action, 'store', 'CONTROL: BZh9 followed by text, not the block magic, is kept');
});

test('#5535 anything unexpected while scanning skips the file (fail closed)', () => {
  class Hostile extends Buffer {}
  const h = Buffer.from('ordinary text\n');
  Object.setPrototypeOf(h, Hostile.prototype);
  h.toString = () => { throw new Error('boom'); };
  const r = bs.scanFile('agents/a/n.md', h);
  assert.deepEqual(r, { action: 'skip', why: 'could not be checked' });
});

const LONG_ONLY = 'Xq7Lp2Vw9Kx4Rn6Tj8Hm3Bc5Zd1Fg0Yh7Wk2Qs4Ej6Ru9Ti3';   // fires long_token and nothing else (measured)
const URL_ONLY = 'ftp://glyphname:uni0C95below@kannada';                 // fires url_credential and nothing else (measured)

test('#5535 audio is media: real system sounds are kept; a provider key in one is still caught', () => {
  const fs = require('fs');
  let checked = 0;
  for (const name of ['Blow.aiff', 'Basso.aiff', 'Bottle.aiff', 'Funk.aiff']) {
    let buf; try { buf = fs.readFileSync(`/System/Library/Sounds/${name}`); } catch { continue; }
    checked++;
    assert.equal(bs.scanFile(`agents/a/${name}`, buf).action, 'store', `the real ${name} was skipped`);
  }
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(8, 5), Buffer.from(LONG_ONLY), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/memo.wav', wav).action, 'store', 'a WAV with long_token-shaped sample noise is kept');
  const keyed = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(8, 5), Buffer.from(KEY), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/memo2.wav', keyed).action, 'skip', 'a provider key inside a WAV is caught (specific detectors still count)');
  if (fs.existsSync('/System/Library/Sounds')) assert.ok(checked > 0, 'PRECONDITION: some real sounds were checked');
});

test('#5535 strict magics have cases: an ISO file with a non-media brand is not media; each font magic is a font', () => {
  const iso = (brand) => Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp' + brand), Buffer.alloc(8), Buffer.from(LONG_ONLY), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/x.bin', iso('crx3')).action, 'skip', 'ftyp with an unknown brand: long_token counts');
  assert.equal(bs.scanFile('agents/a/x.heic', iso('heic')).action, 'store', 'CONTROL: ftyp heic is an image');
  assert.equal(bs.scanFile('agents/a/x.m4a', iso('M4A ')).action, 'store', 'CONTROL: ftyp M4A is audio');
  const fontWith = (head, payload) => Buffer.concat([head, Buffer.alloc(8, 1), Buffer.from(payload), Buffer.alloc(8)]);
  const sane = (tag) => Buffer.concat([Buffer.from(tag, 'latin1'), Buffer.from('0010', 'hex')]);  // numTables = 16
  for (const [what, head] of [['wOF2', Buffer.from('wOF2')], ['ttcf', Buffer.from('ttcf')], ['true', sane('true')], ['OTTO', sane('OTTO')]]) {
    assert.equal(bs.scanFile(`agents/a/f.${what}`, fontWith(head, LONG_ONLY)).action, 'store', `${what}: a font with long_token-shaped glyph data is kept`);
    assert.equal(bs.scanFile(`agents/b/f.${what}`, fontWith(head, URL_ONLY)).action, 'store', `${what}: glyph-name noise that fires url_credential is kept (a font-only exemption)`);
  }
  assert.equal(bs.scanFile('agents/a/f.bin', Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(4), Buffer.from(URL_ONLY), Buffer.alloc(8)])).action, 'skip', 'CONTROL: the same url_credential in a non-font binary counts');
});

test('#5535 audio arms each pinned: specific kinds still count; wrong forms are not audio; each format keeps its noise', () => {
  const wavWith = (payload) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(8, 5), Buffer.from(payload), Buffer.alloc(8)]);
  const sm = require('./secretmask');
  const pw = 'password=Hunter2Hunter2xyzQ', url = 'https://user:Pa55wordXyz@host.example.com/x';
  if (sm.mask(pw).fired.length) assert.equal(bs.scanFile('agents/a/a.wav', wavWith(pw)).action, 'skip', 'an assigned password inside a WAV');
  assert.equal(bs.scanFile('agents/a/b.wav', wavWith(url)).action, 'skip', 'a URL credential inside a WAV (audio ignores only long_token)');
  const riffAvi = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI LIST'), Buffer.alloc(8, 5), Buffer.from(LONG_ONLY), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/c.bin', riffAvi).action, 'skip', 'RIFF that is not WAVE is not audio');
  const form8svx = Buffer.concat([Buffer.from('FORM'), Buffer.alloc(4), Buffer.from('8SVX'), Buffer.alloc(8, 5), Buffer.from(LONG_ONLY), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/d.bin', form8svx).action, 'skip', 'FORM that is not AIFF/AIFC is not audio');
  for (const [what, head] of [['ID3', Buffer.from('ID3\u0004\u0000')], ['caff', Buffer.from('caff\u0000\u0001')], ['Ogg', Buffer.from('OggS\u0000\u0002')],
    ['FLAC', Buffer.from('fLaC\u0000')], ['BMP', Buffer.concat([Buffer.from('BM'), Buffer.alloc(12), Buffer.from([40, 0, 0, 0])])],
    ['ICO', Buffer.from('000001000100', 'hex')], ['WASM', Buffer.from('0061736d01000000', 'hex')]]) {
    assert.equal(bs.scanFile(`agents/a/n.${what}`, Buffer.concat([head, Buffer.alloc(8, 3), Buffer.from(LONG_ONLY), Buffer.alloc(8)])).action, 'store', `${what}: long_token-shaped noise is kept`);
  }
  assert.equal(bs.scanFile('agents/a/v.ogg', Buffer.concat([Buffer.from('OggS\u0000\u0002'), Buffer.alloc(8, 3), Buffer.from(KEY), Buffer.alloc(8)])).action, 'skip', 'a provider key inside an Ogg file');
  assert.equal(bs.scanFile('agents/a/o.bin', Buffer.concat([Buffer.from('OggS\u0001'), Buffer.alloc(8, 3), Buffer.from(LONG_ONLY), Buffer.alloc(8)])).action, 'skip', 'OggS with a non-zero version is not audio');
});

test('#5535 deny-list entries each pinned: provider sign-ins, bare credential files, a git file; near misses kept', () => {
  for (const p of ['.codex/auth.json', '.gemini/oauth_creds.json', '.grok/credentials', 'x/credentials', 'x/secret', 'x/secrets', 'wt/.git']) {
    assert.equal(bs.pathDecision(p).include, false, `${p} must be skipped by path`);
  }
  for (const p of ['.codex/config.toml', '.gemini/settings.json', 'x/credentials-guide.md', 'x/secretary.md', 'wt/.gitignore', 'wt/.github/workflows/ci.yml']) {
    assert.equal(bs.pathDecision(p).include, true, `CONTROL: ${p} is kept`);
  }
  assert.equal(bs.scanFile('agents/a/n.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.from([9, 0]), Buffer.alloc(8, 3), Buffer.from(LONG_ONLY), Buffer.alloc(8)])).action, 'skip', 'ID3 with an impossible version is not audio');
});

test('#5535 over-skips from round 9: a chance zip signature in media, XMP keys in video, and the stated path loss', () => {
  const fs = require('fs'), path = require('path');
  const shot = path.join(__dirname, '..', 'ios', 'store', 'screenshots', 'dark', '04-project-room.png');
  if (fs.existsSync(shot)) assert.equal(bs.scanFile('agents/a/shot.png', fs.readFileSync(shot)).action, 'store', 'a real PNG with PK\\x05\\x06 by chance is kept');
  const mov = '/System/Library/ExtensionKit/Extensions/MouseExtension.appex/Contents/Resources/Mouse.mov';
  if (fs.existsSync(mov)) assert.equal(bs.scanFile('agents/a/m.mov', fs.readFileSync(mov)).action, 'store', 'a real .mov with XMP keys is kept');
  // An appended zip still counts when its end record closes the file.
  const zipped = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from('stub'), Buffer.from('504b0506', 'hex'), Buffer.alloc(16), Buffer.from([0, 0])]);
  assert.equal(bs.scanFile('agents/a/setup.bin', zipped).action, 'skip', 'a well-formed appended zip end record is still skipped');
  const chance = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from('504b0506', 'hex'), Buffer.alloc(40, 7)]);
  assert.equal(bs.scanFile('agents/a/x.bin', chance).action, 'store', 'CONTROL: the signature by chance, not closing the file, is not a zip');
  // XMP in a video with a REAL key elsewhere still skips: only the packet is dropped.
  const movKey = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(8), Buffer.from('<x:xmpmeta xmpDM:key="keywordExt_123e4567"></x:xmpmeta>'), Buffer.alloc(4), Buffer.from(KEY), Buffer.alloc(4)]);
  assert.equal(bs.scanFile('agents/a/v.mov', movKey).action, 'skip', 'a provider key outside the XMP packet still skips');
});

test('#5535 XMP in media: only xmpDM:key noise is ignored; a key or password elsewhere in the packet still skips', () => {
  const vid = (packet) => Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(8), Buffer.from(packet), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/n.mov', vid('<x:xmpmeta><rdf:li xmpDM:key="keywordExtDVAv1_123e4567-e89b-12d3-a456-426614174000"/></x:xmpmeta>')).action, 'store',
    'synthetic video with xmpDM:key noise is kept (pins the behaviour on any machine)');
  assert.equal(bs.scanFile('agents/a/k.mov', vid(`<x:xmpmeta><rdf:Description dc:description="my key ${KEY}"/></x:xmpmeta>`)).action, 'skip', 'a provider key inside the XMP packet');
  const pw = '<x:xmpmeta><rdf:Description password="Hunter2Hunter2xyz99"/></x:xmpmeta>';
  if (require('./secretmask').mask('password="Hunter2Hunter2xyz99"').fired.length) assert.equal(bs.scanFile('agents/a/p.mov', vid(pw)).action, 'skip', 'a password attribute inside the XMP packet');
});

test('#5535 the xmpDM:key carve-out removes only the name: a key in its value, in another field, in a non-media file, or past an unclosed quote still skips', () => {
  const vid = (packet) => Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(8), Buffer.from(packet), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/a.mov', vid(`<rdf:li xmpDM:key="${KEY}"/>`)).action, 'skip', 'a provider key inside an xmpDM:key value');
  assert.equal(bs.scanFile('agents/a/b.mov', vid(`<rdf:li xmpDM:logComment="${KEY}"/>`)).action, 'skip', 'a key in another xmpDM field');
  const db = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(8), Buffer.from(`xmpDM:key="${KEY}"`), Buffer.alloc(8)]);
  assert.equal(bs.scanFile('agents/a/c.db', db).action, 'skip', 'the carve-out does not apply to a non-media binary');
  assert.equal(bs.scanFile('agents/a/d.mov', vid(`<rdf:li xmpDM:key="${'x'.repeat(600)} ${KEY}`)).action, 'skip', 'a key far past an unclosed xmpDM:key quote');
});

test('#5535 credential-named CSV exports are denied by path (cloud consoles export keys as CSV)', () => {
  for (const p of ['credentials.csv', 'secrets.csv', 'auth.csv', 'x/tokens.csv']) assert.equal(bs.pathDecision(p).include, false, p);
  assert.equal(bs.pathDecision('reports/q3-tokens-used.csv').include, true, 'CONTROL: an ordinary CSV is kept');
});
