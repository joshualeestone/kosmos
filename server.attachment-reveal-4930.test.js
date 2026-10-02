'use strict';
/*
 * kosmos#4930: POST /api/attachment/<id>/reveal on the real board selects THAT attachment's stored file in Finder (the
 * full-page preview's "Open in Finder"). The file comes from the stored record by id alone, so nothing in the request
 * names a path; an unknown or malformed id reveals nothing. The opener is stubbed at its seam.
 *
 *   node --test server.attachment-reveal-4930.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-reveal-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-reveal-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-reveal-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-reveal-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-attach-reveal-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const attachments = require('./engine/attachments');
const projects = require('./engine/projects');

const calls = [];
test.before(async () => {
  await start(0);
  projects.setRevealPlatform('darwin');
  projects.setRevealRunner((bin, args) => { calls.push([bin, args]); return { ok: true }; });
});
test.after(() => {
  projects.setRevealPlatform(null);
  projects.setRevealRunner(null);
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});
const reveal = (id) => fetch(`http://127.0.0.1:${server.address().port}/api/attachment/${id}/reveal`, { method: 'POST' });

test('#4930 sandbox: attachments are stored in this test\'s data root', () => {
  assert.ok(attachments.ROOT.startsWith(SANDBOX + path.sep), attachments.ROOT);
});

test('#4930: the attachment\'s own stored file is selected (open -R), found by its id', async () => {
  const row = attachments.save('agent', 'ava', { name: 'shot.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
  const id = row.id || (String(row.url || '').match(/[0-9a-f]{24}/) || [])[0];
  assert.match(String(id), /^[0-9a-f]{24}$/, 'the saved row named no id');
  calls.length = 0;
  const r = await reveal(id);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/usr/bin/open');
  assert.equal(calls[0][1][0], '-R', 'the file was opened rather than selected');
  assert.equal(calls[0][1][1], attachments.read(id).file);
  assert.ok(calls[0][1][1].startsWith(SANDBOX + path.sep));
});

test('#4930: an unknown or malformed id reveals nothing', async () => {
  calls.length = 0;
  assert.equal((await reveal('f'.repeat(24))).status, 404);
  assert.equal((await reveal('not-an-id')).status, 404);
  assert.equal(calls.length, 0, 'something was revealed for an id with no attachment');
});
