'use strict';
/**
 * kosmos#5995 item 3: two comments said ping.installId() "is promised never to leave the Mac" while two modules sent
 * it. Anyone reasoning about privacy from the comments got it wrong. engine/ping.js now lists where the id goes, and
 * this holds that list to the source:
 *   - the tracked files that hold the exact identifier `installId` are exactly a listed set (in code or in a comment:
 *     any new one is the moment to decide where the id may go, and no parsing of comments is needed to see it);
 *   - the same for the copy kept in an agent's profile (`idInstall`), and for the files that load engine/ping.js;
 *   - the two that send it put THIS install's id in what they send (run, not read);
 *   - in the two modules that talk to a coordinator and to the community, every mention is a comment;
 *   - in the files that hold the identifier, no sentence about it uses one of the listed "it never leaves" wordings;
 *   - engine/ping.js's own list names every engine file that uses the id.
 * What it does not hold: a value handed on by one of the listed files under another name; a read of the id's file
 * that neither loads engine/ping.js nor uses the identifier; a "never leaves" wording that is not on the list, or one
 * in a file that does not hold the identifier, or outside a comment; prose that says "install id" in two words.
 *
 *   node --test engine/installid-senders-5995.test.js
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-installid-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* Every file git tracks, whatever its kind or folder (a Swift file, a script with no extension, a hook), bar tests,
   docs, plans, test fixtures and files that are not text. Asked of git so no folder can be forgotten. */
const NOT_SOURCE = /(\.test\.(js|mjs)$|^docs\/|^\.claude\/|^test-support\/|(^|\/)node_modules\/)/;
const NOT_TEXT = /\.(png|jpe?g|gif|icns|ico|woff2?|ttf|otf|zip|gz|tgz|pdf|mp3|mp4|mov|webp|car|nib|bin|dmg|pkg|exe|dll)$/i;
function tracked() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((f) => f && !NOT_SOURCE.test(f) && !NOT_TEXT.test(f)).sort();
}
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const FILES = tracked();
const holding = (re) => FILES.filter((f) => re.test(read(f)));

/* The exact identifier, however it is reached: a call, a property, a destructure, a comment. Case matters: it is the
   name every reader of the id has to write at least once. */
