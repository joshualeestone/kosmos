import XCTest

/// kosmos#8072: pulling a chat up past its newest message shows the dots and ends on its own, and the chat comes back where
/// it was. The dots are held by KOSMOS_SAMPLE_PULL_SECONDS, since a sample read ends before anything could look at it.
/// Not shown here: a new message arriving through a pull, and a real phone. That is the card's Done.
final class EndPullUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(_ extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_PULL_SECONDS": "4"]
        for (k, v) in extra { app.launchEnvironment[k] = v }
        UIKitListArm.set(app)   // kosmos#8221 slice 9: measured on either list (TEST_RUNNER_KOSMOS_UIKITLIST)
        app.launch()
        UIKitListArm.assertDrawn(app)
        return app
    }

    private func newest(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
    }

    private func dots(_ app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any)["Refreshing"] }

    private static func box(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
    }

    /// Waits for the row to stop moving before a pull: until it has not moved for `quiet` seconds, giving up after `limit`, and
    /// says what it saw, for a failure's message. Why it may be needed is a hypothesis: see .claude/plans/pullstill-8072.md.
    private func openFinished(_ row: XCUIElement, quiet: TimeInterval = 6, limit: TimeInterval = 45) -> String {
        let began = Date()
        var at = CGFloat.nan
        var stillSince = Date()
        var moved: CGFloat = 0
        var lastMove = 0
        var quietReached = false
        while Date().timeIntervalSince(began) < limit {
            let now = row.exists ? row.frame.minY : CGFloat.nan
            if !now.isFinite || !at.isFinite {
                at = now
                stillSince = Date()   // gone, or no position yet: not still
            } else if abs(now - at) > 1 {
                moved += abs(now - at)
                at = now
                stillSince = Date()
                lastMove = Int(Date().timeIntervalSince(began))
            }
            if at.isFinite && Date().timeIntervalSince(stillSince) >= quiet { quietReached = true; break }
            Thread.sleep(forTimeInterval: 1)
        }
        return "after waiting \(Int(Date().timeIntervalSince(began))) s for the row, which moved \(Int(moved)) pt, last at \(lastMove) s"
            + (quietReached ? "" : ", and was still not still")
    }

    private func pullUp(_ app: XCUIApplication, distance: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -distance)), withVelocity: .slow, thenHoldForDuration: 0.1)
    }

    func testAPullPastTheNewestShowsTheDotsEndsAndComesBack() {
        let app = launch()
        let row = newest(app)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        KeyboardSlideUITests.settle(row)
        XCTAssertFalse(dots(app).exists, "dots at rest, before any pull")
        let before = row.frame.minY
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a long pull")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "end-pull-dots"; shot.lifetime = .keepAlways; add(shot)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        KeyboardSlideUITests.settle(row)
        XCTAssertTrue(row.exists, "the newest message went away")
        XCTAssertEqual(row.frame.minY, before, accuracy: 4, "the chat did not come back where it was")
    }

    // A chat long enough to fill the screen: the list bounces back under the dots, and stays where it was.
    func testALongChatPullBouncesBackUnderTheDots() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_PULL_SECONDS": "10"])
        let row = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        let waited = openFinished(row)
        let before = row.frame.minY
        // kosmos#8283: the working line shows before the pull (on the UIKit list, so its going under the dots below is a real
        // change; on the lazy list, as the dots' reference).
        let working = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Dana is working'")).firstMatch
        XCTAssertTrue(working.exists, "CONTROL: no working line before the pull, so its hiding is not checked")
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a long pull, " + waited)
        KeyboardSlideUITests.settle(row)
        XCTAssertTrue(dots(app).exists, "the dots went before the read ended")
        // kosmos#7609: a long chat can open short of its true end until any touch: 103 to 129 pt measured on CI (#8072), so the landing
        // is allowed up to 160 pt above where it opened, and says so. Further up is a list that did not bounce back.
        let landed = row.frame.minY
        XCTAssertLessThanOrEqual(landed, before + 20, "the list landed below where it opened, " + waited)
        XCTAssertGreaterThanOrEqual(landed, before - 160, "the list did not bounce back, " + waited)
        if before - landed > 20 { print("UI-NOTE kosmos#8072: the long chat landed \(Int(before - landed)) pt above where it opened") }
        if UIKitListArm.on {
            // kosmos#8283: on the UIKit list the working line is drawn over the strip above the box, in the room the dots rest in,
            // so it is taken away while they show. The dots rest clear of the newest message above them (its whole bubble, the
            // time line under it included), and of the box and its 18 pt fade below.
            XCTAssertFalse(working.exists, "the working line shows under the dots")
            let bubble = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'You' AND label CONTAINS 'Message 260 of 260'")).firstMatch
            XCTAssertTrue(bubble.exists, "CONTROL: the newest message's bubble was not found")
            let dot = dots(app).frame, above = dot.minY - bubble.frame.maxY, below = Self.box(app).frame.minY - dot.maxY
            let said = "\(above) under the newest message's bubble, \(below) above the box"
            print("UI-NOTE kosmos#8283 uikit: dots " + said)
            // 1 pt: at the true end they rest about 2.5 pt under it (restsAbove 11.5); measured 11-09, -0.5 at 14.5.
            XCTAssertGreaterThanOrEqual(above, 1, "the dots touch the newest message: " + said)
            XCTAssertGreaterThanOrEqual(below, 18, "the box's fade cuts the dots: " + said)
            // kosmos#7609: and not stuck high, which the allowance above cannot see.
            XCTAssertLessThanOrEqual(above, 40, "the list did not come back to its end: " + said)
            XCTAssertLessThanOrEqual(below, 40, "the list did not come back to its end: " + said)
        } else {
            // The lazy list keeps its working line's row (kosmos#8283): clear of the working line, and of the box and its fade.
            XCTAssertTrue(working.exists, "CONTROL: no working line, so this checks no gap")
            let dot = dots(app).frame, above = dot.minY - working.frame.maxY, below = Self.box(app).frame.minY - dot.maxY
            XCTAssertGreaterThanOrEqual(above, 8, "the dots hang off the working line: \(above) above, \(below) below")
            XCTAssertGreaterThanOrEqual(below, 18, "the box's fade cuts the dots: \(above) above, \(below) below")
            // kosmos#7609: and not stuck high, which the allowance above cannot see: the true landing has 11.5 above and 21.5 below.
            XCTAssertLessThanOrEqual(above, 40, "the list did not come back to its end: \(above) above, \(below) below")
            XCTAssertLessThanOrEqual(below, 40, "the list did not come back to its end: \(above) above, \(below) below")
        }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "end-pull-dots-long"; shot.lifetime = .keepAlways; add(shot)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 20)
        XCTAssertTrue(row.exists, "the newest message went away")
        XCTAssertEqual(row.frame.minY, landed, accuracy: 4, "the chat moved when the dots went")
        XCTAssertTrue(working.waitForExistence(timeout: 3), "the working line did not come back after the dots went")
    }

    // The next pull counts, even when the first read ended after the list had come back.
    func testASecondPullCountsToo() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_PULL_SECONDS": "3"])
        let row = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        let waited = openFinished(row)
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after the first pull, " + waited)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        KeyboardSlideUITests.settle(row)
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a second pull")
    }

    // KOSMOS_SAMPLE_GROW: every read brings a message, the 5 s reads too, so this is a message landing around a pull, not
    // proof that the pull fetched it. It must reach the screen, with the list still drawn and at its end.
    // kosmos#8221 slice 9: the 5 s reads put an arrival inside this pull in every measured run (10 of 10 on 11-09; the UIKit
    // list's trace says "rows landed under a pull"), which is the case that failed there. That is timing, not a guarantee.
    func testAMessageLandingAroundAPullShowsAndNothingBlanks() {
        let app = launch(["KOSMOS_SAMPLE_GROW": "1", "KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_TRACE": "1"])
        // "New message " with the space: the "New messages" capsule is not a message.
        let grown = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'New message '"))
        XCTAssertTrue(grown.firstMatch.waitForExistence(timeout: 20), "CONTROL: no message arrived")
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a long pull")
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        // kosmos#8221: wait for the NEXT message by its number, not for more of them: the UIKit list keeps only the cells on
        // screen in the tree, so its count can stay level while messages arrive (an old one scrolls out as a new one lands).
        let numbers = grown.allElementsBoundByIndex.compactMap { Int($0.label.split(separator: " ").dropFirst(2).first ?? "") }
        let newest = numbers.max() ?? 0
        XCTAssertGreaterThan(newest, 0, "CONTROL: no numbered message to wait past: \(grown.allElementsBoundByIndex.map(\.label))")
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "New message \(newest + 1) ")).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 15), "no later message reached the list (newest seen: \(newest))")
        KeyboardSlideUITests.settle(last)
        XCTAssertTrue(last.exists && last.isHittable, "the newest message is not on screen after a pull")
    }

    func testAShortPullDoesNothing() {
        let app = launch()
        let row = newest(app)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        KeyboardSlideUITests.settle(row)
        pullUp(app, distance: 60)
        XCTAssertFalse(dots(app).waitForExistence(timeout: 2), "dots from a pull that never reached the threshold")
    }

    // Not past the end at all. The end-marker gate itself is pinned by a source check in LogicTests/room.
    func testAPullHigherUpDoesNothing() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_SCROLLUP": "40"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample never scrolled up")
        pullUp(app, distance: 420)
        XCTAssertFalse(dots(app).waitForExistence(timeout: 2), "dots from scrolling a list that is not at its end")
    }
}
