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

test('#6411: the item is re-decided at every commit, when the page goes away, and on the switches through updateRunAgentsItem', () => {
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)'), /updateBackHomeItem\(\)/,
    'a new page does not re-decide the item');
  assert.match(body('func webViewWebContentProcessDidTerminate(_ webView: WKWebView)'), /updateBackHomeItem\(\)/,
    'a page that went away leaves the item as it was');
  assert.match(body('private func updateRunAgentsItem()'), /updateBackHomeItem\(\)/, 'a mode switch does not re-decide the item');
  // Both parts, in either order: a reorder of the two conditions is not a change of rule.
  const away = body('private func isOnAnotherComputer() -> Bool');
  assert.match(away, /computerMode != \.connect/, 'the item shows on a connect computer, which has no board of its own');
  assert.match(away, /showsAnotherComputer\(committedPageURL, board: badgeOrigin, ownPlusHost: ownKosmosPlusHost\(\)\)/,
    'the item no longer follows the selftested rule');
  assert.doesNotMatch(away, /\|\|/, 'the two conditions are no longer both required');
});

test('#6411: the action checks again and holds off during an update before it loads', () => {
  const b = body('@objc func backToThisComputer(_ sender: Any?)');
  const load = b.indexOf('loadBoard()');
  const guard = b.indexOf('guard isOnAnotherComputer(), !boardStartInFlight else {');
  assert.ok(guard > 0 && guard < load, 'the action no longer checks, before loading, that the window is still on another computer');
  const update = b.indexOf('let updating = updateLookInFlight || (modeHome.map { Self.installUnderWay(kosmosHome: $0) } ?? false)');
  const hold = b.indexOf('guard !updating else {');
  assert.ok(update > 0 && hold > update && hold < load, 'the board can be started while an update is copying files in');
  // Marked as a start from this item, just before loadBoard: Cmd-R here reloads the other computer's page.
  const mark = b.indexOf('boardStartFromBackHome = true');
  assert.ok(mark > hold && mark < load, 'the start is not marked as from Back to This Computer before loadBoard, so its failure says Cmd-R');
});

test('#6411: a start from Back to This Computer that fails or hangs says to choose it again, not Cmd-R', () => {
  const lb = body('private func loadBoard()');
  // Read into this start's origin and cleared before ANY return, so an early return (connect, KOSMOS_URL, an
  // install that cannot be resolved), which never sets boardStartInFlight, cannot leave it set for a later start.
  const read = lb.indexOf('let origin: BoardStartOrigin = boardStartFromBackHome ? .backHome : (boardRecoveryIsUserInitiated ? .reload : .launch)');
  const clear = lb.indexOf('boardStartFromBackHome = false');
  assert.ok(read > 0 && clear > read, 'loadBoard does not take the marker into this start and then clear it');
  assert.doesNotMatch(lb.slice(0, clear), /\breturn\b/, 'loadBoard can return before it clears the marker');
  // Statements only (a line of its own), so the declaration's initial value is not counted.
  assert.equal((SRC.match(/^\s+boardStartFromBackHome = true$/gm) || []).length, 1, 'something other than backToThisComputer sets the marker');
  assert.equal((SRC.match(/^\s+boardStartFromBackHome = false$/gm) || []).length, 1, 'the marker is cleared somewhere other than loadBoard, so it may not follow one start');
  // Both messages branch on this start's origin as advised when shown (boardStartAdvice: Reload's advice if the item
  // has gone), through the one place that says how to try again.
  assert.match(lb, /let advise = self\.boardStartAdvice\(for: origin\)\n\s+self\.showStartupFailureAlert\(detail: "Kosmos is taking unusually long to start\. Click OK, then \\\(boardStartRetry\(advise\)\)\.", title: "Kosmos is still starting"\)/,
    'the watchdog no longer follows the start origin, as advised when it shows');
  assert.match(lb, /let advise = self\.boardStartAdvice\(for: origin\)\n\s+self\.showStartupFailureAlert\(detail: "Something went wrong while \\\(whose\) was starting\. \\\(boardStartFailureRemedy\(advise\)\)"\)/,
    'the failure alert no longer follows the start origin, as advised when it shows');
  assert.match(body('private func boardStartAdvice(for origin: BoardStartOrigin) -> BoardStartOrigin'),
    /boardStartAdviceOrigin\(origin, itemShown: isOnAnotherComputer\(\)\)/, 'the advice no longer checks whether the item is shown');
  assert.doesNotMatch(lb, /Cmd-R \(View > Reload\)|installing it again/i, 'loadBoard spells out its own advice again, beside boardStartRetry');
  const retryAt = SRC.indexOf('func boardStartRetry(_ origin: BoardStartOrigin) -> String');
  assert.ok(retryAt > 0, 'boardStartRetry is gone from main.swift');
  const retry = SRC.slice(retryAt, SRC.indexOf('\n}\n', retryAt));
  assert.match(retry, /origin == \.backHome\s*\? "choose View > Back to This Computer \(Cmd-Shift-H\) to try again"/,
    'a start from Back to This Computer no longer says to choose it again');
  const remedy = SRC.slice(SRC.indexOf('func boardStartFailureRemedy('), SRC.indexOf('\n}\n', SRC.indexOf('func boardStartFailureRemedy(')));
  // Back home and Reload share one string, which differs only in its retry step, so the two cannot drift.
  assert.match(remedy, /case \.reload, \.backHome: return "This can be temporary: click OK, then \\\(boardStartRetry\(origin\)\)\. If it keeps failing, installing it again /,
    'the back-home failure no longer says what Reload does with only its retry step changed');
  assert.doesNotMatch(remedy, /Cmd-R/, 'the failure remedy names Cmd-R itself instead of through boardStartRetry');
  // The selftest proves the words; this proves it has a row for this case.
  const st = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'));
  assert.match(st, /retry\(\.backHome, /, 'no selftest row proves the back-home wording');
  assert.match(st, /advise\(\.backHome, false, \.reload, /, 'no selftest row proves a back-home start whose item has gone advises Reload');
});

test('#6411: showsAnotherComputer has selftest rows both ways', () => {
  const st = SRC.slice(SRC.indexOf('if CommandLine.arguments.contains("--kosmos-app-mode-selftest")'));
  assert.match(st, /away\("https:\/\/amy\.kosmosplus\.com\/", "home\.kosmosplus\.com", true,/, 'no row proves another computer shows the item');
  assert.match(st, /away\("https:\/\/home\.kosmosplus\.com\/", "home\.kosmosplus\.com", false,/, 'no row proves this computer\'s own address hides it');
  assert.match(st, /away\("http:\/\/127\.0\.0\.1:16180\/\?tab=agents", "home\.kosmosplus\.com", false,/, 'no row proves the own board hides it');
});
