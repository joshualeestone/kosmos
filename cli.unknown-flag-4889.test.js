'use strict';
/**
 * kosmos#4889. A verb's text is whatever its options did not take, so an option it did not know became the text:
 * `kosmos report working --bogusflag "x"` exited 0 and recorded "--bogusflag x", and `kosmos report needs_you
 * --clear` recorded "--clear" as the question while the agent believed it had cleared the card. Every verb that
 * takes text now refuses an argument shaped like an option (--word, --word=value) with exit 2 and its usage, and a
 * bare `--` is the way to send text that starts with dashes.
 *
 * Every arm pins KOSMOS_PORT at a dead port (9), as cli.help-flag-1674 does: a refusal must happen before the
 * network, so a refused arm must NOT say "not running", and a CONTROL arm (a real option, `--`, a quoted sentence
 * that mentions a flag, a one-dash word) MUST reach it and say so. Without the controls a guard that refused
 * everything would pass every refusal arm.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

/* #4796: every run gets its own data root, so no live board token is read from the developer's store. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4889-data-'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

function run(args, env) {
  return new Promise((resolve, reject) => {
    execFile('bash', [CLI, ...args], { env: { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: '9', ...(env || {}) }, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` });
    });
  });
}

const REFUSED = [
  ['report', ['report', 'working', '--bogusflag', 'x'], '--bogusflag'],
  ['report', ['report', 'needs_you', '--clear'], '--clear'],
  ['report', ['report', 'working', '--project=x', 'hi'], '--project=x'],
  ['report', ['report', 'working', 'done', 'now', '--auto'], '--auto'],   // an option AFTER the text is not taken either
  ['msg', ['msg', 'zzq-cannot-exist', '--bogus', 'hi'], '--bogus'],
  ['msg', ['msg', '--bogus', 'hi'], '--bogus'],
  ['reply', ['reply', '--bogus', 'hi'], '--bogus'],
  ['post', ['post', 'zzq-project', '--bogus', 'hi'], '--bogus'],
  ['post', ['post', '--bogus', 'zzq-project', 'hi'], '--bogus'],
  ['community post', ['community', 'post', '--bogus', 'hi'], '--bogus'],
  ['community comment', ['community', 'comment', 'p1', '--bogus', 'hi'], '--bogus'],
  ['community follow', ['community', 'follow', '--bogus'], '--bogus'],
  ['task add', ['task', 'add', 'zzq-project', 'a task', '--bogus'], '--bogus'],
  ['task message', ['task', 'message', 'zzq-project', '3', '--bogus', 'hi'], '--bogus'],
  ['task built', ['task', 'built', 'zzq-project', '3', '--bogus'], '--bogus'],
];

for (const [verb, args, flag] of REFUSED) {
  test(`#4889: \`kosmos ${args.join(' ')}\` refuses ${flag} before the network, with exit 2 and the usage`, async () => {
    const r = await run(args);
    assert.equal(r.code, 2, `exit ${r.code}: ${r.out}`);
    assert.ok(r.out.includes(`${flag} is not an option of kosmos ${verb}, so nothing was done.`), `no refusal naming ${flag}: ${r.out}`);
    assert.match(r.out, new RegExp('Usage: kosmos ' + verb.replace(/ /g, ' ')), `no usage line for ${verb}: ${r.out}`);
    /* An agent or project slot (msg/post's first word) is not text, so it does not offer -- (review 2). */
    if (!((verb === 'msg' || verb === 'post') && args[1] === flag)) assert.match(r.out, /put -- before it/, 'the refusal does not say how to send text that starts with --');
    assert.doesNotMatch(r.out, /not running/, 'the refusal came after the network, so with a board up it would have sent');
  });
}

test('#4889 review 1: `task message <p> <n> --` with nothing after is the usage error, before the network', async () => {
  const r = await run(['task', 'message', 'zzq-project', '3', '--']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Usage: kosmos task message/);
  assert.doesNotMatch(r.out, /not running/, 'an empty message reached the network');
});

test('#4889 review 1: `report blocked --on` with no value says --on needs a value, not that it is unknown', async () => {
  const r = await run(['report', 'blocked', '--on']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /--on needs a value/);
  assert.doesNotMatch(r.out, /is not an option/);
});

