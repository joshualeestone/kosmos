import XCTest

// kosmos#8959 slice D2b1: Settings' "Connections" opens the native, read-only list (ConnView), not the board's page. In
// a sample run (KOSMOS_SAMPLE_AGENTS=1) the screen shows the sample computer's four services (one of each state, both
// kinds) and never asks a real one, so this check sees each row's line and the footer that sends changes to the
// computer. It drives only the sample build's path; the request and every state are the logic suite's (run-conn.sh).
final class ConnUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testConnectionsRowOpensTheNativeList() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-connections"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Connections row in Settings")
        row.tap()

        XCTAssertTrue(app.navigationBars["Connections"].waitForExistence(timeout: 10), "the native Connections screen did not open")
        let rows = app.descendants(matching: .any).matching(identifier: "conn-service")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 10), "no service rows")
        // By their whole labels, not by position (a duplicated element would shift positions).
        for label in ["GitHub, Signed in on your computer", "Vercel, Not saved by Kosmos: check it on your computer",
                      "Cloudflare, Not connected", "Brave Search, Saved on your computer"] {
            XCTAssertTrue(rows.matching(NSPredicate(format: "label == %@", label)).firstMatch.exists, "no row reads: " + label)
        }
        XCTAssertTrue(app.staticTexts["Connect, check or remove a service in Settings on your computer."].waitForExistence(timeout: 5),
                      "the footer that sends changes to the computer")
        shot(app, "connections-list")
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement, swipes: Int = 8) {
        for _ in 0..<swipes where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
