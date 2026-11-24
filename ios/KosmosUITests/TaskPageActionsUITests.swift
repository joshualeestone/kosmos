import XCTest

// kosmos#8958 slice B1: a task's page says something on the task, sets its due date, and edits its title or detail
// natively (the board's tk-say, Due and tk-editform), never through the board. Sample agents only (a Debug build): the
// sample Mac's task 4, "Pages 1 to 8", from the Tasks tab. Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other
// sample-board UI tests are (ios/tools/ui-sample.sh runs them). Each runs once, in the
// simulator's own appearance: dark design shots come from `xcrun simctl ui <device> appearance dark` before the run
// (XCUIDevice.shared.appearance changes nothing on an iOS 27.0 simulator, TextSetupUITests).
final class TaskPageActionsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func openTask() throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1"]
        app.launch()
        let tasks = app.tabBars.buttons["Tasks"]
        XCTAssertTrue(tasks.waitForExistence(timeout: 30), "no Tasks tab")
        tasks.tap()
        // Its group (Built but waiting) sits below the tiles and four groups, so on a small phone it is scrolled to.
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Pages 1 to 8")).firstMatch
        XCTAssertTrue(app.staticTexts.firstMatch.waitForExistence(timeout: 20), "the Tasks list did not draw")
        for _ in 0..<8 where !(row.exists && row.isHittable) { app.swipeUp() }
        XCTAssertTrue(row.exists && row.isHittable, "no sample task 4 on Tasks")
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
        let app = try openTask()
        XCTAssertTrue(app.buttons["Edit title or detail"].waitForExistence(timeout: 10), "no Edit title or detail")
        XCTAssertTrue(app.buttons["Clear the due date"].exists, "no due date to clear on a task that has one")
        XCTAssertTrue(app.buttons["Put on hold"].exists, "no Put on hold on an open task (kosmos#8958 slice B2)")
        let say = box(app)
        for _ in 0..<6 where !say.isHittable { app.swipeUp() }
        XCTAssertTrue(say.isHittable, "no message box within reach on the task")
        XCTAssertTrue(app.buttons["Send this message on the task"].exists, "no Send")
        shot(app, "task page actions")
    }

    // A message: typed, sent, the box empty again, and the message in the task's activity (the sample Mac records it).
    func testAMessageIsSent() throws {
        let app = try openTask()
        let say = box(app)
        for _ in 0..<6 where !say.isHittable { app.swipeUp() }
        XCTAssertTrue(say.waitForExistence(timeout: 10), "no message box")
        say.tap()
        say.typeText("Check the captions")
        app.buttons["Send this message on the task"].tap()
        let empty = NSPredicate(format: "NOT (value CONTAINS %@)", "Check the captions")
        expectation(for: empty, evaluatedWith: say)
        waitForExpectations(timeout: 10)
        // Any element: an activity row is one combined accessibility element, whatever type XCTest reports it as.
        let inActivity = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Check the captions")).firstMatch
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

    // kosmos#8958 slice B3: Repeats. Sample task 4 repeats twice a day; Every hour is chosen and saved, and the page's
    // line then says the saved rule and Save turns off (the sample Mac stores it), so a Save that sent nothing, or a page
    // that kept the old rule, cannot pass.
    func testRepeatIsChangedAndSaved() throws {
        let app = try openTask()
        let line = app.descendants(matching: .any)["taskpage.repeat.line"]
        for _ in 0..<4 where !(line.exists && line.isHittable) { app.swipeUp() }
        XCTAssertTrue(line.waitForExistence(timeout: 10), "no repeat line on a task that repeats")
        XCTAssertTrue(line.label.contains("Repeats every day at 9am and 5pm"), "the line is not the stored rule: \(line.label)")
        let save = app.buttons["taskpage.repeat.save"]
        XCTAssertTrue(save.exists && !save.isEnabled, "Save is on with nothing changed")
        // kosmos#8958 slice B3b: who is told of a missed run, its choice said as its value (Nobody on the sample).
        let reviewer = app.descendants(matching: .any)["taskpage.repeat.reviewer"]
        XCTAssertTrue(reviewer.exists, "no If missed, tell on a task that repeats")
        XCTAssertEqual(reviewer.value as? String, "Nobody", "the reviewer menu does not say its choice")
        shot(app, "repeats")
        let every = app.buttons["taskpage.repeat.every"]
        XCTAssertTrue(every.exists, "no How often control")
        every.tap()
        let hourly = app.buttons["Every hour"]
        XCTAssertTrue(hourly.waitForExistence(timeout: 5), "the How often menu did not open")
        hourly.tap()
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: save)
        waitForExpectations(timeout: 5)
        save.tap()
        expectation(for: NSPredicate(format: "label CONTAINS %@", "Repeats every hour"), evaluatedWith: line)
        waitForExpectations(timeout: 15)
        // Saved. is said only once the save and its reads are done, so Save being off after it is the rule being
        // unchanged, not the save still in flight.
        XCTAssertTrue(app.staticTexts["Saved."].waitForExistence(timeout: 15), "no Saved. under Repeats")
        XCTAssertFalse(save.isEnabled, "Save is still on after the rule was saved")
        shot(app, "repeat saved")
    }

    // kosmos#8958 slice B4: a task marked done draws its receipt under the activity: what each agent did with its cost, the
    // pull request as a link, the files opened by their count, and a line for an agent with nothing to read.
    func testADoneTaskShowsItsReceipt() throws {
        let app = try openTask()
        let done = app.buttons["Mark as done"]
        for _ in 0..<4 where !(done.exists && done.isHittable) { app.swipeUp() }
        XCTAssertTrue(done.exists, "no Mark as done")
        XCTAssertFalse(app.staticTexts["Edited 2 files, ran 12 commands, 1.2M tokens, $2.50 at API prices."].exists, "an open task shows a receipt")
        done.tap()
        let line = app.staticTexts["Edited 2 files, ran 12 commands, 1.2M tokens, $2.50 at API prices."]
        XCTAssertTrue(line.waitForExistence(timeout: 20), "no receipt on a task marked done")
        let files = app.buttons["2 files, Dana"]
        for _ in 0..<6 where !(files.exists && files.isHittable) { app.swipeUp() }
        XCTAssertTrue(files.isHittable, "no files under the agent's work")
        XCTAssertFalse(app.staticTexts["captions.md"].exists, "the files are open before they are asked for")
        files.tap()
        XCTAssertTrue(app.staticTexts["captions.md"].waitForExistence(timeout: 5), "the files did not open")
        XCTAssertTrue(app.staticTexts["In /Users/sam/Kosmos/Dana"].exists, "no folder under the files")
        XCTAssertTrue(app.links["catalogue#12"].exists, "the pull request is not a link")
        XCTAssertTrue(app.staticTexts["A receipt is not available for Grok agents yet."].exists, "no line for an agent whose work is not read")
        shot(app, "receipt")
    }
    // kosmos#8958 slice B5: under a done task's receipt, its file changes are undone from a list: each file chosen as the
    // Mac offers it (one another agent edited is off but can be chosen, one changed since cannot), Cancel undoes nothing,
    // and the undo says what it did where the offer was (the sample Mac answers with what it was sent).
    func testAFinishedTasksFilesAreUndone() throws {
        for dark in [false, true] {
            let app = try openTask(dark: dark)
            let done = app.buttons["Mark as done"]
            for _ in 0..<4 where !(done.exists && done.isHittable) { app.swipeUp() }
            XCTAssertTrue(done.exists, "no Mark as done")
            let offer = app.buttons["Undo this task\u{2019}s file changes"]
            XCTAssertFalse(offer.exists, "an open task offers an undo")
            done.tap()
            XCTAssertTrue(offer.waitForExistence(timeout: 20), "no undo under a done task's receipt")
            for _ in 0..<6 where !offer.isHittable { app.swipeUp() }
            offer.tap()
            func file(_ name: String) -> XCUIElement { app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch }
            XCTAssertTrue(file("captions.md").waitForExistence(timeout: 10), "the list did not open")
            XCTAssertEqual(file("captions.md").value as? String, "1", "a file that goes back is not chosen")
            XCTAssertEqual(file("pages-1-8.md").value as? String, "1", "a file the agent made is not chosen")
            XCTAssertEqual(file("prices.md").value as? String, "0", "a file another agent edited is chosen")
            XCTAssertTrue(file("prices.md").isEnabled, "a file another agent edited cannot be chosen")
            XCTAssertFalse(file("style.md").isEnabled, "a file changed after the close can be chosen")
            XCTAssertTrue(file("prices.md").label.contains("another agent also edited it"), "its reason is not read with it: \(file("prices.md").label)")
            shot(app, "undo list, \(dark ? "dark" : "light")")
            app.buttons["Cancel"].tap()
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: file("captions.md"))
            waitForExpectations(timeout: 10)
            XCTAssertTrue(offer.waitForExistence(timeout: 10), "Cancel took the offer away")
            offer.tap()
            let prices = file("prices.md")
            XCTAssertTrue(prices.waitForExistence(timeout: 10), "the list did not open again")
            prices.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
            expectation(for: NSPredicate(format: "value == %@", "1"), evaluatedWith: prices)
            waitForExpectations(timeout: 5)
            let go = app.buttons["Undo the chosen files"]
            for _ in 0..<4 where !(go.exists && go.isHittable) { app.swipeUp() }
            go.tap()
            let said = app.staticTexts["Undone: 3 files. The versions from before the undo are saved in /Users/sam/Kosmos/undo-saved/2026-11-24."]
            XCTAssertTrue(said.waitForExistence(timeout: 15), "what was undone is not said")
            // Waited for: the list slides away after the words are there.
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: go)
            waitForExpectations(timeout: 10)
            XCTAssertFalse(offer.exists, "the offer is still there after the undo")
            shot(app, "undone, \(dark ? "dark" : "light")")
            app.terminate()
        }
    }
}
