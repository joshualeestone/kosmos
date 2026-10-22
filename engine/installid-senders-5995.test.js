'use strict';
/**
 * kosmos#5995 item 3: two comments said ping.installId() "is promised never to leave the Mac" while two modules sent
 * it. Anyone reasoning about privacy from the comments got it wrong. engine/ping.js now lists where the id goes, and
 * this holds that list to the source:
 *   - the files git tracks or would track that hold the exact identifier `installId` are exactly a listed set (in
 *     code or in a comment: any new one is the moment to decide where the id may go);
 *   - the same for the copy kept in an agent's profile (`idInstall`), for the files that load engine/ping.js under any
 *     path, and for the files that name the id's own file, ping.json;
 *   - the two that send it put THIS install's id in what they send (run, not read);
 *   - in the two modules that talk to a coordinator and to the community, every mention is a comment;
 *   - engine/ping.js's own list has a line for every engine file that uses the id.
 * What it does not hold: a value handed on by one of the listed files under another name, and what any comment SAYS.
 * The largest case of the first: a profile carries `idInstall`, so whatever passes a whole profile on passes the id
 * on without naming it, and no set here sees that. That is how the id used to reach every agent's card. engine/store.js
 * now hands a profile on without the key, and engine/status.cardnoinstallid-5995.test.js holds that on the served card;
 * a copy carried under another name would still be seen by neither.
 * A check of wording was tried and taken out: a list of ways to say "it never leaves" missed real ones and flagged
 * true ones ("is never sent to the community"). The comments were reduced to pointers at engine/ping.js instead.
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

/* Every file git tracks, and every new file it would track (not yet added, not ignored), whatever its kind or folder
   (a Swift file, a script with no extension, a hook, a browser check under docs/), bar tests, the prose under docs/
   and .claude/ (.md), the data folders a test board makes at the top of the repo (.aw-*), test support and files that
   are not text. Asked of git so no folder can be forgotten; like the
   repo's other sweeps, it needs a checkout to run in. */
const NOT_SOURCE = /(\.test\.(js|mjs)$|^(docs|\.claude)\/.*\.md$|^\.aw-|^test-support\/|(^|\/)node_modules\/)/;
const NOT_TEXT = /\.(png|jpe?g|gif|icns|ico|woff2?|ttf|otf|zip|gz|tgz|pdf|mp3|mp4|mov|webp|car|nib|bin|dmg|pkg|exe|dll)$/i;
function tracked() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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
/* Naming the module that keeps the id: any quoted word that is `ping` or `ping.js`, alone or at the end of a path,
   or its file through it. A quoted word, not a call, so a path put together from parts (path.join(..., 'ping')) is
   seen too; the price is two files that use the word for something else, listed below with what it is there. A name
   built from pieces of the word is not seen. */
const LOADS_PING = /[`'"]([^`'"]*\/)?ping(\.js)?[`'"]|\bping\.FILE\b/;
/* The id's own file, by name. `ping.json(` is a fetch answer on the page, not the file. */
const ID_FILE = /ping\.json(?!\()/;

/* `listed`: engine/ping.js's "Where it goes" list must have a line for it. The descriptions are for the reader:
   nothing checks them. */
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
  'docs/browser-checks/render-talk.js': 'a comment about the capture that blanks it',
  'engine/agentfile.js': 'a comment: an exported agent file does not carry it',
  'engine/ping.js': 'the list of where the install id goes names it',
  'engine/store.js': 'writes it, and compares it to tell a profile copied from another install',
  'tools/capture-agent-card.js': 'blanks it when a card is captured as a fixture',
});
const NAME_ID_FILE = Object.freeze({
  'engine/ping.js': 'keeps the id there',
  'install/setup.sh': 'a comment: the files an uninstall leaves in place',
  'tools/test-install.sh': 'a comment about what a test install writes',
});
const LOAD_PING = Object.freeze({
  'engine/createdbeacon.js': 'reads the id to send it',
  'engine/feedback.js': 'reads the id to write it into the report',
  'engine/feedbacksend.js': 'reads the id to send it',
  'engine/guidestate.js': 'a comment about an injected function of that name; does not load the module',
  'engine/store.js': 'reads the id to keep it in a profile',
  'engine/updating.js': 'asks whether it is under test; does not read the id',
  'engine/usage.js': 'kosmos#6829: asks when the install began (installedAt); does not read the id',
  'engine/win32channel.js': 'a message type of that name; does not load the module',
});

