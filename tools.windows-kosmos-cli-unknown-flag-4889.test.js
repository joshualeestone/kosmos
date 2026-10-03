'use strict';
/**
 * kosmos#4889, the Windows half (tools/windows/kosmos-cli.js), parity with install/kosmos and
 * cli.unknown-flag-4889.test.js. An option a verb does not know used to become its text and exit 0. Now it is
 * refused with exit 2 and the usage BEFORE any call, and a bare `--` sends text that starts with dashes.
 *
 * "Did it send?" is observable directly here: the scripted fetch records every call, so a refused arm must make
 * none, and every CONTROL arm must make exactly one carrying the text as written. Without the controls a verb that
 * refused everything would pass every refusal arm.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

async function run(argv) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    readStdin: async () => ({ text: '' }),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), body: init.body === undefined ? undefined : JSON.parse(init.body) });
      return { status: 200, text: async () => '{}' };
    },
  });
  return { code, calls, all: out.concat(err).join('\n') };
}

const REFUSED = [
  ['report', ['report', 'working', '--bogusflag', 'x'], '--bogusflag'],
  ['report', ['report', 'needs_you', '--clear'], '--clear'],
  ['report', ['report', 'working', '--project=x', 'hi'], '--project=x'],
  ['report', ['report', 'working', 'done', 'now', '--auto'], '--auto'],
  ['msg', ['msg', 'someone', '--bogus', 'hi'], '--bogus'],
  ['msg', ['msg', '--bogus', 'hi'], '--bogus'],
  ['reply', ['reply', '--bogus', 'hi'], '--bogus'],
  ['post', ['post', 'proj', '--bogus', 'hi'], '--bogus'],
  ['post', ['post', '--bogus', 'proj', 'hi'], '--bogus'],
  ['community post', ['community', 'post', '--bogus', 'hi'], '--bogus'],
  ['community comment', ['community', 'comment', 'p1', '--bogus', 'hi'], '--bogus'],
  ['community follow', ['community', 'follow', '--bogus'], '--bogus'],
  ['task add', ['task', 'add', 'proj', 'a task', '--bogus'], '--bogus'],
  ['task message', ['task', 'message', 'proj', '3', '--bogus', 'hi'], '--bogus'],
  ['task built', ['task', 'built', 'proj', '3', '--bogus'], '--bogus'],
  ['feedback write', ['feedback', 'write', '--bogus', 'x'], '--bogus'],
];

for (const [verb, argv, flag] of REFUSED) {
  test(`#4889 Windows: \`kosmos ${argv.join(' ')}\` refuses ${flag} with exit 2, the usage, and no call`, async () => {
    const r = await run(argv);
    assert.equal(r.code, 2, `exit ${r.code}: ${r.all}`);
    assert.ok(r.all.includes(`${flag} is not an option of kosmos ${verb}, so nothing was done.`), r.all);
    assert.ok(r.all.includes('Usage: kosmos ' + verb), `no usage line for ${verb}: ${r.all}`);
    if (!((verb === 'msg' || verb === 'post') && argv[1] === flag)) assert.match(r.all, /put -- before it/);   // a target slot offers no -- (review 2)
    assert.equal(r.calls.length, 0, `it called the board: ${JSON.stringify(r.calls)}`);
  });
}

test('#4889 review 1 Windows: `task message <p> <n> --` with nothing after is the usage error, no call', async () => {
  const r = await run(['task', 'message', 'proj', '3', '--']);
  assert.equal(r.code, 2, r.all);
  assert.match(r.all, /Usage: kosmos task message/);
  assert.equal(r.calls.length, 0);
});

test('#4889 review 1 Windows: `report blocked --on` with no value says --on needs a value, no call', async () => {
  const r = await run(['report', 'blocked', '--on']);
  assert.equal(r.code, 2, r.all);
  assert.match(r.all, /--on needs a value/);
  assert.doesNotMatch(r.all, /is not an option/);
  assert.equal(r.calls.length, 0);
});

test('#4889 Windows: `report needs_you --clear` also says how a report is cleared', async () => {
  const r = await run(['report', 'needs_you', '--clear']);
  assert.match(r.all, /To take a needs_you or blocked off the board, run: kosmos report clear/, r.all);
});

/* [argv, the route's field, what it must carry] */
const SENT = [
  [['report', 'working', '--', '--clear', 'is', 'literal'], 'text', '--clear is literal'],
  [['report', 'working', '--on', 'the thing', 'and', 'text'], 'text', 'and text'],
  [['reply', 'a sentence that mentions --bogus inside one argument'], 'text', 'a sentence that mentions --bogus inside one argument'],
  [['reply', '-5', 'degrees'], 'text', '-5 degrees'],
  [['reply', '--', '--starts', 'with', 'dashes'], 'text', '--starts with dashes'],
  [['msg', 'someone', '--', '--hi'], 'text', '--hi'],
  [['post', '--new', 'proj', 'hi'], 'text', 'hi'],
  [['post', 'proj', '--', '--hi'], 'text', '--hi'],
  [['task', 'add', 'proj', 'a task', '--parent', '2', 'detail'], 'detail', 'detail'],
  [['task', 'add', 'proj', 'a task', '--', '--not-an-option'], 'detail', '--not-an-option'],
  [['task', 'message', 'proj', '3', '--', '--hi'], 'text', '--hi'],
  [['task', 'built', 'proj', '3', '--clear'], 'clear', true],
  [['task', 'built', 'proj', '3', '--', '--a', 'note'], 'note', '--a note'],
  [['community', 'follow', 'Echo', 'Two'], 'name', 'Echo Two'],
];

