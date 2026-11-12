import XCTest

/// kosmos#8221 slice 11: a scroll up from the newest message made without a finger (VoiceOver's three-finger swipe, Voice
/// Control, a keyboard's Page Up) runs on the UIKit list without the list putting itself back at the end while it runs.
/// The scroll is made as VoiceOver's is (the list told through personScrolls, which its accessibilityScroll override calls,
/// then the scroll; the real call scrolls nothing on a simulator with VoiceOver off), 6 s after the chat opens
/// (KOSMOS_SAMPLE_A11YSCROLL), in one of four modes (KOSMOS_SAMPLE_A11YSCROLL_MODE, see ChatList.sampleA11yScroll). The app
/// reports how many times the list pinned itself to the end while it ran, how far it moved, whether the reader is still at
/// the newest, and whether the person's-scroll window opened. The UIKit list only: the lazy list has no such pin.
final class A11yScrollUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private struct Report { let pins: Int; let atEnd: Bool; let moved: Int; let window: Bool; let dragged: Bool; let short: Int; let graced: Bool; let label: String }

    private func scrollUp(mode: String, fixOff: Bool = false, windowByClock: Bool = false, noStallGrace: Bool = false) throws -> Report {
        guard UIKitListArm.on else { throw XCTSkip("the lazy list has no pin to the end (UIKit list only)") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1",
                                 "KOSMOS_SAMPLE_A11YSCROLL": "6", "KOSMOS_SAMPLE_A11YSCROLL_MODE": mode]
        if fixOff { app.launchEnvironment["KOSMOS_SAMPLE_NOPERSONSCROLL"] = "1" }
        if windowByClock { app.launchEnvironment["KOSMOS_SAMPLE_WINDOWBYCLOCK"] = "1" }   // kosmos#8442: the control arm
        if noStallGrace { app.launchEnvironment["KOSMOS_SAMPLE_NOSTALLGRACE"] = "1" }   // kosmos#8442 review 2: the control arm
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        let marker = app.descendants(matching: .any).matching(identifier: "sample-a11y-scroll").firstMatch
        // kosmos#8221: the newest row, or the scroll's report that the newest message was on screen when it acted.
        XCTAssertTrue(UIKitListArm.openedAtNewest(newest, orReported: marker), "CONTROL: the long chat did not open at its newest message")
        XCTAssertTrue(marker.waitForExistence(timeout: 20), "CONTROL: the scroll never reported")
        // "sample a11y scroll pins <n>, at end <bool>, moved <n>, window <bool>, dragged <bool>, short <n>, from the end <bool>"
        let label = marker.label
        let words = label.replacingOccurrences(of: ",", with: "").split(separator: " ").map(String.init)
        func after(_ key: String) -> String? { words.firstIndex(of: key).flatMap { $0 + 1 < words.count ? words[$0 + 1] : nil } }
        XCTAssertEqual(words.last, "true", "CONTROL: the scroll did not start at the newest message: \(label)")
        print("UI-NOTE kosmos#8221 slice 11 \(mode)\(fixOff ? ", fix off" : "")\(windowByClock ? ", by the clock" : "")\(noStallGrace ? ", no stall grace" : ""): \(label)")
        guard let pins = after("pins").flatMap(Int.init), let moved = after("moved").flatMap(Int.init),
              let at = words.firstIndex(of: "at"), at + 2 < words.count, words[at + 1] == "end",
              let window = after("window"), let dragged = after("dragged"), let short = after("short").flatMap(Int.init) else {
            throw NSError(domain: "A11yScrollUITests", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreadable report: \(label)"])
        }
        return Report(pins: pins, atEnd: words[at + 2] == "true", moved: moved, window: window == "true", dragged: dragged == "true", short: short, graced: after("graced") == "true", label: label)
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

    func testWithoutTheFixAScrollThatMovesNothingCountsAsADrag() throws {
        let r = try scrollUp(mode: "still", fixOff: true)
        XCTAssertTrue(r.dragged, "CONTROL: without the fix the unused ask was not counted as a drag, so the still check cannot fail: \(r.label)")
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

    // kosmos#8442: the same slow scroll with the main thread held 0.6 s after its first move (longer than personScrollQuiet),
    // as a busy phone or CI's hosted Mac can. The moves after the stall still count as the person's: the window stays open
    // until its lapse check runs, which sees them moving. Before, read by the clock, the window had closed, the reader 15 pt
    // up was still "at the end" and was put back, and every later move was pinned (CI run 42906709675: pins 8, moved 0).
    func testASlowScrollWithAStallIsStillFollowed() throws {
        let r = try scrollUp(mode: "stalled")
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end after the stall: \(r.label)")
        XCTAssertGreaterThan(r.moved, 300, "the stalled scroll was stopped short: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still counted at the newest after scrolling up: \(r.label)")
    }

    // kosmos#8442 review 3: the stall grace on its own. With the window read by the clock (the first fix off), the moves
    // after the stall are not the person's and the lapse check comes about 0.35 s late; only the grace (one more quiet period, as
    // it ran late) keeps the window for the moves after it. The report says the grace fired, so this cannot pass on the
    // first fix; the control below (both off) is undone. Pins are not asserted: one can land before the late check runs.
    func testTheStallGraceAloneKeepsAStalledScroll() throws {
        let r = try scrollUp(mode: "stalled", windowByClock: true)
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
        XCTAssertTrue(r.graced, "the lapse check did not give the stall grace: \(r.label)")
        XCTAssertGreaterThan(r.moved, 300, "the stalled scroll was stopped short: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still counted at the newest after scrolling up: \(r.label)")
    }

    // The control: the list as before kosmos#8442, the window read by the clock alone and no stall grace (either one alone
    // keeps this scroll: measured on a simulator, the grace alone gave pins 1, moved 373). The stall closes the window, and
    // the scroll is undone (measured: pins 13, moved 0, as CI run 42906709675's pins 8, moved 0).
    func testWithTheWindowByTheClockAStalledScrollIsPutBackAtTheEnd() throws {
        let r = try scrollUp(mode: "stalled", windowByClock: true, noStallGrace: true)
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
        XCTAssertGreaterThan(r.pins, 0, "the control was not put back at the end, so the stalled check cannot see the defect: \(r.label)")
        XCTAssertLessThan(r.moved, 300, "the control's stalled scroll ran on: \(r.label)")
    }

    // kosmos#8442 review 2: an animated scroll (as VoiceOver's) with the main thread held 0.6 s a moment into it. Its later
    // frames are driven by the display, so they may run after the overdue lapse check. Measured on a simulator the scroll's
    // reported end decided it (kept with or without the stall grace); this pins that it is kept, whichever way it goes.
    func testAnAnimatedScrollWithAStallIsNotPutBack() throws {
        let r = try scrollUp(mode: "stalledAnimated")
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end after the stall: \(r.label)")
        XCTAssertGreaterThan(r.moved, 40, "the scroll did not move the list up: \(r.label)")
        XCTAssertFalse(r.atEnd, "the reader is still counted at the newest after scrolling up: \(r.label)")
    }

    // Its control: no stall grace. Recorded, not asserted to fail: whether the display's frames or the overdue check run
    // first after a stall is the system's choice. Measured on a simulator (iOS 27.0) it kept the scroll too (pins 0, moved
    // 408): the animation's end was reported and closed the window as the person's. The grace is for when it is not.
    func testRecordOnlyWithoutTheStallGraceAnAnimatedStalledScroll() throws {
        let r = try scrollUp(mode: "stalledAnimated", noStallGrace: true)
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened: \(r.label)")
    }

    // A jump to the newest (a send, New messages) during such a scroll wins: the scroll is stopped and the reader stays at
    // the newest, the scroll's later moves never reading them off it.
    func testAJumpToTheNewestDuringTheScrollWins() throws {
        let r = try scrollUp(mode: "jump")
        XCTAssertTrue(r.window, "CONTROL: the person's-scroll window never opened before the jump: \(r.label)")
        XCTAssertTrue(r.atEnd, "the scroll took the reader off the newest after the jump: \(r.label)")
        // How far short of the end, not how far it moved: the chat can grow during the scroll (measured: 63 pt), moving the end.
        XCTAssertLessThanOrEqual(abs(r.short), 2, "the list did not come back to the newest after the jump: \(r.label)")
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
