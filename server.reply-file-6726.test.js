'use strict';

/**
 * #6726: `kosmos reply --file <path>` attaches one of the agent's own files to its reply,
 * as the SAME attachment a person's upload is: copied into the attachment store, carried on
 * the reply's row by attachments.rowFields, downloaded through the existing GET
 * /api/attachment/<id>. These arms drive the real route.
 *
 * Every refusal arm also asserts that no row was written and no stored copy was left, so a
 * refusal that still attached (or still kept a copy) is red, not only one with the wrong words.
 *
 * Sandbox: the data, workers and projects roots are temp folders set BEFORE server.js is
 * required (an unset workers root is the real ~/work/workers). Boots on port 0. The sender is
 * resolved through the messages.setRunner pane seam, as server.report-reply-loopback-1968 does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-6726-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const chat = require('./engine/chat');
const attachments = require('./engine/attachments');
const dmfiles = require('./engine/dmfiles');
const projects = require('./engine/projects');
const store = require('./engine/store');
const replyfile = require('./engine/replyfile');
const sendertoken = require('./engine/sendertoken');

const TOK = 'BOARDTOKEN_6726_0123456789abcdef';
let LEO_TOKEN = '';
const PAGE = { 'x-kosmos-board-token': TOK };   // the page's own reads, on the enforcing board
const WHO = 'leo';   // the fleet's leo is not one of ours, so its session is its key
let base;
let FILES;
let PROJ;
let NESTED;
let OUTSIDE;
const CAFE_NFC = 'caf\u00e9';          // a nested project's folder, written composed
const CAFE_NFD = 'cafe\u0301';         // the same name, decomposed

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  /* Review r2 finding 3: the arms run on an ENFORCING board, the state production has when it holds a token. The
     r2-3 arm below runs the other real state (not enforcing, no token). Each reply presents leo's AGENT token. */
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  const minted = sendertoken.mint(WHO);
  assert.ok(minted.ok, JSON.stringify(minted));
  LEO_TOKEN = minted.token;
  FILES = dmfiles.filesDir(WHO);
  assert.ok(FILES && FILES.startsWith(SANDBOX + path.sep), 'the Files folder must be inside the sandbox: ' + FILES);
  fs.mkdirSync(path.join(FILES, 'sub'), { recursive: true });
  PROJ = path.join(SANDBOX, 'proj');
  NESTED = path.join(PROJ, 'inner');
  OUTSIDE = path.join(SANDBOX, 'outside');
  fs.mkdirSync(path.join(PROJ, 'cuts'), { recursive: true });
  fs.mkdirSync(path.join(PROJ, '.git'), { recursive: true });
  fs.mkdirSync(NESTED, { recursive: true });
  fs.mkdirSync(path.join(PROJ, CAFE_NFC), { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
  projects.readAll();
  projects.writeAll([
    { id: 'proj-6726', name: 'Proj', folder: PROJ, agents: [WHO], createdAt: new Date().toISOString() },
    { id: 'inner-6726', name: 'Inner', folder: NESTED, agents: ['mara'], createdAt: new Date().toISOString() },
    { id: 'cafe-6726', name: 'Cafe', folder: path.join(PROJ, CAFE_NFC), agents: ['mara'], createdAt: new Date().toISOString() },
  ]);
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* leo, and mara beside it for the cross-agent arm: pane %9 is mara's, every other pane is leo's. */
function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  messages.setRunner((pane) => ({ ok: true, session: pane === '%9' ? 'mara-discord' : 'leo-discord' }));
  return Promise.resolve().then(() => fn(board)).finally(() => { messages.setRunner(null); board.restore(); });
}

/* Every reply presents leo's agent token unless `token: false`: a file goes only from a sender its agent token named. */
async function reply(body, headers = {}, { token = true } = {}) {
  const res = await fetch(base + '/api/reply', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-kosmos-agent-token': LEO_TOKEN } : {}), ...headers },
    body: JSON.stringify({ from_pane: '%3', ...body }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* left {} */ }
  return { code: res.status, json, text };
}

const rows = () => chat.readThread(chat.DIRECT, WHO).messages.filter((m) => m && m.from === WHO);
/* Review r1 finding 9: the WHOLE store, every scope and owner, so a copy left anywhere is seen. */
const storedCount = () => {
  let n = 0;
  for (const scope of ['agent', 'project']) {
    let owners = [];
    try { owners = fs.readdirSync(path.join(attachments.ROOT, scope)); } catch { continue; }
    for (const o of owners) { try { n += fs.readdirSync(path.join(attachments.ROOT, scope, o)).length; } catch { /* none */ } }
  }
  return n;
};
const agentStore = () => path.join(attachments.ROOT, 'agent', store.safeKey(WHO));

function write(p, bytes) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); return p; }

/* A refusal: kept false with these words, and nothing written anywhere. */
async function refused(body, because, headers, opts) {
  const before = rows().length;
  const copies = storedCount();
  const r = await reply(body, headers, opts);
  assert.equal(r.code, 200, r.text);
  assert.equal(r.json.kept, false, 'DANGEROUS: it was kept: ' + r.text);
  assert.match(String(r.json.because), because, r.text);
  assert.equal(rows().length, before, 'a refused reply wrote a row');
  assert.equal(storedCount(), copies, 'a refused reply left a stored copy');
}

test('#6726: a file from the Files folder arrives on the reply as an attachment and downloads byte for byte, as a copy', () => withLeo(async () => {
  const bytes = Buffer.from(Array.from({ length: 300 * 1024 }, (_, i) => (i * 31 + 7) & 0xff));
  const src = write(path.join(FILES, 'report.pdf'), bytes);
  const r = await reply({ text: 'Here is the report', file: src });
  assert.equal(r.json.kept, true, r.text);
  const row = rows().at(-1);
  assert.equal(row.text, 'Here is the report');
  assert.ok(Array.isArray(row.attachments) && row.attachments.length === 1, 'no attachments on the row: ' + JSON.stringify(row));
  const a = row.attachments[0];
  assert.equal(a.name, 'report.pdf');
  assert.equal(a.size, bytes.length);
  assert.equal(a.type, 'application/pdf');
  assert.equal(a.kind, 'pdf');
  assert.equal(row.attachment.id, a.id, 'the single-file field a card drawn against one file reads');
  assert.equal(a.url, '/api/attachment/' + a.id);
  /* What the page reads (GET /api/agent/<name>/thread) carries the same record on the agent's row. */
  const page = await (await fetch(base + '/api/agent/' + encodeURIComponent(WHO) + '/thread', { headers: PAGE })).json();
  const seen = JSON.stringify(page);
  assert.ok(seen.includes('"id":"' + a.id + '"') && seen.includes('"url":"' + a.url + '"'), 'the page\'s thread read does not carry the attachment: ' + seen.slice(0, 400));
  /* The original changes and then goes: what was sent does not. */
  fs.writeFileSync(src, 'edited after sending');
  const got = await fetch(base + a.url, { headers: PAGE });
  assert.equal(got.status, 200);
  assert.match(String(got.headers.get('content-disposition')), /^attachment; filename\*=UTF-8''report\.pdf$/);
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(bytes), 'the download is not the bytes that were sent');
  fs.rmSync(src);
  const again = await fetch(base + a.url, { headers: PAGE });
  assert.ok(Buffer.from(await again.arrayBuffer()).equals(bytes), 'deleting the original changed the download');
}));