const ID = /installId/;
/* The profile's copy. A word of its own, so `midInstall` (server.js, about an install in progress) is not one. */
const PROFILE_COPY = /\bidInstall\b/;
/* Loading the module that keeps the id, or naming its file through it. */
const LOADS_PING = /require\(\s*['"]\.\/(engine\/)?ping['"]\s*\)|\bping\.FILE\b/;

/* `listed`: engine/ping.js's "Where it goes" list must have a line for it. */
const HOLD_ID = Object.freeze({
  'engine/communitysend.js': { what: 'a comment: the community is given its own id, never this one', listed: false },
  'engine/createdbeacon.js': { what: 'sends it to the install endpoint, on a board start and when an agent is made', listed: true },
  'engine/feedback.js': { what: 'writes it into the daily report file on this computer', listed: true },
  'engine/feedbacksend.js': { what: 'sends it with the daily feedback report', listed: true },
  'engine/phonenotify.js': { what: 'a comment, and a field of that name that carries the notifier\'s own id', listed: false },
  'engine/ping.js': { what: 'makes it, keeps it in ping.json, and lists where it goes', listed: false },
  'engine/store.js': { what: 'keeps it in each agent\'s profile as idInstall', listed: true },
  'tools/test-install.sh': { what: 'a comment about the file the id is kept in', listed: false },
});
const HOLD_PROFILE_COPY = Object.freeze({
  'engine/agentfile.js': 'a comment: an exported agent file does not carry it',
  'engine/ping.js': 'the list of where the install id goes names it',
  'engine/store.js': 'writes it, and compares it to tell a profile copied from another install',
  'tools/capture-agent-card.js': 'blanks it when a card is captured as a fixture',
});
const LOAD_PING = Object.freeze({
  'engine/createdbeacon.js': 'reads the id to send it',
  'engine/feedback.js': 'reads the id to write it into the report',
  'engine/feedbacksend.js': 'reads the id to send it',
  'engine/store.js': 'reads the id to keep it in a profile',
  'engine/updating.js': 'asks whether it is under test; does not read the id',
});

test('fixture: git lists the files, of every kind and folder, and not tests, docs or fixtures', () => {
  for (const f of ['engine/ping.js', 'server.js', 'web/index.html', 'install/kosmos', 'tools/windows/kosmos-cli.js', 'tools/test-install.sh', 'native-app/main.swift', 'install/pkg-scripts/postinstall']) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;   // a file that is gone is not this test's subject
    assert.ok(FILES.includes(f), 'the scan does not read ' + f);
  }
  assert.ok(FILES.length > 500, 'git listed only ' + FILES.length + ' files');
  assert.ok(!FILES.some((f) => NOT_SOURCE.test(f)), 'the scan reads a test, a doc, a plan or a fixture');
});

test('#5995: the tracked files that hold the identifier installId are exactly the ones listed here', () => {
  assert.deepEqual(holding(ID), Object.keys(HOLD_ID).sort(),
    'a file holds installId and is not listed (or a listed one no longer does). Decide where the id may go, list it here and in engine/ping.js');
});

test('#5995: the tracked files that hold the profile\'s copy (idInstall) are exactly the ones listed here', () => {
  assert.deepEqual(holding(PROFILE_COPY), Object.keys(HOLD_PROFILE_COPY).sort(), 'a file holds idInstall and is not listed (or a listed one no longer does)');
  assert.ok(/midInstall/.test(read('server.js')) && !PROFILE_COPY.test(read('server.js')), 'CONTROL: server.js\'s midInstall is a different word, and the pattern must not count it');
});

test('#5995: the tracked files that load engine/ping.js are exactly the ones listed here', () => {
  assert.deepEqual(holding(LOADS_PING), Object.keys(LOAD_PING).sort(), 'a file loads engine/ping.js and is not listed (or a listed one no longer does)');
  assert.ok(/ping\.json\(\)/.test(read('web/index.html')) && !LOADS_PING.test(read('web/index.html')), 'CONTROL: the page\'s `ping.json()` is a fetch answer, and the pattern must not count it');
});

test('#5995: the created beacon and the feedback send each carry THIS install\'s id in what they send', () => {
  const ping = require('./ping');
  assert.ok(ping.FILE.startsWith(SANDBOX + path.sep), 'fixture: the id file is not in this test\'s sandbox: ' + ping.FILE);
  const mine = ping.installId();
  assert.match(mine, /^[0-9a-f-]{16,}$/i, 'fixture: no install id was made');
  const beacon = require('./createdbeacon');
  assert.equal(typeof beacon.payload, 'function', 'createdbeacon no longer exports payload; this test reads what it sends through it');
  assert.equal(beacon.payload(0).installId, mine, 'the created beacon\'s payload does not carry this install\'s id');
  const feedback = require('./feedback');
  const feedbacksend = require('./feedbacksend');
  const day = feedback.today();
  feedback.write('A report written by a test, so there is one to send.', { from: 'installid-test', date: day });
  const sent = feedbacksend.payload(day);
  assert.ok(sent, 'fixture: there is no payload for the report this test just wrote');
  assert.equal(sent.install, mine, 'the feedback send\'s payload does not carry this install\'s id');
  assert.match(fs.readFileSync(feedback.pathFor(day), 'utf8'), new RegExp('^install: ' + mine + '$', 'm'), 'the report file does not carry this install\'s id');
});

test('#5995: where a coordinator or the community is talked to, every mention of the identifier is a comment', () => {
  /* phonenotify sends a field NAMED installId whose value is its own notifyId (the coordinator's field name). That one
     line is code and is allowed, and it is held to be exactly that. */
  const KEY_WITH_OWN_ID = /^\s*installId:\s*notifyId,\s*$/;
  const COMMENT_LINE = /^\s*(\/\*\*?|\*|\/\/)/;   // a line inside or opening a block comment, or a line comment
  for (const f of ['engine/phonenotify.js', 'engine/communitysend.js']) {
    const lines = read(f).split('\n').map((text, i) => ({ text, n: i + 1 })).filter((l) => ID.test(l.text));
    assert.ok(lines.length > 0, 'fixture: ' + f + ' no longer holds the identifier; take it off this test and off the list');
    for (const l of lines) {
      if (f === 'engine/phonenotify.js' && KEY_WITH_OWN_ID.test(l.text)) continue;
      assert.match(l.text, COMMENT_LINE, f + ':' + l.n + ' holds the identifier outside a comment: ' + l.text.trim());
    }
  }
  assert.equal(read('engine/phonenotify.js').split('\n').filter((t) => KEY_WITH_OWN_ID.test(t)).length, 1, 'phonenotify.js no longer has exactly one `installId: notifyId,` line; read what it sends under that name now');
});

/* Wordings for "it never leaves". A list, so it is narrower than the idea, and it is applied only to sentences about
   the id in the files that hold the identifier. */
const NEVER_LEAVES = [
  /promised never/i,
  /never (to )?leaves?\b/i,
  /(does not|doesn't|will not|won't|cannot|can't) leave\b/i,
  /never (sent|shared)\b/i,
  /not (sent|shared) (off|with|to|anywhere)/i,
  /stays (local|on (this|the) (mac|computer|machine))/i,
  /\blocal-only\b/i,
  /\bon (this|the) (mac|computer|machine) only\b/i,
];
const ABOUT_ID = /\binstall[ -]?id\b|\binstallId\b/i;   // a word of its own: "install identity" and "uninstall idle" are not it
/* Only what is written in comments: the lines that open or continue a comment, their leader taken off and joined, so
   a sentence wrapped over comment lines is one sentence and code is never read as prose. */
const prose = (text) => text.split('\n').map((l) => { const m = /^\s*(?:\/\*\*?|\*\/?|\/\/|#)(.*)$/.exec(l); return m ? m[1].trim() : null; }).filter((l) => l !== null).join(' ');
/* The sentences that are about the id, or that follow one that is and begin with "It" (for "It never leaves"). */
function claims(text) {
  const s = prose(text).replace(/\b(e\.g|i\.e|etc)\.\s/gi, '$1 ').split(/(?<=[.!?])\s+/);
  const out = [];
  s.forEach((x, i) => { if (ABOUT_ID.test(x) || (i > 0 && ABOUT_ID.test(s[i - 1]) && /^(it|that one|this one)\b/i.test(x))) out.push(x); });
  return out;
}
const promising = (text) => claims(text).filter((x) => NEVER_LEAVES.some((re) => re.test(x)));

test('#5995: in the files that hold the identifier, no sentence about the id uses a listed "it never leaves" wording', () => {
  const making = Object.keys(HOLD_ID).map((f) => [f, promising(read(f))]).filter(([, hits]) => hits.length);
  assert.deepEqual(making, [], 'these sentences say the install id does not leave; createdbeacon.js and feedbacksend.js send it');
});

const asComment = (said) => said.split('\n').map((l) => (/^\s*(\*|\/\/|\/\*|#)/.test(l) ? l : ' * ' + l)).join('\n');

test('#5995 CONTROL: the two sentences this card was filed for, and other ways of saying it, are caught; true ones are not', () => {
  for (const said of [
    ' * to, only after a person asks, and with its own random id (`notifyId`), never\n * ping.installId(), which is promised never to leave the Mac.',
    ' * ping.installId() (phonenotify promises that one never leaves the Mac) and nothing derived from the machine.',
    'The install id is never sent anywhere.',
    'installId is not sent off this computer.',
    '// installId stays local.',
    'The install id is kept in ping.json. It never leaves the Mac.',
    'installId is not shared with anyone.',
    'The install-id never leaves the Mac.',
    'The install id doesn\'t leave the Mac.',
    'The install id will not leave this Mac.',
    'installId is local-only.',
    'The install id is kept on this computer only.',
    'The install id, e.g. a uuid, is random. It never leaves the Mac.',
  ]) assert.equal(promising(asComment(said)).length > 0, true, 'not caught: ' + said);
  for (const said of [
    'A message never leaves the Mac. The install id is sent with the daily report.',
    'never ping.installId() (engine/ping.js lists where that one goes, and a coordinator is not on the list).',
    'It stays on the Mac. Nothing here is about ids.',
    'The installId is sent with the daily report. It is random, and that one fact never changes.',
    'A notifier has its own id. It never leaves the coordinator it was made for.',
    'The install identity key (mac_key) never leaves the Mac.',
    'After an uninstall idle agents stop, and the board token is never sent anywhere.',
  ]) assert.deepEqual(promising(asComment(said)), [], 'a true sentence was caught: ' + said);
  assert.deepEqual(promising('const installId = neverLeaves(); // unrelated\nif (x) { it.never.leaves(); }'), [], 'code was read as prose');
});

test('#5995: engine/ping.js\'s own list of where the id goes has a line for each engine file that uses it, and for its own file', () => {
  const header = read('engine/ping.js').split('*/')[0];
  const i = header.indexOf('Where it goes');
  assert.ok(i > 0, 'engine/ping.js no longer has its "Where it goes" list');
  const named = [...header.slice(i).matchAll(/^ \*\s+(engine\/[a-z0-9-]+\.js|ping\.json)\s{2,}\S/gm)].map((m) => m[1]).sort();
  const want = [...Object.keys(HOLD_ID).filter((f) => HOLD_ID[f].listed), 'ping.json'].sort();
  assert.deepEqual(named, want, 'engine/ping.js\'s list and the files that use the install id differ');
});
