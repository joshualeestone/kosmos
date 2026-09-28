'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4421 (Josh, 2026-09-28): after renaming an agent, its page heading said "Demis Hassabis - Gemini" while the
 * "Direct Message to" title, every message label and the "is working" line said "Gemini-Sub". Those read
 * CURRENT.name, the card as it was when the agent was opened, and nothing refreshed it: a restart does not reopen
 * the agent. The fix copies the fresh card's name onto CURRENT on every poll (followRename), before anything paints.
 *
 * These run the REAL page functions (lifted from web/index.html): the poll's followRename, the message label
 * (dmWho) and the working line (busyRow). The title is 'Direct Message to ' + the name the poll passes, pinned by
 * source order below. The browser check docs/browser-checks/render-rename-4421.js drives the real poll in a page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);

const OLD = 'Gemini-Sub';          // the session name, which the old surfaces kept showing
const NEW = 'Demis Hassabis - Gemini';

function world() {
  const heading = { textContent: OLD };
  const nav = [];
  const doc = { getElementById: (id) => (id === 'd-name' ? heading : null) };
  const src = 'let CURRENT = null;\n'
    + page.liftConst(SCRIPT, 'WORKING_VERB') + '\n'
    // The avatar tints: one line each (DISC_INKS is aligned with two spaces, which liftConst does not match).
    + ['DISC_TINTS', 'DISC_INKS'].map((c) => (SCRIPT.match(new RegExp('^const ' + c + '\\s+=.*$', 'm')) || [''])[0]).join('\n') + '\n'
    + page.liftAll(SCRIPT, ['esc', 'initials', 'discIndex', 'discTint', 'discInk', 'busyRow', 'dmWho', 'followRename']) + '\n'
    + 'return { set: (c) => { CURRENT = c; }, get: () => CURRENT, followRename, dmWho, busyRow };';
  // eslint-disable-next-line no-new-func
  const w = new Function('document', 'detailNavNames', 'fitDetailName', src)(doc, (n) => nav.push(n), () => {});
  return { ...w, heading, nav };
}

const opened = () => ({ sessionName: OLD, name: OLD, state: 'working', hasAvatar: false });
const polled = () => ({ sessionName: OLD, name: NEW, state: 'working', hasAvatar: false });

test('#4421 fixture: before the poll, the page shows the name it was opened with (the bug\'s starting point)', () => {
  const w = world();
  w.set(opened());
  assert.equal(w.dmWho(OLD, w.get().name), OLD);
});

test('#4421: after a rename, the poll moves every surface to the new name, and the id is never shown', () => {
  const w = world();
  w.set(opened());
  const fresh = polled();
  w.followRename(fresh);
  const name = w.get().name;   // what the poll then passes to paintTalk and paintBusy
  assert.equal(name, NEW, 'CURRENT kept the old name, so every surface that reads it did too');
  assert.equal('Direct Message to ' + name, 'Direct Message to ' + NEW, 'the DM title');
  assert.equal(w.dmWho(OLD, name), NEW, 'the label on the agent\'s own messages');
  const busy = w.busyRow(fresh, name);
  assert.match(busy, new RegExp(NEW + ' is working'), 'the "is working" line: ' + busy);
  assert.doesNotMatch(busy, new RegExp(OLD), 'the "is working" line still names the id: ' + busy);
  assert.equal(w.heading.textContent, NEW, 'the heading follows a rename made anywhere else too');
  assert.deepEqual(w.nav, [NEW]);
});

test('#4421: no card this poll, another agent\'s card, or a card with no name keeps the last name rather than guessing', () => {
  const w = world();
  w.set(opened());
  w.followRename(null);
  w.followRename({ sessionName: 'someone-else', name: 'Someone Else' });
  w.followRename({ sessionName: OLD, name: '' });
  assert.equal(w.get().name, OLD);
  assert.equal(w.heading.textContent, OLD);
  assert.deepEqual(w.nav, [], 'the heading was repainted for nothing');
});

test('#4421: the poll follows the rename BEFORE it paints the title, the labels and the working line', () => {
  const at = (needle) => {
    const i = SCRIPT.indexOf(needle);
    assert.ok(i > 0, 'moved: ' + needle);
    return i;
  };
  const follow = at('followRename(fresh);');
  assert.ok(follow < at('paintTalk(CURRENT.sessionName, CURRENT.name);'), 'the title and labels are painted before the name follows');
  assert.ok(follow < at('paintBusy(fresh, CURRENT.name);'), 'the working line is painted before the name follows');
  assert.match(SCRIPT, /textContent = 'Direct Message to ' \+ name;/, 'the title no longer comes from the name the poll passes');
});
