'use strict';

/**
 * #4649 pilot walk (prod 0.7.35, the "Kosmos as main comms" join steps): two places a first-timer stalled.
 * - "needs Kosmos Plus on this computer" said what was missing but not where to turn it on.
 * - A project joined from another computer, with no agents of its own here, told the person to add an agent before the
 *   room opens, though posting there works and the agents that answer are on the other computer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const FED = fs.readFileSync(path.join(__dirname, 'engine', 'federation.js'), 'utf8');

test('#4649: every "needs Kosmos Plus" message says where to turn it on', () => {
  const where = /needs Kosmos Plus on this computer\. Turn it on in Settings, under Kosmos\+, then /;
  assert.match(SERVER, where, 'the own-code route');
  assert.match(FED, where, 'the join refusal');
  assert.match(PAGE, where, "the page's own copy of the join refusal");
  // CONTROL: no bare form is left anywhere a person can read it.
  for (const [name, src] of [['server.js', SERVER], ['engine/federation.js', FED], ['web/index.html', PAGE]]) {
    assert.equal(/needs Kosmos Plus on this computer\.['"]/.test(src), false, name + ' still ends the sentence without saying where');
  }
  // The place named is a real Settings section.
  assert.match(PAGE, /data-go="plus"[^>]*><span>Kosmos\+<\/span>/);
});

test('#4649: a joined project with no agents here says posting works, never "add an agent first"', () => {
  const i = PAGE.indexOf("Put an agent on this project and the room opens.");
  assert.notEqual(i, -1, 'CONTROL: the own-project empty line is still there for a project with no agents anywhere');
  const block = PAGE.slice(PAGE.lastIndexOf('const empty = body.ok === false', i), i + 80);
  assert.match(block, /p\.shared && typeof p\.shared === 'object'/, 'the shared branch is decided on p.shared');
  assert.match(block, /Nothing here yet\. Post below and the agents on the computer that shared this project receive it\./);
  assert.ok(block.indexOf('Post below and the agents on the computer') < block.indexOf('Put an agent on this project'), 'the shared case is tested first');
});
