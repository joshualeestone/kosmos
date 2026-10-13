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

test('#5959: a package version is not an email address, and a real address still is', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' });
  assert.equal(redactText('installing @anthropic-ai/claude-code@2.1.212 on node@20.11.1'), 'installing @anthropic-ai/claude-code@2.1.212 on node@20.11.1');
  assert.equal(redactText('mail ops@mail.example.co.uk now'), 'mail [email] now', 'CONTROL: an address with a letter domain is replaced');
});

test('#5959: a generic host name is not replaced, so a localhost address survives', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'localhost' });
  assert.equal(redactText('http://localhost:16180/api'), 'http://localhost:16180/api');
  const named = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zeds-box.local' });
  assert.equal(named.redactText('zeds-box answered'), '[computer] answered', 'CONTROL: a real host name still is');
});

test('#5959: a long run of name characters with no @ stays fast, and an address beside it is still found', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' });
  const run = 'a.b-c'.repeat(400);   // 2,000 characters an address could start with, and no @
  const t0 = process.hrtime.bigint();
  for (let n = 0; n < 50; n += 1) redactText(run + ' ' + n);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, 'fifty such lines took ' + ms.toFixed(0) + ' ms');   // generous: a quadratic pattern took far longer
  assert.equal(redactText(run + ' ops@example.com'), run + ' [email]');
});