for (const [argv, field, want] of SENT) {
  test(`#4889 Windows CONTROL: \`kosmos ${argv.join(' ')}\` sends ${field}=${JSON.stringify(want)}`, async () => {
    const r = await run(argv);
    assert.doesNotMatch(r.all, /is not an option of kosmos/, r.all);
    const sent = r.calls.filter((c) => c.body && Object.prototype.hasOwnProperty.call(c.body, field));
    assert.equal(sent.length, 1, `expected one call carrying ${field}: ${JSON.stringify(r.calls)} ${r.all}`);
    assert.deepEqual(sent[0].body[field], want);
  });
}

test('#4889 review 2 Windows: `task add <p> -- "--title" detail` sends the title as written, the detail after it', async () => {
  const r = await run(['task', 'add', 'proj', '--', '--title', 'the', 'detail']);
  assert.equal(r.calls.length, 1, r.all);
  assert.equal(r.calls[0].body.sentence, '--title');
  assert.equal(r.calls[0].body.detail, 'the detail');
});

test('#4889 review 2 Windows: `task add <p> --title` refuses, `task add <p> --` alone is the usage error', async () => {
  const a = await run(['task', 'add', 'proj', '--title']);
  assert.equal(a.code, 2, a.all);
  assert.match(a.all, /--title is not an option of kosmos task add/);
  assert.equal(a.calls.length, 0);
  const b = await run(['task', 'add', 'proj', '--']);
  assert.equal(b.code, 2, b.all);
  assert.match(b.all, /Usage: kosmos task add/);
  assert.equal(b.calls.length, 0);
});

test('#4889 review 2 Windows: an agent or project slot refusal does not offer --', async () => {
  for (const argv of [['msg', '--x', 'hi'], ['post', '--x', 'hi']]) {
    const r = await run(argv);
    assert.equal(r.code, 2, r.all);
    assert.doesNotMatch(r.all, /put -- before it/, argv.join(' '));
  }
});

test('#4889 review 2 Windows: a non-ASCII letter after -- is text, as on the Mac', async () => {
  const r = await run(['reply', '--été']);
  assert.doesNotMatch(r.all, /is not an option/);
  assert.equal(r.calls.length, 1);
});

test('#4889 review 3 Windows: `task add <p> -- "--t" --parent 3` files a subtask; the escape covers only the title', async () => {
  const r = await run(['task', 'add', 'proj', '--', '--t', '--parent', '3', 'more']);
  assert.equal(r.calls.length, 1, r.all);
  assert.equal(r.calls[0].body.sentence, '--t');
  assert.equal(r.calls[0].body.parent, 3);
  assert.equal(r.calls[0].body.detail, 'more');
  const bad = await run(['task', 'add', 'proj', '--', '--t', '--bogus']);
  assert.equal(bad.code, 2, bad.all);
  assert.equal(bad.calls.length, 0);
});

test('#4889 after #4887 Windows: --who is taken after an escaped title, sits beside the option check, and past a -- is words', async () => {
  const r = await run(['task', 'add', 'proj', '--', '--t', '--who', 'bob', 'more']);
  assert.equal(r.calls.length, 1, r.all);
  assert.equal(r.calls[0].body.sentence, '--t');
  assert.equal(r.calls[0].body.who, 'bob');
  assert.equal(r.calls[0].body.detail, 'more');
  const words = await run(['task', 'add', 'proj', 'a task', '--', '--who', 'bob']);
  assert.equal(words.calls.length, 1, words.all);
  assert.equal(words.calls[0].body.detail, '--who bob');
  assert.equal(words.calls[0].body.who, undefined);
  const bad = await run(['task', 'add', 'proj', 'a task', '--who', 'bob', '--bogus']);
  assert.equal(bad.code, 2, bad.all);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.all, /--bogus is not an option of kosmos task add/);
});

test('#4889 review 3 Windows: `task add <p> --parent=3` says what the Mac says', async () => {
  const r = await run(['task', 'add', 'proj', '--parent=3', 'x']);
  assert.equal(r.code, 2);
  assert.match(r.all, /Write it as --parent <task-number>, with a space\./);
});

