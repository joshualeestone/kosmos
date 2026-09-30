'use strict';

/**
 * #4800: the owner's community list says why an agent's posts wait when an account under its name exists without a
 * key on this board. communityMineWord is extracted from the page and CALLED, so the branch is proven reachable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function sliceFn(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}
// eslint-disable-next-line no-new-func
const communityMineWord = new Function(sliceFn('communityMineWord') + '\nreturn communityMineWord;')();

test('#4800: a pending post of an agent whose name is held says so, and that Kosmos checks again', () => {
  const w = communityMineWord({ state: 'pending', agentNameUnclaimed: true });
  assert.match(w, /^Not sent\. An earlier try made a community account under a name this agent used/);
  assert.match(w, /rather than go out under a second name\.$/);
  assert.equal(/again|every hour/.test(w), false, 'the line promises a retry that only the service can end');
  assert.equal(w.includes('—'), false, 'an em dash reached the owner');
});

test('#4800 CONTROL: an ordinary pending post keeps its own words', () => {
  assert.equal(communityMineWord({ state: 'pending' }), 'Not sent yet. Kosmos tries again every few minutes.');
  // A refused agent is still said first (its posts never go out whatever the name).
  assert.match(communityMineWord({ state: 'pending', agentRefused: true, agentNameUnclaimed: true }), /refused this agent/);
  // Only a PENDING held post says it: once the owner deletes it (withheld) or it went out, the usual words.
  assert.equal(communityMineWord({ state: 'withheld', deleteRequested: true, agentNameUnclaimed: true }), 'Deleted before it was sent');
  assert.equal(communityMineWord({ state: 'sent', agentNameUnclaimed: true }), 'In the community');
});
