'use strict';
/* #5307 (Josh, 2026-10-05 10:41): when the automatic handoff prompt fires, the agent also posts ONE community post (what
 * it learned), after the handoff. Splinter's calls on the card: only when the community is on; it counts toward the
 * floor and never past the ceiling of 6 (at 6 it skips and says so); the usual privacy rules; a failed or held post
 * never blocks the handoff. */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hopost-5307-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const ah = require('./autohandoff');
const { sweepOnce } = require('./autohandoff-sweep');
const { DELIVERY } = require('./chat');
const nudge = require('./communitynudge');
const cs = require('./communitysend');

const ON = { participating: true, posts: 2, max: 6 };

test('#5307: no community, or the community off, leaves the prompt exactly as before', () => {
  const plain = ah.handoffPrompt(88, '/h/a.md');
  assert.equal(ah.handoffPrompt(88, '/h/a.md', null), plain);
  assert.equal(ah.handoffPrompt(88, '/h/a.md', { participating: false, posts: 0, max: 6 }), plain);
  assert.equal(ah.handoffPrompt(88, '/h/a.md', { participating: 'yes', posts: 0, max: 6 }), plain, 'only a real true asks');
  assert.doesNotMatch(plain, /community/i);
  assert.match(plain, /not into a message \(messages truncate\)\.\nKeep working after this, and refresh the handoff as the work moves\.$/);
});

test('#5307: with the community on, one post is asked for AFTER the handoff, with the privacy rules and the never-blocks rule', () => {
  const p = ah.handoffPrompt(88, '/h/a.md', ON);
  const lines = p.split('\n');
  const at = lines.findIndex((l) => /Kosmos\+ community/.test(l));
  assert.ok(at > lines.findIndex((l) => /Write to the path/.test(l)), 'after the handoff instructions');
  assert.ok(at < lines.length - 1 && /^Keep working/.test(lines[lines.length - 1]), 'before "keep working", which stays last');
  const ask = lines[at];
  assert.match(ask, /^Once the handoff is written, post ONE thing/);
  assert.match(ask, /what you learned or finished/);
  assert.match(ask, /never names, projects, people, files or what your person said/);
  assert.match(ask, /If the post fails or is held, leave it: it never holds up the handoff\./);
  assert.doesNotMatch(ask, /Skip it if/, 'a known count under the ceiling needs no reminder');
  for (const dash of [/—/, /&mdash;/, /&#8212;/, /&#x2014;/i, /\\u\{?2014/]) assert.doesNotMatch(p, dash);
});

test('#5307: at the ceiling of 6 the post is skipped, and the prompt says so; an unknown count asks and names the ceiling', () => {
  const full = ah.communityAsk({ participating: true, posts: 6, max: 6 });
  assert.equal(full, 'You have already posted 6 times to the Kosmos+ community in the last 24 hours, the most a day, so make no community post this time.');
  assert.match(ah.communityAsk({ participating: true, posts: 9, max: 6 }), /make no community post/);
  assert.match(ah.communityAsk({ participating: true, posts: 5, max: 6 }), /^Once the handoff is written/, 'five is under the ceiling');
  const unknown = ah.communityAsk({ participating: true, posts: null, max: 6 });
  assert.match(unknown, /^Once the handoff is written/);
  assert.match(unknown, /Skip it if you have already posted 6 times in the last 24 hours\./);
});

test('#5307: the sweep asks the community per agent; a lookup that throws still delivers the handoff, without the post', () => {
  const sent = [];
  const deliver = (session, text) => { sent.push({ session, text }); return { state: DELIVERY.PLACED }; };
  const roster = [{ sessionName: 'a', context: { percent: 90 } }, { sessionName: 'b', context: { percent: 90 } }, { sessionName: 'c', context: { percent: 90 } }];
  const asked = [];
  const community = (k) => { asked.push(k); if (k === 'b') throw new Error('unreadable'); return k === 'a' ? ON : { participating: true, posts: 6, max: 6 }; };
  const { prompted } = sweepOnce({ setting: { enabled: true, threshold: 85 }, roster, lastBand: new Map(), deliver,
    pathFor: (k) => '/h/' + k + '.md', autohandoff: ah, DELIVERY, community });
  assert.deepEqual(asked, ['a', 'b', 'c']);
  assert.equal(prompted.length, 3);
  assert.ok(prompted.every((p) => p.advanced), 'every handoff was delivered and its band advanced');
  assert.match(sent[0].text, /post ONE thing to the Kosmos\+ community/);
  assert.equal(sent[1].text, ah.handoffPrompt(90, '/h/b.md'), 'a throwing lookup: the plain handoff');
  assert.match(sent[2].text, /make no community post this time/);
  // No community dependency at all: the sweep is as it was.
  const plain = [];
  sweepOnce({ setting: { enabled: true, threshold: 85 }, roster: [roster[0]], lastBand: new Map(), deliver: (s, t) => { plain.push(t); return { state: DELIVERY.PLACED }; },
    pathFor: (k) => '/h/' + k + '.md', autohandoff: ah, DELIVERY });
  assert.equal(plain[0], ah.handoffPrompt(90, '/h/a.md'));
});

test('#5307: accountRefused is true only for a readable record that says refused', () => {
  const file = cs._paths.keysFile();
  try { fs.unlinkSync(file); } catch { /* none yet */ }
  assert.equal(nudge.accountRefused('ada'), false, 'no keys file: not refused (a fresh machine still posts)');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ada: { refused: true }, bo: { apiKey: 'k' } }));
  assert.equal(nudge.accountRefused('ada'), true);
  assert.equal(nudge.accountRefused('bo'), false);
  assert.equal(nudge.accountRefused('cy'), false, 'an agent with no record');
  fs.writeFileSync(file, '{not json');
  assert.equal(nudge.accountRefused('ada'), false, 'an unreadable record says nothing');
});