test('#6726: a file inside a project folder the agent is on attaches; with no words the name is the text', () => withLeo(async () => {
  const src = write(path.join(PROJ, 'cuts', 'clip.mp4'), Buffer.from('not really a video, but bytes'));
  const r = await reply({ text: '', file: src });
  assert.equal(r.json.kept, true, r.text);
  const row = rows().at(-1);
  assert.equal(row.text, 'clip.mp4');
  assert.equal(row.attachments[0].type, 'video/mp4');
  assert.equal(row.attachments[0].kind, 'other');
}));

test('#6726 CONTROL: a reply with no file is kept as text with no attachment, and a forwarded one is kept too', () => withLeo(async () => {
  const r = await reply({ text: 'just words' });
  assert.equal(r.json.kept, true, r.text);
  assert.equal(rows().at(-1).attachments, undefined);
  const fwd = await reply({ text: 'words from afar' }, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(fwd.json.kept, true, 'the remote arm below must be refused for the FILE, not for being forwarded: ' + fwd.text);
}));

test('#6726: a forwarded (remote) request cannot attach a file', () => withLeo(async () => {
  const src = write(path.join(FILES, 'remote.txt'), 'x');
  await refused({ text: 'hi', file: src }, /only by an agent running on this computer/, { 'x-forwarded-for': '203.0.113.9' });
}));

test('#6726: a file outside the agent\'s folders is refused', () => withLeo(async () => {
  await refused({ text: 'hi', file: write(path.join(OUTSIDE, 'secret.txt'), 'nope') }, /only a file directly in your Files folder/);
}));

test('#6726: a link in the Files folder that points out is judged by where it lands', () => withLeo(async () => {
  const target = write(path.join(OUTSIDE, 'linked.txt'), 'nope');
  const link = path.join(FILES, 'innocent.txt');
  fs.symlinkSync(target, link);
  await refused({ text: 'hi', file: link }, /only a file directly in your Files folder/);
}));

test('#6726: a path with .. is refused, even one that would land inside', () => withLeo(async () => {
  write(path.join(FILES, 'dots.txt'), 'x');
  await refused({ text: 'hi', file: path.join(FILES, 'sub') + '/../dots.txt' }, /\.\. in it/);
}));

test('#6726: a folder is refused', () => withLeo(async () => {
  await refused({ text: 'hi', file: path.join(PROJ, 'cuts') }, /that is a folder/);
}));

test('#6726: a FIFO and a device are refused as not ordinary files', () => withLeo(async () => {
  const fifo = path.join(FILES, 'pipe');
  execFileSync('mkfifo', [fifo]);
  await refused({ text: 'hi', file: fifo }, /not an ordinary file/);
  await refused({ text: 'hi', file: '/dev/null' }, /not an ordinary file/);
}));

test('#6726: a file over the 100 MB a conversation carries is refused before it is read', () => withLeo(async () => {
  const big = path.join(FILES, 'big.mov');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, attachments.MAX_BYTES + 1);   // sparse: the size is real, the disk is not used
  await refused({ text: 'hi', file: big }, /that file is larger than 100 MB, the most a conversation carries/);
}));

test('#6726: a missing file and a relative path are refused', () => withLeo(async () => {
  await refused({ text: 'hi', file: path.join(FILES, 'gone.txt') }, /there is no file at /);
  await refused({ text: 'hi', file: 'Files/report.pdf' }, /full path/);
}));

test('#6726: a file in a subfolder of Files, a hidden file and another agent\'s Files are refused', () => withLeo(async () => {
  await refused({ text: 'hi', file: write(path.join(FILES, 'sub', 'deep.txt'), 'x') }, /only a file directly in your Files folder/);
  await refused({ text: 'hi', file: write(path.join(PROJ, '.env'), 'KEY=1') }, /hidden/);
  await refused({ text: 'hi', file: write(path.join(PROJ, '.git', 'config'), 'x') }, /hidden/);
  const mara = dmfiles.filesDir('mara');
  await refused({ text: 'hi', file: write(path.join(mara, 'hers.txt'), 'x') }, /only a file directly in your Files folder/);
}));

test('#6726: a file in a nested project the agent is not on is refused, though it sits inside its project', () => withLeo(async () => {
  await refused({ text: 'hi', file: write(path.join(NESTED, 'theirs.txt'), 'x') }, /only a file directly in your Files folder/);
}));

test('#6726: file must be a path string', () => withLeo(async () => {
  const r = await reply({ text: 'hi', file: ['/etc/passwd'] });
  assert.equal(r.code, 400, r.text);
}));

test('#6726 r1-1: a nested project the agent is not on is refused when its folder is typed in another case', () => withLeo(async () => {
  await refused({ text: 'hi', file: write(path.join(NESTED, 'cased.txt'), 'x').replace(path.sep + 'inner' + path.sep, path.sep + 'INNER' + path.sep) }, /only a file directly in your Files folder/);
}));

test('#6726 r1-1: a nested project the agent is not on is refused when its name is typed decomposed (NFD)', () => withLeo(async () => {
  write(path.join(PROJ, CAFE_NFC, 'menu.txt'), 'x');
  const nfd = path.join(PROJ, CAFE_NFD, 'menu.txt');
  assert.notEqual(nfd, path.join(PROJ, CAFE_NFC, 'menu.txt'), 'the two spellings must differ as strings, or this arm proves nothing');
  await refused({ text: 'hi', file: nfd }, /only a file directly in your Files folder/);
}));

test('#6726 r1-1 CONTROL: a Files folder typed in another case still attaches (the disk does not care, so neither do we)', () => withLeo(async () => {
  write(path.join(FILES, 'cased-ok.txt'), 'fine');
  const r = await reply({ text: 'hi', file: path.join(path.dirname(FILES), 'files', 'cased-ok.txt') });
  assert.equal(r.json.kept, true, r.text);
}));

test('#6726 r1-2: a Files folder that is a link is not a root, so its target cannot be sent', () => withLeo(async () => {
  const keys = path.join(SANDBOX, 'keys');
  write(path.join(keys, 'id_key'), 'PRIVATE');
  const aside = FILES + '.real';
  fs.renameSync(FILES, aside);
  fs.symlinkSync(keys, FILES);
  try {
    await refused({ text: 'hi', file: path.join(FILES, 'id_key') }, /only a file directly in your Files folder/);
  } finally {
    fs.unlinkSync(FILES);
    fs.renameSync(aside, FILES);
  }
}));

test('#6726 r1-3: a hard link is refused, whether its other name is outside or inside', () => withLeo(async () => {
  const outer = write(path.join(OUTSIDE, 'hard.txt'), 'secret');
  fs.linkSync(outer, path.join(FILES, 'hard.txt'));
  await refused({ text: 'hi', file: path.join(FILES, 'hard.txt') }, /hard link/);
  const mine = write(path.join(FILES, 'twice.txt'), 'mine');
  fs.linkSync(mine, path.join(FILES, 'twice-again.txt'));
  await refused({ text: 'hi', file: mine }, /hard link/);
}));

