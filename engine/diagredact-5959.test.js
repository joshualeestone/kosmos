'use strict';

/* #5959 slice 4: engine/diagredact.js takes keys, the home folder, email addresses and this computer's names out of
   every string in the diagnostics file. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRedactor } = require('./diagredact');

const WHO = { home: '/Users/pat', user: 'pat', host: 'Pats-Desk.local' };
// A key shape secretmask.mask is built for (an Anthropic API key), long enough to be one.
const KEY = 'sk-ant-api03-' + 'Q7w9Zk2Lm4Np6Rt8Vx0Yb3Cd5Fg7Hj9'.repeat(2);

test('#5959: each planted string is replaced, and none of it is left in the result', () => {
  const { redactText } = makeRedactor(WHO);
  const line = `pat on Pats-Desk.local (Pats-Desk) read ${KEY} from /Users/pat/.claude and mailed pat@example.com`;
  for (const planted of [KEY, '/Users/pat', 'Pats-Desk', 'pat@example.com']) {
    assert.ok(line.includes(planted), 'CONTROL: the check can see ' + planted + ' before redaction');
  }
  const out = redactText(line);
  for (const planted of [KEY, '/Users/pat', 'Pats-Desk', 'pat@example.com', 'example.com']) {
    assert.ok(!out.includes(planted), planted + ' is gone: ' + out);
  }
  assert.ok(!/\bpat\b/i.test(out), 'the user name is gone: ' + out);
  assert.match(out, /^\[user\] on \[computer\] \(\[computer\]\) read /);
  assert.match(out, / from ~\/\.claude and mailed \[email\]$/);
});

test('#5959: a name is replaced whole, in any case, never inside a longer word', () => {
  const { redactText } = makeRedactor({ home: '/Users/sam', user: 'sam', host: 'box' });
  assert.equal(redactText('SAM and Sam ran samples on samba; sam_2 stays'), '[user] and [user] ran samples on samba; sam_2 stays');
  assert.equal(redactText('the box is boxed in a boxroom'), 'the [computer] is boxed in a boxroom');
});

test('#5959: a name too short to replace safely is left alone', () => {
  const { redactText } = makeRedactor({ home: '/home/al', user: 'al', host: 'x' });
  assert.equal(redactText('al and also all of x'), 'al and also all of x');
  assert.equal(redactText('/home/al/logs'), '~/logs', 'the home folder still goes');
});

test('#5959: the home folder is replaced only as a whole folder, and a Windows one too', () => {
  const { redactText } = makeRedactor({ home: '/Users/pat', user: 'zzz', host: 'zzz' });
  assert.equal(redactText('/Users/pat/x and /Users/patricia/y'), '~/x and /Users/patricia/y');
  const win = makeRedactor({ home: 'C:\\Users\\pat', user: 'zzz', host: 'zzz' });
  assert.equal(win.redactText('C:\\Users\\pat\\AppData'), '~\\AppData');
});

test('#5959: redactDeep reaches every string, keys included, and leaves the input as it was', () => {
  const { redactDeep } = makeRedactor(WHO);
  const input = { name: 'pat', nested: [{ path: '/Users/pat/a', n: 3, ok: true, none: null }], ['pat@example.com']: 'x' };
  const out = redactDeep(input);
  assert.deepEqual(out, { name: '[user]', nested: [{ path: '~/a', n: 3, ok: true, none: null }], '[email]': 'x' });
  assert.equal(input.name, 'pat', 'the input is not changed');
  assert.ok(!/\bpat\b/.test(JSON.stringify(out)), JSON.stringify(out));
});
