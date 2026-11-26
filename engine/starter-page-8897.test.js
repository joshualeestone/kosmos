'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8897: the starter project shows the person what it is. projects.list (what /api/projects sends the page)
   marks the project Kosmos seeded `starter: true`, by the same isStarter rule the agents' instructions use, so the
   page can say it is a placeholder while it has no work. CONTROLS: a real empty project, the welcome project once
   renamed (the person's own), and a test project carry no mark. The page side (the empty list's sentence) is proven
   by docs/browser-checks/render-starter-empty-8897.js. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-page-8897-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const projects = require('./projects');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('the list the page reads marks the seeded starter project, and nothing else', () => {
  const home = projects.seedWelcomeHome({ roster: [] });
  assert.ok(home, 'fixture: the welcome project seeded');
  const real = projects.create({ name: 'Real empty 8897', made: { via: 'screen', by: null } });
  const testOnly = projects.create({ name: 'Test only 8897', made: { via: 'screen', by: null }, testOnly: true });

  const byId = new Map(projects.list([]).map((p) => [p.id, p]));
  assert.equal(byId.get(home.id).starter, true, 'the seeded welcome project is not marked starter');
  assert.equal(byId.get(real.id).starter, undefined, 'CONTROL: a real empty project is marked starter');
  assert.equal(byId.get(testOnly.id).starter, undefined, 'CONTROL: a test project is marked starter');
  assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(byId.get(real.id))), 'starter'),
    'the key travels for a project that is not the starter (it should be left out)');

  /* Renamed by the person: theirs now, no mark (the same rule as the instructions). */
  const seededName = home.name;
  projects.edit(home.id, { name: 'Q4 launch 8897' });
  const after = projects.list([]).find((p) => p.id === home.id);
  assert.equal(after.starter, undefined, 'a renamed welcome project is still marked starter');
  /* Review 1: CONTROL: the person's own project with the seeded name, made from the screen, is not the starter. */
  fs.mkdirSync(path.join(SANDBOX, 'lookalike-8897'), { recursive: true });
  const lookalike = projects.create({ name: seededName, folder: path.join(SANDBOX, 'lookalike-8897'), made: { via: 'screen', by: null } });
  assert.equal(projects.list([]).find((p) => p.id === lookalike.id).starter, undefined, 'a screen-made project with the starter\'s name is marked starter');
});
