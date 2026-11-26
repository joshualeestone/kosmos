import XCTest

// kosmos#9002: the Duo checks CI runs (ios/tools/ui-sample.sh): the fold, and today's upright iPhone keeping its tabs as
// it always did. The rest of DuoPanesUITests are by hand on a Mac.
final class DuoFoldUITests: DuoPanesCase {
    // Folds or unfolds by the app's own control, then waits for the app to say it did (no clock to race on a slow runner).
    private func fold(_ app: XCUIApplication, _ want: String) {
        let c = app.descendants(matching: .any).matching(identifier: "duo-sample-fold").firstMatch
        XCTAssertTrue(c.waitForExistence(timeout: 10), "CONTROL: the sample fold control is not there")
        c.tap()
        XCTAssertTrue(holds(10) { c.label == want }, "the sample did not become \(want) (it reads \(c.label))")
    }

    // The page is opened while folded, then the phone unfolds: the list comes back beside it with the tabs.
    func testAPageOpenedFoldedHasTheTabsBackOnAnUnfold() throws {
        let app = try launch("tap", ["KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"])
        let info = app.buttons["room-info"], plus = app.buttons["Add a file to this conversation"]
        XCTAssertTrue(info.waitForExistence(timeout: 30), "the room did not open")
        XCTAssertTrue(holds(8) { self.pastMiddle(app, plus) && self.tabsShow(app) }, "CONTROL: unfolded, the room is not beside its list with the tabs")
        fold(app, "sample folded")
        XCTAssertTrue(holds(10) { self.atLeft(app, plus) && !self.tabsShow(app) }, "folded, the room is not alone without the tabs")
        info.tap()
        let about = words(app, "What it is for")
        XCTAssertTrue(about.waitForExistence(timeout: 10) && !tabsShow(app), "the page opened folded has the tab bar over it")
        fold(app, "sample unfolded")
        XCTAssertTrue(holds(10) { self.pastMiddle(app, about) && self.tabsShow(app) }, "unfolded, the page is not beside its list with the tabs")
        shot(app, "opened folded, unfolded")
        // Three pages deep: a member's chat from that page.
        let member = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Cleo'")).firstMatch
        XCTAssertTrue(member.waitForExistence(timeout: 5), "CONTROL: no Cleo in the page's members")
        member.tap()
        let chat = labelled(app, "label == %@", "Message Cleo")
        XCTAssertTrue(holds(10) { self.pastMiddle(app, chat) && self.tabsShow(app) }, "a chat three pages deep is not beside the list with the tabs")
        shot(app, "three deep")
    }

    // A long bubble follows its pane: bounded beside the list, wider when folded alone, bounded again on the unfold.
    func testALongBubbleFollowsItsPaneThroughAFoldAndAnUnfold() throws {
        let app = try launch("tap", ["KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "varied"])
        XCTAssertTrue(box(app).waitForExistence(timeout: 30) && holds(8) { self.beside(app) }, "CONTROL: unfolded, the list is not beside the chat")
        UIKitListArm.assertDrawn(app)
        // The widest message text in the chat's pane, and that pane's width (its message box less the 16 pt margins).
        func widest() -> (text: CGFloat, pane: CGFloat) {
            let b = box(app).frame
            let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label CONTAINS ' of 260'")).allElementsBoundByIndex
                .filter { $0.frame.width > 0 && $0.frame.minX >= b.minX - 20 }
            return (rows.map(\.frame.width).max() ?? 0, b.width + 32)
        }
        sleep(3)
        let open = widest()
        XCTAssertGreaterThan(open.text, 0, "CONTROL: no messages drawn in the chat's pane")
        XCTAssertLessThanOrEqual(open.text, open.pane * 0.78, "unfolded, a bubble's text is wider than its pane's share")
        fold(app, "sample folded")
        XCTAssertTrue(holds(10) { self.alone(app) }, "CONTROL: folded, the chat is not alone")
        sleep(3)
        let folded = widest()
        print("UI-NOTE kosmos#9002 widest bubble text unfolded \(Int(open.text)) of \(Int(open.pane)), folded \(Int(folded.text)) of \(Int(folded.pane))")
        XCTAssertGreaterThan(folded.text, open.text + 20, "folded, the bubbles kept the narrow pane's width")
        shot(app, "long bubbles folded")
        fold(app, "sample unfolded")
        XCTAssertTrue(holds(10) { self.beside(app) }, "CONTROL: unfolded again, the list is not beside the chat")
        sleep(3)
        let again = widest()
        XCTAssertGreaterThan(again.text, 0, "CONTROL: no messages drawn after the unfold")
        XCTAssertLessThanOrEqual(again.text, again.pane * 0.78, "unfolded again, the bubbles kept the whole screen's width")
        shot(app, "long bubbles unfolded again")
    }

    // An upright phone, as it always was: no tabs in a room or its page, the tabs back with the list.
    func testAnUprightPhoneHidesTheTabsInAProjectAndShowsThemInTheList() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        UIKitListArm.set(app)
        app.launch()
        XCTAssertTrue(app.buttons["room-info"].waitForExistence(timeout: 30), "the room did not open")
        XCTAssertTrue(holds(5) { !self.tabsShow(app) }, "an upright phone shows the tabs in a project's room")
        app.buttons["room-info"].tap()
        XCTAssertTrue(words(app, "What it is for").waitForExistence(timeout: 10) && holds(5) { !self.tabsShow(app) }, "an upright phone shows the tabs over a project's page")
        // A task opened from the project's page keeps the tabs hidden, as the rest of a project does (a change on purpose:
        // the task page used to bring them back; Josh 11-03, no nav inside a project).
        let inProject = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Choose the cover photo'")).firstMatch
        for _ in 0..<4 where !(inProject.exists && inProject.isHittable) { app.swipeUp() }
        XCTAssertTrue(inProject.waitForExistence(timeout: 10), "CONTROL: the project's page lists no task to open")
        inProject.tap()
        XCTAssertTrue(app.navigationBars["Task 7"].waitForExistence(timeout: 10), "CONTROL: the task did not open from the project's page")
        XCTAssertTrue(holds(5) { !self.tabsShow(app) }, "the tabs show over a task opened inside a project")
        back(app)
        back(app)
        XCTAssertTrue(app.buttons["room-info"].waitForExistence(timeout: 10), "CONTROL: back did not return to the room")
        XCTAssertTrue(holds(5) { !self.tabsShow(app) }, "the tabs show over the room on the way back")
        back(app)
        XCTAssertTrue(holds(8) { self.tabsShow(app) }, "the tabs did not come back with the list")
        shot(app, "upright, back in the list")
        // A task's page keeps its tabs, as it always has.
        app.tabBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Tasks'")).firstMatch.tap()
        let task = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Choose the cover photo'")).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 10), "no tasks")
        task.tap()
        XCTAssertTrue(app.navigationBars["Task 7"].waitForExistence(timeout: 10) && tabsShow(app), "an upright phone lost the tabs on a task's page")
    }
}
