import XCTest

/// kosmos#8221 slice 12: on the UIKit list, assistive focus (VoiceOver's one-finger swipe to the element above) moving to a
/// message above the screen while the reader is at the newest: the reader is no longer held at the end, and that message is
/// on screen and stays there. VoiceOver does not run on a simulator, so the app posts the notification VoiceOver posts, 6 s
/// after the chat opens (KOSMOS_SAMPLE_A11YFOCUS), in one of four modes (KOSMOS_SAMPLE_A11YFOCUS_MODE, see
/// ChatList.sampleA11yFocus), and reports what the list did. The UIKit list only: the lazy list has no such pin.
final class A11yFocusUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private struct Report { let found: Bool; let atEnd: Bool; let onScreen: Bool; let pins: Int; let moved: Int; let kind: String; let label: String }

    private func focus(mode: String, fixOff: Bool = false) throws -> Report {
        guard UIKitListArm.on else { throw XCTSkip("the lazy list has no pin to the end (UIKit list only)") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1",
                                 "KOSMOS_SAMPLE_A11YFOCUS": "6", "KOSMOS_SAMPLE_A11YFOCUS_MODE": mode]
        if fixOff { app.launchEnvironment["KOSMOS_SAMPLE_NOFOCUSFOLLOW"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        let marker = app.descendants(matching: .any).matching(identifier: "sample-a11y-scroll").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 20), "CONTROL: the focus never reported")
        // "sample a11y scroll focus found <bool>, at end <bool>, on screen <bool>, pins <n>, moved <n>, kind <name>, from the end <bool>"
        let label = marker.label
        let words = label.replacingOccurrences(of: ",", with: "").split(separator: " ").map(String.init)
        func after(_ key: String) -> String? { words.firstIndex(of: key).flatMap { $0 + 1 < words.count ? words[$0 + 1] : nil } }
        print("UI-NOTE kosmos#8221 slice 12 \(mode)\(fixOff ? ", fix off" : ""): \(label)")
        XCTAssertEqual(words.last, "true", "CONTROL: the focus did not start at the newest message: \(label)")
        guard words.contains("focus"), let found = after("found"), let pins = after("pins").flatMap(Int.init),
              let moved = after("moved").flatMap(Int.init), let kind = after("kind"),
              let at = words.firstIndex(of: "at"), at + 2 < words.count, words[at + 1] == "end",
              let on = words.firstIndex(of: "on"), on + 2 < words.count, words[on + 1] == "screen" else {
            throw NSError(domain: "A11yFocusUITests", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreadable report: \(label)"])
        }
        return Report(found: found == "true", atEnd: words[at + 2] == "true", onScreen: words[on + 2] == "true", pins: pins,
                      moved: moved, kind: kind, label: label)
    }

    // The controls: before this slice the focus changed nothing, so the message stayed off screen with the reader at the end.
    // If a control reads the message on screen, the check beside it cannot see the defect.
    func testWithoutTheFixAFocusAboveTheScreenLeavesTheMessageOffIt() throws {
        let r = try focus(mode: "above", fixOff: true)
        XCTAssertTrue(r.found, "CONTROL: the focused element was not placed on its row: \(r.label)")
        XCTAssertFalse(r.onScreen, "CONTROL: without the fix the message came on screen anyway: \(r.label)")
        XCTAssertTrue(r.atEnd, "CONTROL: without the fix the reader left the newest: \(r.label)")
    }

    func testWithoutTheFixVoiceOversScrollIsPutBackAtTheEnd() throws {
        let r = try focus(mode: "after", fixOff: true)
        XCTAssertFalse(r.onScreen, "CONTROL: without the fix VoiceOver's scroll kept the message on screen: \(r.label)")
        XCTAssertTrue(r.atEnd, "CONTROL: without the fix the reader left the newest: \(r.label)")
    }

    // A message above the screen, focused with no scroll of VoiceOver's: put on screen, the reader off the newest, never
    // pinned back.
    func testAFocusAboveTheScreenBringsTheMessageOnScreen() throws {
        let r = try focus(mode: "above")
        XCTAssertTrue(r.found, "CONTROL: the focused element was not placed on its row: \(r.label)")
        XCTAssertTrue(r.onScreen, "the focused message is not on screen: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still held at the newest: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end after the focus: \(r.label)")
        XCTAssertGreaterThan(r.moved, 40, "the list did not move up: \(r.label)")
    }

    // VoiceOver's scroll first (pinned back by the list), then the focus: the focus brings the message back.
    func testVoiceOversScrollThenTheFocusKeepsTheMessageOnScreen() throws {
        let r = try focus(mode: "after")
        XCTAssertTrue(r.found, "CONTROL: the focused element was not placed on its row: \(r.label)")
        XCTAssertTrue(r.onScreen, "the focused message is not on screen: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still held at the newest: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end after the focus: \(r.label)")
    }

    // The focus first, then VoiceOver's scroll: the scroll is followed, not pinned back.
    func testTheFocusThenVoiceOversScrollIsFollowed() throws {
        let r = try focus(mode: "first")
        XCTAssertTrue(r.found, "CONTROL: the focused element was not placed on its row: \(r.label)")
        XCTAssertTrue(r.onScreen, "the focused message is not on screen: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still held at the newest: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end during VoiceOver's scroll: \(r.label)")
    }

    // A message already on screen, focused with the element SwiftUI made for it: found by its cell, and nothing changes.
    func testAFocusOnScreenChangesNothing() throws {
        let r = try focus(mode: "visible")
        XCTAssertNotEqual(r.kind, "list", "CONTROL: no SwiftUI element was found in an on-screen cell: \(r.label)")
        XCTAssertTrue(r.found, "the SwiftUI element was not traced to its row: \(r.label)")
        XCTAssertTrue(r.atEnd, "a focus on screen took the reader off the newest: \(r.label)")
        XCTAssertEqual(r.moved, 0, "a focus on screen moved the list: \(r.label)")
    }
}