test('#6726 r1-4: the open never blocks: O_NONBLOCK is in the flags, and a FIFO with no writer is refused at once', () => {
  assert.ok(replyfile.OPEN_FLAGS & fs.constants.O_NONBLOCK, 'the open can block on a FIFO swapped in after the stat');
  const fifo = path.join(SANDBOX, 'swapped-fifo');
  execFileSync('mkfifo', [fifo]);
  const fake = fs.statSync(__filename);   // the stat the swap happened after: an ordinary file
  const copies = storedCount();
  const got = replyfile.readOwn(fifo, fake, fifo);   // the given path is required (review r6 finding 3)
  assert.equal(storedCount(), copies, 'a refused read left a stored copy');
  assert.equal(got.ok, false);
  assert.match(got.because, /changed while it was being attached/);
});

test('#6726 r2-2: on an enforcing board the board token names no agent, so a board-token reply cannot attach', () => withLeo(async () => {
  const src = write(path.join(FILES, 'by-board.txt'), 'board');
  await refused({ text: 'hi', file: src }, /without one, so nothing was sent/, { 'x-kosmos-board-token': TOK }, { token: false });
  const words = await reply({ text: 'words only' }, { 'x-kosmos-board-token': TOK }, { token: false });
  assert.equal(words.json.kept, true, 'CONTROL: the same board-token reply without a file is kept: ' + words.text);
}));

test('#6726 r2-3: on a board that does not enforce and holds no token, a pane alone cannot attach; the agent token can', () => withLeo(async () => {
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = false;
  boardAuthState.token = null;
  try {
    const src = write(path.join(FILES, 'by-token.txt'), 'tokened');
    await refused({ text: 'hi', file: src }, /only by an agent Kosmos started with its own agent token/, {}, { token: false });
    const r = await reply({ text: 'hi', file: src });
    assert.equal(r.json.kept, true, r.text);
    assert.equal(rows().at(-1).attachments[0].name, 'by-token.txt');
  } finally {
    boardAuthState.on = was.on;
    boardAuthState.token = was.token;
  }
}));

test('#6726 r2-3: leo\'s agent token with mara\'s pane attaches as leo, from leo\'s folders, never mara\'s', () => withLeo(async () => {
  const marasFiles = dmfiles.filesDir('mara');
  const hers = write(path.join(marasFiles, 'hers-cross.txt'), 'mara only');
  await refused({ text: 'hi', file: hers, from_pane: '%9' }, /only a file directly in your Files folder/);
  const mine = write(path.join(FILES, 'mine-cross.txt'), 'leo');
  const marasRows = () => chat.readThread(chat.DIRECT, 'mara').messages.length;
  const before = marasRows();
  const r = await reply({ text: 'hi', file: mine, from_pane: '%9' });
  assert.equal(r.json.kept, true, r.text);
  assert.equal(rows().at(-1).attachments[0].name, 'mine-cross.txt', 'it did not land in leo\'s conversation');
  assert.equal(marasRows(), before, 'it landed in mara\'s conversation');
}));

/* Review r2 finding 1: a project the agent is on reaches nothing Kosmos keeps for itself or its agents. Each arm adds
   one project for leo, and puts the list back after. */
