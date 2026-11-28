import XCTest

// kosmos#9212 EXPERIMENT (draft PR only, never merged): does re-opening the chat of tall replies stall the app on the
// hosted runner, and is it #9089's open looks (ChatView.landOnNewest) that keep it busy? Each arm launches once and
// re-opens Dana's tall20 chat REOPENS times, timing each open from the tap to the composer showing. continueAfterFailure
// is on, so a stalled open is counted and the loop goes on. One UI-NOTE line per re-open, and one total per arm.
// Arm "looks": the app as shipped. Arm "nolooks": KOSMOS_SAMPLE_NOOPENLAND=1, the app without the looks.
final class ChatTallReopenProbeUITests: XCTestCase {
    static let REOPENS = 10
    override func setUp() { super.setUp(); continueAfterFailure = true }

    private func composer(_ app: XCUIApplication) -> XCUIElement {
        app.textFields.matching(NSPredicate(format: "placeholderValue BEGINSWITH %@", "Message ")).firstMatch
    }
    private func probe(_ arm: String, noLooks: Bool, danaIdle: Bool = false, stillDots: Bool = false, noRow: Bool = false, noPosId: Bool = false, oldOpen: Bool = false, grow: Bool = false, arriveAfter: String? = nil) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "tall20"]
        if noLooks { app.launchEnvironment["KOSMOS_SAMPLE_NOOPENLAND"] = "1" }
        // Arm "looks-idle": Dana shown idle (BoardClient.sampleWithDanaAsSet), so the chat draws no always-on "is working"
        // wave (LayerWaveDots): one variable changed against arm "looks".
        if danaIdle { app.launchEnvironment["KOSMOS_SAMPLE_SEND_WORKS"] = "1"; app.launchEnvironment["KOSMOS_SAMPLE_SEND_SLOW"] = "0.5" }
        if noPosId { app.launchEnvironment["KOSMOS_SAMPLE_NOPOSID"] = "1" }
        if noRow { app.launchEnvironment["KOSMOS_SAMPLE_NOWORKINGROW"] = "1" }
        if stillDots { app.launchEnvironment["KOSMOS_SAMPLE_STILLDOTS"] = "1" }
        if let out = ProcessInfo.processInfo.environment["KOSMOS_PROBE_OUT"] { app.launchEnvironment["KOSMOS_SAMPLE_STDOUT"] = out + "/stdout-\(arm)-\(Int(Date().timeIntervalSince1970)).txt" }
        if let a = arriveAfter { app.launchEnvironment["KOSMOS_SAMPLE_ARRIVE_AFTER"] = a }
        if grow { app.launchEnvironment["KOSMOS_SAMPLE_GROW"] = "1" }   // kosmos#9226: a new message on every read, the open's included
        if oldOpen { app.launchEnvironment["KOSMOS_SAMPLE_ANCHORATOPEN"] = "1" }
        if ProcessInfo.processInfo.environment["KOSMOS_ANCHORATOPEN"] == "1" { app.launchEnvironment["KOSMOS_SAMPLE_ANCHORATOPEN"] = "1" }   // the old open
        app.launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 30), "\(arm): the chat did not open at launch")
        Thread.sleep(forTimeInterval: 2.0)   // past the last look (1.6 s), as ChatTallOpenUITests waits
        var stalled = 0
        for i in 1...Self.REOPENS {
            let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
            guard back.waitForExistence(timeout: 10) else { print("UI-NOTE kosmos#9212 \(arm) reopen \(i): no Back button"); stalled += 1; continue }
            back.tap()
            let dana = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
            guard dana.waitForExistence(timeout: 15) else { print("UI-NOTE kosmos#9212 \(arm) reopen \(i): Dana's row did not show"); stalled += 1; continue }
            let t0 = Date()
            dana.tap()
            print("UI-NOTE kosmos#9212 \(arm) reopen \(i) tap at \(t0.timeIntervalSince1970)")
            let opened = composer(app).waitForExistence(timeout: 30)
            let secs = Date().timeIntervalSince(t0)
            if !opened { stalled += 1 }
            print("UI-NOTE kosmos#9212 \(arm) reopen \(i): composer \(opened ? "showed" : "DID NOT SHOW") after \(String(format: "%.1f", secs)) s")
            Thread.sleep(forTimeInterval: 2.0)
        }
        print("UI-NOTE kosmos#9212 \(arm) TOTAL: \(stalled) of \(Self.REOPENS) re-opens stalled")
        XCTAssertEqual(stalled, 0, "\(arm): \(stalled) of \(Self.REOPENS) re-opens stalled")
    }

    func testReopenWithTheLooks() throws { try probe("looks", noLooks: false) }
    func testReopenArriveAt03() throws { try probe("arrive03", noLooks: false, arriveAfter: "0.3") }
    func testReopenArriveAt03OldOpen() throws { try probe("arrive03-oldopen", noLooks: false, oldOpen: true, arriveAfter: "0.3") }
    func testReopenWithArrivals() throws { try probe("grow", noLooks: false, grow: true) }
    func testReopenWithArrivalsOldOpen() throws { try probe("grow-oldopen", noLooks: false, oldOpen: true, grow: true) }
    func testReopenWithTheLooksOldOpen() throws { try probe("oldopen", noLooks: false, oldOpen: true) }
    func testReopenWithoutTheLooks() throws { try probe("nolooks", noLooks: true) }
    func testReopenWithTheLooksStillDots() throws { try probe("looks-stilldots", noLooks: false, stillDots: true) }
    func testReopenWithTheLooksNoWorkingRow() throws { try probe("looks-norow", noLooks: false, noRow: true) }
    func testReopenWithNoIdAnchor() throws { try probe("noposid", noLooks: false, noPosId: true) }
    func testReopenWithTheLooksDanaIdle() throws { try probe("looks-idle", noLooks: false, danaIdle: true) }

    // kosmos#9226 case 2: with a message arriving 0.3 s into each open, is the arrived message drawn and wholly on screen
    // once the list is still? Counts misses over REOPENS opens; UI-NOTE per open and a TOTAL.
    func testArrivalShowsAfterOpen() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "tall20", "KOSMOS_SAMPLE_ARRIVE_AFTER": "0.3"]
        app.launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 2.5)
        var missed = 0
        for i in 1...Self.REOPENS {
            let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
            guard back.waitForExistence(timeout: 10) else { missed += 1; continue }
            back.tap()
            let dana = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
            guard dana.waitForExistence(timeout: 15) else { missed += 1; continue }
            dana.tap()
            guard composer(app).waitForExistence(timeout: 30) else { print("UI-NOTE kosmos#9226 arrival \(i): chat did not open"); missed += 1; continue }
            Thread.sleep(forTimeInterval: 2.5)   // past the arrival (0.3 s) and the open's last look (1.6 s)
            let arrived = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "during the open.")).allElementsBoundByIndex
            let newest = arrived.max(by: { $0.frame.minY < $1.frame.minY })
            let top = app.navigationBars.firstMatch.frame.maxY, bottom = composer(app).frame.minY
            let shown = newest.map { $0.frame.minY >= top - 1 && $0.frame.maxY <= bottom + 1 } ?? false
            if !shown { missed += 1 }
            print("UI-NOTE kosmos#9226 arrival \(i): \(arrived.count) arrived drawn, newest \(newest.map { "\(Int($0.frame.minY))-\(Int($0.frame.maxY))" } ?? "none"), band \(Int(top))-\(Int(bottom)): \(shown ? "SHOWN" : "NOT SHOWN")")
        }
        print("UI-NOTE kosmos#9226 arrival TOTAL: \(missed) of \(Self.REOPENS) opens did not show the arrived message")
        XCTAssertEqual(missed, 0)
    }

    // kosmos#9226 case 5: Cleo's short chat (its top on screen at the open, 12 earlier messages to load above it). After each
    // re-open and the page's landing, is her newest message still wholly on screen? Fix vs the old open.
    private func cleoPage(_ arm: String, oldOpen: Bool) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "cleo"]
        if oldOpen { app.launchEnvironment["KOSMOS_SAMPLE_ANCHORATOPEN"] = "1" }
        app.launch()
        let box = app.textFields.matching(NSPredicate(format: "placeholderValue BEGINSWITH %@", "Message ")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "\(arm): Cleo's chat did not open")
        Thread.sleep(forTimeInterval: 2.5)
        var missed = 0
        for i in 1...Self.REOPENS {
            let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
            guard back.waitForExistence(timeout: 10) else { missed += 1; continue }
            back.tap()
            let cleo = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Cleo")).firstMatch
            guard cleo.waitForExistence(timeout: 15) else { missed += 1; continue }
            cleo.tap()
            guard box.waitForExistence(timeout: 30) else { print("UI-NOTE kosmos#9226 \(arm) \(i): chat did not open"); missed += 1; continue }
            Thread.sleep(forTimeInterval: 2.5)   // the earlier page lands when the top shows
            // The question is drawn as the asking card, not a row: the newest ROW is Kosmos's pause line, then the person's reply.
            let paused = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "paused for today")).allElementsBoundByIndex.filter { $0.frame.height > 0 }
            let reply = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "I will read it tonight")).allElementsBoundByIndex.filter { $0.frame.height > 0 }
            let newest = (paused.isEmpty ? reply : paused).max(by: { $0.frame.maxY < $1.frame.maxY })
            print("UI-NOTE kosmos#9226 \(arm) \(i): found \(paused.isEmpty ? (reply.isEmpty ? "no row" : "the reply") : "the pause line")")
            let older = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Checking the venue list")).count
            let top = app.navigationBars.firstMatch.frame.maxY, bottom = box.frame.minY
            let shown = newest.map { $0.frame.minY >= top - 1 && $0.frame.maxY <= bottom + 1 } ?? false
            if !shown { missed += 1 }
            print("UI-NOTE kosmos#9226 \(arm) \(i): earlier rows drawn \(older), newest \(newest.map { "\(Int($0.frame.minY))-\(Int($0.frame.maxY))" } ?? "none"), band \(Int(top))-\(Int(bottom)): \(shown ? "SHOWN" : "NOT SHOWN")")
        }
        print("UI-NOTE kosmos#9226 \(arm) TOTAL: \(missed) of \(Self.REOPENS) opens did not show the newest")
        XCTAssertEqual(missed, 0)
    }
    func testCleoPageFix() throws { try cleoPage("cleo-fix", oldOpen: false) }
    func testCleoPageOldOpen() throws { try cleoPage("cleo-oldopen", oldOpen: true) }

    // kosmos#9226 case 4: each open's first read refused, then the good read rebuilds the list. Does the app still answer 7 s
    // after each re-open? Fix vs the old open.
    private func refusedRead(_ arm: String, oldOpen: Bool) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "tall20", "KOSMOS_SAMPLE_REFUSE_FIRST": "1"]
        if oldOpen { app.launchEnvironment["KOSMOS_SAMPLE_ANCHORATOPEN"] = "1" }
        app.launch()
        Thread.sleep(forTimeInterval: 7)
        var stalled = 0
        for i in 1...Self.REOPENS {
            let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
            guard back.waitForExistence(timeout: 20) else { print("UI-NOTE kosmos#9226 \(arm) \(i): no Back button (stalled)"); stalled += 1; continue }
            back.tap()
            let dana = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
            guard dana.waitForExistence(timeout: 20) else { print("UI-NOTE kosmos#9226 \(arm) \(i): Dana's row did not show (stalled)"); stalled += 1; continue }
            dana.tap()
            // The refusal must be seen, or this re-open measured nothing (the hook may not have fired).
            let refusal = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "A sample refusal")).firstMatch
            let refused = refusal.waitForExistence(timeout: 4)
            print("UI-NOTE kosmos#9226 \(arm) \(i): refusal \(refused ? "SEEN" : "NOT SEEN")")
            Thread.sleep(forTimeInterval: 5)   // past the good read 5 s after the refused one, which rebuilds the list
            let newest = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Message 20 of 20.")).firstMatch
            let drawn = newest.waitForExistence(timeout: 20)
            if !drawn { stalled += 1 }
            print("UI-NOTE kosmos#9226 \(arm) \(i): \(drawn ? "the newest drawn after the rebuild" : "NOTHING DRAWN (stalled or blank)")")
        }
        print("UI-NOTE kosmos#9226 \(arm) TOTAL: \(stalled) of \(Self.REOPENS) re-opens stalled")
        XCTAssertEqual(stalled, 0)
    }
    func testRefusedReadFix() throws { try refusedRead("refused-fix", oldOpen: false) }
    func testRefusedReadOldOpen() throws { try refusedRead("refused-oldopen", oldOpen: true) }

    // kosmos#9226 case 3: the keyboard comes up and the message box grows (a long draft that wraps) as soon as the chat
    // shows, inside the open's request window. Does the app still answer, and is the newest drawn? Fix vs the old open.
    private func boxDuringOpen(_ arm: String, oldOpen: Bool) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "tall20"]
        if oldOpen { app.launchEnvironment["KOSMOS_SAMPLE_ANCHORATOPEN"] = "1" }
        app.launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 2.0)
        var stalled = 0
        let draft = "A long draft that wraps over several lines in the message box, typed the moment the chat shows, to grow it."
        for i in 1...Self.REOPENS {
            let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
            guard back.waitForExistence(timeout: 20) else { print("UI-NOTE kosmos#9226 \(arm) \(i): no Back button (stalled)"); stalled += 1; continue }
            if app.keyboards.count > 0 { app.swipeDown() }
            back.tap()
            let dana = app.collectionViews.matching(identifier: "agents-list").firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
            guard dana.waitForExistence(timeout: 20) else { print("UI-NOTE kosmos#9226 \(arm) \(i): Dana's row did not show (stalled)"); stalled += 1; continue }
            dana.tap()
            // The box is found by its place, not its placeholder: a typed draft hides the placeholder (the first run's error).
            let box = app.textFields.firstMatch
            guard box.waitForExistence(timeout: 30) else { print("UI-NOTE kosmos#9226 \(arm) \(i): chat did not open (stalled)"); stalled += 1; continue }
            box.tap(); box.typeText(draft)   // the keyboard up and the box grown inside the first second or so
            Thread.sleep(forTimeInterval: 2.5)
            let ok = back.waitForExistence(timeout: 20)
            if !ok { stalled += 1 }
            print("UI-NOTE kosmos#9226 \(arm) \(i): \(ok ? "answering" : "STALLED")")
            if let v = box.value as? String, !v.isEmpty { box.tap(); box.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: v.count)) }
        }
        print("UI-NOTE kosmos#9226 \(arm) TOTAL: \(stalled) of \(Self.REOPENS) re-opens stalled")
        XCTAssertEqual(stalled, 0)
    }
    func testBoxDuringOpenFix() throws { try boxDuringOpen("box-fix", oldOpen: false) }
    func testBoxDuringOpenOldOpen() throws { try boxDuringOpen("box-oldopen", oldOpen: true) }
}
