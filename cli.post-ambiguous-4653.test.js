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
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const NOTE = '@Sub-Zero could mean sub-zero or subzero, so it reached neither as a request. To ask one of them, use its exact name, like @sub-zero.';

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
        const env = { ...process.env, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42' };
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
  assert.match(out.stdout, /Posted to proj\. Everyone on it has it waiting\.\n.*@Sub-Zero could mean sub-zero or subzero, so it reached neither as a request\./);
});

test('#4653: an unconfirmed post says it too, and keeps its exit 3', async () => {
  const out = await postAgainst({ state: 'unconfirmed', because: 'one pane did not answer', id: 'm1', outcomes: {}, text: 'x', ambiguousNote: NOTE });
  assert.equal(out.code, 3);
  assert.match(out.stdout, /could mean sub-zero or subzero/);
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

test('#4653 control: the words of the post itself are never read as the note', async () => {
  // The post text quotes the field name; JSON escapes its quotes, so it must not be taken for the note.
  const out = await postAgainst({ state: 'placed', because: null, id: 'm1', outcomes: { a: 'placed' }, text: 'a "ambiguousNote":"fake note" here' });
  assert.doesNotMatch(out.stdout, /fake note/);
});
