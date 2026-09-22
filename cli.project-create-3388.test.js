'use strict';
/**
 * kosmos#3388: `kosmos project create "<name>" <folder> ["<desc>"]` POSTs to
 * /api/projects so an agent can make a project with one command instead of a raw
 * curl carrying the board token in argv.
 *
 * The stub is a REAL http server the CLI's own curl hits, so this asserts the
 * request the CLI actually builds (endpoint, method, body fields) and how it
 * reads each response -- not the CLI's source text.
 *
 * 📌 The stub answers `/` with a body containing "Kosmos" because the CLI's
 * healthy() refuses a port that answers with somebody else's page and would exit
 * before ever POSTing (the same note cli.presents-token.test.js records). And it
 * must NEVER touch a real board: it binds 127.0.0.1:0 (a private ephemeral port)
 * and the CLI is pointed at it via KOSMOS_PORT, so no project is created anywhere
 * real and the #327 rate valve is never burned.
 *
 * ⚠️ THE ERROR CASE IS LOAD-BEARING. A create that printed "Created ..." on every
 * response would pass the success case alone; the {"error"} case is what makes the
 * success assertion mean something. Do not drop it to shorten the file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const CLI = path.join(__dirname, 'install', 'kosmos');

// reply: what POST /api/projects returns (status + JSON). Captured requests land
// in `seen` as {url, method, body}.
function withStub(reply, body) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/projects')) {
      let buf = '';
      req.on('data', (d) => { buf += d; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf || '{}'); } catch { parsed = { UNPARSEABLE: buf }; }
        seen.push({ url: req.url, method: req.method, body: parsed });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.json);
      });
      return;
    }
    // healthy() probes `/`; it must look like Kosmos or the CLI aborts early.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await body(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

// Run the CLI async (a sync child blocks node's loop so the in-process stub can't
// answer healthy()), and return {stdout, code}. The CLI's exit code is meaningful
// here (unlike the report test), so capture it rather than swallowing it.
async function cli(port, args) {
  const env = { ...process.env, KOSMOS_PORT: String(port) };
  try {
    const { stdout } = await run(CLI, args, { env, timeout: 15000 });
    return { stdout, code: 0 };
  } catch (e) {
    return { stdout: (e && e.stdout) || '', code: (e && typeof e.code === 'number') ? e.code : 1 };
  }
}

const OK = { status: 200, json: '{"project":{"id":"my-project"},"told":[],"id":"my-project","agentsUnreadable":false}' };

test('project create POSTs name + folder to /api/projects and reports the id', async () => {
  await withStub(OK, async (port, seen) => {
    const { stdout, code } = await cli(port, ['project', 'create', 'My Project', '/tmp/mp', 'a demo']);
    assert.equal(seen.length, 1, 'the CLI did not POST to /api/projects');
    assert.equal(seen[0].url, '/api/projects');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].body.name, 'My Project', 'name was not sent in the body');
    assert.equal(seen[0].body.folder, '/tmp/mp', 'folder was not sent in the body');
    assert.equal(seen[0].body.description, 'a demo', 'the optional description was not sent when given');
    assert.equal(code, 0, 'a successful create should exit 0');
    assert.match(stdout, /Created project "My Project"/);
    assert.match(stdout, /my-project/, 'the created id is not reported back');
  });
});

test('project create omits description when not given', async () => {
  await withStub(OK, async (port, seen) => {
    await cli(port, ['project', 'create', 'Nodesc', '/tmp/nd']);
    assert.equal(seen.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(seen[0].body, 'description'), false,
      'description must be absent from the body when the caller did not pass one');
  });
});

test('project create surfaces the board error and exits non-zero (the load-bearing control)', async () => {
  const ERR = { status: 429, json: '{"error":"agents have made 12 projects in the last hour, so Kosmos is pausing agent-made projects"}' };
  await withStub(ERR, async (port, seen) => {
    const { stdout, code } = await cli(port, ['project', 'create', 'Rate', '/tmp/r']);
    assert.equal(seen.length, 1, 'the request should still have been sent');
    assert.notEqual(code, 0, 'a refused create must exit non-zero');
    assert.match(stdout, /did not create that project/);
    assert.match(stdout, /pausing agent-made projects/, 'the board reason must be shown to the caller');
  });
});

test('project create with missing args prints usage, exits 2, and sends nothing', async () => {
  await withStub(OK, async (port, seen) => {
    const noArgs = await cli(port, ['project', 'create']);
    assert.equal(noArgs.code, 2, 'missing both args should exit 2');
    assert.match(noArgs.stdout, /Usage: kosmos project create/);
    const oneArg = await cli(port, ['project', 'create', 'OnlyName']);
    assert.equal(oneArg.code, 2, 'missing the folder should exit 2');
    assert.equal(seen.length, 0, 'a malformed call must not POST anything');
  });
});

test('project (no subcommand) and an unknown subcommand print usage and exit 2', async () => {
  await withStub(OK, async (port, seen) => {
    const bare = await cli(port, ['project']);
    assert.equal(bare.code, 2);
    assert.match(bare.stdout, /Usage: kosmos project/);
    const bogus = await cli(port, ['project', 'wat']);
    assert.equal(bogus.code, 2);
    assert.match(bogus.stdout, /Unknown: kosmos project wat/);
    assert.equal(seen.length, 0, 'neither should POST anything');
  });
});
