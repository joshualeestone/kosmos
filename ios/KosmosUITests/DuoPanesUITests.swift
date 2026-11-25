import XCTest

// kosmos#9002: on an unfolded iPhone Duo (both size classes regular) the Agents list and the open chat are side by side, and
// a fold or an unfold keeps the chat and the words typed into it. Sample agents, with KOSMOS_SAMPLE_REGULAR standing in for
// Duo (this Mac's Xcode has no Duo simulator). Sideways, for a width two panes need. Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1.
final class DuoPanesUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.orientation = .portrait; super.tearDown() }

    private func launch(_ regular: String?, _ env: [String: String] = ["KOSMOS_SAMPLE_OPEN": "dana"]) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1"].merging(env) { $1 }
        UIKitListArm.set(app)
        if let regular { app.launchEnvironment["KOSMOS_SAMPLE_REGULAR"] = regular }
        app.launch()
        return app
    }
    private func box(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
    }
    private func row(_ app: XCUIApplication) -> XCUIElement { app.staticTexts["Cleo"].firstMatch }
    // Beside: the message box starts right of the list's row. Judged by frames, never by isHittable: asking that of a row a
    // fold is taking away fails the test by itself.
    private func beside(_ app: XCUIApplication) -> Bool {
        guard box(app).exists, row(app).exists else { return false }
        let b = box(app).frame, r = row(app).frame
        return b.width > 0 && r.width > 0 && r.maxX > 0 && b.minX > r.maxX
    }
    // Alone: the box starts near the left edge, so the chat has the whole width.
    private func alone(_ app: XCUIApplication) -> Bool { box(app).exists && box(app).frame.width > 0 && box(app).frame.minX < app.frame.width * 0.25 }
    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    // Polled, since the size classes change on a timer: true as soon as it holds, false at the end of the wait.
    private func holds(_ seconds: TimeInterval, _ what: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end { if what() { return true }; usleep(300_000) }
        return what()
    }

    // The tabs show beside a list and never over an open page on one column.
    private func tabsShow(_ app: XCUIApplication) -> Bool {
        let b = app.tabBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Settings'")).firstMatch
        return b.exists && b.frame.width > 0 && b.frame.maxY <= app.frame.height && b.frame.minY >= 0
    }

    // CONTROL: the same phone, sideways, with no stand-in, keeps its one column.
    func testSidewaysWithoutTheStandInIsOneColumn() throws {
        let app = try launch(nil)
        XCTAssertTrue(box(app).waitForExistence(timeout: 40), "Dana's chat did not open")
        sleep(2)
        shot(app, "control, one column")
        XCTAssertTrue(alone(app) && !beside(app), "without the stand-in the chat does not have the whole width (box \(box(app).frame))")
    }

    func testTheListIsBesideTheChatAndAFoldKeepsTheChatAndTheDraft() throws {
        let app = try launch("fold:40")
        XCTAssertTrue(box(app).waitForExistence(timeout: 30), "Dana's chat did not open")
        XCTAssertTrue(holds(5) { self.tabsShow(app) }, "CONTROL: unfolded, no tabs beside the chat")
        shot(app, "unfolded")
        XCTAssertTrue(holds(8) { self.beside(app) }, "unfolded, the list is not beside the chat (row \(row(app).frame), box \(box(app).frame))")
        box(app).tap()
        box(app).typeText("kept words")
        XCTAssertTrue(((box(app).value as? String) ?? "").contains("kept words"), "CONTROL: the words were not typed")
        XCTAssertTrue(holds(50) { self.alone(app) }, "the fold never came, or Dana's chat is gone (box exists \(box(app).exists))")
        XCTAssertTrue(holds(5) { !self.tabsShow(app) }, "folded, the tab bar is over the chat")
        shot(app, "folded")
        XCTAssertTrue(((box(app).value as? String) ?? "").contains("kept words"), "folded, the draft is gone (the box reads \((box(app).value as? String ?? "").debugDescription))")
        XCTAssertTrue(holds(60) { self.beside(app) }, "the unfold never came, or Dana's chat is gone (box exists \(box(app).exists))")
        XCTAssertTrue(((box(app).value as? String) ?? "").contains("kept words"), "unfolded again, the draft is gone")
        shot(app, "unfolded again")
    }

    private func words(_ app: XCUIApplication, _ text: String) -> XCUIElement { app.staticTexts[text].firstMatch }
    private func labelled(_ app: XCUIApplication, _ format: String, _ arg: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: format, arg)).firstMatch
    }
    private func pastMiddle(_ app: XCUIApplication, _ e: XCUIElement) -> Bool { e.exists && e.frame.width > 0 && e.frame.minX > app.frame.width * 0.25 }
    private func atLeft(_ app: XCUIApplication, _ e: XCUIElement) -> Bool { e.exists && e.frame.width > 0 && e.frame.minX < app.frame.width * 0.25 }

    // A reader higher up a long chat is still looking at the same message after a fold and after the unfold.
    func testAFoldKeepsTheReadersPlaceInALongChat() throws {
        let app = try launch("fold:50", ["KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1"])
        XCTAssertTrue(box(app).waitForExistence(timeout: 30), "Dana's chat did not open")
        XCTAssertTrue(holds(8) { self.beside(app) }, "CONTROL: the list is not beside the chat")
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "CONTROL: the chat did not open at its newest message")
        for _ in 0..<3 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.3)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.65)))
        }
        sleep(3)
        XCTAssertFalse(newest.exists && newest.frame.minY < app.frame.height && newest.isHittable, "CONTROL: the drags did not move the reader up")
        let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label CONTAINS ' of 260'")).allElementsBoundByIndex
        let middle = app.frame.height * 0.35
        guard let held = rows.filter({ $0.frame.minY > 60 && $0.frame.maxY < app.frame.height * 0.7 }).min(by: { abs($0.frame.midY - middle) < abs($1.frame.midY - middle) })?.label
        else { XCTFail("CONTROL: no message in the middle of the screen"); return }
        let row = app.staticTexts.matching(NSPredicate(format: "label == %@", held)).firstMatch
        let y0 = row.frame.midY
        shot(app, "scrolled, unfolded")
        func kept(_ when: String) {
            sleep(2)
            shot(app, "scrolled, " + when)
            XCTAssertTrue(row.exists && row.frame.minY > 0 && row.frame.maxY < app.frame.height, "\(when): '\(held)' is no longer on screen (exists \(row.exists))")
            print("UI-NOTE kosmos#9002 \(when): '\(held)' moved \(Int((row.exists ? row.frame.midY : 9999) - y0)) pt")
            if row.exists { XCTAssertLessThan(abs(row.frame.midY - y0), 130, "\(when): '\(held)' moved") }
        }
        XCTAssertTrue(holds(60) { self.alone(app) }, "the fold never came, or the chat is gone")
        kept("folded")
        XCTAssertTrue(holds(70) { self.beside(app) }, "the unfold never came, or the chat is gone")
        kept("unfolded again")
    }

    // A project's room beside its list, then its info page: a fold and an unfold keep the page; another project picked in the
    // list while that page is open shows that project's room, with the page gone.
    func testAProjectsPagesStayThroughAFoldAndAnotherProjectReplacesThem() throws {
        let app = try launch("fold:40", ["KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"])
        let info = app.buttons["room-info"]
        XCTAssertTrue(info.waitForExistence(timeout: 30), "the room did not open")
        XCTAssertTrue(holds(8) { self.pastMiddle(app, app.buttons["Add a file to this conversation"]) }, "unfolded, the room is not beside the list")
        shot(app, "project, unfolded")
        info.tap()
        let about = words(app, "What it is for")
        XCTAssertTrue(about.waitForExistence(timeout: 10) && holds(5) { self.pastMiddle(app, about) }, "the project's page is not beside the list")
        XCTAssertTrue(holds(50) { self.atLeft(app, about) }, "folded, the project's page is gone (exists \(about.exists))")
        XCTAssertTrue(holds(5) { !self.tabsShow(app) }, "folded, the tab bar is over the project's page")
        shot(app, "project page, folded")
        XCTAssertTrue(holds(60) { self.pastMiddle(app, about) }, "unfolded again, the project's page is gone")
        XCTAssertTrue(holds(5) { self.tabsShow(app) }, "unfolded again, the tabs are gone beside the project's page")
        shot(app, "project page, unfolded again")
        let other = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Website'")).firstMatch
        XCTAssertTrue(other.exists, "CONTROL: no Website row in the list")
        other.tap()
        XCTAssertTrue(holds(10) { !about.exists && self.pastMiddle(app, app.buttons["Add a file to this conversation"]) },
                      "another project did not replace the page (page still there \(about.exists))")
        sleep(2)
        shot(app, "another project")
    }

    // A task's page beside the list, kept through a fold; an agent's Answer in the list then takes its place.
    func testATaskStaysThroughAFoldAndAnswerReplacesIt() throws {
        let app = try launch("fold:40", ["KOSMOS_SAMPLE_TAB": "tasks"])
        let task = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Choose the cover photo'")).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 30), "no tasks")
        XCTAssertTrue(words(app, "Choose a task").waitForExistence(timeout: 10), "unfolded, nothing says to choose a task")
        shot(app, "tasks, nothing open")
        task.tap()
        sleep(3)
        shot(app, "task, unfolded")
        // The page's own bar title, so this does not depend on the sample task's contents.
        let bar = app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS[c] 'task' AND identifier != 'Tasks'")).firstMatch
        print("UI-NOTE kosmos#9002 bars: \(app.navigationBars.allElementsBoundByIndex.map(\.identifier))")
        XCTAssertTrue(pastMiddle(app, bar) && !words(app, "Choose a task").exists, "the task is not beside the list")
        XCTAssertTrue(holds(50) { self.atLeft(app, bar) }, "folded, the task is gone")
        shot(app, "task, folded")
        XCTAssertTrue(holds(60) { self.pastMiddle(app, bar) }, "unfolded again, the task is gone")
        let answer = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Answer'")).firstMatch
        XCTAssertTrue(answer.exists, "CONTROL: no Answer in the list")
        answer.tap()
        let cleo = labelled(app, "label == %@", "Message Cleo")
        XCTAssertTrue(holds(10) { self.pastMiddle(app, cleo) && !bar.exists }, "Answer did not put Cleo's chat in the task's place")
        sleep(2)
        shot(app, "answer")
    }

    // The tab bar floats over the list: its last row can still be read above it.
    func testTheListsLastRowClearsTheTabBar() throws {
        let app = try launch("1")
        XCTAssertTrue(box(app).waitForExistence(timeout: 30) && holds(8) { self.beside(app) }, "CONTROL: the list is not beside the chat")
        for _ in 0..<4 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.7)).press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)))
        }
        sleep(2)
        shot(app, "list's end")
        let last = app.collectionViews.firstMatch.cells.allElementsBoundByIndex.last
        let bar = app.tabBars.firstMatch
        print("UI-NOTE kosmos#9002 last row \(String(describing: last?.frame)), tab bar \(bar.exists ? String(describing: bar.frame) : "none"), buttons \(app.tabBars.buttons.allElementsBoundByIndex.map(\.frame))")
        XCTAssertTrue(bar.exists, "CONTROL: no tab bar beside the chat")
        guard let last else { XCTFail("CONTROL: no rows"); return }
        // Only where they share a column: a bar narrower than the window covers nothing beside it.
        let covered = app.tabBars.buttons.allElementsBoundByIndex.contains { $0.frame.intersects(last.frame) }
        XCTAssertFalse(covered, "the tab bar covers the list's last row (\(last.frame))")
    }
}
