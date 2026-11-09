import XCTest

// kosmos#8221 slice 7: earlier messages load when the reader reaches the top of a long chat, on both lists (UIKitListArm).
// The sample board's long chat (KOSMOS_SAMPLE_LONG) shows Dana's newest 220 messages, "Message 41 of 260." to "Message 260 of
// 260.", with 40 older ones a page away (BoardClient.sampleOlder: "Checking the venue list, item 1." is the oldest). Both are
// on Friday 23 October, so one day line heads the chat: above "Message 41" before the page lands, above "item 1" after.
// KOSMOS_SAMPLE_OLDER_DELAY holds the page back (12 s here, review 1: a slower CI runner's snapshot of a 220-row chat
// can take seconds), so the top, the loading line and the landing are three moments.
// What it proves: reaching the top asks for the page before and says it is loading; the page landing is seen on screen (the
// day line leaves, moved up above the new rows); the row the reader was on stays where it was as the page lands; and the
// page is really there, reached by scrolling on. The UIKit list only (ui-sample.sh --uikit): measured 11-09 00:2x, the lazy
// list asks for the page before the top shows (its top marker is drawn ahead in the lazy stack), so on it the page has
// landed before the day line is reached and there is no "at the top, not yet landed" moment to read. Its earlier pages are
// kosmos#7016's and #7265's, unchanged here.
// Measured 11-09 00:05 and 00:11: a swipe's momentum carries the list past "Message 41" to the top and on into the page, so
// the approach to the top is made with drags that stop dead (no fling).
final class EarlierPagesUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static func launch(delay: String = "12") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_DELAY"] = delay
        app.launchEnvironment["KOSMOS_SAMPLE_TRACE"] = "1"   // the list's atTop and scroll ends, to read what a run did
        UIKitListArm.set(app)
        app.launch()
        return app
    }

    private static func label(_ app: XCUIApplication, _ prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    // A third of the screen up the thread, held at the end so nothing flings on.
    private static func dragUp(_ app: XCUIApplication) {
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.4)
    }

    func testReachingTheTopLoadsEarlierMessagesAndKeepsThePlace() throws {
        if !UIKitListArm.on { throw XCTSkip("the lazy list loads the page before its top shows (kosmos#8221 slice 7); this reads the UIKit list's top") }
        let app = Self.launch()
        XCTAssertTrue(Self.label(app, "Message 260 of 260").waitForExistence(timeout: 20), "the long chat did not open at its newest message")
        let first = Self.label(app, "Message 41 of 260")
        let oldest = Self.label(app, "Checking the venue list, item 1.")
        let loading = Self.label(app, "Loading earlier messages")
        // Most of the way up with swipes, until the sixties show (about 20 rows short of the top).
        let near = Self.label(app, "Message 6")
        var swipes = 0
        while !near.exists && swipes < 60 { app.swipeDown(); swipes += 1 }
        XCTAssertTrue(near.exists, "never came near the top (\(swipes) swipes)")
        // The rest with drags that stop, until the list asks for the page before: its loading line shows the moment the reader
        // is at the top (within the list's slack). Measured 11-09 00:31-00:58: the day line at the very top sits under the
        // header and can read as not hittable there, so a loop waiting on it dragged on while the page was already on its
        // way, and landed mid-loop. The product's own signal is exact.
        var drags = 0
        while !loading.exists && drags < 25 { Self.dragUp(app); drags += 1 }
        XCTAssertTrue(loading.exists, "reaching the top did not say earlier messages are loading (\(drags) drags)")
        XCTAssertTrue(first.exists, "the first loaded message is not drawn at the top")
        let y0 = first.frame.minY
        // The page lands above; the loading line goes.
        let landed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter().wait(for: [landed], timeout: 20), .completed, "the earlier page never finished loading")
        Thread.sleep(forTimeInterval: 1)
        // The reader's row stayed where it was: not moved up to the page's top (40 rows, far off screen), nor back to the
        // newest message. By its frame, not hittability: at the very top it can sit under the header.
        XCTAssertTrue(first.exists, "the reader's row left the screen as the earlier page landed")
        XCTAssertEqual(first.frame.minY, y0, accuracy: 8, "the reader's row moved \(Int(first.frame.minY - y0)) pt as the earlier page landed")
        XCTAssertFalse(Self.label(app, "Message 260 of 260").exists, "the page landing took the reader back to the newest message")
        // And the page is there, above: scrolling on reaches its oldest message.
        drags = 0
        while !oldest.exists && drags < 20 { Self.dragUp(app); drags += 1 }
        XCTAssertTrue(oldest.exists, "the earlier page's oldest message was never reached (\(drags) drags)")
    }

    // Review 1 (BLOCKER), measured 11-09 01:29 and 01:33 by trace: a page that landed while a finger was on the list at its
    // top was never held (the hold runs only at rest), and the reader was left at the very top of the new page (y -12 with
    // the content grown by the page), its oldest message. Here the page lands 1 s after it is asked for, which is inside a
    // drag (each drag is about 1.5 s with the finger down), so it lands under the finger.
    func testAPageLandingUnderTheFingerKeepsThePlace() throws {
        if !UIKitListArm.on { throw XCTSkip("the lazy list loads the page before its top shows (kosmos#8221 slice 7); this reads the UIKit list's top") }
        let app = Self.launch(delay: "1")
        XCTAssertTrue(Self.label(app, "Message 260 of 260").waitForExistence(timeout: 20), "the long chat did not open at its newest message")
        let first = Self.label(app, "Message 41 of 260")
        let oldest = Self.label(app, "Checking the venue list, item 1.")
        let near = Self.label(app, "Message 6")
        var swipes = 0
        while !near.exists && swipes < 60 { app.swipeDown(); swipes += 1 }
        XCTAssertTrue(near.exists, "never came near the top (\(swipes) swipes)")
        // Drags to the top; the page is asked for and lands during one of them.
        var drags = 0
        while !first.exists && !oldest.exists && drags < 20 { Self.dragUp(app); drags += 1 }
        Self.dragUp(app); Self.dragUp(app)   // on into the top, where the page is asked for and lands under the finger
        Thread.sleep(forTimeInterval: 2)
        XCTAssertFalse(oldest.exists, "the page that landed under the finger threw the reader to its oldest message")
        // Not also "Message 41 is on screen": the page can land on the first of these drags, and the later ones then carry the
        // reader a third of a screen each into it, correctly (measured 11-09 01:4x, 1 run in 3). The jump this guards against
        // is to the page's very top, where its oldest message shows.
        // The page did land (so this measured a landing): scrolling on reaches its oldest message.
        drags = 0
        while !oldest.exists && drags < 20 { Self.dragUp(app); drags += 1 }
        XCTAssertTrue(oldest.exists, "the earlier page's oldest message was never reached (\(drags) drags)")
    }
}
