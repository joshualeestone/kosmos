'use strict';
/**
 * #4373 part B: the Windows `kosmos community comment` verb, driven through main() with its seams (fetch, hook,
 * out/err), so the Mac/Windows parity claim is measured, not only listed. Nothing leaves the process.
 *
 *   node --test tools.windows-kosmos-cli-community-comment-4373.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const TOKEN = 'cd'.repeat(16);
const POST = '1b2c3d4e-0000-4000-8000-000000000001';

function harness({ answer = () => [200, { ok: true, status: 'held', id: 'c1' }], throws, stdin = '' } = {}) {
  const sent = [];
  const lines = { out: [], err: [] };
  const io = {
    env: {},
    url: 'http://127.0.0.1:16180',
    out: (s) => lines.out.push(s),
    err: (s) => lines.err.push(s),
    readStdin: async () => ({ text: stdin, ended: true }),
    hook: { agentToken: () => TOKEN, readBoardToken: () => 'board-tok', resolveUrl: () => 'http://127.0.0.1:16180' },
    fetch: async (u, init) => {
      sent.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      if (throws) throw throws;
      const [status, json] = answer();
      return { status, text: async () => JSON.stringify(json) };
    },
  };
  return { io, sent, lines, all: () => lines.out.concat(lines.err).join('\n') };
}

test('#4373 B: a comment goes to the board with the post id, the text and the agent token in a header', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment', POST, 'Tuesdays', 'work'], h.io), 0, h.all());
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].method, 'POST');
  assert.match(h.sent[0].url, /\/api\/community\/service-comment$/);
  assert.equal(h.sent[0].headers['x-kosmos-agent-token'], TOKEN, 'the agent token did not travel as a header');
  assert.equal(h.sent[0].body.servicePostId, POST);
  assert.equal(h.sent[0].body.body, 'Tuesdays work');
  assert.ok(!('agent' in h.sent[0].body), 'identity must ride the token, never the body');
  // #3485 (2026-09-30): nothing waits for a release step any more; held means the scrub stopped it for the person.
  assert.equal(h.lines.out.join('\n'), 'Commented, and held for your person to look at before it goes public, which is expected. Do not send it again. See where it stands with: kosmos community status');
  assert.doesNotMatch(h.all(), /until your person releases/);
});

test('#3485 merge: a published comment says it goes on the next pass, never held', async () => {
  const h = harness({ answer: () => [200, { ok: true, status: 'published', id: 'c1', sends: true }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], h.io), 0, h.all());
  assert.equal(h.lines.out.join('\n'), 'Comment queued: Kosmos sends it to the community shortly. Check whether it has gone out with: kosmos community status');   // #4939
  assert.doesNotMatch(h.all(), /held|until your person releases/);
});

test('#4373 B merged with #4580: a refused connect reported only as an AggregateError (no cause.code) is "could not reach", not a maybe', async () => {
  const agg = Object.assign(new TypeError('fetch failed'), { cause: { errors: [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED ::1:16180' }] } });
  assert.equal(agg.cause.code, undefined, 'PRECONDITION: the fixture must carry no cause.code, or it tests the other arm');
  const h = harness({ throws: agg });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], h.io), 1, h.all());
  assert.doesNotMatch(h.all(), /may have been taken/);
  assert.match(h.all(), /^We could not reach Kosmos to send that comment\. Is it running at /m);
});

test('#4373 B: a comment piped in on stdin arrives, trailing newlines dropped as on the Mac', async () => {
  const h = harness({ stdin: 'line one\nline two\n' });
  assert.equal(await cli.main(['community', 'comment', POST], h.io), 0, h.all());
  assert.equal(h.sent[0].body.body, 'line one\nline two');
});

test('#4373 B: no post id or no text exits 2 without asking the board; --help exits 0', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment'], h.io), 2);
  assert.match(h.lines.err.join('\n'), /Usage: kosmos community comment <post-id>/);
  assert.equal(await cli.main(['community', 'comment', POST, '   '], h.io), 2);
  assert.equal(await cli.main(['community', 'comment', '--help'], h.io), 0);
  assert.equal(h.sent.length, 0, 'a refused call reached the board');
});

test('#4373 B: a refusal is said in the board\'s words and exits 1', async () => {
  const no = harness({ answer: () => [400, { error: 'a community comment can be at most 2000 characters' }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], no.io), 1);
  assert.match(no.lines.err.join('\n'), /^That comment was not sent: a community comment can be at most 2000 characters\.$/);
});

test('#4373 B review (merge): a 500 or an unreadable 200 is a maybe (exit 3); a 503 before the store is still not sent', async () => {
  const five = harness({ answer: () => [500, { error: 'we could not submit that comment' }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], five.io), 3);
  assert.match(five.lines.err.join('\n'), /may have been taken, so do not send it again/);
  const odd = harness({ answer: () => [200, { ok: true }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], odd.io), 3);
  const early = harness({ answer: () => [503, { error: 'we could not check which agents are running' }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], early.io), 1, 'CONTROL: a refusal before the store stays "not sent"');
});

test('#4373 B review 3: a connection cut after the request went is a maybe (exit 3, do not resend); a refused connect is not reached', async () => {
  const cut = harness({ throws: Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }) });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], cut.io), 3, 'a cut answer was not a maybe');
  assert.match(cut.lines.err.join('\n'), /do not send it again/);
  const refused = harness({ throws: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], refused.io), 1, 'a refused connect was a maybe');
  const slow = harness({ throws: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], slow.io), 3);
});

test('#4373 B review 3: published while Community is off, it says it will not go', async () => {
  const off = harness({ answer: () => [200, { ok: true, status: 'published', id: 'c1', sends: false }] });
  assert.equal(await cli.main(['community', 'comment', POST, 'x'], off.io), 0);
  assert.match(off.lines.out.join("\n"), /not sending to the community right now, so it will not go/);
});

test('#4373 B fifth red-team: an empty comment in PowerShell is told the safe form, never double quotes', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment', POST, '   '], h.io), 2);
  const err = h.lines.err.join('\n');
  assert.match(err, /single-quoted here-string/);
  assert.match(err, /never in double quotes, where \$\( \) runs/);
  assert.match(err, /never with a line in the text that starts with '@/);
  assert.doesNotMatch(err, /pass the text as an argument/, 'the shared "as an argument" note invites double quotes');
});

// #4833 slice 3: --reply-to, the same as the Mac verb (cli.community-comment-4373.test.js).
const PARENT = '2c3d4e5f-0000-4000-8000-000000000002';
test('#4833: --reply-to after the post id sends serviceParentId, and the text is everything after it', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment', POST, '--reply-to', PARENT, 'Agreed', '--reply-to', 'x'], h.io), 0, h.all());
  assert.equal(h.sent[0].body.servicePostId, POST);
  assert.equal(h.sent[0].body.serviceParentId, PARENT);
  assert.equal(h.sent[0].body.body, 'Agreed --reply-to x');
});

test('#4833: --reply-to before the post id works the same, and a piped reply arrives too', async () => {
  const h = harness({ stdin: 'piped reply\n' });
  assert.equal(await cli.main(['community', 'comment', '--reply-to', PARENT, POST], h.io), 0, h.all());
  assert.equal(h.sent[0].body.servicePostId, POST);
  assert.equal(h.sent[0].body.serviceParentId, PARENT);
  assert.equal(h.sent[0].body.body, 'piped reply');
});

test('#4833 CONTROL: without --reply-to no serviceParentId is sent', async () => {
  const h = harness();
  assert.equal(await cli.main(['community', 'comment', POST, 'top level'], h.io), 0, h.all());
  assert.ok(!('serviceParentId' in h.sent[0].body), JSON.stringify(h.sent[0].body));
});

test('#4833: --reply-to with no comment id is a usage error and nothing is sent', async () => {
  for (const args of [['community', 'comment', POST, '--reply-to'], ['community', 'comment', '--reply-to']]) {
    const h = harness();
    assert.equal(await cli.main(args, h.io), 2, args.join(' ') + ': ' + h.all());
    assert.match(h.all(), /--reply-to <comment-id>/);
    assert.equal(h.sent.length, 0);
  }
});

test('#4833: an empty post id (an unset variable) is a usage error, never skipped to make the text the post id', async () => {
  for (const args of [['community', 'comment', '', POST], ['community', 'comment', '', 'hello'], ['community', 'comment', '--reply-to', PARENT, '', POST]]) {
    const h = harness({ stdin: 'should not be read\n' });
    assert.equal(await cli.main(args, h.io), 2, JSON.stringify(args) + ': ' + h.all());
    assert.match(h.all(), /Usage: kosmos community comment <post-id>/);
    assert.equal(h.sent.length, 0);
  }
});
