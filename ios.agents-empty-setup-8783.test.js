'use strict';

/**
 * kosmos#8783 item 2: the iPhone app's Agents tab, with a board that answers but has no agents, offers a way into setup.
 * A cloud-only customer (11-19) saw "No agents yet / Make your first one on your computer." with no button: there is no
 * computer of theirs to do that on, and the first step (connecting a model) is the board's own setup, which they could
 * reach only through Settings. Read from the Swift source, since iOS CI compiles the app but runs no UI tests.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'AgentsView.swift'), 'utf8');

function noAgentsView() {
  const at = SRC.indexOf('private var noAgents: some View {');
  assert.ok(at > 0, 'the no-agents view was not found');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at));
}

test('kosmos#8783: the empty Agents tab offers "Set up Kosmos", which opens the board (its setup)', () => {
  const view = noAgentsView();
  assert.match(view, /accessibilityIdentifier\("agents-empty"\)/, 'CONTROL: this is the empty state');
  assert.match(view, /Button \{ openBoard\(\) \} label: \{ Text\("Set up Kosmos"\)/, 'no button into setup');
  assert.match(view, /accessibilityIdentifier\("agents-empty-setup"\)/, 'the button has no identifier for a UI test');
});

test('kosmos#8783: the empty Agents tab no longer sends a cloud-only person to "your computer"', () => {
  assert.doesNotMatch(noAgentsView(), /on your computer/, 'a cloud-only customer has no computer to make one on');
});

test('kosmos#8783: the setup button is one tap, never an automatic jump on launch', () => {
  // An automatic openBoard() in an onAppear of the empty state would throw the person into a web view unasked.
  assert.doesNotMatch(noAgentsView(), /onAppear[\s\S]*openBoard\(\)/);
});
