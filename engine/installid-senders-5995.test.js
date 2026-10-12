'use strict';
/**
 * kosmos#5995 item 3: two comments said ping.installId() "is promised never to leave the Mac" while two modules sent
 * it. Anyone reasoning about privacy from the comments got it wrong. engine/ping.js now lists where the id goes, and
 * this holds that list to the source:
 *   - the shipped files that MENTION the install id, by name, are exactly a listed set (in code or in a comment: any
 *     new mention is the moment to decide where the id may go, and no parsing of comments is needed to see it);
 *   - the same for the copy kept in an agent's profile (`idInstall`);
 *   - the two that send it put this install's id in what they send;
 *   - in the two modules that talk to a coordinator and to the community, every mention is a comment;
 *   - the wordings found so far that say it never leaves are in no shipped file;
 *   - engine/ping.js's own list names every engine file on the set.
 * What it does not hold: a value handed on by one of the listed files, and a wording nobody has written yet.
 *
 *   node --test engine/installid-senders-5995.test.js
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-installid-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* Every shipped source file: the engine, the server, the page, the installers and the tools. Not tests, not the
   browser checks and their fixtures, not plans or docs. */
function shipped() {
  const out = [];
  const walk = (rel, depth) => {
    for (const d of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) { if (depth > 0 && d.name !== 'node_modules') walk(r, depth - 1); continue; }
      if (/\.test\.(js|mjs)$/.test(d.name)) continue;
      if (/\.(js|mjs|cjs|sh|html|ps1|cmd)$/.test(d.name) || rel === 'bin' || r === 'install/kosmos') out.push(r);
    }
  };
  for (const [dir, depth] of [['engine', 0], ['web', 1], ['install', 2], ['bin', 1], ['tools', 3]]) if (fs.existsSync(path.join(ROOT, dir))) walk(dir, depth + 1);
  for (const f of fs.readdirSync(ROOT)) if (/\.(js|mjs)$/.test(f) && !/\.test\.(js|mjs)$/.test(f)) out.push(f);
  return out.sort();
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FILES = shipped();
const mentioning = (re) => FILES.filter((f) => re.test(read(f)));

/* The install id by its name, however it is reached: a call, a property, a destructure, a comment. */
const ID = /installId/;
/* The profile's copy. A word of its own, so `midInstall` (server.js, about an install in progress) is not one. */
const PROFILE_COPY = /\bidInstall\b/;

const MENTION_ID = Object.freeze({
  'engine/communitysend.js': 'a comment: the community is given its own id, never this one',
  'engine/createdbeacon.js': 'sends it to the install endpoint, on a board start and when an agent is made',
  'engine/feedback.js': 'writes it into the daily report file on this computer',
  'engine/feedbacksend.js': 'sends it with the daily feedback report',
  'engine/phonenotify.js': 'a comment: a coordinator is given its own id, never this one',
  'engine/ping.js': 'makes it, keeps it, and lists where it goes',
  'engine/store.js': 'keeps it in each agent\'s profile as idInstall',
  'tools/test-install.sh': 'a comment about the file the id is kept in',
});
const MENTION_PROFILE_COPY = Object.freeze({
  'engine/agentfile.js': 'a comment: an exported agent file does not carry it',
  'engine/ping.js': 'the list of where the install id goes names it',
  'engine/store.js': 'writes it, and compares it to tell a profile copied from another install',
  'tools/capture-agent-card.js': 'blanks it when a card is captured as a fixture',
});

test('fixture: the scan reads the files it should, and not tests or checks', () => {
  for (const f of ['engine/ping.js', 'server.js', 'web/index.html', 'install/kosmos', 'tools/windows/kosmos-cli.js', 'tools/test-install.sh']) assert.ok(FILES.includes(f), 'the scan does not read ' + f);
  assert.ok(FILES.length > 300, 'the scan found only ' + FILES.length + ' files');
  assert.ok(!FILES.some((f) => /\.test\.js$/.test(f) || f.startsWith('docs/') || f.includes('node_modules')), 'the scan reads a test, a doc or a dependency');
});

test('#5995: the shipped files that mention the install id are exactly the ones listed here', () => {
  assert.deepEqual(mentioning(ID), Object.keys(MENTION_ID).sort(),
    'a file mentions installId and is not listed (or a listed one no longer does). Decide where the id may go, list it here and in engine/ping.js');
});

test('#5995: the shipped files that mention the profile\'s copy (idInstall) are exactly the ones listed here', () => {
  assert.deepEqual(mentioning(PROFILE_COPY), Object.keys(MENTION_PROFILE_COPY).sort(),
    'a file mentions idInstall and is not listed (or a listed one no longer does)');
  assert.ok(/midInstall/.test(read('server.js')) && !PROFILE_COPY.test(read('server.js')), 'CONTROL: server.js\'s midInstall is a different word, and the pattern must not count it');
});

test('#5995: the created beacon sends THIS install\'s id, and the feedback send puts it in its payload', () => {
  const ping = require('./ping');
  const beacon = require('./createdbeacon');
  assert.ok(ping.FILE.startsWith(SANDBOX + path.sep), 'fixture: the id file is not in this test\'s sandbox: ' + ping.FILE);
  const mine = ping.installId();
  assert.match(mine, /^[0-9a-f-]{16,}$/i, 'fixture: no install id was made');
  assert.equal(typeof beacon.payload, 'function', 'createdbeacon no longer exports payload; this test reads what it sends through it');
  assert.equal(beacon.payload(0).installId, mine, 'the created beacon\'s payload does not carry this install\'s id');
  assert.notEqual(mine, 'unknown');
  assert.match(read('engine/feedbacksend.js'), /install:\s*install\s*\|\|\s*'unknown'/, 'feedbacksend.js no longer puts the install id in its payload');
});

