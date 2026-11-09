import XCTest

/// kosmos#8221 slice 11: a scroll up from the newest message made without a finger (VoiceOver's three-finger swipe, Voice
/// Control, a keyboard's Page Up) runs on the UIKit list without the list putting itself back at the end while it runs.
/// The scroll is made as VoiceOver's is (the list told through personScrolls, which its accessibilityScroll override calls,
/// then the scroll; the real call scrolls nothing on a simulator with VoiceOver off), 6 s after the chat opens
/// (KOSMOS_SAMPLE_A11YSCROLL), in one of three modes (KOSMOS_SAMPLE_A11YSCROLL_MODE, see ChatList.sampleA11yScroll). The app
/// reports how many times the list pinned itself to the end while it ran, how far it moved, whether the reader is still at
/// the newest, and whether the person's-scroll window opened. The UIKit list only: the lazy list has no such pin.
final class A11yScrollUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private struct Report { let pins: Int; let atEnd: Bool; let moved: Int; let window: Bool; let dragged: Bool; let label: String }

    private func scrollUp(mode: String, fixOff: Bool = false) throws -> Report {
        guard UIKitListArm.on else { throw XCTSkip("the lazy list has no pin to the end (UIKit list only)") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1",
                                 "KOSMOS_SAMPLE_A11YSCROLL": "6", "KOSMOS_SAMPLE_A11YSCROLL_MODE": mode]
        if fixOff { app.launchEnvironment["KOSMOS_SAMPLE_NOPERSONSCROLL"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        let marker = app.descendants(matching: .any).matching(identifier: "sample-a11y-scroll").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 20), "CONTROL: the scroll never reported")
        // "sample a11y scroll pins <n>, at end <bool>, moved <n>, window <bool>, dragged <bool>, from the end <bool>"
        let label = marker.label
        let words = label.replacingOccurrences(of: ",", with: "").split(separator: " ").map(String.init)
        func after(_ key: String) -> String? { words.firstIndex(of: key).flatMap { $0 + 1 < words.count ? words[$0 + 1] : nil } }
        XCTAssertEqual(words.last, "true", "CONTROL: the scroll did not start at the newest message: \(label)")
        print("UI-NOTE kosmos#8221 slice 11 \(mode)\(fixOff ? ", fix off" : ""): \(label)")
        guard let pins = after("pins").flatMap(Int.init), let moved = after("moved").flatMap(Int.init),
              let atEnd = after("end"), let window = after("window"), let dragged = after("dragged") else {
            throw NSError(domain: "A11yScrollUITests", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreadable report: \(label)"])
        }
        return Report(pins: pins, atEnd: atEnd == "true", moved: moved, window: window == "true", dragged: dragged == "true", label: label)
    }

    // The controls: before this slice the list pinned itself back during such a scroll. If a control reads 0 pins, the check
    // beside it cannot see the defect it guards (the scroll did not run, or the count is not reached), and proves nothing.
    func testWithoutTheFixAnAnimatedScrollIsHeldAtTheEnd() throws {
        let r = try scrollUp(mode: "animated", fixOff: true)
        XCTAssertGreaterThan(r.pins, 0, "CONTROL: without the fix the list was never put back at the end: \(r.label)")
    }

    func testWithoutTheFixASlowScrollIsHeldAtTheEnd() throws {
        let r = try scrollUp(mode: "stepped", fixOff: true)
        XCTAssertGreaterThan(r.pins, 0, "CONTROL: without the fix the list was never put back at the end: \(r.label)")
    }

    // One page up, its end reported.
    func testAnAnimatedScrollUpIsNotHeldAtTheEnd() throws {
        let r = try scrollUp(mode: "animated")
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end while the person's scroll ran: \(r.label)")
        XCTAssertGreaterThan(r.moved, 40, "the scroll did not move the list up: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still counted at the newest after scrolling up: \(r.label)")
    }

    // A scroll slower than the window's quiet time with no end reported: the window stays open while it moves (or the list
    // would hold the reader's place on each move and freeze it) and lets go after it stops, the reader where it left them.
    func testASlowScrollWithNoEndIsFollowedAndLetGo() throws {
        let r = try scrollUp(mode: "stepped")
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end while the person's scroll ran: \(r.label)")
        XCTAssertGreaterThan(r.moved, 300, "the slow scroll was stopped short: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still counted at the newest after scrolling up: \(r.label)")
    }

    // A jump to the newest (a send, New messages) during such a scroll wins: the scroll is stopped and the reader stays at
    // the newest, the scroll's later moves never reading them off it.
    func testAJumpToTheNewestDuringTheScrollWins() throws {
        let r = try scrollUp(mode: "jump")
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened before the jump: \(r.label)")
        XCTAssertTrue(r.atEnd, "the scroll took the reader off the newest after the jump: \(r.label)")
        XCTAssertLessThanOrEqual(abs(r.moved), 2, "the list did not come back to the newest after the jump: \(r.label)")
    }

    // Asked for, but nothing moves (an arrow key that only moves focus): no window opens, the reader stays at the newest, and
    // the ask is let go, so a later scroll nobody asked for is not counted as the person's.
    func testAScrollThatMovesNothingChangesNothing() throws {
        let r = try scrollUp(mode: "still")
        XCTAssertFalse(r.window, "a scroll that moved nothing opened the person's-scroll window: \(r.label)")
        XCTAssertTrue(r.atEnd, "a scroll that moved nothing took the reader off the newest: \(r.label)")
        XCTAssertEqual(r.moved, 0, "CONTROL: the still scroll moved the list: \(r.label)")
        XCTAssertFalse(r.dragged, "the unused ask still counts as the person's scroll: \(r.label)")
    }
}