async function withProject(folder, fn) {
  const kept = projects.readAll();
  projects.writeAll([...kept, { id: 'wide-6726', name: 'Wide', folder, agents: [WHO], createdAt: new Date().toISOString() }]);
  try { await fn(); } finally { projects.writeAll(kept); }
}
async function withHome(home, fn) {
  const was = process.env.AGENT_WORKFORCE_HOME;
  process.env.AGENT_WORKFORCE_HOME = home;
  try { await fn(); } finally { if (was === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = was; }
}

test('#6726 r2-1: a project holding another agent\'s folder cannot send its Files', () => withLeo(async () => {
  const maraDir = path.dirname(dmfiles.filesDir('mara'));
  const hers = write(path.join(maraDir, 'Files', 'hers-wide.txt'), 'mara');
  await withProject(maraDir, () => refused({ text: 'hi', file: hers }, /a folder Kosmos keeps for itself or for its agents/));
}));

test('#6726 r2-1: a project inside the data root cannot send a person\'s upload stored there', () => withLeo(async () => {
  const upload = attachments.save('agent', 'mara', { name: 'persons.pdf', type: 'application/pdf', bytes: Buffer.from('the person\'s') });
  await withProject(attachments.ROOT, () => refused({ text: 'hi', file: upload.file }, /a folder Kosmos keeps for itself or for its agents/));
}));

test('#6726 r2-1: a project AT the data root cannot send the board token', () => withLeo(async () => {
  const tokenFile = write(path.join(store.ROOT, 'board.token'), 'not a real token');
  await withProject(store.ROOT, () => refused({ text: 'hi', file: tokenFile }, /holds Kosmos's own data/));
}));

test('#6726 r2-1: a project holding the data root, or the workers root, gives nothing', () => withLeo(async () => {
  const aboveData = path.dirname(store.ROOT);
  const nearData = write(path.join(aboveData, 'beside-data.txt'), 'x');
  await withProject(aboveData, () => refused({ text: 'hi', file: nearData }, /holds Kosmos's own data/));
  const workers = path.dirname(path.dirname(FILES));
  const inWorkers = write(path.join(workers, 'beside-agents.txt'), 'x');
  await withProject(workers, () => refused({ text: 'hi', file: inWorkers }, /holds Kosmos's own data/));
}));

test('#6726 r2-1: a project at the home folder gives nothing, and one at ~/.ssh is kept', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home');
  const notes = write(path.join(home, 'notes.txt'), 'x');
  const key = write(path.join(home, '.ssh', 'id_key'), 'PRIVATE');
  await withHome(home, async () => {
    await withProject(home, () => refused({ text: 'hi', file: notes }, /whole home folder/));
    /* Reached through a link with no dot in its name: the path as given passes the r5-5 rule, so this arm sees the
       rule on the REAL path (~/.ssh is kept). */
    fs.symlinkSync(path.join(home, '.ssh'), path.join(home, 'ssh-link'));
    await withProject(path.join(home, '.ssh'), () => refused({ text: 'hi', file: path.join(home, 'ssh-link', 'id_key') }, /a folder Kosmos keeps for itself or for its agents/));
  });
}));

test('#6726 r2-1 CONTROL: an ordinary project folder still attaches, under the same sandbox home', () => withLeo(async () => {
  const src = write(path.join(PROJ, 'cuts', 'fine.txt'), 'ok');
  await withHome(path.join(SANDBOX, 'home'), async () => {
    const r = await reply({ text: 'hi', file: src });
    assert.equal(r.json.kept, true, r.text);
  });
}));

test('#6726 r2-5: a link is stored under the name of the file it points at', () => withLeo(async () => {
  const realFile = write(path.join(FILES, 'notes-real.txt'), 'plain notes');
  fs.symlinkSync(realFile, path.join(FILES, 'report-link.pdf'));
  const r = await reply({ text: 'hi', file: path.join(FILES, 'report-link.pdf') });
  assert.equal(r.json.kept, true, r.text);
  const a = rows().at(-1).attachments[0];
  assert.equal(a.name, 'notes-real.txt');
  assert.equal(a.type, 'text/plain');
  assert.equal(r.json.attached, 'notes-real.txt', 'the reply does not name what it was saved as, so the command says the link\'s name');
}));

/* Review r1 finding 6: a reply that is not kept leaves nothing in the store, whether the keep says no or throws.
   chat.appendMessage is swapped on the module object server.js calls it through, and put back after. */
for (const [how, stand] of [
  ['says it was not kept', () => ({ recorded: false, because: 'we could not write this conversation down on this computer' })],
  ['throws', () => { throw new Error('the disk went away'); }],
]) {
  test('#6726 r1-6: a reply whose keep ' + how + ' leaves no stored copy', () => withLeo(async () => {
    const src = write(path.join(FILES, 'unkept.txt'), 'never carried');
    const real = chat.appendMessage;
    const copies = storedCount();
    const before = rows().length;
    const dayBefore = replyfile.sentToday(WHO);
    chat.appendMessage = stand;
    let r;
    try { r = await reply({ text: 'hi', file: src }); } finally { chat.appendMessage = real; }
    assert.notEqual(r.json.kept, true, r.text);
    assert.equal(rows().length, before);
    assert.equal(storedCount(), copies, 'DANGEROUS: a copy no message carries was left in the store');
    assert.equal(replyfile.sentToday(WHO), dayBefore, 'a copy that was never sent still counts against the day');
  }));
}

/* Review r1 finding 8: 200 MB a day per agent, rolling, from the store's records of files AGENTS attached. The
   records are written by hand (no file bytes needed: only record.json is counted), and taken away after. */
test('#6726 r1-8: past 200 MB of reply attachments in 24 hours the next is refused; older ones and the person\'s do not count', () => withLeo(async () => {
  const made = [];
  const fakeRecord = (size, ageMs, by) => {
    const id = require('node:crypto').randomBytes(12).toString('hex');
    const dir = path.join(agentStore(), id);
    fs.mkdirSync(dir, { recursive: true });
    const rec = { id, name: 'old.bin', type: 'application/octet-stream', size, kind: 'other', at: new Date(Date.now() - ageMs).toISOString(), scope: 'agent', owner: WHO };
    if (by) rec.by = by;
    fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(rec));
    made.push(dir);
  };
  const src = write(path.join(FILES, 'one-more.txt'), 'x'.repeat(100));
  try {
    fakeRecord(replyfile.DAILY_BYTES - 50, 60 * 60 * 1000, 'agent');            // an hour ago, nearly the whole day's allowance
    fakeRecord(500 * 1024 * 1024, 60 * 1000);                                     // the PERSON's upload: not counted
    fakeRecord(500 * 1024 * 1024, 25 * 60 * 60 * 1000, 'agent');                  // 25 hours ago: out of the window
    assert.equal(replyfile.DAILY_BYTES, 200 * 1024 * 1024);
    replyfile.seed();   // the records written by hand above reach the ledger only through a seed, as at boot
    await refused({ text: 'hi', file: src }, /up to 200 MB a day/);
    for (const d of made.splice(0, 1)) fs.rmSync(d, { recursive: true, force: true });
    replyfile.seed();
    const r = await reply({ text: 'hi', file: src });
    assert.equal(r.json.kept, true, 'CONTROL: with the near-full day gone, the same file attaches: ' + r.text);
    const id = rows().at(-1).attachments[0].id;
    const rec = JSON.parse(fs.readFileSync(path.join(agentStore(), id, 'record.json'), 'utf8'));
    assert.equal(rec.by, 'agent', 'a reply attachment must be recorded as the agent\'s, or the day\'s total never counts it');
  } finally {
    for (const d of made) fs.rmSync(d, { recursive: true, force: true });
    replyfile.seed();
  }
}));

/* Review r2 finding 4: the total is kept in memory. A record that appears on disk without an attach is not seen
   until the next seed, which is how this test can tell a ledger from a walk of the store on every reply. */
test('#6726 r2-4: the day\'s total comes from the ledger, not a walk of the store per reply', () => withLeo(async () => {
  replyfile.seed();
  const before = replyfile.sentToday(WHO);
  const id = require('node:crypto').randomBytes(12).toString('hex');
  const dir = path.join(agentStore(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({ id, name: 'x', size: 12345, at: new Date().toISOString(), scope: 'agent', owner: WHO, by: 'agent' }));
  try {
    assert.equal(replyfile.sentToday(WHO), before, 'a record nobody attached changed the total: the store was walked');
    replyfile.seed();
    assert.equal(replyfile.sentToday(WHO), before + 12345, 'CONTROL: a seed does read it');
    const src = write(path.join(FILES, 'ledger.txt'), 'abc');
    const r = await reply({ text: 'hi', file: src });
    assert.equal(r.json.kept, true, r.text);
    assert.equal(replyfile.sentToday(WHO), before + 12345 + 3, 'an attach did not add to the ledger');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    replyfile.seed();
  }
}));

/* Review r2 finding 6: with no words the text is the name the copy was SAVED under, which safeName cuts to 160
   characters, so the bubble and the card never show two spellings of one name. */
test('#6726 r2-6: a wordless reply with a 200-character file name shows the saved name, once', () => withLeo(async () => {
  const long = 'n'.repeat(196) + '.txt';
  const src = write(path.join(FILES, long), 'long');
  const r = await reply({ text: '', file: src });
  assert.equal(r.json.kept, true, r.text);
  const row = rows().at(-1);
  assert.equal(row.attachments[0].name.length, 160, 'safeName did not cut it, so this arm proves nothing');
  assert.equal(row.text, row.attachments[0].name);
}));

/* Review r2 finding 7: after the open, the given path is resolved again and must land on the same real path. The
   second resolution is made to answer differently through the module's realpath seam, so no race is needed. */
test('#6726 r2-7: a path that resolves elsewhere after the open is refused', () => withLeo(async () => {
  const src = write(path.join(FILES, 'swapped-parent.txt'), 'x');
  let calls = 0;
  const native = (p) => fs.realpathSync.native(p);
  replyfile.setRealpathForTests((p) => (p === src && ++calls === 2 ? path.join(OUTSIDE, 'swapped-parent.txt') : native(p)));
  try {
    await refused({ text: 'hi', file: src }, /changed while it was being attached/);
    assert.equal(calls, 2, 'the given path was not resolved a second time');
  } finally {
    replyfile.setRealpathForTests(null);
  }
  const r = await reply({ text: 'hi', file: src });
  assert.equal(r.json.kept, true, 'CONTROL: with the seam gone the same file attaches: ' + r.text);
}));

/* Review r2 follow-up (a): every agent's own folder is kept, wherever it was recorded. Mara's folder is recorded
   outside the workers root, and a project of leo's holds it. The record is put back after. */
test('#6726 r2-1a: another agent\'s folder recorded outside the workers root is kept from leo\'s project', () => withLeo(async () => {
  const elsewhere = path.join(SANDBOX, 'elsewhere');
  const marasOwn = path.join(elsewhere, 'mara-home');
  fs.mkdirSync(path.join(marasOwn, 'Files'), { recursive: true });
  const had = store.readProfile('mara');
  store.writeProfile('mara', { dir: marasOwn });
  try {
    assert.equal(dmfiles.filesDir('mara'), path.join(marasOwn, 'Files'), 'the recorded folder was not followed, so this arm proves nothing');
    const hers = write(path.join(marasOwn, 'Files', 'recorded.txt'), 'mara');
    await withProject(elsewhere, () => refused({ text: 'hi', file: hers }, /a folder Kosmos keeps for itself or for its agents/));
    const mine = write(path.join(elsewhere, 'leos-own.txt'), 'leo');
    await withProject(elsewhere, async () => {
      const r = await reply({ text: 'hi', file: mine });
      assert.equal(r.json.kept, true, 'CONTROL: leo\'s own file in the same project attaches: ' + r.text);
    });
  } finally {
    store.writeProfile('mara', { dir: had && had.dir ? had.dir : undefined });
  }
}));

/* Review r3: the denylist became classes. Each arm sets a sandbox home and adds one project for leo. */
test('#6726 r3-1: a project rooted in a hidden folder of home (~/.aws, ~/.docker) cannot send what is in it', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home3');
  const creds = write(path.join(home, '.aws', 'credentials'), '[default]');
  const cfg = write(path.join(home, '.docker', 'contexts', 'meta.json'), '{}');
  const dot = write(path.join(home, '.netrc'), 'machine x');
  await withHome(home, async () => {
    /* Each reached through a link with no dot in its name, so the path as given passes the r5-5 rule and the arm sees
       the rule on the REAL path. */
    fs.symlinkSync(path.join(home, '.aws'), path.join(home, 'aws-link'));
    fs.symlinkSync(path.join(home, '.docker'), path.join(home, 'docker-link'));
    fs.symlinkSync(dot, path.join(home, 'netrc-link'));
    await withProject(path.join(home, '.aws'), () => refused({ text: 'hi', file: path.join(home, 'aws-link', 'credentials') }, /hidden folder of the home folder/));
    await withProject(path.join(home, '.docker', 'contexts'), () => refused({ text: 'hi', file: path.join(home, 'docker-link', 'contexts', 'meta.json') }, /hidden folder of the home folder/));
    /* A dotfile directly in home is reachable only from a project that holds home, which gives nothing at all. */
    await withProject(home, () => refused({ text: 'hi', file: path.join(home, 'netrc-link') }, /whole home folder/));
  });
}));

test('#6726 r3-2: ~/Library is app data: Keychains and Application Support are refused, iCloud Drive and cloud folders are not', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home4');
  const keychain = write(path.join(home, 'Library', 'Keychains', 'login.keychain-db'), 'k');
  const chrome = write(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies'), 'c');
  const dropbox = write(path.join(home, 'Library', 'CloudStorage', 'Dropbox', 'Work', 'deck.pdf'), 'd');
  const icloud = write(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Work', 'notes.md'), 'n');
  const appNotes = write(path.join(home, 'Library', 'Mobile Documents', 'com~apple~Notes', 'Data', 'note.txt'), 'app data');
  const vault = write(path.join(home, 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents', 'Vault', 'idea.md'), 'v');
  await withHome(home, async () => {
    await withProject(path.join(home, 'Library', 'Keychains'), () => refused({ text: 'hi', file: keychain }, /the Library folder, where apps keep their data/));
    await withProject(path.join(home, 'Library', 'Application Support', 'Google'), () => refused({ text: 'hi', file: chrome }, /the Library folder, where apps keep their data/));
    /* In Mobile Documents only iCloud Drive and a container's Documents are open: the rest of a container is app data. */
    await withProject(path.join(home, 'Library', 'Mobile Documents', 'com~apple~Notes'), () => refused({ text: 'hi', file: appNotes }, /the Library folder, where apps keep their data/));
    /* Review r4 finding 4: an iCloud app's Documents is where its user-visible files live (an Obsidian vault). */
    for (const [folder, file] of [[path.join(home, 'Library', 'CloudStorage', 'Dropbox', 'Work'), dropbox], [path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Work'), icloud], [path.join(home, 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents', 'Vault'), vault]]) {
      await withProject(folder, async () => {
        const r = await reply({ text: 'hi', file });
        assert.equal(r.json.kept, true, 'CONTROL: a project in ' + folder + ' attaches: ' + r.text);
      });
    }
  });
}));

test('#6726 r3-2: the legacy data root is Kosmos\'s data too', () => withLeo(async () => {
  const legacy = store.dataRootFor(process.platform, os.homedir(), process.env, store.LEGACY_APP);
  assert.ok(legacy.startsWith(SANDBOX + path.sep), 'the legacy root must be in the sandbox: ' + legacy);
  const old = write(path.join(legacy, 'tokens', 'leo.json'), '{}');
  await withProject(legacy, () => refused({ text: 'hi', file: old }, /a folder Kosmos keeps for itself or for its agents/));
}));

test('#6726 r3-3: a project that holds the home folder gives nothing, wherever the data and workers roots live', () => withLeo(async () => {
  const users = path.join(SANDBOX, 'users');
  const home = path.join(users, 'me');
  fs.mkdirSync(home, { recursive: true });
  assert.ok(!store.ROOT.startsWith(users) && !FILES.startsWith(users), 'the data and workers roots must be outside this home, or this arm proves nothing');
  const beside = write(path.join(users, 'shared.txt'), 'x');
  await withHome(home, () => withProject(users, () => refused({ text: 'hi', file: beside }, /whole home folder/)));
}));

/* Review r3 finding 4: the file now at the real path must be the one the descriptor holds. The second resolution
   (made through the seam, after the open) swaps a new file into that path and still answers the same path. */
test('#6726 r3-4: a file replaced at the same path after the open is refused', () => withLeo(async () => {
  const src = write(path.join(FILES, 'replaced.txt'), 'the one that was checked');
  const real = fs.realpathSync.native(src);
  let calls = 0;
  replyfile.setRealpathForTests((p) => {
    if (p === src && ++calls === 2) { fs.renameSync(real, real + '.moved'); fs.writeFileSync(real, 'a different file'); }
    return fs.realpathSync.native(p);
  });
  try {
    await refused({ text: 'hi', file: src }, /changed while it was being attached/);
    assert.equal(calls, 2);
  } finally {
    replyfile.setRealpathForTests(null);
  }
}));

/* Review r3 finding 5: outside a test process the seam refuses to turn on. Run in a child with no test markers. */
test('#6726 r3-5: setRealpathForTests throws outside a test process', () => {
  const probe = path.join(SANDBOX, 'seam-probe.js');
  fs.writeFileSync(probe, [
    "'use strict';",
    "const rf = require(" + JSON.stringify(path.join(__dirname, 'engine', 'replyfile.js')) + ");",
    "try { rf.setRealpathForTests(() => '/'); process.stdout.write('ARMED'); } catch (e) { process.stdout.write('REFUSED: ' + e.message); }",
  ].join('\n'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.KOSMOS_TEST_RUN;
  const out = execFileSync(process.execPath, [probe], { env, cwd: SANDBOX, encoding: 'utf8', timeout: 30000 });
  assert.match(out, /^REFUSED: setRealpathForTests is for tests only$/, out);
});

/* Review r4 finding 1: every rule compares by IDENTITY, not by spelling. On macOS realpathSync.native leaves
   /System/Volumes/Data/Users/<me> unchanged though it is /Users/<me> (a firmlink), and a sandbox cannot make a
   firmlink. So the alias here is a symlink, and BOTH resolvers (replyfile's realOf and projects.js's folder
   realpath) are set to leave a path under an alias as written, exactly as native realpath leaves a firmlink
   spelling. stat still follows the link to the real folder, so the alias and the canonical path have the same
   inode and differ only as strings: what this arm can see is whether a rule compared identities or spellings. */
async function withAliases(aliases, fn) {
  const made = [];
  for (const [alias, target] of aliases) { fs.symlinkSync(target, alias); made.push(alias); }
  const asWritten = (p) => (made.some((a) => p === a || p.startsWith(a + path.sep)) ? p : fs.realpathSync.native(p));
  replyfile.setRealpathForTests(asWritten);
  projects.setFsWorldForTests({ realpath: asWritten });
  try { await fn(); } finally {
    replyfile.setRealpathForTests(null);
    projects.setFsWorldForTests(null);
    for (const a of made) fs.unlinkSync(a);
  }
}

test('#6726 r4-1: a second spelling of home, the data root or an agent\'s folder reaches nothing the first cannot', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home5');
  write(path.join(home, 'Library', 'Keychains', 'login.keychain-db'), 'k');
  write(path.join(home, '.aws', 'credentials'), '[default]');
  write(path.join(home, 'work', 'plain.txt'), 'fine');
  write(path.join(store.ROOT, 'board.token'), 'not a real token');
  const maraDir = path.dirname(dmfiles.filesDir('mara'));
  write(path.join(maraDir, 'Files', 'hers-alias.txt'), 'mara');
  const A = path.join(SANDBOX, 'alias-home');
  const D = path.join(SANDBOX, 'alias-data');
  const M = path.join(SANDBOX, 'alias-mara');
  await withHome(home, () => withAliases([[A, home], [D, store.ROOT], [M, maraDir]], async () => {
    const ino = (p) => { const st = fs.statSync(p); return st.dev + ':' + st.ino; };
    assert.equal(ino(path.join(A, 'Library')), ino(path.join(home, 'Library')), 'the alias must be the same folder');
    assert.notEqual(path.join(A, 'Library'), path.join(home, 'Library'), 'and a different spelling, or this arm proves nothing');
    await withProject(path.join(A, 'Library', 'Keychains'), () => refused({ text: 'hi', file: path.join(A, 'Library', 'Keychains', 'login.keychain-db') }, /the Library folder, where apps keep their data/));
    await withProject(path.join(A, '.aws'), () => refused({ text: 'hi', file: path.join(A, '.aws', 'credentials') }, /hidden folder of the home folder/));
    await withProject(D, () => refused({ text: 'hi', file: path.join(D, 'board.token') }, /holds Kosmos's own data/));
    await withProject(M, () => refused({ text: 'hi', file: path.join(M, 'Files', 'hers-alias.txt') }, /a folder Kosmos keeps for itself or for its agents/));
    await withProject(path.join(A, 'work'), async () => {
      const r = await reply({ text: 'hi', file: path.join(A, 'work', 'plain.txt') });
      assert.equal(r.json.kept, true, 'CONTROL: an ordinary file through the same alias attaches: ' + r.text);
    });
  }));
}));

/* Review r4 finding 3: a connected agent's recorded folder is its own working folder, often a person's project.
   Only what Kosmos writes there (Files, Inbox, the brief file) is kept from the other agents. */
test('#6726 r4-3: a connected agent working in a project keeps only its Files, Inbox and brief there', () => withLeo(async () => {
  const app = path.join(SANDBOX, 'connected-app');
  fs.mkdirSync(path.join(app, 'Files'), { recursive: true });
  const had = store.readProfile('mara');
  store.writeProfile('mara', { dir: app });
  try {
    assert.equal(dmfiles.filesDir('mara'), path.join(app, 'Files'), 'the recorded folder was not followed, so this arm proves nothing');
    const brief = require('./engine/instructions').fileFor('mara');
    assert.equal(path.dirname(brief), app);
    write(brief, '# mara');
    const code = write(path.join(app, 'src', 'main.js'), 'console.log(1)');
    const hers = write(path.join(app, 'Files', 'hers.txt'), 'mara');
    const inbox = write(path.join(app, 'Inbox', 'long-message.txt'), 'private');
    /* Review r5 finding 2: everything else Kosmos writes there: the launch log, the brief's backup, and the other
       runners' brief names (a runner switch leaves the old one behind). */
    const others = ['start.log', path.basename(brief) + '.previous', 'AGENTS.md', 'AGENTS.md.previous', 'GEMINI.md', 'CLAUDE.md.previous']
      .filter((n) => n !== path.basename(brief)).map((n) => write(path.join(app, n), 'kosmos wrote this'));
    await withProject(app, async () => {
      const r = await reply({ text: 'hi', file: code });
      assert.equal(r.json.kept, true, 'an ordinary file of the project mara works in must attach for leo: ' + r.text);
      await refused({ text: 'hi', file: hers }, /a folder Kosmos keeps for itself or for its agents/);
      await refused({ text: 'hi', file: inbox }, /a folder Kosmos keeps for itself or for its agents/);
      await refused({ text: 'hi', file: brief }, /a folder Kosmos keeps for itself or for its agents/);
      for (const f of others) await refused({ text: 'hi', file: f }, /a folder Kosmos keeps for itself or for its agents/);
    });
  } finally {
    store.writeProfile('mara', { dir: had && had.dir ? had.dir : undefined });
  }
}));

/* With identity doing the containment, the on-disk spelling (realpathSync.native) still decides the NAME the card
   shows: a file typed in another case is stored under the case it has on disk. */
test('#6726 r4-1: a file typed in another case is stored under its name as it is on disk', () => withLeo(async () => {
  write(path.join(FILES, 'cased-name.txt'), 'x');
  const r = await reply({ text: 'hi', file: path.join(FILES, 'CASED-NAME.TXT') });
  assert.equal(r.json.kept, true, r.text);
  assert.equal(rows().at(-1).attachments[0].name, 'cased-name.txt');
}));

/* Review r5 finding 1: home reached through a second spelling of a folder ABOVE it. The ancestor sets walk home's
   canonical spelling, so a folder that holds home only through another spelling (as /System/Volumes/Data holds
   /Users/<me> through a firmlink) is not among them. Here home is spelled through a link (sys6/Users -> vol6/Users),
   and the project is at vol6, which holds home by identity and is not among the ancestors of home's spelling. */
test('#6726 r5-1: a project at a folder that holds home through another spelling gives nothing', () => withLeo(async () => {
  const vol = path.join(SANDBOX, 'vol6');
  const sys = path.join(SANDBOX, 'sys6');
  fs.mkdirSync(path.join(vol, 'Users', 'me'), { recursive: true });
  fs.mkdirSync(sys, { recursive: true });
  fs.symlinkSync(path.join(vol, 'Users'), path.join(sys, 'Users'));
  const home = path.join(sys, 'Users', 'me');
  const plan = write(path.join(vol, 'Users', 'me', 'Documents', 'plan.txt'), 'private');
  const id = (p) => { const st = fs.statSync(p); return st.dev + ':' + st.ino; };
  const spelledAbove = [];
  for (let cur = home; ; cur = path.dirname(cur)) { spelledAbove.push(id(cur)); if (path.dirname(cur) === cur) break; }
  assert.ok(!spelledAbove.includes(id(vol)), 'vol6 must not be an ancestor of home\'s spelling, or this arm proves nothing');
  assert.equal(id(home), id(path.join(vol, 'Users', 'me')), 'and home must be the same folder under both spellings');
  await withHome(home, () => withProject(vol, () => refused({ text: 'hi', file: plan }, /whole home folder/)));
}));

/* Review r5 finding 3: the kept set is computed once per attach: one instructions.fileFor per agent, plus the
   sender's Files folder. Counted around replyfile.attach alone (the route's own later reads, such as the setup
   guide's folder check in keepAgentReply, are not the attach's). The roster is the fleet's (leo and mara); nothing
   is created in the sandbox's launch folder. */
test('#6726 r5-3: one attach reads each agent\'s instructions path once', () => withLeo(async (board) => {
  /* #7232: keptRoots reads each agent's folder through create.workerDir, not instructions.fileFor (which also read the
     launch job for a brief name keptRoots never used), so both are counted: fileFor once for the sender's Files, and a
     workerDir of its own (outside fileFor) once per agent. */
  const instructions = require('./engine/instructions');
  const create = require('./engine/create');
  const src = write(path.join(PROJ, 'cuts', 'count.txt'), 'x');
  const real = instructions.fileFor;
  const realDir = create.workerDir;
  let calls = 0;
  let inFileFor = 0;
  let dirs = 0;
  instructions.fileFor = (...a) => { calls += 1; inFileFor += 1; try { return real(...a); } finally { inFileFor -= 1; } };
  create.workerDir = (...a) => { if (!inFileFor) dirs += 1; return realDir(...a); };
  let got;
  try { got = replyfile.attach(WHO, src, { roster: board.roster }); } finally { instructions.fileFor = real; create.workerDir = realDir; }
  assert.equal(got.ok, true, JSON.stringify(got));
  replyfile.discard(got.rec);
  assert.ok(dirs >= 2, 'the agents were not read at all, so this arm proves nothing: ' + dirs);
  assert.ok(calls + dirs <= 3, 'one attach read the agents\' folders ' + (calls + dirs) + ' times for two agents (one each, plus the sender\'s Files)');
}));

/* Review r5 finding 4: a container's Documents opens only to a project inside that container. */
test('#6726 r5-4: a project at Mobile Documents itself opens no app\'s Documents; a vault project inside its container still does', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home7');
  const md = path.join(home, 'Library', 'Mobile Documents');
  const idea = write(path.join(md, 'iCloud~md~obsidian', 'Documents', 'Vault', 'idea.md'), 'v');
  await withHome(home, async () => {
    await withProject(md, () => refused({ text: 'hi', file: idea }, /the Library folder, where apps keep their data/));
    await withProject(path.join(md, 'iCloud~md~obsidian'), async () => {
      const r = await reply({ text: 'hi', file: idea });
      assert.equal(r.json.kept, true, 'CONTROL: a project at the container itself opens its Documents: ' + r.text);
    });
  });
}));

/* Review r5 finding 5: a hidden name in the path as GIVEN is refused even when the real folder is not hidden
   (~/.aws as a link into a dotfiles folder). The control pins the gap the plan records: the same file by its real,
   non-hidden path, from a project at the dotfiles folder, attaches, because no name there says secret. */
test('#6726 r5-5: ~/.aws as a link into a non-hidden folder is refused by the name it was reached through', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home8');
  const creds = write(path.join(home, 'dotfiles', 'aws', 'credentials'), '[default]');
  fs.symlinkSync(path.join(home, 'dotfiles', 'aws'), path.join(home, '.aws'));
  await withHome(home, () => withProject(path.join(home, 'dotfiles'), async () => {
    await refused({ text: 'hi', file: path.join(home, '.aws', 'credentials') }, /hidden folder of the home folder/);
    const r = await reply({ text: 'hi', file: creds });
    assert.equal(r.json.kept, true, 'the recorded gap: by its real non-hidden path the same file attaches: ' + r.text);
  }));
}));

/* #7226: rule 1 found home by spelling, so the same home spelled another way skipped it and ~/.aws (a link into a
   project folder) attached. Two other spellings: a different case (a case-insensitive volume, as a Mac's is by default),
   and home reached through a link. Each with its controls: the correct spelling refused, the real path attached. */
test('#7226: ~/.aws reached with home spelled in another case is refused (case-insensitive volume)', (t) => withLeo(async () => {
  const home = path.join(SANDBOX, 'home11');
  const creds = write(path.join(home, 'dotfiles', 'aws', 'credentials'), '[default]');
  fs.symlinkSync(path.join(home, 'dotfiles', 'aws'), path.join(home, '.aws'));
  const other = path.join(SANDBOX, 'HOME11');
  if (!fs.existsSync(other)) { t.skip('this volume tells HOME11 from home11, so there is no other case to spell'); return; }
  await withHome(home, () => withProject(path.join(home, 'dotfiles'), async () => {
    await refused({ text: 'hi', file: path.join(other, '.aws', 'credentials') }, /hidden folder of the home folder/);
    await refused({ text: 'hi', file: path.join(home, '.aws', 'credentials') }, /hidden folder of the home folder/);   // CONTROL
    const r = await reply({ text: 'hi', file: creds });
    assert.equal(r.json.kept, true, 'CONTROL: the real non-hidden path still attaches: ' + r.text);
  }));
}));

test('#7226: ~/.aws reached through a link to home is refused', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home12');
  const creds = write(path.join(home, 'dotfiles', 'aws', 'credentials'), '[default]');
  fs.symlinkSync(path.join(home, 'dotfiles', 'aws'), path.join(home, '.aws'));
  const via = path.join(SANDBOX, 'via12');
  fs.symlinkSync(home, via);
  await withHome(home, () => withProject(path.join(home, 'dotfiles'), async () => {
    await refused({ text: 'hi', file: path.join(via, '.aws', 'credentials') }, /hidden folder of the home folder/);
    // CONTROL: a non-hidden file through the same link attaches, so the link itself is not what is refused.
    const r = await reply({ text: 'hi', file: path.join(via, 'dotfiles', 'aws', 'credentials') });
    assert.equal(r.json.kept, true, 'CONTROL: the same link to a non-hidden name attaches: ' + r.text);
    assert.equal(fs.realpathSync(path.join(via, '.aws', 'credentials')), fs.realpathSync(creds), 'the refused path is the same file');
  }));
}));

