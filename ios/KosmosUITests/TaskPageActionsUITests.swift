import XCTest

// kosmos#8958 slice B1: a task's page says something on the task, sets its due date, and edits its title or detail
// natively (the board's tk-say, Due and tk-editform), never through the board. Sample agents only (a Debug build): the
// sample Mac's task 4, "Pages 1 to 8", from the Tasks tab. Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other
// sample-board UI tests are (ios/tools/ui-sample.sh runs them). Screenshots in light and dark are the design shots.
final class TaskPageActionsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.appearance = .light; super.tearDown() }

    private func openTask(dark: Bool = false) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        XCUIDevice.shared.appearance = dark ? .dark : .light
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1"]
        app.launch()
        let tasks = app.tabBars.buttons["Tasks"]
        XCTAssertTrue(tasks.waitForExistence(timeout: 30), "no Tasks tab")
        tasks.tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Pages 1 to 8")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no sample task 4 on Tasks")
        row.tap()
        XCTAssertTrue(app.navigationBars["Task 4"].waitForExistence(timeout: 20), "task 4's page did not open")
        // The page drawn (the task read), not only its bar, before anything swipes or looks.
        XCTAssertTrue(app.buttons["Edit title or detail"].waitForExistence(timeout: 20), "task 4's page did not draw")
        return app
    }

    private func box(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Add a message to this task")).firstMatch
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    // The page's own controls: Edit title or detail, the due date with Clear, and the message box with Send.
    func testThePageHasItsActions() throws {
        for dark in [false, true] {
            let app = try openTask(dark: dark)
            XCTAssertTrue(app.buttons["Edit title or detail"].waitForExistence(timeout: 10), "no Edit title or detail")
            XCTAssertTrue(app.buttons["Clear the due date"].exists, "no due date to clear on a task that has one")
            let say = box(app)
            for _ in 0..<6 where !say.isHittable { app.swipeUp() }
            XCTAssertTrue(say.isHittable, "no message box within reach on the task")
            XCTAssertTrue(app.buttons["Send"].exists, "no Send")
            shot(app, "task page actions, \(dark ? "dark" : "light")")
            app.terminate()
        }
    }

    // A message: typed, sent, the box empty again, and the message in the task's activity (the sample Mac records it).
    func testAMessageIsSent() throws {
        let app = try openTask()
        let say = box(app)
        for _ in 0..<6 where !say.isHittable { app.swipeUp() }
        XCTAssertTrue(say.waitForExistence(timeout: 10), "no message box")
        say.tap()
        say.typeText("Check the captions")
        app.buttons["Send"].tap()
        let empty = NSPredicate(format: "NOT (value CONTAINS %@)", "Check the captions")
        expectation(for: empty, evaluatedWith: say)
        waitForExpectations(timeout: 10)
        let inActivity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Check the captions")).firstMatch
        for _ in 0..<4 where !inActivity.exists { app.swipeDown() }
        XCTAssertTrue(inActivity.waitForExistence(timeout: 15), "the message is not in the task's activity")
        shot(app, "message sent")
    }

    // Edit title or detail opens the form with the task's words; Save closes it and the page shows the new title (the
    // sample Mac records it), so a Save that sent nothing cannot pass.
    func testEditOpensAndSaves() throws {
        let app = try openTask()
        let edit = app.buttons["Edit title or detail"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10), "no Edit title or detail")
        edit.tap()
        let save = app.buttons["Save title and detail"]
        XCTAssertTrue(save.waitForExistence(timeout: 10), "the edit form did not open")
        // The form's own field, not the page's title behind the sheet.
        let title = app.textFields.matching(NSPredicate(format: "value CONTAINS %@", "Pages 1 to 8")).firstMatch
        XCTAssertTrue(title.exists, "the form did not open with the task's title")
        shot(app, "edit form")
        title.tap()
        title.typeText(" and the cover")
        save.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: save)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.staticTexts["Pages 1 to 8 and the cover"].waitForExistence(timeout: 15), "the page does not show the saved title")
    }
}
