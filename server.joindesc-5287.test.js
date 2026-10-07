'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits

/**
 * kosmos#5287: a project JOINED from another account carries what its owner shared (handle and description, from the
 * federation link) in GET /api/projects, as `shared`, and the project page shows it as theirs. The owner's description
 * is never the project's own description (the brief its agents get). A `self` link (this account's other computer)
 * and an unshared project carry nothing.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.joindesc-5287.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-joindesc-5287-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const federation = require('./engine/federation');
const page = require('./test-support/page');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const listed = async () => {
  const r = await fetch(base + '/api/projects');
  assert.equal(r.status, 200);
  return (await r.json()).projects;
};

test('#5287: a joined project carries its owner and THEIR description; its own description stays empty', async () => {
  const joined = projects.create({ name: 'Henderson lease', agents: [], made: { via: 'screen', by: null } });
  federation.recordLink(joined.id, { role: 'member', edge_id: 'e1', owner_handle: 'ada', project_name: 'Henderson lease',
    project_desc: 'Close the lease by Friday.\nKeep the landlord in the loop.', project_created: joined.createdAt });
  const nameless = projects.create({ name: 'Quiet project', agents: [], made: { via: 'screen', by: null } });
  federation.recordLink(nameless.id, { role: 'member', edge_id: 'e2', owner_handle: null, project_name: 'Quiet project',
    project_desc: null, project_created: nameless.createdAt });
  const own = projects.create({ name: 'Mine elsewhere', agents: [], made: { via: 'screen', by: null } });
  federation.recordLink(own.id, { role: 'self', ref: 'r1', project_name: 'Mine elsewhere', project_created: own.createdAt });
  const plain = projects.create({ name: 'Local only', agents: [], made: { via: 'screen', by: null } });

  const all = await listed();
  const by = (id) => all.find((p) => p.id === id);
  assert.deepEqual(by(joined.id).shared, { owner: 'ada', description: 'Close the lease by Friday.\nKeep the landlord in the loop.' });
  assert.ok(!by(joined.id).description, 'the owner\'s words were copied into this project\'s own description (its agents\' brief)');
  assert.deepEqual(by(nameless.id).shared, { owner: null, description: null });
  assert.equal(by(own.id).shared, undefined, 'a self link (this account\'s own project) is not "shared by" anyone');
  assert.equal(by(plain.id).shared, undefined, 'CONTROL: an unshared project carries nothing');
});

/* The page half: the real painter, lifted from the shipped page, on a fake document holding only its three elements. */
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
function paint(p) {
  const els = { 'pj-one-shared': { hidden: true }, 'pj-one-shared-by': { textContent: '' }, 'pj-one-shared-desc': { textContent: '' } };
  const document = { getElementById: (id) => { if (!els[id]) throw new Error('unexpected element ' + id); return els[id]; } };
  new Function('document', page.lift(SCRIPT, 'pjPaintShared') + '\nreturn pjPaintShared;')(document)(p);
  return { hidden: els['pj-one-shared'].hidden, by: els['pj-one-shared-by'].textContent, desc: els['pj-one-shared-desc'].textContent };
}

test('#5287 page: the owner\'s words are shown as theirs, in quotes, under who shared it', () => {
  const got = paint({ shared: { owner: 'ada', description: 'Close the lease by Friday.' } });
  assert.equal(got.hidden, false);
  assert.equal(got.by, 'Shared by ada.kosmosplus.com.');
  assert.equal(got.desc, 'They describe it as: \u201cClose the lease by Friday.\u201d');
});

test('#5287 page: no name yet says so (the join screen\'s words); no description says so', () => {
  const got = paint({ shared: { owner: null, description: null } });
  assert.equal(got.by, 'Shared by a Kosmos+ account with no name yet.');
  assert.equal(got.desc, 'They did not add a description.');
  assert.equal(got.hidden, false);
});

test('#5287 page CONTROL: a project that is not shared shows no block at all', () => {
  assert.equal(paint({ name: 'Local only' }).hidden, true);
  assert.equal(paint(null).hidden, true);
});

test('#5287 wiring: paintOneProject calls the painter, and the block sits under the made line', () => {
  assert.match(page.lift(SCRIPT, 'paintOneProject'), /\n\s*pjPaintShared\(p\);/);
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="pj-one-shared"') > html.indexOf('id="pj-one-made"'), 'the block is not under the made line');
});
