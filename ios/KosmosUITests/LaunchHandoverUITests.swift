import XCTest

// kosmos#7945 follow-up (Josh 11-04 on build 43: a big launch orb, then a small one): the launch screen is a picture of
// the Agents tab's "Connecting..." ring, centred on the screen (a launch image always is). This measures, on a running
// app, that the wait still puts its ring there: run-sweep.sh reads the view's code, which cannot see a wrapper added
// above it that moves it. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other sample-board checks are.
final class LaunchHandoverUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testTheWaitToConnectSitsWhereTheLaunchScreenDrawsTheRing() throws {
        try measure(tab: nil, words: "Connecting\u{2026}")
    }

    // A launch from a room notification opens on Projects, whose first wait is drawn the same way (ConnectingWait), under
    // a different bar.
    func testTheProjectsWaitSitsWhereTheLaunchScreenDrawsTheRing() throws {
        try measure(tab: "projects", words: "Reaching your computer\u{2026}")
    }

    private func measure(tab: String?, words: String) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_REACHING": "1"]
        if let tab { app.launchEnvironment["KOSMOS_SAMPLE_TAB"] = tab }
        app.launch()
        let wait = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", words)).firstMatch
        XCTAssertTrue(wait.waitForExistence(timeout: 20), "the wait (\(words)) did not show")
        let screen = app.windows.firstMatch.frame, frame = wait.frame
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = tab ?? "agents"; shot.lifetime = .keepAlways; add(shot)
        // The element is the ring and the words below it together (accessibilityElement(children: .combine)), so its top
        // is the ring's top and its middle across is the ring's. The ring is 20 pt (SweepDots(scales: false), the launch
        // picture's side), so its centre is 10 pt below that top. Within a point of the screen's centre, where the launch
        // screen draws it.
        let ring = CGPoint(x: frame.midX, y: frame.minY + 10)
        XCTAssertEqual(ring.x, screen.midX, accuracy: 1, "the ring is not across the screen's middle: wait \(frame), screen \(screen)")
        XCTAssertEqual(ring.y, screen.midY, accuracy: 1, "the ring is not at the screen's middle height: wait \(frame), screen \(screen)")
        // The words sit under the ring, not beside or over it: the element runs below the ring.
        XCTAssertGreaterThan(frame.maxY, ring.y + 10 + 8, "the words are not below the ring: wait \(frame)")
    }
}