/* Review r6 finding 1: a "volume root" (as /System/Volumes/Data) holds home without being an ancestor of home's
   spelling, and holds files OUTSIDE home too (Users/Shared, private/etc), which the file's own chain never shows.
   Stand-in: home is spelled through sys9/Users, a link to vol9/Users; vol9 is the volume root. */
test('#6726 r6-1: a project at a volume root that holds home through another spelling gives nothing, outside home too', () => withLeo(async () => {
  const vol = path.join(SANDBOX, 'vol9');
  const sys = path.join(SANDBOX, 'sys9');
  fs.mkdirSync(path.join(vol, 'Users', 'me'), { recursive: true });
  fs.mkdirSync(sys, { recursive: true });
  fs.symlinkSync(path.join(vol, 'Users'), path.join(sys, 'Users'));
  const home = path.join(sys, 'Users', 'me');
  const shared = write(path.join(vol, 'Users', 'Shared', 'everyone.txt'), 'not home');
  const etc = write(path.join(vol, 'private', 'etc', 'hosts'), '127.0.0.1');
  const id = (p) => { const st = fs.statSync(p); return st.dev + ':' + st.ino; };
  const spelledAbove = [];
  for (let cur = home; ; cur = path.dirname(cur)) { spelledAbove.push(id(cur)); if (path.dirname(cur) === cur) break; }
  assert.ok(!spelledAbove.includes(id(vol)), 'the volume root must not be an ancestor of home\'s spelling, or this arm proves nothing');
  await withHome(home, () => withProject(vol, async () => {
    await refused({ text: 'hi', file: shared }, /whole home folder/);
    await refused({ text: 'hi', file: etc }, /whole home folder/);
  }));
}));

