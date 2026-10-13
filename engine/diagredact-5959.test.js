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
  assert.equal(redactText('/Users/pat/x and /Users/patricia/y'), '~/x and /Users/[user]/y', 'patricia is not the home folder (it is another account\'s, so [user])');
  const win = makeRedactor({ home: 'C:\\Users\\pat', user: 'zzz', host: 'zzz' });
  assert.equal(win.redactText('C:\\Users\\pat\\AppData'), '~\\AppData');
});

test('#5959: redactDeep reaches every string value, leaves keys (the code\'s own words) alone, and leaves the input as it was', () => {
  const { redactDeep } = makeRedactor({ ...WHO, host: 'log' });   // a host name equal to one of the file's keys
  const input = { name: 'pat', nested: [{ path: '/Users/pat/a', n: 3, ok: true, none: null }], log: 'log said pat@example.com' };
  const out = redactDeep(input);
  assert.deepEqual(out, { name: '[user]', nested: [{ path: '~/a', n: 3, ok: true, none: null }], log: '[computer] said [email]' });
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

test('#5959: a Windows home folder is replaced however a line spells it, and a folder named for a person is too', () => {
  const { redactText } = makeRedactor({ home: 'C:\\Users\\Pat Smith', user: 'pat.smith', host: 'zzz' });
  const line = 'C:/Users/Pat Smith/doc, C:\\\\Users\\\\Pat Smith\\\\doc, c:\\users\\pat smith\\x, and Pat Smith said';
  assert.ok(line.includes('Pat Smith') && line.includes('pat smith'), 'CONTROL: the folder name is in the line');
  const out = redactText(line);
  assert.ok(!/pat smith/i.test(out), out);
  assert.equal(out, '~/doc, ~\\\\doc, ~\\x, and [user] said');
  const mac = makeRedactor({ home: '/Users/pat', user: 'pat', host: 'zzz' });
  assert.equal(mac.redactText('/users/PAT/y and /Users/patricia/z'), '~/y and /Users/[user]/z', 'any case; patricia is another account, not ~');
});

test('#5959: another account\'s user folder is taken out too, a name with spaces whole', () => {
  const { redactText } = makeRedactor({ home: '/Users/pat', user: 'pat', host: 'zzz' });
  const line = '/Users/ann/y /home/bob/z C:\\Users\\Cy Doe\\w C:/Users/Cy Doe/q /Users/ann said hi';
  for (const n of ['ann', 'bob', 'Cy Doe']) assert.ok(line.includes(n), 'CONTROL: ' + n + ' is in the line');
  assert.equal(redactText(line), '/Users/[user]/y /home/[user]/z C:\\Users\\[user]\\w C:/Users/[user]/q /Users/[user] said hi');
});

test('#5959: a home folder or user name in a URL-encoded path is redacted too', () => {
  const { redactText } = makeRedactor({ home: '/Users/patsmith', user: 'patsmith', host: 'zzz' });
  const line = 'GET /api/files?path=%2FUsers%2Fpatsmith%2Fwork then %2fUsers%2fann%2fx and ?who=%2Fpatsmith%2F';
  assert.ok(line.includes('patsmith') && line.includes('ann'), 'CONTROL: the names are in the line');
  const out = redactText(line);
  assert.ok(!/patsmith|ann/.test(out), out);
  assert.equal(out, 'GET /api/files?path=~%2Fwork then %2fUsers%2f[user]%2fx and ?who=%2F[user]%2F');
});

test('#5959: header credentials and secret-named JSON fields lose their value, keep their name', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' });
  const v = 'QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Njc4OTAx';
  const cases = [
    ['Authorization: Bearer ' + v, 'Authorization: Bearer ••••'],
    ['cookie: kosmos_board=' + v + '; x=1', 'cookie: ••••'],
    ['{"authToken":"abc123","name":"ok"}', '{"authToken":"••••","name":"ok"}'],
    ['{"client_secret": "s3cr3t-value"}', '{"client_secret": "••••"}'],
    ['sent Basic dXNlcjpwYXNzd29yZA==', 'sent Basic ••••'],
    ['{"headers":{"authorization":"Bearer abcdefghijkl"}}', '{"headers":{"authorization":"••••"}}'],
  ];
  for (const [input, want] of cases) assert.equal(redactText(input), want, input);
  assert.equal(redactText('the bearer of bad news, basic rules'), 'the bearer of bad news, basic rules', 'CONTROL: plain words stay');
});

test('#5959: a value the board holds is masked by value, however bare; a short one is left alone', () => {
  const tok = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz', secrets: [tok, 'short'] });
  assert.equal(makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' }).redactText('agent token ' + tok + ' refused'),
    'agent token ' + tok + ' refused', 'CONTROL: by shape alone a bare hex token is not found');
  assert.equal(redactText('agent token ' + tok + ' refused'), 'agent token •••• refused');
  assert.equal(redactText('a short word'), 'a short word');
});

test('#5959: a secret field keeps nothing after an escaped quote, and authMode or author is not a secret', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' });
  assert.equal(redactText('{"password":"a\\"bcdefgh","x":1}'), '{"password":"••••","x":1}');
  assert.equal(redactText('{"author":"Rick","authMode":"antigravity"}'), '{"author":"Rick","authMode":"antigravity"}');
});

