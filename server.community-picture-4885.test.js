'use strict';
/*
 * kosmos#4885: GET /api/community-industry also carries the two picture counts Settings shows (picturesStuck,
 * picturesUnsendable), from the send layer when it has them: 0 when it does not (a board without the picture pass),
 * null when it throws (cannot tell), and the count otherwise. On the real board; the send layer is stubbed at its seam.
 *
 *   node --test server.community-picture-4885.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-picture-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-picture-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-picture-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-picture-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-picture-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const communitysend = require('./engine/communitysend');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const url = () => `http://127.0.0.1:${server.address().port}/api/community-industry`;
const put = (b) => fetch(url(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) });

const real = { u: communitysend.pictureUnreachable, s: communitysend.pictureUnsendable, f: communitysend.pictureToFit };
test.afterEach(() => {
  for (const [k, v] of [['pictureUnreachable', real.u], ['pictureUnsendable', real.s], ['pictureToFit', real.f]]) {
    if (v === undefined) delete communitysend[k]; else communitysend[k] = v;
  }
});
const read = async () => { const r = await fetch(url()); assert.equal(r.status, 200); return r.json(); };

test('#4885: a send layer without the picture pass gives 0 for both counts', async () => {
  delete communitysend.pictureUnreachable; delete communitysend.pictureUnsendable;
  const j = await read();
  assert.equal(j.picturesStuck, 0);
  assert.equal(j.picturesUnsendable, 0);
});

test('#4885: the counts are the send layer\'s, and a send layer that throws gives null (cannot tell), not 0', async () => {
  communitysend.pictureUnreachable = () => 2;
  communitysend.pictureUnsendable = () => 3;
  let j = await read();
  assert.equal(j.picturesStuck, 2);
  assert.equal(j.picturesUnsendable, 3);
  communitysend.pictureUnreachable = () => { throw new Error('no'); };
  communitysend.pictureUnsendable = () => { throw new Error('no'); };
  j = await read();
  assert.equal(j.picturesStuck, null);
  assert.equal(j.picturesUnsendable, null);
  assert.equal(j.ok, true, 'a picture count failing broke the industry answer');
});

test('#4885: a PUT answers with the same counts, so saving an industry does not blank the picture lines', async () => {
  communitysend.pictureUnreachable = () => 1;
  communitysend.pictureUnsendable = () => 4;
  const r = await put({ industry: null });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.picturesStuck, 1);
  assert.equal(j.picturesUnsendable, 4);
});

test('#5302: the agents to fit are the send layer\'s list (at most 100); none without it; null when it throws', async () => {
  delete communitysend.pictureToFit;
  assert.deepEqual((await read()).picturesToFit, []);
  communitysend.pictureToFit = () => ['ava', 'bo'];
  assert.deepEqual((await read()).picturesToFit, [{ name: 'ava', ver: 0 }, { name: 'bo', ver: 0 }], 'each name with its picture version (0: none)');
  communitysend.pictureToFit = () => Array.from({ length: 150 }, (_, i) => 'a' + i);
  assert.equal((await read()).picturesToFit.length, 100);
  communitysend.pictureToFit = () => null;
  assert.deepEqual((await read()).picturesToFit, []);
  communitysend.pictureToFit = () => { throw new Error('no'); };
  const j = await read();
  assert.equal(j.picturesToFit, null);
  assert.equal(j.ok, true, 'the list failing broke the industry answer');
});

test('#5302: a refit PUT names the version it read; the route refuses a changed picture and keeps the original first', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /const refitOf = req\.headers\['x-kosmos-refit-of'\];\n\s*if \(refitOf !== undefined\) \{\n\s*if \(String\(store\.avatarVersion\(name\)\) !== String\(refitOf\)\) \{ sendJson\(res, 409,[^\n]*\n\s*store\.keepAvatarOriginal\(name\);\n\s*\}\n\s*store\.saveAvatar\(/);
});
