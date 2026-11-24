import XCTest

// kosmos#7838: the room's info button opens the native project page (ProjectInfoView), not the board in a sheet: About
// first, then Files. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as RoomTitleUITests is; screenshots kept for design review.
final class ProjectInfoUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let s = XCTAttachment(screenshot: app.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    func testInfoOpensTheProjectPageAboutThenFiles() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue", "KOSMOS_SAMPLE_FILES": "1"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        // CONTROL: before the tap, the project page is not on screen.
        XCTAssertFalse(app.staticTexts["What it is for"].exists, "the project page showed before Project info was tapped")
        XCTAssertFalse(app.buttons["Files"].exists, "the room still has a separate Files button")
        app.buttons["room-info"].tap()
        XCTAssertTrue(app.staticTexts["What it is for"].waitForExistence(timeout: 10), "About did not open")
        XCTAssertTrue(app.staticTexts["Members"].exists || app.staticTexts["MEMBERS"].exists, "no Members section")
        shot(app, "project-info-about")
        app.swipeUp()
        shot(app, "project-info-about-lower")
        // Slice B: Settings, the middle segment, with the board's own rename sentence.
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Renaming is safe. Agents stay on the project, and Kosmos tells them the new name."].waitForExistence(timeout: 5), "Settings did not open")
        shot(app, "project-info-settings")
        app.swipeUp()
        shot(app, "project-info-settings-lower")
        app.buttons["Files"].tap()
        XCTAssertFalse(app.staticTexts["What it is for"].waitForExistence(timeout: 2), "About stayed after choosing Files")
        sleep(2)
        shot(app, "project-info-files")
    }

    // kosmos#8956: adding a member, removing one and archiving are native screens, and none of them opens the board page.
    // The sample board admits no computer, so these stop at the screens (PigeonPete, #8954): what the taps send is covered
    // in ios/LogicTests/room. On iOS 26+ a confirmationDialog is a popover with no Cancel button (Renet, #8955).
    private func dismissDialog(_ app: XCUIApplication) {
        let cancel = app.buttons["Cancel"]
        if cancel.waitForExistence(timeout: 2) && cancel.isHittable { cancel.tap(); return }
        let outside = app.otherElements["PopoverDismissRegion"]
        if outside.waitForExistence(timeout: 2) { outside.tap() }
    }

    func testMembersAndArchiveAreNative() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        app.buttons["room-info"].tap()
        XCTAssertTrue(app.staticTexts["What it is for"].waitForExistence(timeout: 10), "About did not open")
        // Review 1: the general board rows are gone from About and from Settings (only the labelled hand-off is left).
        // Review 3: About is loaded and carries the labelled hand-off first, so the absence below is about a page that is there.
        // (No web-view check: the sample board admits no computer, so the board page could not open here either way.)
        let aboutHandoff = app.buttons["project-outside-members"]
        for _ in 0..<4 where !aboutHandoff.exists { app.swipeUp() }
        XCTAssertTrue(aboutHandoff.waitForExistence(timeout: 5), "About has no labelled hand-off")
        XCTAssertFalse(app.buttons["Open on your computer\u{2019}s board"].exists, "About still has the general board row")
        app.buttons["Settings"].tap()
        let add = app.buttons["project-add-member"]
        for _ in 0..<4 where !add.isHittable { app.swipeUp() }
        XCTAssertTrue(add.waitForExistence(timeout: 5), "no Add a member")
        shot(app, "project-members-settings")
        add.tap()
        XCTAssertTrue(app.navigationBars["Add a member"].waitForExistence(timeout: 5), "Add a member did not open natively")
        shot(app, "project-add-member")
        app.navigationBars["Add a member"].buttons["Cancel"].tap()
        XCTAssertFalse(app.navigationBars["Add a member"].waitForExistence(timeout: 2), "Cancel did not close Add a member")
        let remove = app.buttons["project-remove-member"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "no member to remove")
        remove.tap()
        XCTAssertTrue(app.buttons["Remove from this project"].waitForExistence(timeout: 5), "Remove did not ask first")
        shot(app, "project-remove-member-ask")
        dismissDialog(app)
        XCTAssertFalse(app.buttons["Remove from this project"].waitForExistence(timeout: 2), "the Remove question stayed after Cancel")
        let archive = app.buttons["project-archive"]
        for _ in 0..<4 where !archive.isHittable { app.swipeUp() }
        XCTAssertTrue(archive.waitForExistence(timeout: 5), "no Archive project")
        archive.tap()
        // Review 1: the question's own words (the row's button is also called Archive project, so a button count proves nothing).
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Archive Spring'")).firstMatch.waitForExistence(timeout: 5), "Archive did not ask first")
        shot(app, "project-archive-ask")
        dismissDialog(app)
        XCTAssertTrue(app.buttons["project-outside-members"].waitForExistence(timeout: 5), "the labelled hand-off for members from other computers is missing")
        XCTAssertFalse(app.buttons["Open on your computer\u{2019}s board"].exists, "Settings still has the general board row")
        shot(app, "project-settings-lower")
    }

    // kosmos#7847: a project's room has no tab bar (as a direct conversation has none); Back to the list brings it back.
    func testTheRoomHasNoTabBar() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        sleep(1)
        XCTAssertFalse(app.tabBars.buttons["Projects"].isHittable, "the tab bar shows inside the room")
        shot(app, "room-no-tab-bar")
        // CONTROL: back on the Projects list, the bar is there, so the check above can see one.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.tabBars.buttons["Projects"].waitForExistence(timeout: 10), "CONTROL: no tab bar on the Projects list")
        XCTAssertTrue(app.tabBars.buttons["Projects"].isHittable, "CONTROL: the list's tab bar is not on screen")
    }

    // kosmos#7847 final review: a task opened from the project page keeps the bar hidden too. Measured on iOS 27.0 and
    // 26.5: the room's hidden bar carries down the stack to every screen pushed from it, so the task page needs no rule
    // of its own (a per-screen flag was tried and changed nothing, both arms passing). This guards that behaviour: a
    // screen pushed here that set the bar visible would fail it.
    func testATaskOpenedFromTheProjectPageHasNoTabBar() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        app.buttons["room-info"].tap()
        XCTAssertTrue(app.staticTexts["What it is for"].waitForExistence(timeout: 10), "About did not open")
        app.swipeUp()
        let task = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12'")).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10), "no open task row")
        task.tap()
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Task '")).firstMatch.waitForExistence(timeout: 10)
                      || app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Task '")).firstMatch.waitForExistence(timeout: 2), "the task page did not open")
        sleep(1)
        XCTAssertFalse(app.tabBars.buttons["Projects"].isHittable, "the tab bar came back on a task opened from the project")
        shot(app, "project-task-no-tab-bar")
    }

    // Review 1: tapping a member opens their chat on top of the project page.
    func testAMemberOpensTheirChat() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue", "KOSMOS_SAMPLE_FILES": "1"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        app.buttons["room-info"].tap()
        XCTAssertTrue(app.staticTexts["What it is for"].waitForExistence(timeout: 10), "About did not open")
        let dana = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Dana'")).firstMatch
        XCTAssertTrue(dana.waitForExistence(timeout: 5), "no member row for Dana")
        dana.tap()
        // Only Dana's own chat has this composer (the room's reads "Message Spring catalogue", a name a post also shows).
        let danaComposer = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(danaComposer.waitForExistence(timeout: 10), "Dana's chat did not open")
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Spring catalogue'")).firstMatch.exists,
                       "the room is on top, not Dana's chat")
        shot(app, "project-info-member-chat")
    }
}
