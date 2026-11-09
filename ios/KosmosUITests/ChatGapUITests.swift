import XCTest

/// kosmos#8283 (Josh 11-09, his screenshots against Discord's): the room between the newest message and the box, with the
/// keyboard up, on either list (TEST_RUNNER_KOSMOS_UIKITLIST), in Dana's chat while she works. Measured from the newest
/// message's whole bubble (its time line included, the last thing drawn above the box), as Josh measured by eye. Before this
/// card: 90 pt from its words to the box on the lazy list and 102 on the UIKit list; Discord's is about 34 pt.
final class ChatGapUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testTheGapAboveTheBoxIsDiscordsAndTheWorkingLineFitsInIt() throws { try measure(largest: false) }

    // The line grows with the text size and the room it sits in does not: at the largest size it must still clear the newest
    // message and the box (the gap is not held to Discord's there).
    func testTheWorkingLineFitsAtTheLargestText() throws { try measure(largest: true) }

    // A reader higher up sees the line too (it was a row at the end of the list before), over a ground that fades the messages
    // behind it out. The screenshot is the check of that fade; this asserts the line is there and the reader stayed put.
    func testTheWorkingLineShowsToAReaderHigherUp() throws {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_SCROLLUP": "40"]
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample never scrolled up")
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertFalse(newest.exists && newest.isHittable, "CONTROL: the newest message is on screen, so the reader is not higher up")
        let working = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Dana is working'")).firstMatch
        XCTAssertTrue(working.exists, "a reader higher up does not see the working line")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "chat-gap-working-line-higher-up"; shot.lifetime = .keepAlways; add(shot)
    }

    private func measure(largest: Bool) throws {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        if largest { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let words = "Pages 9 to 12 need the new photos"
        let text = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", words)).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        // The bubble is one element read as "Dana, <time>, <words>" (ChatBubble's spokenLabel).
        let bubble = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Dana' AND label CONTAINS %@", words)).firstMatch
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.exists, "CONTROL: no message box")
        try KeyboardSlideUITests.keyboardUp(app, box, text, shot: largest ? "chat-gap-keyboard-up-largest" : "chat-gap-keyboard-up", test: self)
        XCTAssertTrue(bubble.exists, "CONTROL: the newest message's bubble was not found")
        XCTAssertGreaterThan(bubble.frame.maxY, text.frame.maxY, "CONTROL: the bubble does not reach below its words")
        let working = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Dana is working'")).firstMatch
        XCTAssertTrue(working.exists, "CONTROL: no working line, so its place is not checked")
        let gap = box.frame.minY - bubble.frame.maxY
        let above = working.frame.minY - bubble.frame.maxY, below = box.frame.minY - working.frame.maxY
        let said = "\(UIKitListArm.on ? "uikit" : "lazy")\(largest ? " largest text" : ""): bubble to box \(gap); working line \(above) under the bubble, \(below) above the box's words"
        print("UI-NOTE kosmos#8283 " + said)
        if !largest { XCTAssertLessThanOrEqual(gap, 60, "the gap above the box is back: " + said) }
        XCTAssertGreaterThanOrEqual(above, 2, "the working line covers the newest message: " + said)
        XCTAssertGreaterThanOrEqual(below, 12, "the working line sits on the box: " + said)
    }
}
