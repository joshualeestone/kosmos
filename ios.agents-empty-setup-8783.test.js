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

test('kosmos#8783: the empty Agents tab offers "Make an agent", which opens the BOARD\'s New agent form', () => {
  const view = noAgentsView();
  assert.match(view, /accessibilityIdentifier\("agents-empty"\)/, 'CONTROL: this is the empty state');
  assert.match(view, /Button \{ createOnBoard\(\) \} label: \{\s*if creatingFirst \{ WorkingDots\(color: Palette\.card\)[^}]*\} else \{ Text\("Make an agent"\)/, 'no button that makes an agent');
  assert.match(view, /\.disabled\(creatingFirst\)/, 'kosmos#8954 review 1: a second tap while the computer is read is not ignored');
  const content = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'ContentView.swift'), 'utf8');
  // kosmos#8954 (Mona Lisa, 11-23): native only when the computer is connected AND has an AI account; otherwise the board's
  // form and its first-run setup, as this card wants for a person not yet set up.
  assert.match(content, /createOnBoard: \{ makeFirstAgent\(\) \}/, 'the empty-state button does not go through makeFirstAgent');
  assert.match(content, /guard board\.macURL != nil else \{ openCreate\(\.agent\); return \}/, 'not connected must open the board form');
  assert.match(content, /return NewAgentPicker\.emptyStateGoesNative\(connected: board\.macURL != nil, firstRunDone: done, accounts: rows\)/,
    'native only when the rule says so (first-run done and an account)');
  assert.match(content, /guard NewAgentPicker\.tapAnswerStands\(epochAtTap: epoch, epochNow: board\.chatEpoch, unlocked: isUnlocked\) else \{ return \}\s*firstAgentGen \+= 1; firstAgentNative = native[^\n]*\n\s*if native \{ newAgentOpen = true \} else \{ openCreate\(\.agent\) \}/,
    'review 1: a late answer must not open anything after a switch or the lock');
  // Review 2: the busy flag is reset BEFORE the late-answer gate, so a refused answer can never leave the button stuck.
  assert.match(content, /firstAgentBusy = false\s*guard NewAgentPicker\.tapAnswerStands/, 'the busy flag is not reset before the gate');
  // kosmos#8954 with #8957: the empty state learns which way its button goes when it appears, from the same decision.
  assert.match(view, /\.onAppear \{ checkFirstAgent\(\) \}/, 'the empty state does not check which way its button goes');
  assert.match(content, /private func checkFirstAgent\(\) \{[\s\S]*?await firstAgentDecision\(\)[\s\S]*?if gen == firstAgentGen && board\.chatEpoch == epoch \{ firstAgentNative = native \}/, 'the answer for the note is not the same decision as the tap, kept only for its computer');
  // Review 3: a switch clears the answer; closing the board page asks again (first-run may have just been finished there).
  assert.match(content, /onChange\(of: board\.chatEpoch\) \{ _ in[\s\S]*?firstAgentNative = nil; firstAgentGen \+= 1/, 'a computer switch keeps the previous answer');
  assert.match(content, /onChange\(of: todayBoard\) \{ open in if !open && firstAgentNative != nil \{ checkFirstAgent\(\) \} \}/, 'closing the board page does not ask again');
  // kosmos#8957 wrapped by #8954: the note that the tap opens the board shows only when it does (false), never while reading.
  assert.match(view, /if firstAgentGoesNative == false \{ OpensOnBoardNote\(\) \}/, 'the board note shows when the tap opens the native New Agent');
  assert.match(view, /accessibilityIdentifier\("agents-empty-setup"\)/, 'the button has no identifier for a UI test');
  assert.match(view, /Text\("It takes a few steps, and you can stop at any point\."\)/, 'Mona Lisa\'s line under the heading (11-19)');
});

test('kosmos#8783: the empty Agents tab no longer sends a cloud-only person to "your computer"', () => {
  assert.doesNotMatch(noAgentsView(), /on your computer/, 'a cloud-only customer has no computer to make one on');
});

test('kosmos#8783: the setup button is one tap, never an automatic jump on launch', () => {
  // An automatic openBoard() in an onAppear of the empty state would throw the person into a web view unasked.
  assert.doesNotMatch(noAgentsView(), /onAppear[\s\S]*openBoard\(\)/);
});
