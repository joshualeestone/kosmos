import XCTest

// kosmos#8221 slice 2: the New messages capsule, on both lists (UIKitListArm). For a reader higher up it shows as messages
// arrive, and pressing it takes them to the newest message and goes away. A reader at the newest message never gets it.
// Slice 3: a higher-up reader keeps their exact place as rows come and go above (testAReaderHigherUpKeepsTheirPlace...).
// KOSMOS_SAMPLE_GROW brings one new message per read of the chat, and drops the oldest
// ("New message <n> after the window slid."), so arrivals come on the chat's own reads, as a busy agent's do.
// Two ways up: KOSMOS_SAMPLE_SCROLLUP (a fixed place, set by the app itself) and a real drag down the chat (which goes
// through the list's own reading of the person's scroll).
final class NewMessagesUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static func launch(_ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_GROW"] = "1"
        for (k, v) in env { app.launchEnvironment[k] = v }
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        return app
    }

    private static func message260(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
    }

    private static func capsule(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'New messages'")).firstMatch
    }

    private static func grown(_ app: XCUIApplication) -> XCUIElementQuery {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'New message ' AND label CONTAINS 'after the window slid'"))
    }

    // The newest arrival drawn, by its number (the query's order is not the screen's), as an element found by that number,
    // so a later read is of the same message and not of whatever then sits at the same index.
    private static func newestGrown(_ app: XCUIApplication) -> (n: Int, element: XCUIElement)? {
        let numbers = grown(app).allElementsBoundByIndex.compactMap { e -> Int? in
            let words = e.label.split(separator: " ")
            return words.count > 2 ? Int(words[2]) : nil
        }
        guard let n = numbers.max() else { return nil }
        return (n, app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "New message \(n) after")).firstMatch)
    }

    // Until an arrival numbered above n is drawn (at most `timeout`), settled.
    private static func arrival(after n: Int, _ app: XCUIApplication, timeout: TimeInterval) -> (n: Int, element: XCUIElement)? {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if var g = newestGrown(app), g.n > n {
                // Settled, then read again until no newer arrival came during the settle.
                for _ in 0..<4 {
                    KeyboardSlideUITests.settle(g.element)
                    guard let again = newestGrown(app), again.n != g.n else { break }
                    g = again
                }
                return g
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return nil
    }

    // From a reader higher up: the capsule shows as messages arrive and the arrivals stay below the screen; pressing it takes
    // them to the newest, the capsule goes, and the next arrival shows with no capsule.
    private func checkCapsule(_ app: XCUIApplication, shot: String) {
        let capsule = Self.capsule(app)
        XCTAssertTrue(capsule.waitForExistence(timeout: 20), "no New messages capsule for a reader higher up as messages arrived")
        // Still higher up: an older message is on screen, and neither Message 260 nor the newest arrival is.
        let header = app.navigationBars.firstMatch.frame.maxY
        let older = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label CONTAINS ' of 260.'"))
            .allElementsBoundByIndex.filter { $0.isHittable && $0.frame.minY > header && !$0.label.hasPrefix("Message 260 ") }
        guard let held = older.first else { XCTFail("no older message on screen while the capsule shows"); return }
        let heldRow = app.staticTexts.matching(NSPredicate(format: "label == %@", held.label)).firstMatch
        let heldY = heldRow.frame.minY
        XCTAssertFalse(Self.message260(app).isHittable, "Message 260 is on screen: the reader was pulled down to the newest message")
        let shownNewest = Self.newestGrown(app)
        XCTAssertFalse(shownNewest?.element.isHittable ?? false,
                       "New message \(shownNewest?.n ?? 0) is on screen: the reader was pulled down to the newest message")
        let before = XCTAttachment(screenshot: app.screenshot()); before.name = shot + "-shown"; before.lifetime = .keepAlways; add(before)
        capsule.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: capsule)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "the capsule stayed after it was pressed")
        guard let (n, e) = Self.arrival(after: 0, app, timeout: 5) else { XCTFail("no arrival drawn after the capsule was pressed"); return }
        XCTAssertTrue(e.isHittable, "New message \(n), the newest, is not on screen after the capsule was pressed")
        XCTAssertFalse(heldRow.exists && heldRow.isHittable, "'\(held.label)' is still on screen: the press did not move the reader")
        if heldRow.exists {
            XCTAssertGreaterThan(abs(heldRow.frame.minY - heldY), 200, "'\(held.label)' moved \(Int(heldRow.frame.minY - heldY)) pt: the press did not move the reader")
        }
        let after = XCTAttachment(screenshot: app.screenshot()); after.name = shot + "-pressed"; after.lifetime = .keepAlways; add(after)
        guard let (m, f) = Self.arrival(after: n, app, timeout: 20) else { XCTFail("CONTROL: no later message arrived after the capsule was pressed"); return }
        XCTAssertTrue(f.isHittable, "New message \(m) arrived after the capsule was pressed and is not on screen")
        XCTAssertFalse(capsule.waitForExistence(timeout: 6), "the capsule came back for a reader at the newest message")
    }

    func testAReaderHigherUpGetsTheCapsuleAndItTakesThemToTheNewest() {
        let app = Self.launch(["KOSMOS_SAMPLE_SCROLLUP": "40"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample scroll-up never came to rest")
        checkCapsule(app, shot: "capsule")
    }

    // The same, the reader moved up by a drag, so the list decides from the scroll itself that they left the newest message.
    func testAReaderWhoDraggedUpGetsTheCapsule() {
        let app = Self.launch([:])
        let first = Self.grown(app).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20), "CONTROL: no message arrived")
        guard let (n0, newest) = Self.newestGrown(app) else { XCTFail("CONTROL: no arrival drawn"); return }
        KeyboardSlideUITests.settle(newest)
        for _ in 0..<2 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        }
        KeyboardSlideUITests.settle(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message '")).firstMatch)
        XCTAssertFalse(newest.exists && newest.isHittable, "CONTROL: the drags did not move the reader off New message \(n0)")
        let after = Self.newestGrown(app)
        XCTAssertFalse(after?.element.isHittable ?? false, "CONTROL: New message \(after?.n ?? 0) is on screen after the drags")
        checkCapsule(app, shot: "capsule-drag")
    }

    // kosmos#8221 slice 3: every read drops the oldest message off the top and adds one at the end, and a reader higher up
    // stays exactly where they were: the highest row on screen at the same height, within 4 pt, read every second for 15 s.
    // The capsule showing is the control that arrivals came in that time (it shows only as messages arrive).
    func testAReaderHigherUpKeepsTheirPlaceAsRowsComeAndGo() {
        let app = Self.launch(["KOSMOS_SAMPLE_SCROLLUP": "40"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample scroll-up never came to rest")
        let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label ENDSWITH ' of 260.'"))
        KeyboardSlideUITests.settle(rows.firstMatch)
        let header = app.navigationBars.firstMatch.frame.maxY
        guard let top = rows.allElementsBoundByIndex.filter({ $0.isHittable && $0.frame.minY > header }).min(by: { $0.frame.minY < $1.frame.minY }) else {
            XCTFail("no row on screen after the scroll up"); return
        }
        let row = app.staticTexts.matching(NSPredicate(format: "label == %@", top.label)).firstMatch
        let y0 = row.frame.minY
        for s in 1...15 {
            Thread.sleep(forTimeInterval: 1)
            XCTAssertTrue(row.exists && row.isHittable, "after \(s) s: '\(top.label)', read higher up, left the screen as messages came and went")
            XCTAssertEqual(row.frame.minY, y0, accuracy: 4, "after \(s) s: '\(top.label)' moved from \(Int(y0)) to \(Int(row.frame.minY)) as messages came and went")
        }
        XCTAssertTrue(Self.capsule(app).exists, "CONTROL: no New messages capsule, so no message arrived during the check")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "kept-place"; a.lifetime = .keepAlways; add(a)
    }

    // The control: the same arrivals, the reader left at the newest message. Each shows, and the capsule never does, not even
    // for one read.
    func testAReaderAtTheNewestNeverGetsTheCapsule() {
        let app = Self.launch([:])
        let capsule = Self.capsule(app)
        var last = 0
        for i in 1...3 {
            guard let (n, e) = Self.arrival(after: last, app, timeout: 20) else { XCTFail("CONTROL: arrival \(i) never came"); return }
            XCTAssertTrue(e.isHittable, "New message \(n), the newest, is not on screen for a reader at the newest message")
            XCTAssertFalse(capsule.exists, "the capsule showed after New message \(n) for a reader at the newest message")
            last = n
        }
        // Then 6 s more, polled, so a capsule shown for one read in that time is caught too (one before it may not be).
        XCTAssertFalse(capsule.waitForExistence(timeout: 6), "the capsule showed for a reader at the newest message")
    }
}