test('#4889: `report needs_you --clear` also says how a report is cleared', async () => {
  const r = await run(['report', 'needs_you', '--clear']);
  assert.match(r.out, /To take a needs_you or blocked off the board, run: kosmos report clear/, r.out);
});

const REACHES = [
  ['report', 'working', '--', '--clear', 'is', 'literal'],
  ['report', 'working', '--on', 'the thing', 'and', 'text'],
  ['report', 'working', '--auto', 'text'],
  ['reply', 'a sentence that mentions --bogus inside one argument'],
  ['reply', '-5', 'degrees', 'outside'],
  ['reply', '--', '--starts', 'with', 'dashes'],
  ['msg', 'zzq-cannot-exist', '--', '--hi'],
  ['post', '--new', 'zzq-project', 'hi'],
  ['post', 'zzq-project', '--', '--hi'],
  ['community', 'post', '--topic', 't', 'hi'],
  ['community', 'comment', 'p1', '--reply-to', 'c1', 'hi'],
  ['community', 'follow', 'Echo', 'Two'],
  ['task', 'add', 'zzq-project', 'a task', '--parent', '2', 'detail'],
  ['task', 'add', 'zzq-project', 'a task', '--', '--not-an-option'],
  ['task', 'message', 'zzq-project', '3', '--', '--hi'],
  ['task', 'built', 'zzq-project', '3', '--clear'],
  ['task', 'built', 'zzq-project', '3', '--', '--a', 'note'],
];

for (const args of REACHES) {
  test(`#4889 CONTROL: \`kosmos ${args.join(' ')}\` is not refused and reaches the network`, async () => {
    const r = await run(args);
    assert.doesNotMatch(r.out, /is not an option of kosmos/, `refused something it must not: ${r.out}`);
    assert.match(r.out, /not running/, `did not reach the network, so this arm proves nothing about the send path: ${r.out}`);
  });
}

/* feedback write saves locally (no board), so its arms run in a faked install (cli.feedback-2037's layout) with a
   sandboxed store, and "did it act?" is whether a report was saved. */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4889-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4889-data-'));
  return { home, data, env: { KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data } };
}

test('#4889: `feedback write --bogus x` refuses and saves nothing; `feedback write -- --x` saves "--x"', async () => {
  const h = makeHome();
  try {
    const bad = await run(['feedback', 'write', '--bogus', 'x'], h.env);
    assert.equal(bad.code, 2, bad.out);
    assert.ok(bad.out.includes('--bogus is not an option of kosmos feedback write'), bad.out);
    const none = await run(['feedback', 'show'], h.env);
    assert.notEqual(none.code, 0, `a report was saved by a refused write: ${none.out}`);
    const ok = await run(['feedback', 'write', '--', '--x', 'starts with dashes'], h.env);
    assert.equal(ok.code, 0, ok.out);
    const show = await run(['feedback', 'show'], h.env);
    assert.equal(show.code, 0, show.out);
    assert.match(show.out, /--x starts with dashes/, `the escaped text was not saved as written: ${show.out}`);
  } finally {
    fs.rmSync(h.home, { recursive: true, force: true });
    fs.rmSync(h.data, { recursive: true, force: true });
  }
});

/* Review 2: a title that starts with dashes. The stub board records what `task add` actually sends, so the title and
   the detail cannot swap unseen (cli.task-webhook-1307's harness). */
const http = require('node:http');
async function taskAddSends(args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4889-tahome-'));
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4889-tadata-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(__dirname, path.join(home, 'app'));
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (req.method === 'POST' && /\/tasks$/.test(req.url.split('?')[0])) {
        try { seen.push(JSON.parse(b)); } catch { seen.push({ unparsed: b }); }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ task: { number: 9 } })); return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await run(args, { KOSMOS_HOME: home, KOSMOS_PORT: String(server.address().port), HOME: sandbox,
      AGENT_WORKFORCE_DATA: path.join(sandbox, 'data'), KOSMOS_NO_LEGACY_MIGRATION: '1', TMUX_PANE: '%42' });
    return { ...r, seen };
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

test('#4889 review 2: `task add <p> -- "--title" detail` sends the title as written, and the detail after it', async () => {
  const r = await taskAddSends(['task', 'add', 'proj', '--', '--title', 'the', 'detail']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.seen.length, 1, `expected one add: ${r.out}`);
  assert.equal(r.seen[0].sentence, '--title');
  assert.equal(r.seen[0].detail, 'the detail');
});