test('#5995: where a coordinator or the community is talked to, every mention of the install id is a comment', () => {
  /* phonenotify sends a field NAMED installId whose value is its own notifyId (the coordinator's field name). That one
     line is code and is allowed, and it is held to be exactly that. */
  const KEY_WITH_OWN_ID = /^\s*installId:\s*notifyId,\s*$/;
  for (const f of ['engine/phonenotify.js', 'engine/communitysend.js']) {
    const lines = read(f).split('\n').map((text, i) => ({ text, n: i + 1 })).filter((l) => ID.test(l.text));
    assert.ok(lines.length > 0, 'fixture: ' + f + ' no longer mentions the install id; take it off this test and off the list');
    for (const l of lines) {
      if (f === 'engine/phonenotify.js' && KEY_WITH_OWN_ID.test(l.text)) continue;
      assert.match(l.text, /^\s*(\*|\/\/)/, f + ':' + l.n + ' mentions the install id outside a comment: ' + l.text.trim());
    }
  }
  assert.equal(read('engine/phonenotify.js').split('\n').filter((t) => KEY_WITH_OWN_ID.test(t)).length, 1, 'phonenotify.js no longer has exactly one `installId: notifyId,` line; read what it sends under that name now');
  for (const f of ['engine/remote.js', 'engine/communityread.js', 'engine/communityfollow.js', 'engine/communityvote.js']) {
    assert.ok(FILES.includes(f), 'fixture: ' + f + ' is gone; name the file that talks to that service now');
    assert.ok(!ID.test(read(f)), f + ' mentions the install id; it talks to a coordinator or the community');
  }
});

/* The wordings that have been written, or that a reviewer could think of, for "it never leaves". A list, so it is
   narrower than the idea: a new wording is not caught until it is added. */
const NEVER_LEAVES = [
  /promised never/i,
  /never (to )?leaves?\b/i,
  /does not leave/i,
  /never (sent|shared)\b/i,
  /not (sent|shared) (off|with|to|anywhere)/i,
  /stays (local|on (this|the) (mac|computer|machine))/i,
];
const flat = (text) => text.replace(/\n[ \t]*(\*|\/\/)?[ \t]*/g, ' ');   // a sentence wrapped over comment lines is one sentence
/* The sentences of a file that mention the install id, or that follow one that does (for "It never leaves"). */
function claims(text) {
  const s = flat(text).split(/(?<=[.!?])\s+/);
  const out = [];
  s.forEach((x, i) => { if (/install ?id|installId/i.test(x) || (i > 0 && /install ?id|installId/i.test(s[i - 1]) && /^(it|that one|this one)\b/i.test(x))) out.push(x); });
  return out;
}
const promising = (text) => claims(text).filter((x) => NEVER_LEAVES.some((re) => re.test(x)));

test('#5995: no shipped file says, in any wording found so far, that the install id never leaves', () => {
  const making = FILES.map((f) => [f, promising(read(f))]).filter(([, hits]) => hits.length);
  assert.deepEqual(making, [], 'these sentences say the install id does not leave; createdbeacon.js and feedbacksend.js send it');
});

test('#5995 CONTROL: the two sentences this card was filed for, and other ways of saying it, are caught; true ones are not', () => {
  for (const said of [
    ' * to, only after a person asks, and with its own random id (`notifyId`), never\n * ping.installId(), which is promised never to leave the Mac.',
    ' * ping.installId() (phonenotify promises that one never leaves the Mac) and nothing derived from the machine.',
    'The install id is never sent anywhere.',
    'installId is not sent off this computer.',
    '// installId stays local.',
    'The install id is kept in ping.json. It never leaves the Mac.',
    'installId is not shared with anyone.',
  ]) assert.equal(promising(said).length > 0, true, 'not caught: ' + said);
  for (const said of [
    'A message never leaves the Mac. The install id is sent with the daily report.',
    'never ping.installId() (engine/ping.js lists where that one goes, and a coordinator is not on the list).',
    'It stays on the Mac. Nothing here is about ids.',
  ]) assert.deepEqual(promising(said), [], 'a true sentence was caught: ' + said);
});

test('#5995: engine/ping.js\'s own list of where the id goes names every engine file on the set, and no other', () => {
  const header = read('engine/ping.js').split('*/')[0];
  const i = header.indexOf('Where it goes');
  assert.ok(i > 0, 'engine/ping.js no longer has its "Where it goes" list');
  const named = [...header.slice(i).matchAll(/^ \*\s+(engine\/[a-z0-9-]+\.js)\s{2,}\S/gm)].map((m) => m[1]).sort();
  const want = Object.keys(MENTION_ID).filter((f) => f.startsWith('engine/') && !/a comment:/.test(MENTION_ID[f]) && f !== 'engine/ping.js').sort();
  assert.deepEqual(named, want, 'engine/ping.js\'s list and the files that use the install id differ');
});
