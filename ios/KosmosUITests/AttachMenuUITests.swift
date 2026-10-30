import XCTest

// kosmos#7596 review 3: the + panel hands each choice on once it has gone, and iOS opens nothing from a presentation still
// on its way out. This taps + and then Photos, and + and then Files, on the sample chat, and checks the picker came up
// over the chat (the + is covered). Skipped unless KOSMOS_UI_PLUS=1 is given to the test runner (TEST_RUNNER_KOSMOS_UI_PLUS).
// Camera cannot run here: a simulator has no camera, so the panel shows it dimmed.
final class AttachMenuUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(room: Bool = false, args: [String] = []) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = room
            ? ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
            : ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        app.launchArguments = args
        app.launch()
        return app
    }

    private func open(_ choice: String, in app: XCUIApplication, plusLabel: String = "Add a photo or file") {
        let plus = app.buttons[plusLabel]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the chat's + did not show")
        plus.tap()
        let row = app.descendants(matching: .any)["attach-panel"].buttons[choice]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the panel did not offer \(choice)")
        shot(app, "panel before \(choice)")
        row.tap()
        // Review 5: the panel itself has gone, so a panel stuck open cannot pass for the picker below.
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: row)
        waitForExpectations(timeout: 5)
        // The picker covers the chat: the + can no longer be tapped. A dropped presentation leaves it tappable.
        let covered = NSPredicate(format: "isHittable == false")
        expectation(for: covered, evaluatedWith: plus)
        // kosmos#7609: the Files and Photos pickers run in their own system process, whose first launch on a freshly booted
        // simulator took over 8 s once (the whole suite on one simulator, iOS 27); a slower CI runner needs more. A long
        // wait cannot make a dropped presentation pass: the + stays hittable and the wait runs out.
        waitForExpectations(timeout: 20)
        shot(app, "\(choice) opened")
    }

    func testPhotosOpensAfterThePanelCloses() throws {
        let app = try launch()
        open("Photos", in: app)
    }

    func testFilesOpensAfterThePanelCloses() throws {
        let app = try launch()
        open("Files", in: app)
    }

    // Review 15: the room has its own picker hosts, so its + is walked too.
    func testPhotosOpensFromARoom() throws {
        let app = try launch(room: true)
        open("Photos", in: app, plusLabel: "Add a file to this conversation")
    }

    // The control: the panel dismissed with no choice leaves the + tappable, so "covered" above means a picker opened.
    func testThePanelClosedWithNoChoiceLeavesThePlus() throws {
        let app = try launch()
        let plus = app.buttons["Add a photo or file"]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the chat's + did not show")
        plus.tap()
        let panelPhotos = app.descendants(matching: .any)["attach-panel"].buttons["Photos"]
        XCTAssertTrue(panelPhotos.waitForExistence(timeout: 5), "the panel did not open")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()   // outside the panel
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: panelPhotos)
        waitForExpectations(timeout: 5)   // the panel closed
        let open = NSPredicate(format: "isHittable == true")
        expectation(for: open, evaluatedWith: plus)
        waitForExpectations(timeout: 5)
    }

    // Review 16: every row is as wide as the widest, so no row leaves a strip that closes the panel instead. The
    // simulator has no camera, so Camera carries its "Not available" note and is the widest row. Review 17: an attempt
    // to force equal widths (fixedSize) pushed the rows off the screen at the largest text, so that is checked too.
    private func rowWidths(_ app: XCUIApplication) -> [CGFloat] {
        let plus = app.buttons["Add a photo or file"]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the chat's + did not show")
        plus.tap()
        let panel = app.descendants(matching: .any)["attach-panel"]
        XCTAssertTrue(panel.buttons["Photos"].waitForExistence(timeout: 5), "the panel did not open")
        shot(app, "panel")
        let rows = panel.buttons.allElementsBoundByIndex
        XCTAssertEqual(rows.count, 3, "the panel should offer Camera, Photos and Files")
        XCTAssertTrue(rows.contains { $0.label.contains("Not available") }, "Camera's note did not show, so this proves nothing")
        // And every row fits across the screen: equal widths alone would pass on rows that all overflow it together.
        // Across only: at the largest text the lower rows sit below the fold inside the panel's scroll view, by design.
        let screen = app.windows.firstMatch.frame
        for row in rows { XCTAssertTrue(row.frame.minX >= screen.minX && row.frame.maxX <= screen.maxX, "\(row.label) runs off the screen: \(row.frame) in \(screen)") }
        return rows.map { $0.frame.width }
    }

    func testEveryRowIsAsWideAsTheWidest() throws {
        let widths = rowWidths(try launch())
        XCTAssertEqual(widths.max()! - widths.min()!, 0, accuracy: 0.5, "row widths \(widths)")
    }

    func testEveryRowIsAsWideAsTheWidestAtTheLargestText() throws {
        let widths = rowWidths(try launch(args: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]))
        XCTAssertEqual(widths.max()! - widths.min()!, 0, accuracy: 0.5, "row widths \(widths)")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
}
