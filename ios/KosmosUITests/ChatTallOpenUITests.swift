import XCTest

// kosmos#9089: a short chat of tall replies (KOSMOS_SAMPLE_LONG=tall20) opens on its newest message, the first time and
// after going back to Agents and opening it again. On 11-25 build 73 opened it above the newest, 3 of 3, while the same
// 20 messages one line each (short20, the control here) opened on the newest 3 of 3. Both chat lists (UIKitListArm).
// Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as ChatOpensAtNewestUITests is.
final class ChatTallOpenUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func newest(_ app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Message 20 of 20.")).firstMatch
    }
    private func composer(_ app: XCUIApplication) -> XCUIElement {
        app.textFields.matching(NSPredicate(format: "placeholderValue BEGINSWITH %@", "Message ")).firstMatch
    }
    // The bubble wholly between the top bar and the box, read once the list has been still for half a second.
    private func shownWhole(_ app: XCUIApplication, _ when: String) {
        XCTAssertTrue(composer(app).waitForExistence(timeout: 20), "the chat did not open, \(when)")
        // Where the newest is the moment the chat shows (a late landing is the person seeing the wrong place first), read
        // within the 5 s that ChatOpensAtNewestUITests allows, then again once the list is still.
        let early = newest(app).waitForExistence(timeout: 5)
        print("UI-NOTE kosmos#9089 \(when): newest drawn within 5 s: \(early)\(early ? " at \(Int(newest(app).frame.minY))" : "")")
        // Past the open's last look (1.6 s, ChatView.openLandLooks), so the stillness read below cannot fall between two
        // looks and read a list that is about to move (review 2: a false red, never a false green).
        Thread.sleep(forTimeInterval: 2.0)
        let firstLook = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); firstLook.name = when + ", at 5 s"; firstLook.lifetime = .keepAlways; add(firstLook)
        let any = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Message ")).firstMatch
        var last = CGRect.null
        for _ in 0..<12 { let now = any.exists ? any.frame : .null; if now == last && !now.isNull { break }; last = now; Thread.sleep(forTimeInterval: 0.5) }
        let n = newest(app), top = app.navigationBars.firstMatch.frame.maxY, bottom = composer(app).frame.minY
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = when; a.lifetime = .keepAlways; add(a)
        XCTAssertTrue(early, "\(when): the newest message was not drawn within 5 s of the chat showing")
        XCTAssertTrue(n.exists, "\(when): the newest message is not drawn (the list opened above it)")
        print("UI-NOTE kosmos#9089 \(when): newest \(Int(n.frame.minY))-\(Int(n.frame.maxY)), band \(Int(top))-\(Int(bottom))")
        XCTAssertTrue(n.frame.minY >= top - 1 && n.frame.maxY <= bottom + 1, "\(when): the newest message is not wholly on screen: \(n.frame), band \(top) to \(bottom)")
    }
    private func run(_ sample: String) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": sample]
        // TEST_RUNNER_KOSMOS_NOOPENLAND=1: the app without the open's second look, the control (kosmos#9089).
        if ProcessInfo.processInfo.environment["KOSMOS_NOOPENLAND"] == "1" { app.launchEnvironment["KOSMOS_SAMPLE_NOOPENLAND"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        shownWhole(app, "\(sample), first open")
        let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5), "no Back button")
        back.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: composer(app)); waitForExpectations(timeout: 5)
        let dana = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
        XCTAssertTrue(dana.waitForExistence(timeout: 10) && dana.isHittable, "Dana's row is not showing")
        dana.tap()
        shownWhole(app, "\(sample), second open")
    }

    func testAChatOfTallRepliesOpensOnItsNewest() throws { try run("tall20") }

    // kosmos#9212: re-opening the chat of tall replies could freeze the app (the main thread never came back, about one run in
    // two on the simulator, iOS 26.5) while the chat list's id anchor was set in the same update that first built the list. One
    // re-open per launch, as above, saw it on CI only now and then, so this one re-opens the chat REOPENS times in one launch.
    static let REOPENS = 8
    func testAChatOfTallRepliesReopensWithoutFreezing() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "tall20"]
        // TEST_RUNNER_KOSMOS_ANCHORATOPEN=1: the anchor named as the list is built, as before the fix: the control.
        if ProcessInfo.processInfo.environment["KOSMOS_ANCHORATOPEN"] == "1" { app.launchEnvironment["KOSMOS_SAMPLE_ANCHORATOPEN"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        XCTAssertTrue(composer(app).waitForExistence(timeout: 20), "the chat did not open at launch")
        let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
        let dana = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
        for i in 1...Self.REOPENS {
            Thread.sleep(forTimeInterval: 2.0)   // past the open's last look (1.6 s, ChatView.openLandLooks)
            XCTAssertTrue(back.waitForExistence(timeout: 10), "re-open \(i): no Back button")
            back.tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: composer(app)); waitForExpectations(timeout: 10)
            XCTAssertTrue(dana.waitForExistence(timeout: 10) && dana.isHittable, "re-open \(i): Dana's row is not showing")
            dana.tap()
            XCTAssertTrue(composer(app).waitForExistence(timeout: 20), "re-open \(i) of \(Self.REOPENS): the chat did not open (the app froze)")
            XCTAssertTrue(newest(app).waitForExistence(timeout: 5), "re-open \(i): the newest message was not drawn")
        }
        // The last open's looks too: past them, the app still answers.
        Thread.sleep(forTimeInterval: 2.0)
        XCTAssertTrue(back.waitForExistence(timeout: 10), "after the last re-open: the app stopped answering")
    }
    // CONTROL: the same 20 messages, one line each.
    func testTheSameChatInOneLinersOpensOnItsNewest() throws { try run("short20") }
}
