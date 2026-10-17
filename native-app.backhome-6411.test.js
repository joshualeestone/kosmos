'use strict';
/**
 * kosmos#6411 part 1: View > Back to This Computer (Cmd-Shift-H). Since #6406 the Mac app's window can show another
 * computer, and the only way home was that computer's own switcher or quitting. The item shows only while the
 * window is on another computer; its rule (showsAnotherComputer) is proved by its rows in
 * --kosmos-app-mode-selftest, and the menu row by the bundle build's menu table (--kosmos-app-menu-selftest). This
 * file pins the wiring neither selftest reaches: when the item is shown or hidden (a hidden item's key equivalent is
 * ignored, so that decides the shortcut too), and that its action checks again and holds off during an update.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#6411: the item is built hidden, under View, with its own target and Cmd-Shift-H', () => {
  const menu = body('static func makeMainMenu(');
  const at = menu.indexOf('let homeItem = NSMenuItem(title: "Back to This Computer"');
  assert.ok(at > 0, 'View > Back to This Computer is gone');
  const end = menu.indexOf('viewMenu.addItem(homeItem)', at);
  assert.ok(end > at, 'the item is built but never added to View');
  const item = menu.slice(at, end);
  assert.match(item, /homeItem\.isHidden = true/, 'the item is not hidden from the start, so a window on this computer offers it');
  assert.match(item, /homeItem\.target = reloadTarget/, 'the item has no target (WebKit swallows a nil-targeted action)');
  assert.match(BUILD, /item:Back to This Computer\tshortcut:cmd\+shift\+h\taction:backToThisComputer:\ttarget:set/,
    'the build\'s menu table no longer expects the item');
});

test('#6411: the item is re-decided at every commit, when the page goes away, and on every mode switch', () => {
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)'), /updateBackHomeItem\(\)/,
    'a new page does not re-decide the item');
  assert.match(body('func webViewWebContentProcessDidTerminate(_ webView: WKWebView)'), /updateBackHomeItem\(\)/,
    'a page that went away leaves the item as it was');
  assert.match(body('private func updateRunAgentsItem()'), /updateBackHomeItem\(\)/, 'a mode switch does not re-decide the item');
  assert.match(body('private func isOnAnotherComputer() -> Bool'),
    /computerMode != \.connect && showsAnotherComputer\(committedPageURL, board: badgeOrigin, ownPlusHost: ownKosmosPlusHost\(\)\)/,
    'the item no longer follows the selftested rule, or shows on a connect computer');
});

test('#6411: the action checks again and holds off during an update before it loads', () => {
  const b = body('@objc func backToThisComputer(_ sender: Any?)');
  const load = b.indexOf('loadBoard()');
  const guard = b.indexOf('guard isOnAnotherComputer(), !boardStartInFlight else {');
  assert.ok(guard > 0 && guard < load, 'the action no longer checks, before loading, that the window is still on another computer');
  const update = b.indexOf('let updating = updateLookInFlight || (modeHome.map { Self.installUnderWay(kosmosHome: $0) } ?? false)');
  const hold = b.indexOf('guard !updating else {');
  assert.ok(update > 0 && hold > update && hold < load, 'the board can be started while an update is copying files in');
  // Not marked user-initiated: that wording sends the person to Cmd-R, which here reloads the other computer's page.
  assert.doesNotMatch(b, /boardRecoveryIsUserInitiated = true/, 'a failed start from this menu would tell the person to press Cmd-R, which does not retry it');
});

test('#6411: showsAnotherComputer has selftest rows both ways', () => {
  const st = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'));
  assert.match(st, /away\("https:\/\/amy\.kosmosplus\.com\/", "home\.kosmosplus\.com", true,/, 'no row proves another computer shows the item');
  assert.match(st, /away\("https:\/\/home\.kosmosplus\.com\/", "home\.kosmosplus\.com", false,/, 'no row proves this computer\'s own address hides it');
  assert.match(st, /away\("http:\/\/127\.0\.0\.1:16180\/\?tab=agents", "home\.kosmosplus\.com", false,/, 'no row proves the own board hides it');
});