/* Review r6 finding 2: an agent's own Files folder under a dot folder (some runners keep their agents there) is the
   Files rule's, not a project's, so no hidden-name rule refuses it. A project file there is still refused. */
test('#6726 r6-2: an agent\'s own Files under a dot folder attaches; a project file under a dot folder does not', () => withLeo(async () => {
  const home = path.join(SANDBOX, 'home10');
  const own = path.join(home, '.runner', 'agents', 'leo');
  fs.mkdirSync(path.join(own, 'Files'), { recursive: true });
  const mine = write(path.join(own, 'Files', 'deck.pdf'), 'leo made this');
  const had = store.readProfile(WHO);
  store.writeProfile(WHO, { dir: own });
  try {
    assert.equal(dmfiles.filesDir(WHO), path.join(own, 'Files'), 'the recorded folder was not followed, so this arm proves nothing');
    await withHome(home, async () => {
      const r = await reply({ text: 'hi', file: mine });
      assert.equal(r.json.kept, true, 'an agent\'s own Files under a dot folder must attach: ' + r.text);
      const projFile = write(path.join(home, '.runner', 'shared', 'notes.txt'), 'x');
      await withProject(path.join(home, '.runner', 'shared'), () => refused({ text: 'hi', file: projFile }, /hidden folder of the home folder/));
    });
  } finally {
    store.writeProfile(WHO, { dir: had && had.dir ? had.dir : undefined });
  }
}));

