'use strict';

/**
 * #1595: the STUCK screen's one way out ("open Terminal, type claude, follow its
 * sign-in") is gated in web/index.html on `st.canRunClaude`. becomeStuck computes
 * and writes that flag, but `publicView` (what /api/connect serves) never returned
 * it, so the page read `undefined` and the hatch never rendered. This pins that
 * the serving contract now carries the field.
 *
 *   node --test engine.publicview-canrun-1595.test.js
 *
 * The client half is already tested (server.connect.test.js pins that the stuck
 * screen reads `st && st.canRunClaude`); this is the server half that was missing,
 * which is why the client test passed while the feature was dead end to end.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const connect = require('./engine/connect');

test('#1595: publicView carries canRunClaude, so the stuck screen hatch reaches the client', () => {
  // The whole bug: a stuck state that CAN run claude must serve canRunClaude:true.
  const canRun = connect.publicView({ phase: 'stuck', because: 'x', canRunClaude: true });
  assert.equal(canRun.canRunClaude, true, 'a stuck state that can run claude did not serve the flag the hatch is gated on');
  assert.ok('canRunClaude' in canRun, 'canRunClaude is absent from the serving contract, so the page reads undefined and the hatch never renders (#1595)');

  // The other arm: cannot run claude serves false, not undefined, so the page
  // gets a real answer rather than a missing field.
  const cannot = connect.publicView({ phase: 'stuck', because: 'x', canRunClaude: false });
  assert.equal(cannot.canRunClaude, false, 'a stuck state that cannot run claude must serve false, not omit the field');

  // Default: a state that never set the flag (any non-stuck phase) serves false,
  // never undefined. becomeStuck is the only writer, so this is the common case.
  const idleish = connect.publicView({ phase: 'downloading' });
  assert.equal(idleish.canRunClaude, false, 'a state that never set canRunClaude must serve false, not leak undefined into the contract');

  // The addition did not drop any prior field: the tail/plan/because contract the
  // rest of the page depends on is intact.
  for (const k of ['configDir', 'phase', 'before', 'progress', 'url', 'plan', 'because', 'tail']) {
    assert.ok(k in canRun, 'publicView dropped the pre-existing field ' + k);
  }
});
