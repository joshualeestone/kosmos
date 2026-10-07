'use strict';
/**
 * #5359: engine/accountline.js, the one copy of what `kosmos accounts` prints on both CLIs. The CLI tests
 * (cli.accounts-5359.test.js, tools.windows-kosmos-cli-accounts-5359.test.js) drive it end to end; this pins the arms
 * those fixtures do not reach and the classes of a failed answer.
 *
 *   node --test engine/accountline-5359.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountLine, answer } = require('./accountline');

const row = (connection, extra = {}) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'a@example.com', connection, ...extra });

test('#5359: every badge, and the state when there is none, in the board\'s words', () => {
  assert.equal(accountLine(row({ state: 'none', badge: 'signed_out', because: 'not signed in on this computer' })),
    'Anthropic / Claude: a@example.com: not signed in: not signed in on this computer');
  assert.equal(accountLine(row({ state: 'unknown', badge: 'unchecked', because: 'the check timed out' })),
    'Anthropic / Claude: a@example.com: could not be checked just now: the check timed out');
  // Control: the same data with no badge falls to the state, so the two arms above are reached by the badge.
  assert.equal(accountLine(row({ state: 'none', because: 'not signed in on this computer' })),
    'Anthropic / Claude: a@example.com: not signed in: not signed in on this computer');
});

test('#5359: a default account with nothing else to name it by is called the default account, never by its folder', () => {
  const line = accountLine({ provider: 'anthropic', providerName: 'Anthropic / Claude', isDefault: true, dir: '/a/folder/.claude', connection: { state: 'connected', badge: 'working' } });
  assert.equal(line, 'Anthropic / Claude: the default account: signed in');
  assert.ok(!line.includes('/a/folder'), 'the folder was printed');
});

test('#5359: board text with a newline stays on one line, in an account and in a refusal', () => {
  const line = accountLine(row({ state: 'none', badge: 'signed_out', because: 'first\nAnthropic / Claude: fake@example.com: signed in' }));
  assert.ok(!line.includes('\n'), 'a reason printed as an extra line');
  const refused = answer(401, { error: 'that needs the board token\nsecond line' });
  assert.ok(refused.fail && !refused.fail.includes('\n'), 'a refusal printed as two lines');
  assert.match(refused.fail, /^Kosmos refused that request: that needs the board token second line\.$/);
});

test('#5359: the classes of a failed answer are the same whatever the body', () => {
  assert.match(answer(500, null).fail, /^Kosmos could not read its accounts just now\. Try again in a minute\.$/, 'an empty 5xx');
  assert.match(answer(502, null).fail, /could not read its accounts just now/, 'a 5xx that is not JSON');
  assert.match(answer(500, { error: 'boom' }).fail, /^Kosmos could not read its accounts just now: boom\. Try again/);
  assert.match(answer(403, {}).fail, /could not read its accounts just now/, 'a 4xx with no reason is not a refusal');
  assert.match(answer(403, { error: 'no' }).fail, /^Kosmos refused that request: no\.$/);
  assert.match(answer(200, { error: 'odd' }).fail, /an answer we could not read/, 'an error on a 200 is not a refusal');
  assert.match(answer(200, null).fail, /an answer we could not read/);
  assert.deepEqual(answer(200, { accounts: [] }).lines, ['No provider accounts are set up on this board yet. The person adds one in Settings > AI Models.']);
  assert.equal(answer(200, { accounts: [row({ state: 'connected', badge: 'working' })] }).lines[0], 'Anthropic / Claude: a@example.com: signed in');
});