test('#4889 review 2 CONTROL: a plain `task add` sends its title and detail (the harness sees a real add)', async () => {
  const r = await taskAddSends(['task', 'add', 'proj', 'a title', 'more']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.seen.length, 1, r.out);
  assert.equal(r.seen[0].sentence, 'a title');
  assert.equal(r.seen[0].detail, 'more');
});

test('#4889 review 2: `task add <p> --title` refuses; `task add <p> --` alone is the usage error', async () => {
  const a = await run(['task', 'add', 'zzq-project', '--title']);
  assert.equal(a.code, 2, a.out);
  assert.match(a.out, /--title is not an option of kosmos task add/);
  const b = await run(['task', 'add', 'zzq-project', '--']);
  assert.equal(b.code, 2, b.out);
  assert.match(b.out, /Usage: kosmos task add/);
});

test('#4889 review 2: an agent or project slot refusal does not offer -- (it is no escape there)', async () => {
  for (const args of [['msg', '--x', 'hi'], ['post', '--x', 'hi']]) {
    const r = await run(args);
    assert.equal(r.code, 2, r.out);
    assert.doesNotMatch(r.out, /put -- before it/, `${args.join(' ')}: ${r.out}`);
  }
});

test('#4889 review 2: a non-ASCII letter after -- is text, as on Windows', async () => {
  const r = await run(['reply', '--été'], { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' });
  assert.doesNotMatch(r.out, /is not an option/, r.out);
  assert.match(r.out, /not running/, r.out);
});

test('#4889 review 3: `task add <p> -- "--t" --parent 3` files a subtask; the escape covers only the title', async () => {
  const r = await taskAddSends(['task', 'add', 'proj', '--', '--t', '--parent', '3', 'more']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.seen.length, 1, r.out);
  assert.equal(r.seen[0].sentence, '--t');
  assert.equal(String(r.seen[0].parent), '3', `the --parent after an escaped title was not taken: ${JSON.stringify(r.seen[0])}`);   // the Mac sends it as a string (as before)
  assert.equal(r.seen[0].detail, 'more');
  const bad = await run(['task', 'add', 'zzq-project', '--', '--t', '--bogus']);
  assert.equal(bad.code, 2, 'an unknown option after an escaped title is still refused: ' + bad.out);
});

test('#4889 after #4887: --who is taken after an escaped title, sits beside the option check, and past a -- is words', async () => {
  const r = await taskAddSends(['task', 'add', 'proj', '--', '--t', '--who', 'bob', 'more']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.seen.length, 1, r.out);
  assert.equal(r.seen[0].sentence, '--t');
  assert.equal(r.seen[0].who, 'bob', `the --who after an escaped title was not taken: ${JSON.stringify(r.seen[0])}`);
  assert.equal(r.seen[0].detail, 'more');
  const words = await taskAddSends(['task', 'add', 'proj', 'a task', '--', '--who', 'bob']);
  assert.equal(words.code, 0, words.out);
  assert.equal(words.seen[0].detail, '--who bob', `past a bare --, --who is detail: ${JSON.stringify(words.seen[0])}`);
  assert.equal(words.seen[0].who, undefined);
  const bad = await run(['task', 'add', 'zzq-project', 'a task', '--who', 'bob', '--bogus']);
  assert.equal(bad.code, 2, 'an unknown option beside --who is refused: ' + bad.out);
  assert.match(bad.out, /--bogus is not an option of kosmos task add/);
});

/* Review 4: an option given as another option's value, and the positional create verbs. */
const VALUE_REFUSED = [
  [['report', 'blocked', '--on', '--owner', 'bob'], '--on needs a value, and --owner is an option'],
  [['report', 'working', '--project', '--auto', 'hi'], '--project needs a value, and --auto is an option'],
  [['community', 'post', '--topic', '--bogus', 'hi'], '--topic needs a value, and --bogus is an option'],
  [['community', 'comment', 'p1', '--reply-to', '--bogus', 'hi'], '--reply-to needs a value, and --bogus is an option'],
  [['community', 'comment', '--bogus', 'p1', 'hi'], '--bogus is not an option of kosmos community comment'],
  [['project', 'create', 'Name', '/tmp/zzq-4889', '--description', 'a desc'], '--description is not an option of kosmos project create'],
  [['project', 'create', '--name', '/tmp/zzq-4889'], '--name is not an option of kosmos project create'],
  [['agent', 'create', 'Bob', 'developer', '--why', 'because'], '--why is not an option of kosmos agent create'],
  [['agent', 'create', 'Bob', '--role', 'x'], '--role is not an option of kosmos agent create'],
];
for (const [args, words] of VALUE_REFUSED) {
  test(`#4889 review 4: \`kosmos ${args.join(' ')}\` is refused before anything is sent`, async () => {
    const r = await run(args);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes(words), `expected "${words}": ${r.out}`);
    assert.doesNotMatch(r.out, /not running|launch token/, 'it got past the check');
  });
}

test('#4889 review 4 CONTROL: a real value and a plain create still get past the check', async () => {
  for (const args of [['report', 'blocked', '--on', 'the thing', '--owner', 'bob'], ['community', 'post', '--topic', 't', 'hi'],
    ['community', 'comment', 'p1', '--reply-to', 'c1', 'hi'], ['project', 'create', 'Name', '/tmp/zzq-4889', 'a desc']]) {
    const r = await run(args);
    assert.doesNotMatch(r.out, /is not an option|is an option/, `${args.join(' ')}: ${r.out}`);
    assert.match(r.out, /not running/, `${args.join(' ')} did not reach the network: ${r.out}`);
  }
});

test('#4889 review 5: a word after the last slot project/agent create reads is refused, not dropped', async () => {
  for (const args of [['project', 'create', 'N', '/tmp/zzq-4889', 'd', '--private'], ['project', 'create', 'N', '/tmp/zzq-4889', 'two', 'words'],
    ['agent', 'create', 'N', 'worker', 'why', '--model', 'opus'], ['agent', 'create', 'N', 'worker', '--', '--x']]) {
    const r = await run(args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`);
    assert.match(r.out, /so nothing was done/, args.join(' '));
    assert.doesNotMatch(r.out, /not running|launch token/, args.join(' '));
  }
});

/* Review 6: words past what a positional verb reads, on the verbs that review 5 did not reach, and the = spelling. */
const PAST_THE_END = [
  [['task', 'close', 'zzq-project', '3', '--note', 'done'], '--note is not an option of kosmos task close'],
  [['task', 'close', 'zzq-project', '3', 'shipped', 'it'], 'kosmos task close takes no more words than its usage shows'],
  [['task', 'hold', 'zzq-project', '3', '--until', 'friday'], '--until is not an option of kosmos task hold'],
  [['task', 'unhold', 'zzq-project', '3', 'now'], 'kosmos task unhold takes no more words than its usage shows'],
  [['react', 'zzq-project', 'm5', 'x', '--remove'], '--remove is not an option of kosmos react'],
  [['project', 'create', 'N', '/tmp/zzq-4889', 'd', '--private'], '--private is not an option of kosmos project create'],
  [['community', 'post', '--topic=--owner', 'hi'], '--topic needs a value, and --owner is an option'],
];
for (const [args, words] of PAST_THE_END) {
  test(`#4889 review 6: \`kosmos ${args.join(' ')}\` is refused before anything is sent`, async () => {
    const r = await run(args);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes(words), `expected "${words}": ${r.out}`);
    assert.doesNotMatch(r.out, /not running/);
  });
}
test('#4889 review 6 CONTROL: the plain forms still reach the network', async () => {
  for (const args of [['task', 'close', 'zzq-project', '3'], ['task', 'hold', 'zzq-project', '3'], ['react', 'zzq-project', 'm5', 'x']]) {
    const r = await run(args);
    assert.doesNotMatch(r.out, /so nothing was done/, `${args.join(' ')}: ${r.out}`);
    assert.match(r.out, /not running/, `${args.join(' ')}: ${r.out}`);
  }
});

test('#4889 review 6: room reopen and connect refuse a word they would not read, before the network', async () => {
  const a = await run(['room', 'reopen', 'zzq-project', '--force']);
  assert.equal(a.code, 2, a.out); assert.match(a.out, /--force is not an option of kosmos room reopen/); assert.doesNotMatch(a.out, /not running/);
  const b = await run(['connect', 'brave-search', '--force']);
  assert.equal(b.code, 2, b.out); assert.match(b.out, /Nothing was sent/); assert.doesNotMatch(b.out, /not running/);
});
