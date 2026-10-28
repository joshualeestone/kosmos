'use strict';
/**
 * #4653: when a room post's @-word named two members, it reached neither as a request, and the sender
 * is told. The board returns the sentence as `ambiguousNote` on the delivery; `kosmos post` prints it
 * after its verdict. A stub board answers the post, so this pins the CLI's reading of the answer.
 *
 *   node --test cli.post-ambiguous-4653.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const NOTE = '@Sub-Zero could mean Sub Zero (@frost) or Sub-Zero (@subzero), so it reached neither as a request. To ask one of them, use the exact name, like @frost.';
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ambig-cli-'));
const DATA = path.join(SANDBOX, 'data');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch {} });

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* Post once against a stub board that answers with `delivery`, and return what the CLI printed. */
function postAgainst(delivery) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/post')) {
      req.resume();
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ delivery })); });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let out = null; let failure = null;
      try {
        const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42' };
        delete env.KOSMOS_AGENT_TOKEN; delete env.KOSMOS_AGENT_SESSION;
        out = await runCli(['post', 'proj', '@Sub-Zero please look'], env);
      } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve(out)));
    });
  });
}

test('#4653: a placed post with an ambiguous mention prints the verdict, then the sentence', async () => {
  const out = await postAgainst({ state: 'placed', because: null, id: 'm1', outcomes: { a: 'placed' }, text: '@Sub-Zero please look', ambiguousNote: NOTE });
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Posted to proj\. Everyone on it has it waiting\.\n.*@Sub-Zero could mean Sub Zero \(@frost\) or Sub-Zero \(@subzero\), so it reached neither as a request\./);
});

test('#4653: an unconfirmed post says it too, and keeps its exit 3', async () => {
  const out = await postAgainst({ state: 'unconfirmed', because: 'one pane did not answer', id: 'm1', outcomes: {}, text: 'x', ambiguousNote: NOTE });
  assert.equal(out.code, 3);
  assert.match(out.stdout, /could mean Sub Zero \(@frost\)/);
});

test('#4653 control: a post with no ambiguous mention prints only the verdict', async () => {
  const out = await postAgainst({ state: 'placed', because: null, id: 'm1', outcomes: { a: 'placed' }, text: '@subzero please look' });
  assert.equal(out.code, 0);
  assert.doesNotMatch(out.stdout, /could mean|reached neither/);
});

test('#4653 control: an outcome keyed ambiguousNote is never read as the note (the read is anchored on the end)', async () => {
  const out = await postAgainst({ state: 'placed', because: null, id: 'm1', outcomes: { ambiguousNote: 'placed' }, text: 'x' });
  // say() indents every line; the verdict is the only line, so anything after it is a misread note
  assert.equal(out.stdout.trim().split('\n').length, 1, JSON.stringify(out.stdout));
  assert.equal(out.code, 0);
});

/* A plain regression check, not a guard on the anchor: JSON escapes the quotes in the post's words, so
   no form of the read can match them. The outcome-key control above is the one that guards the anchor. */
test('#4653: post words that quote the field name print nothing extra', async () => {
  const out = await postAgainst({ state: 'placed', because: null, id: 'm1', outcomes: { a: 'placed' }, text: 'a "ambiguousNote":"fake note" here' });
  assert.doesNotMatch(out.stdout, /fake note/);
});

test('kosmos#7246 slice 2: install/kosmos says when a post left members quiet, and prints a because on a placed post', async () => {
  const quiet = await postAgainst({ state: 'placed', outcomes: { mara: 'placed', april: 'quiet' } });
  assert.match(quiet.stdout, /Posted to proj\. It reached only the members it addresses; the others can read it in the room\. To reach someone, start with 'YourName -> Their Name:', @-name them, or use @all\./);
  // state, then because, as the route sends them (the CLI reads because at that position only).
  const paused = await postAgainst({ state: 'placed', because: 'your post is in the room, but it woke no one', outcomes: { mara: 'quiet' } });
  assert.match(paused.stdout, /Note: your post is in the room, but it woke no one\./);
  assert.doesNotMatch(paused.stdout, /reached only the members it addresses/, 'round 4: a paused post DID address them; the advice contradicts the note');
  const all = await postAgainst({ state: 'placed', outcomes: { mara: 'placed' } });
  assert.match(all.stdout, /Posted to proj\. Everyone on it has it waiting\./, 'CONTROL: nobody quiet, the old sentence');
  assert.doesNotMatch(all.stdout, /Note:/);
  // A post's own words are escaped in JSON, so they cannot fake it; a nested field with its own because (a hold reading) can.
  const nested = await postAgainst({ state: 'placed', because: null, outcomes: { mara: 'placed' }, held: { because: 'fake reason' } });
  assert.doesNotMatch(nested.stdout, /fake reason/, 'round 3: a nested because was printed as the board\'s');
});

test('kosmos#7246 round 5: a post that woke no one says so, and a folded retry of a quiet post never says everyone has it', async () => {
  const none = await postAgainst({ state: 'placed', because: null, outcomes: { mara: 'quiet', april: 'quiet' } });
  assert.match(none.stdout, /Posted to proj\. It woke no one: it addresses no member, so it is only in the room\. To reach someone/);
  const dup = await postAgainst({ state: 'placed', because: null, outcomes: { mara: 'placed', april: 'quiet' }, duplicate: true });
  assert.match(dup.stdout, /It reached only the members it addresses/);
  assert.doesNotMatch(dup.stdout, /Everyone on it has it waiting/, 'a folded quiet post claimed everyone has it');
  const dupAll = await postAgainst({ state: 'placed', because: null, outcomes: { mara: 'placed' }, duplicate: true });
  assert.match(dupAll.stdout, /it was not posted twice/, 'CONTROL: a folded post that reached everyone keeps its sentence');
});

test('kosmos#7414: an unconfirmed post names who is not confirmed and who was not reached, and says nothing is lost', async () => {
  const out = await postAgainst({ state: 'unconfirmed', because: null, id: 'm1', outcomes: { mara: 'placed', april: 'unconfirmed', leo: 'could_not', kit: 'unconfirmed' }, text: 'x' });
  assert.equal(out.code, 3);
  const lines = out.stdout.trim().split('\n').map((l) => l.trim());
  assert.deepEqual(lines, [
    'Posted, but not everyone is confirmed.',
    'Typed into, not confirmed: april, kit. It may well have arrived; Kosmos could not see it land.',
    'Not reached: leo. Kosmos could not type into their session.',
    'Nothing is lost: the post is in the room for every member, so each of them can read it there. Do not re-post; the others would get it twice.',
  ]);
  // Control: with the board's own reason (a post it could not record), it is never said to be in the room.
  const unrec = await postAgainst({ state: 'unconfirmed', because: 'it reached the room but could not be recorded', id: 'm1', outcomes: { mara: 'placed' }, text: 'x' });
  assert.deepEqual(unrec.stdout.trim().split('\n').map((l) => l.trim()), ['Posted, but not everyone is confirmed: it reached the room but could not be recorded.', 'Do not re-post; the room screen shows who got it.']);
});