test('#5959: an account named like an ordinary word is not replaced in every line, and its home folder still is', () => {
  const { redactText } = makeRedactor({ home: '/home/kosmos', user: 'kosmos', host: 'zzz' });
  assert.equal(redactText('kosmos: started on /home/kosmos/app'), 'kosmos: started on ~/app');
  const root = makeRedactor({ home: '/root', user: 'root', host: 'zzz' });
  assert.equal(root.redactText('root cause found'), 'root cause found');
});

test('#5959: a URL path after a host name is kept; a user folder in a file path is not', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' });
  assert.equal(redactText('GET https://api.github.com/users/octocat/repos'), 'GET https://api.github.com/users/octocat/repos');
  assert.equal(redactText('read /Users/ann/notes'), 'read /Users/[user]/notes', 'CONTROL: a file path still is');
});

test('#5959: another person\'s folder that starts with the home folder\'s name is taken whole, and a cut secret value too', () => {
  const { redactText } = makeRedactor({ home: '/Users/pat', user: 'pat', host: 'zzz' });
  assert.equal(redactText('C:\\Users\\Pat Smith\\Desktop and /Users/pat smith/x'), 'C:\\Users\\[user]\\Desktop and /Users/[user]/x');
  assert.ok(!/smith/i.test(redactText('/Users/pat smith/x')));
  assert.equal(redactText('/Users/pat/x'), '~/x', 'CONTROL: the home folder itself is still ~');
  assert.equal(redactText('{"password":"abc'), '{"password":"••••', 'a value cut before its quote is taken to the end');
});

test('#5959: a passphrase field is a secret too', () => {
  assert.equal(makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' }).redactText('{"passphrase":"correct horse"}'), '{"passphrase":"••••"}');
});

test('#5959: a secret-named field loses its value in every common spelling, and plain words stay', () => {
  const { redactText } = makeRedactor({ home: '/Users/zed', user: 'zzz', host: 'zzz' });
  const v = 'Q7w9Zk2Lm4Np6Rt8Vx0Yb3C';
  const rows = [
    ["{ authToken: '" + v + "' }", "{ authToken: '••••' }"],                       // a logged object (util.inspect)
    ["{ accessToken: '" + v + "', authMode: 'agy' }", "{ accessToken: '••••', authMode: 'agy' }"],
    ["'authToken': '" + v + "'", "'authToken': '••••'"],
    ['authToken=' + v + '&x=1', 'authToken=••••&x=1'],
    ['{"authToken":"' + v + '","name":"ok"}', '{"authToken":"••••","name":"ok"}'],
  ];
  for (const [input, want] of rows) assert.equal(redactText(input), want, input);
  assert.equal(redactText('Basic information about the board'), 'Basic information about the board', 'CONTROL: prose after Basic stays');
  assert.equal(redactText('the token was refused'), 'the token was refused', 'CONTROL: the word token alone is not a field');
});
