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

    // kosmos#8221 slice 3: every read slides the window (the oldest message out, one in at the end), and a reader higher up
    // stays exactly where they were: the highest row on screen at the same height, within 4 pt, read every second for 15 s.
    // The capsule showing is the control that arrivals came in that time (it shows only as messages arrive).
    // As the app runs, the rows that slid out are kept on the phone (carryDropped, kosmos#7265), so nothing leaves above the
    // reader and this passes on the UIKit list without slice 3's place-keeping (measured 11-08). The NOKEEP check below is
    // the one that takes rows off the top.
    func testAReaderHigherUpKeepsTheirPlaceAsRowsComeAndGo() { keepsPlace([:]) }

    // The same with KOSMOS_SAMPLE_NOKEEP=1 (carryDropped off), so every read takes the oldest row off the top of the list:
    // a list that keeps its offset then slides the reader's rows up by that row each read. Red on the UIKit list built
    // without slice 3's place-keeping (measured 11-08).
    func testAReaderHigherUpKeepsTheirPlaceAsRowsLeaveTheTop() { keepsPlace(["KOSMOS_SAMPLE_NOKEEP": "1"]) }

    // The same, the reader moved up by a real drag (the end of the person's own scroll takes the place, not the hook).
    func testAReaderWhoDraggedUpKeepsTheirPlaceAsRowsLeaveTheTop() { keepsPlace(["KOSMOS_SAMPLE_NOKEEP": "1"], drag: true) }

    // The rows of the sample chat ("Message N of 260.").
    private static func sampleRows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label ENDSWITH ' of 260.'"))
    }

    // Wholly between the top bar and the bottom of the screen, by frame, not isHittable: rows leave the list every read in
    // these checks, and asking a row that is going whether it can be hit fails the check itself ("Activation point
    // invalid", 1 of 4 runs on 11-08).
    private static func onScreen(_ f: CGRect, _ app: XCUIApplication) -> Bool {
        !f.isEmpty && f.minY > app.navigationBars.firstMatch.frame.maxY && f.maxY < app.frame.maxY
    }

    // The highest sample row on screen: its label and frame.
    private static func topRow(_ app: XCUIApplication) -> (label: String, frame: CGRect)? {
        sampleRows(app).allElementsBoundByIndex.map { ($0.label, $0.frame) }.filter { onScreen($0.1, app) }
            .min(by: { $0.1.minY < $1.1.minY }).map { (label: $0.0, frame: $0.1) }
    }

    private func keepsPlace(_ env: [String: String], drag: Bool = false) {
        var env = env
        if !drag { env["KOSMOS_SAMPLE_SCROLLUP"] = "40" }
        let app = Self.launch(env)
        if drag {
            XCTAssertTrue(Self.grown(app).firstMatch.waitForExistence(timeout: 20), "CONTROL: no message arrived")
            KeyboardSlideUITests.settle(Self.grown(app).firstMatch)
            for _ in 0..<2 {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
                    .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
            }
        } else {
            let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
            XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample scroll-up never came to rest")
        }
        KeyboardSlideUITests.settle(Self.sampleRows(app).firstMatch)
        XCTAssertFalse(Self.message260(app).isHittable, "CONTROL: the reader is still at the newest message")
        guard let top = Self.topRow(app) else { XCTFail("no row on screen after the move up"); return }
        let label = top.label
        let row = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        let y0 = row.frame.minY
        for s in 1...15 {
            Thread.sleep(forTimeInterval: 1)
            XCTAssertTrue(row.exists && Self.onScreen(row.frame, app), "after \(s) s: '\(label)', read higher up, left the screen as messages came and went")
            XCTAssertEqual(row.frame.minY, y0, accuracy: 4, "after \(s) s: '\(label)' moved from \(Int(y0)) to \(Int(row.frame.minY)) as messages came and went")
        }
        XCTAssertTrue(Self.capsule(app).exists, "CONTROL: no New messages capsule, so no message arrived during the check")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "kept-place"; a.lifetime = .keepAlways; add(a)
    }

    // A scroll iOS makes itself, with no finger on the list (VoiceOver's page scroll; here KOSMOS_SAMPLE_SCROLLBY, an animated
    // scroll by code 5 s after the scroll-up), moves a reader higher up and is not put back: the held place is dropped and
    // taken again where the scroll ends. The highest row is read before the scroll and after it has come to rest, 3 s apart.
    // UIKit list only: the lazy list's scroll-up hook has no SCROLLBY.
    func testAScrollWithNoFingerMovesAReaderHigherUpAndStays() throws {
        if !UIKitListArm.on { throw XCTSkip("KOSMOS_SAMPLE_SCROLLBY is in the UIKit list's hook only (kosmos#8221)") }
        let app = Self.launch(["KOSMOS_SAMPLE_SCROLLUP": "40", "KOSMOS_SAMPLE_SCROLLBY": "300"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample scroll-up never came to rest")
        KeyboardSlideUITests.settle(Self.sampleRows(app).firstMatch)
        guard let top = Self.topRow(app) else { XCTFail("no row on screen after the scroll up"); return }
        let row = app.staticTexts.matching(NSPredicate(format: "label == %@", top.label)).firstMatch
        let y0 = top.frame.minY
        Thread.sleep(forTimeInterval: 6)   // the scroll fires 4.4 s after the marker shows and animates for under 1 s
        KeyboardSlideUITests.settle(row)
        let y1 = row.frame.minY
        XCTAssertGreaterThan(y1 - y0, 250, "'\(top.label)' moved \(Int(y1 - y0)) pt, not about 300: the scroll was put back")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(row.frame.minY, y1, accuracy: 4, "'\(top.label)' moved again after the scroll ended, from \(Int(y1)) to \(Int(row.frame.minY))")
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
