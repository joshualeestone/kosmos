import XCTest

// kosmos#8221 slice 2: the New messages capsule. A reader higher up is not moved by a message arriving; the capsule offers
// the jump, and pressing it takes them to the newest message and goes away. A reader at the newest message is kept there and
// never sees the capsule. Run on both lists (UIKitListArm). KOSMOS_SAMPLE_GROW brings one new message per read of the chat
// ("New message <n> after the window slid."), so arrivals come on the chat's own reads, as a busy agent's do.
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

    private static func capsule(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'New messages'")).firstMatch
    }

    private static func grown(_ app: XCUIApplication) -> XCUIElementQuery {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'New message ' AND label CONTAINS 'after the window slid'"))
    }

    // The newest arrival drawn, by its number (the query's order is not the screen's).
    private static func newestGrown(_ app: XCUIApplication) -> (n: Int, element: XCUIElement)? {
        let all = grown(app).allElementsBoundByIndex.compactMap { e -> (Int, XCUIElement)? in
            let words = e.label.split(separator: " ")
            guard words.count > 2, let n = Int(words[2]) else { return nil }
            return (n, e)
        }
        return all.max(by: { $0.0 < $1.0 })
    }

    func testAReaderHigherUpGetsTheCapsuleAndItTakesThemToTheNewest() {
        let app = Self.launch(["KOSMOS_SAMPLE_SCROLLUP": "40"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample scroll-up never came to rest")
        let capsule = Self.capsule(app)
        XCTAssertTrue(capsule.waitForExistence(timeout: 20), "no New messages capsule for a reader higher up as messages arrived")
        // Higher up: the arrivals are below the screen, not on it.
        if let (n, e) = Self.newestGrown(app) {
            XCTAssertFalse(e.isHittable, "New message \(n) is on screen: the reader was pulled down to the newest message")
        }
        let before = XCTAttachment(screenshot: app.screenshot()); before.name = "capsule-shown"; before.lifetime = .keepAlways; add(before)
        capsule.tap()
        // Then at the newest: the latest arrival on screen, and the capsule gone.
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: capsule)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "the capsule stayed after it was pressed")
        Thread.sleep(forTimeInterval: 1)
        guard let (n, e) = Self.newestGrown(app) else { XCTFail("no arrival drawn after the capsule was pressed"); return }
        XCTAssertTrue(e.isHittable, "New message \(n), the newest, is not on screen after the capsule was pressed")
        let after = XCTAttachment(screenshot: app.screenshot()); after.name = "capsule-pressed"; after.lifetime = .keepAlways; add(after)
        // And kept there: the next arrival shows too, with no capsule.
        let more = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > %d", Self.grown(app).count), object: Self.grown(app))
        _ = XCTWaiter().wait(for: [more], timeout: 15)
        guard let (m, f) = Self.newestGrown(app) else { XCTFail("the arrivals went"); return }
        XCTAssertGreaterThan(m, n, "CONTROL: no later message arrived after the capsule was pressed")
        XCTAssertTrue(f.isHittable, "New message \(m) arrived after the capsule was pressed and is not on screen")
        XCTAssertFalse(capsule.exists, "the capsule came back for a reader at the newest message")
    }

    // The control: the same arrivals, the reader left at the newest message. They show, and the capsule never does.
    func testAReaderAtTheNewestNeverGetsTheCapsule() {
        let app = Self.launch([:])
        let grown = Self.grown(app)
        let three = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count >= 3"), object: grown)
        XCTAssertEqual(XCTWaiter().wait(for: [three], timeout: 40), .completed, "CONTROL: fewer than three messages arrived")
        XCTAssertFalse(Self.capsule(app).exists, "the capsule showed for a reader at the newest message")
        guard let (n, e) = Self.newestGrown(app) else { XCTFail("no arrival drawn"); return }
        XCTAssertTrue(e.isHittable, "New message \(n), the newest, is not on screen for a reader at the newest message")
    }
}
