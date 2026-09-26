'use strict';
/*
 * #3996: status.waitingTotal, the one number for what is waiting on the person (the Dock badge).
 * It is the page's three counters added: Needs you (counts.needsYou), Messages (each agent's
 * dmUnread) and Projects (counts.projectsUnread), the guide left out, unknown parts as 0.
 *
 *   node --test engine/status.waiting-3996.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');

const agent = (name, dmUnread, extra) => ({ sessionName: name, dmUnread, ...extra });

test('#3996: needs-you + every agent\'s unread DMs + unread project messages', () => {
  const counts = { needsYou: 2, projectsUnread: 5 };
  const agents = [agent('a', 3), agent('b', 0), agent('c', 1)];
  assert.equal(status.waitingTotal(counts, agents), 2 + 4 + 5);
});

test('#3996: each part counts on its own (a control per part)', () => {
  assert.equal(status.waitingTotal({ needsYou: 1, projectsUnread: 0 }, []), 1, 'needs-you');
  assert.equal(status.waitingTotal({ needsYou: 0, projectsUnread: 0 }, [agent('a', 2)]), 2, 'DMs');
  assert.equal(status.waitingTotal({ needsYou: 0, projectsUnread: 7 }, []), 7, 'projects');
  assert.equal(status.waitingTotal({ needsYou: 0, projectsUnread: 0 }, [agent('a', 0)]), 0, 'nothing waiting is zero, no badge');
});

test('#3996: the guide\'s unread DMs are left out, as the Messages tile leaves them out', () => {
  const agents = [agent('guide', 4, { isGuide: true }), agent('a', 1)];
  assert.equal(status.waitingTotal({ needsYou: 0, projectsUnread: 0 }, agents), 1);
});

test('#3996: an unknown part counts 0, never a guess (as on the tiles)', () => {
  assert.equal(status.waitingTotal(null, null), 0);
  assert.equal(status.waitingTotal({ needsYou: null, projectsUnread: undefined }, [agent('a', null), agent('b', 'x'), null]), 0);
  assert.equal(status.waitingTotal({ needsYou: -3, projectsUnread: NaN }, [agent('a', -1)]), 0, 'a negative is not a count');
  assert.equal(status.waitingTotal({ needsYou: 1, projectsUnread: 2.9 }, [agent('a', 1.5)]), 1 + 2 + 1, 'whole numbers only');
});
