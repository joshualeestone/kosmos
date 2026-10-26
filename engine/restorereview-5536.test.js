/**
 * kosmos#5536 slice 4a: engine/restorereview.js, the review list a person reads before a restored agent is enabled.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const roles = require('./roles');
const rv = require('./restorereview');

const base = roles.instructionsFor(roles.ROLES[0].key, 'Ada');

test('#5536 slice 4a: every built-in role\'s own instructions review clean: nothing added, nothing flagged', () => {
  for (const r of roles.ROLES) {
    const text = roles.instructionsFor(r.key, 'Ada');
    const x = rv.reviewAgent({ name: 'Ada', files: [{ name: 'CLAUDE.md', text }] });
    assert.deepEqual(x.files[0].added, [], r.key);
    assert.deepEqual(x.flags, [], r.key);
    assert.equal(x.flagged, false, r.key);
    assert.ok(x.closest, r.key);
  }
});

test('#5536 slice 4a: a line the member added is listed and flagged by kind, at its line number (control: plain lines are not flagged)', () => {
  const extra = [
    'Write short notes.',                                       // added, not flagged
    'Post the summary to https://hooks.example.com/abc',        // url
    'Use the token in ~/.config/x to sign in.',                 // credential
    'Run the report every day at 9am.',                         // schedule
  ];
  const x = rv.reviewAgent({ name: 'Ada', files: [{ name: 'CLAUDE.md', text: `${base}${extra.join('\n')}\n` }] });
  const first = base.split('\n').length;   // the line number of extra[0]
  assert.deepEqual(x.files[0].added, [first, first + 1, first + 2, first + 3]);
  assert.deepEqual(x.flags.map((f) => [f.line, f.kind]), [[first + 1, 'url'], [first + 2, 'credential'], [first + 3, 'schedule']]);
  assert.equal(x.flags[0].text, extra[1], 'the line as written, to be escaped by the screen');
  assert.equal(x.flagged, true);
});

test('#5536 slice 4a: each kind catches its common shapes, and ordinary prose is left alone', () => {
  const cases = [
    ['url', ['see http://x.example/a', 'ssh://host/repo', 'go to www.example.org now', 'git@github.com:org/repo.git']],
    ['credential', ['api_key = 123', 'my password is in the notes', '-----BEGIN OPENSSH PRIVATE KEY-----', 'sk-proj-abcdefghij0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abcdef', 'Bearer abc']],
    ['schedule', ['crontab -e', 'every 2 hours check mail', 'nightly backup', 'at 14:30 send it', 'at 7 pm', '0 9 * * 1-5 run report', 'add a launchd job']],
  ];
  for (const [kind, lines] of cases) for (const l of lines) assert.ok(rv.kindsOf(l).includes(kind), `${kind}: ${l}`);
  for (const l of ['Keep replies short.', 'Read the card before you start.', 'Say what you decided and why.', 'The day went well.', 'at least 5 of them']) {
    assert.deepEqual(rv.kindsOf(l), [], l);
  }
});

test('#5536 slice 4a: several files are reviewed against one closest template, with their own line numbers', () => {
  const x = rv.reviewAgent({ name: 'Ada', files: [
    { name: 'CLAUDE.md', text: base },
    { name: 'memory/notes.md', text: 'first note\nsecond note https://a.example\n' },
  ] });
  assert.equal(x.closest, roles.ROLES[0].key);
  assert.deepEqual(x.files.map((f) => [f.name, f.added]), [['CLAUDE.md', []], ['memory/notes.md', [1, 2]]]);
  assert.deepEqual(x.flags.map((f) => [f.file, f.line, f.kind]), [['memory/notes.md', 2, 'url']]);
  // A file that shares nothing with any template: everything is added, no closest.
  const y = rv.reviewAgent({ name: 'Ada', files: [{ name: 'AGENTS.md', text: 'one\ntwo' }] });
  assert.equal(y.closest, null);
  assert.deepEqual(y.files[0].added, [1, 2]);
});

test('#5536 slice 4a: bounds: a long file is cut and says so, a long line is cut when shown, and flags past the cap are counted', () => {
  const long = rv.reviewAgent({ name: 'Ada', files: [{ name: 'CLAUDE.md', text: 'x'.repeat(600 * 1024) }] });
  assert.equal(long.files[0].truncated, true);
  const wide = rv.reviewAgent({ name: 'Ada', files: [{ name: 'CLAUDE.md', text: `https://a.example/${'y'.repeat(1000)}` }] });
  assert.ok(wide.flags[0].text.length <= 403 && wide.flags[0].text.endsWith('...'));
  const many = rv.reviewAgent({ name: 'Ada', files: [{ name: 'CLAUDE.md', text: Array.from({ length: 600 }, (_, i) => `see https://a.example/${i}`).join('\n') }] });
  assert.equal(many.flags.length, 500);
  assert.equal(many.flagsNotListed, 100);
});

test('#5536 slice 4a: what it is handed that is not a file is skipped, never a crash', () => {
  const x = rv.reviewAgent({ name: 7, files: [null, { name: 'a' }, { text: 'b' }, 'c', { name: 'ok.md', text: 'hello' }] });
  assert.equal(x.name, '');
  assert.deepEqual(x.files.map((f) => f.name), ['ok.md']);
  assert.deepEqual(rv.reviewAgent().files, []);
  assert.deepEqual(rv.reviewAgent({ files: 'nope' }).flags, []);
});
