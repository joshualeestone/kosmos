'use strict';
/**
 * kosmos#5995 item 3: two comments said ping.installId() "is promised never to leave the Mac" while two modules sent
 * it on every board start and with every daily report. Anyone reasoning about privacy from the comments got it wrong.
 *
 * This holds what is true instead, from the source itself:
 *   - who reads the install id (a new reader has to be added here, which is the moment to decide where it may go);
 *   - which of those send it off the computer, and to which of Kosmos's own endpoints;
 *   - that the modules which must NOT send it (the community sender, the phone notifier) never read it;
 *   - that no engine file promises it never leaves.
 *
 *   node --test engine/installid-senders-5995.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = __dirname;
const sources = fs.readdirSync(ENGINE).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).sort();
const read = (f) => fs.readFileSync(path.join(ENGINE, f), 'utf8');
/* Code only: comments out, so a file that only TALKS about installId() is not counted as reading it. */
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CALL = /\binstallId\s*\(/;

/* Every engine module whose CODE reads the install id, and what it does with it. */
const READERS = Object.freeze({
  'createdbeacon.js': 'sends it to Kosmos\'s own install endpoint, on a board start and when an agent is made',
  'feedback.js': 'writes it into the daily report file on this computer',
  'feedbacksend.js': 'sends it to Kosmos\'s own feedback endpoint with the daily report',
  'ping.js': 'makes it and keeps it',
  'store.js': 'keeps it in an agent\'s profile on this computer, to tell a profile copied from another install',
});
const SENDERS = Object.freeze(['createdbeacon.js', 'feedbacksend.js']);

test('#5995: the engine modules that read the install id are exactly the ones listed here', () => {
  const found = sources.filter((f) => CALL.test(code(f)));
  assert.deepEqual(found, Object.keys(READERS).sort(),
    'a module reads ping.installId() and is not listed (or one listed no longer does). Decide where the id may go, then list it: ' + JSON.stringify(found));
});

test('#5995 CONTROL: the comment stripper does not hide a real read, and does hide a mention in a comment', () => {
  assert.ok(CALL.test(code('createdbeacon.js')), 'the real read in createdbeacon.js was stripped');
  assert.ok(CALL.test(read('phonenotify.js')) && !CALL.test(code('phonenotify.js')), 'phonenotify.js mentions installId() only in a comment, and that was counted or not found');
  assert.ok(CALL.test(read('communitysend.js')) && !CALL.test(code('communitysend.js')), 'communitysend.js mentions installId() only in a comment, and that was counted or not found');
});

test('#5995: the two senders put the install id in what they send, and nothing that talks to a coordinator or the community reads it', () => {
  const beacon = require('./createdbeacon');
  const sent = beacon.payload ? beacon.payload(0) : null;
  if (sent) assert.ok(typeof sent.installId === 'string' && sent.installId.length > 0, 'the created beacon\'s payload has no installId: ' + JSON.stringify(sent));
  else assert.match(code('createdbeacon.js'), /installId:\s*install\b/, 'createdbeacon.js no longer puts the install id in its payload');
  assert.match(code('feedbacksend.js'), /install:\s*install\b/, 'feedbacksend.js no longer puts the install id in its payload');
  for (const f of SENDERS) assert.ok(Object.prototype.hasOwnProperty.call(READERS, f), f);
  for (const f of ['phonenotify.js', 'communitysend.js', 'communityread.js', 'communityfollow.js', 'communityvote.js', 'remote.js']) {
    if (!sources.includes(f)) continue;
    assert.ok(!CALL.test(code(f)), f + ' reads ping.installId(); it talks to a coordinator or the community, which must not be given the install id');
  }
});

test('#5995: no engine file promises that the install id never leaves the computer', () => {
  const PROMISE = /install ?id[^.\n]{0,160}\b(never (to )?leaves?|promised never|does not leave|stays on (this|the) (mac|computer|machine))\b|\b(never (to )?leaves?|promised never)[^.\n]{0,80}install ?id/i;
  const flat = (f) => read(f).replace(/\n\s*\*?\s*/g, ' ');   // a promise wrapped over a comment line break is still one
  const making = sources.filter((f) => f !== 'ping.js' && PROMISE.test(flat(f)));
  assert.deepEqual(making, [], 'these files say the install id never leaves; createdbeacon.js and feedbacksend.js send it');
  assert.match('never ping.installId(), which is promised never to leave the Mac.'.replace(/\(\)/g, ''), PROMISE, 'CONTROL: the pattern finds the sentence this card was filed for');
  assert.match('ping.installId() (phonenotify promises that one never leaves the Mac)'.replace(/installId\(\)/, 'install id'), PROMISE, 'CONTROL: and the second one');
});
