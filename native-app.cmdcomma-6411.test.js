'use strict';
/**
 * kosmos#6411 part 2: since #6406 a run or both Mac can show another computer in its window, and Cmd-, then
 * clicked THAT computer's Settings tab while the menu reads as this computer's. openSettings now refuses unless the
 * page on screen is this computer's: its own board or its own Kosmos+ address (isOwnSettingsPage). The function's behaviour is proved by its rows in
 * --kosmos-app-mode-selftest, which the bundle build runs and counts; this file pins that the guard is in
 * openSettings, before anything touches the window or the page, and that the rows exist. No selftest reaches
 * the menu itself (a WebKit window).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#6411: Cmd-, refuses unless the window is on this computer, before it touches the page', () => {
  const b = body('@objc func openSettings(_ sender: Any?)');
  const guard = b.search(/\n\s+guard isOwnSettingsPage\(committedPageURL, board: badgeOrigin, ownPlusHost: ownKosmosPlusHost\(\)\) else \{\n\s+NSSound\.beep\(\);/);
  assert.ok(guard > 0, 'openSettings no longer refuses when the window shows another computer');
  const connect = b.indexOf('guard computerMode != .connect else { NSSound.beep(); return }');
  assert.ok(connect > 0 && connect < guard, 'the connect-computer refusal (#4356) is gone or no longer comes first');
  assert.ok(guard < b.indexOf('window.makeKeyAndOrderFront(nil)'), 'the window is brought forward before the guard');
  assert.ok(guard < b.indexOf('webView.evaluateJavaScript(js)'), 'the page is driven before the guard');
});

test('#6411: isOwnBoardPage is the own-board half of isBoardPage, and its rows are in the mode selftest', () => {
  const isBoard = SRC.slice(SRC.indexOf('func isBoardPage('), SRC.indexOf('\n}\n', SRC.indexOf('func isBoardPage(')));
  assert.match(isBoard, /return isOwnBoardPage\(page, board: board\)/, 'isBoardPage no longer reads isOwnBoardPage for its own-board half');
  const st = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'));
  assert.match(st, /own\("https:\/\/josh\.kosmosplus\.com\/#kst=abc", here, false, "ANOTHER COMPUTER IN THE WINDOW/,
    'the selftest no longer proves another computer is refused');
  assert.match(st, /own\("http:\/\/127\.0\.0\.1:16180\/\?tab=agents", here, true,/, 'CONTROL: the own board is accepted');
  assert.match(st, /settings\("https:\/\/home\.kosmosplus\.com\/\?tab=agents", "home\.kosmosplus\.com", true,/,
    'the selftest no longer proves this computer\'s own Kosmos+ address is accepted');
  assert.match(st, /settings\("https:\/\/josh\.kosmosplus\.com\/", "home\.kosmosplus\.com", false,/,
    'the selftest no longer proves another computer\'s address is refused');
  assert.match(st, /settings\("https:\/\/evil\.example\/", "evil\.example", false,/,
    'the selftest no longer proves an address file naming a non-Kosmos+ host accepts nothing');
  // The address the app reads is the board's own record (engine/remote.js address()).
  const at = SRC.indexOf('func ownKosmosPlusHost() -> String? {');
  assert.ok(at > 0, 'ownKosmosPlusHost is gone');
  const reader = SRC.slice(at, SRC.indexOf('\n}\n', at));
  // The override first, an empty one falling through, then the store's remote/address (engine/remote.js STATE_DIR).
  assert.match(reader, /if let dir = env\["AGENT_WORKFORCE_TUNNEL_STATE"\], !dir\.isEmpty \{\n\s+file = URL\(fileURLWithPath: dir\)\.appendingPathComponent\("address"\)\n\s+\} else \{\n\s+file = storeFileURL\("remote\/address"\)\n\s+\}/,
    'the address file is no longer the tunnel-state override first, else the store\'s remote/address');
  assert.match(reader, /return ownPlusHostFrom\(/, 'the file\'s text no longer goes through ownPlusHostFrom (its selftest rows)');
  const remote = fs.readFileSync(path.join(__dirname, 'engine', 'remote.js'), 'utf8');
  assert.match(remote, /fs\.readFileSync\(path\.join\(STATE_DIR\(\), 'address'\), 'utf8'\)\.trim\(\)/, 'the board keeps its address somewhere else now');
  assert.match(remote, /const STATE_DIR = \(\) => process\.env\.AGENT_WORKFORCE_TUNNEL_STATE \|\| path\.join\(BASE, 'remote'\);/);
});