test('fixture: git lists the files, of every kind and folder, and not tests or prose', () => {
  for (const f of ['engine/ping.js', 'server.js', 'web/index.html', 'install/kosmos', 'tools/windows/kosmos-cli.js', 'tools/test-install.sh', 'native-app/main.swift', 'install/pkg-scripts/postinstall', 'docs/browser-checks/render-talk.js']) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;   // a file that is gone is not this test's subject
    assert.ok(FILES.includes(f), 'the scan does not read ' + f);
  }
  assert.ok(FILES.length > 500, 'git listed only ' + FILES.length + ' files');
  assert.ok(!FILES.some((f) => NOT_SOURCE.test(f)), 'the scan reads a test, a prose file or test support');
});

test('#5995: the files git tracks or would track that hold the identifier installId are exactly the ones listed here', () => {
  assert.deepEqual(holding(ID), Object.keys(HOLD_ID).sort(),
    'a file holds installId and is not listed (or a listed one no longer does; a scratch file not yet added to git counts). Decide where the id may go, list it here and in engine/ping.js');
});

test('#5995: the files that hold the profile\'s copy (idInstall) are exactly the ones listed here', () => {
  assert.deepEqual(holding(PROFILE_COPY), Object.keys(HOLD_PROFILE_COPY).sort(), 'a file holds idInstall and is not listed (or a listed one no longer does)');
  assert.ok(/midInstall/.test(read('server.js')) && !PROFILE_COPY.test(read('server.js')), 'CONTROL: server.js\'s midInstall is a different word, and the pattern must not count it');
});

test('#5995: the files that name engine/ping.js in a quoted word are exactly the ones listed here', () => {
  assert.deepEqual(holding(LOADS_PING), Object.keys(LOAD_PING).sort(), 'a file names engine/ping.js and is not listed (or a listed one no longer does)');
  for (const line of ["require('./ping')", "require('./engine/ping')", "require('../engine/ping')", "require('../../engine/ping.js')", 'require(`./ping`)', "import ping from '../engine/ping.js'", "await import('./ping')", 'fs.readFileSync(ping.FILE)', "require(path.join(__dirname, '..', 'engine', 'ping'))", "require.resolve('./ping')", "import './ping.js'", "require('./engine/' + 'ping')"]) {
    assert.match(line, LOADS_PING, 'CONTROL: this way of loading it is not seen: ' + line);
  }
  for (const line of ["require('./pinger')", "require('./shipping')", "require('./ping-pong')", 'const ping = await fetch(url)']) assert.doesNotMatch(line, LOADS_PING, 'CONTROL: this is not loading it: ' + line);
  // kosmos#6829: usage.js is listed for installedAt only; it must not reach the id itself.
  assert.match(read('engine/usage.js'), /\.installedAt\(\)/, 'CONTROL: usage.js reads installedAt');
  assert.doesNotMatch(read('engine/usage.js'), /installId/, 'engine/usage.js names the install id; only installedAt is allowed there');
});

test('#5995: the files that name the id\'s own file, ping.json, are exactly the ones listed here', () => {
  assert.deepEqual(holding(ID_FILE), Object.keys(NAME_ID_FILE).sort(), 'a file names ping.json and is not listed (or a listed one no longer does)');
  assert.ok(/ping\.json\(\)/.test(read('web/index.html')) && !ID_FILE.test(read('web/index.html')), 'CONTROL: the page\'s `ping.json()` is a fetch answer, and the pattern must not count it');
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

test('#5995: engine/ping.js\'s own list of where the id goes has a line for each engine file that uses it, and for its own file', () => {
  const header = read('engine/ping.js').split('*/')[0];
  const i = header.indexOf('Where it goes');
  assert.ok(i > 0, 'engine/ping.js no longer has its "Where it goes" list');
  const named = [...header.slice(i).matchAll(/^ \*\s+(engine\/[a-z0-9-]+\.js|ping\.json)\s{2,}\S/gm)].map((m) => m[1]).sort();
  const want = [...Object.keys(HOLD_ID).filter((f) => HOLD_ID[f].listed), 'ping.json'].sort();
  assert.deepEqual(named, want, 'engine/ping.js\'s list and the files that use the install id differ');
});
