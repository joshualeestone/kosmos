import XCTest

/// kosmos#8221 slice 11: a scroll up from the newest message made without a finger (VoiceOver's three-finger swipe, Voice
/// Control, a keyboard's Page Up) runs on the UIKit list without the list putting itself back at the end on every frame and
/// then jumping to where the scroll ended. The scroll is made as VoiceOver's is (the list told through personScrolls, which
/// its accessibilityScroll override calls, then an animated page scroll; the real call scrolls nothing on a simulator with
/// VoiceOver off), 6 s after the chat opens (KOSMOS_SAMPLE_A11YSCROLL); the app reports how many times the list pinned
/// itself to the end in the 1.5 s after it. The UIKit list only: the lazy list has no such pin (skipped there).
final class A11yScrollUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func scrollUp(fixOff: Bool) throws -> (pins: Int, atEnd: Bool, moved: Int) {
        guard UIKitListArm.on else { throw XCTSkip("the lazy list has no pin to the end (UIKit list only)") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1",
                                 "KOSMOS_SAMPLE_A11YSCROLL": "6"]
        if fixOff { app.launchEnvironment["KOSMOS_SAMPLE_NOPERSONSCROLL"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        let marker = app.descendants(matching: .any).matching(identifier: "sample-a11y-scroll").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 20), "CONTROL: the accessibility scroll never reported")
        // "sample a11y scroll pins <n>, at end <bool>, moved <n>, from the end <bool>"
        let words = marker.label.replacingOccurrences(of: ",", with: "").split(separator: " ").map(String.init)
        func after(_ key: String) -> String? { words.firstIndex(of: key).flatMap { $0 + 1 < words.count ? words[$0 + 1] : nil } }
        let fromEnd = words.suffix(1).first
        XCTAssertEqual(fromEnd, "true", "CONTROL: the scroll did not start at the newest message: \(marker.label)")
        guard let pins = after("pins").flatMap(Int.init), let moved = after("moved").flatMap(Int.init),
              let atEndWord = words.firstIndex(of: "end").map({ words[$0 + 1] }) else {
            XCTFail("unreadable report: \(marker.label)"); return (0, true, 0)
        }
        print("UI-NOTE kosmos#8221 slice 11 \(fixOff ? "fix off" : "fix on"): \(marker.label)")
        return (pins, atEndWord == "true", moved)
    }

    // The control: before this slice the list pinned itself back during the scroll. If this reads 0, the check cannot see
    // the defect it guards (the scroll did not run, or the count is not reached), and the test below proves nothing.
    func testWithoutTheFixTheListIsHeldAtTheEnd() throws {
        let r = try scrollUp(fixOff: true)
        XCTAssertGreaterThan(r.pins, 0, "CONTROL: without the fix the list was never put back at the end, so the check below cannot fail")
    }

    func testAScrollUpWithoutAFingerIsNotHeldAtTheEnd() throws {
        let r = try scrollUp(fixOff: false)
        XCTAssertEqual(r.pins, 0, "the list put itself back at the end \(r.pins) times while the person's scroll ran")
        XCTAssertGreaterThan(r.moved, 40, "the scroll did not move the list up (moved \(r.moved) pt)")
        XCTAssertFalse(r.atEnd, "the reader is still counted at the newest after scrolling up")
    }
}
