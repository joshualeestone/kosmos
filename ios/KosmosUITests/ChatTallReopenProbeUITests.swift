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
    private func probe(_ arm: String, noLooks: Bool, danaIdle: Bool = false) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "tall20"]
        if noLooks { app.launchEnvironment["KOSMOS_SAMPLE_NOOPENLAND"] = "1" }
        // Arm "looks-idle": Dana shown idle (BoardClient.sampleWithDanaAsSet), so the chat draws no always-on "is working"
        // wave (LayerWaveDots): one variable changed against arm "looks".
        if danaIdle { app.launchEnvironment["KOSMOS_SAMPLE_SEND_WORKS"] = "1"; app.launchEnvironment["KOSMOS_SAMPLE_SEND_SLOW"] = "0.5" }
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
    func testReopenWithoutTheLooks() throws { try probe("nolooks", noLooks: true) }
    func testReopenWithTheLooksDanaIdle() throws { try probe("looks-idle", noLooks: false, danaIdle: true) }
}