/* Review r6 finding 5: the boot read skips a record folder last changed more than a day ago without parsing it. */
test('#6726 r6-5: a record folder older than a day is not read by the seed', () => withLeo(async () => {
  replyfile.seed();
  const before = replyfile.sentToday(WHO);
  const rid = require('node:crypto').randomBytes(12).toString('hex');
  const dir = path.join(agentStore(), rid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({ id: rid, name: 'x', size: 777, at: new Date().toISOString(), scope: 'agent', owner: WHO, by: 'agent' }));
  try {
    replyfile.seed();
    assert.equal(replyfile.sentToday(WHO), before + 777, 'CONTROL: a fresh folder is read');
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(dir, old, old);
    replyfile.seed();
    assert.equal(replyfile.sentToday(WHO), before, 'a folder last changed two days ago was parsed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    replyfile.seed();
  }
}));

/* Review r7 finding 1: a file that shrinks after the open (here, as the seam's second resolution runs, which is after
   the fstat and before the read) is refused, never sent cut. */
test('#6726 r7-1: a file that shrinks between the check and the read is refused', () => withLeo(async () => {
  const src = write(path.join(FILES, 'shrinks.txt'), 'x'.repeat(4096));
  let calls = 0;
  replyfile.setRealpathForTests((p) => {
    if (p === src && ++calls === 2) fs.truncateSync(src, 10);
    return fs.realpathSync.native(p);
  });
  try {
    await refused({ text: 'hi', file: src }, /changed while it was being attached/);
    assert.equal(calls, 2, 'the shrink never ran, so this arm proves nothing');
  } finally {
    replyfile.setRealpathForTests(null);
  }
}));

/* Review r7 finding 2: two projects on one folder, one listing leo and one not. Either order in projects.json, the
   file attaches: the agent is on the folder if any project there lists it. */
test('#6726 r7-2: two projects on one folder: the file attaches whichever is listed first', () => withLeo(async () => {
  const shared = path.join(SANDBOX, 'shared-folder');
  const src = write(path.join(shared, 'both.txt'), 'x');
  const kept = projects.readAll();
  const ours = { id: 'ours-6726', name: 'Ours', folder: shared, agents: [WHO], createdAt: new Date().toISOString() };
  const theirs = { id: 'theirs-6726', name: 'Theirs', folder: shared, agents: ['mara'], createdAt: new Date().toISOString() };
  try {
    for (const order of [[ours, theirs], [theirs, ours]]) {
      projects.writeAll([...kept, ...order]);
      const r = await reply({ text: 'hi', file: src });
      assert.equal(r.json.kept, true, 'order ' + order.map((p) => p.id).join(', ') + ': ' + r.text);
    }
  } finally {
    projects.writeAll(kept);
  }
}));

/* #6734 review 13: a system error while storing a reply copy (here the final rename, as on a full disk) reaches the
   agent as a sentence, never as the raw error, which carries a path with the user's name. */
test('#6734: a system error storing a reply copy is a sentence with no path in it', () => withLeo(async (board) => {
  const src = write(path.join(PROJ, 'cuts', 'rename-fails.txt'), 'x');
  const attachments = require('./engine/attachments');
  const real = fs.renameSync;
  let thrown = 0;
  fs.renameSync = function (from) {
    if (String(from).endsWith(attachments.PART)) {
      thrown += 1;
      throw Object.assign(new Error("ENOSPC: no space left on device, rename '" + from + "'"), { code: 'ENOSPC' });
    }
    return real.apply(this, arguments);
  };
  let got;
  try { got = replyfile.attach(WHO, src, { roster: board.roster }); } finally { fs.renameSync = real; }
  assert.ok(thrown > 0, 'the rename was never reached, so this tested nothing');
  assert.deepEqual(got, { ok: false, because: 'that file could not be kept' });
}));