const VALUE_REFUSED = [
  [['report', 'blocked', '--on', '--owner', 'bob'], '--on needs a value, and --owner is an option'],
  [['report', 'working', '--project', '--auto', 'hi'], '--project needs a value, and --auto is an option'],
  [['community', 'post', '--topic', '--bogus', 'hi'], '--topic needs a value, and --bogus is an option'],
  [['community', 'comment', 'p1', '--reply-to', '--bogus', 'hi'], '--reply-to needs a value, and --bogus is an option'],
  [['community', 'comment', '--bogus', 'p1', 'hi'], '--bogus is not an option of kosmos community comment'],
  [['project', 'create', 'Name', 'C:\\zzq', '--description', 'a desc'], '--description is not an option of kosmos project create'],
  [['project', 'create', '--name', 'C:\\zzq'], '--name is not an option of kosmos project create'],
  [['agent', 'create', 'Bob', 'developer', '--why', 'because'], '--why is not an option of kosmos agent create'],
  [['agent', 'create', 'Bob', '--role', 'x'], '--role is not an option of kosmos agent create'],
];
for (const [argv, words] of VALUE_REFUSED) {
  test(`#4889 review 4 Windows: \`kosmos ${argv.join(' ')}\` is refused with no call`, async () => {
    const r = await run(argv);
    assert.equal(r.code, 2, r.all);
    assert.ok(r.all.includes(words), `expected "${words}": ${r.all}`);
    assert.equal(r.calls.length, 0);
  });
}

test('#4889 review 4 Windows CONTROL: real values and a plain create are sent', async () => {
  const a = await run(['report', 'blocked', '--on', 'the thing', '--owner', 'bob']);
  assert.equal(a.calls.length, 1, a.all);
  assert.equal(a.calls[0].body.owner, 'bob');
  const b = await run(['project', 'create', 'Name', 'C:\\zzq', 'a desc']);
  assert.equal(b.calls.length, 1, b.all);
  assert.equal(b.calls[0].body.description, 'a desc');
});

test('#4889 review 5 Windows: a word after the last slot project/agent create reads is refused, not dropped', async () => {
  for (const argv of [['project', 'create', 'N', 'C:\\f', 'd', '--private'], ['project', 'create', 'N', 'C:\\f', 'two', 'words'],
    ['agent', 'create', 'N', 'worker', 'why', '--model', 'opus'], ['agent', 'create', 'N', 'worker', '--', '--x']]) {
    const r = await run(argv);
    assert.equal(r.code, 2, `${argv.join(' ')}: ${r.all}`);
    assert.match(r.all, /so nothing was done/);
    assert.equal(r.calls.length, 0, argv.join(' '));
  }
});

const PAST_THE_END = [
  [['task', 'close', 'proj', '3', '--note', 'done'], '--note is not an option of kosmos task close'],
  [['task', 'close', 'proj', '3', 'shipped', 'it'], 'kosmos task close takes no more words than its usage shows'],
  [['task', 'hold', 'proj', '3', '--until', 'friday'], '--until is not an option of kosmos task hold'],
  [['task', 'unhold', 'proj', '3', 'now'], 'kosmos task unhold takes no more words than its usage shows'],
  [['react', 'proj', 'm5', 'x', '--remove'], '--remove is not an option of kosmos react'],
  [['project', 'create', 'N', 'C:\\f', 'd', '--private'], '--private is not an option of kosmos project create'],
  [['community', 'post', '--topic=--owner', 'hi'], '--topic needs a value, and --owner is an option'],
];
for (const [argv, words] of PAST_THE_END) {
  test(`#4889 review 6 Windows: \`kosmos ${argv.join(' ')}\` is refused with no call`, async () => {
    const r = await run(argv);
    assert.equal(r.code, 2, r.all);
    assert.ok(r.all.includes(words), `expected "${words}": ${r.all}`);
    assert.equal(r.calls.length, 0);
  });
}
test('#4889 review 6 Windows CONTROL: the plain forms are sent', async () => {
  for (const argv of [['task', 'close', 'proj', '3'], ['task', 'hold', 'proj', '3'], ['react', 'proj', 'm5', 'x']]) {
    const r = await run(argv);
    assert.equal(r.calls.length, 1, `${argv.join(' ')}: ${r.all}`);
  }
});

test('#4889 review 6 Windows: room reopen and connect refuse a word they would not read', async () => {
  const a = await run(['room', 'reopen', 'proj', '--force']);
  assert.equal(a.code, 2, a.all); assert.match(a.all, /--force is not an option of kosmos room reopen/); assert.equal(a.calls.length, 0);
  const b = await run(['connect', 'brave-search', '--force']);
  assert.equal(b.code, 2, b.all); assert.match(b.all, /Nothing was sent/); assert.equal(b.calls.length, 0);
});
