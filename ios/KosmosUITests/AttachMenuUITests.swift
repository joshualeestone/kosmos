import XCTest

// kosmos#8045: the + opens the tray of recent photos at once, on the sample chat and room, with the sample tiles
// (KOSMOS_SAMPLE_PHOTOS, plain colours, standing in for each answer to iOS's photo prompt). Skipped unless KOSMOS_UI_PLUS=1 is
// given to the test runner (TEST_RUNNER_KOSMOS_UI_PLUS). Camera cannot run here: a simulator has no camera, so its tile is dimmed.
final class AttachMenuUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private let chatPlus = "Add a photo or file"
    private let roomPlus = "Add a file to this conversation"

    private func launch(room: Bool = false, photos: String = "all", args: [String] = []) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = (room
            ? ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
            : ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]).merging(["KOSMOS_SAMPLE_PHOTOS": photos]) { $1 }
        app.launchArguments = args
        app.launch()
        return app
    }

    private func panel(_ app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any)["attach-panel"] }

    @discardableResult private func openTray(_ app: XCUIApplication, plus label: String) -> XCUIElement {
        let plus = app.buttons[label]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the + did not show")
        plus.tap()
        XCTAssertTrue(panel(app).waitForExistence(timeout: 5), "the tray did not open")
        // kosmos#7609: the plan file has what this is for and what it does not rule out.
        KeyboardSlideUITests.settle(panel(app))
        return plus
    }

    private func gone(_ element: XCUIElement, timeout: TimeInterval = 10) {
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        waitForExpectations(timeout: timeout)
    }

    // One tap: the tray is up with the camera first, photos, all photos and files, and the + reads as closing it.
    private func checkOneTap(_ app: XCUIApplication, plus: String) {
        openTray(app, plus: plus)
        let p = panel(app)
        for name in ["Camera", "Sample photo 1", "All photos", "Files"] {
            XCTAssertTrue(p.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch.waitForExistence(timeout: 5), "the tray did not offer \(name)")
        }
        XCTAssertTrue(app.buttons["Close photos"].exists, "the + did not become the X")
        XCTAssertFalse(app.buttons[plus].exists, "CONTROL: the + is still named as opening")
        let camera = p.buttons["Camera"].frame, first = p.buttons["Sample photo 1"].frame
        XCTAssertLessThan(camera.minX, first.minX, "the camera is not the first tile: \(camera) \(first)")
        shot(app, "tray")
    }

    func testPlusShowsRecentPhotosInAChat() throws { checkOneTap(try launch(), plus: chatPlus) }
    func testPlusShowsRecentPhotosInARoom() throws { checkOneTap(try launch(room: true), plus: roomPlus) }

    // A tile adds its photo, keeps the tray open, and takes it back on a second tap. The Send button is the way out.
    func testATileAddsAndASecondTapTakesItBack() throws {
        let app = try launch()
        openTray(app, plus: chatPlus)
        let tile = panel(app).buttons["Sample photo 2"]
        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        tile.tap()
        let selected = NSPredicate(format: "isSelected == true")
        expectation(for: selected, evaluatedWith: tile)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(panel(app).exists, "the tray closed on a tap")
        let send = app.buttons["Send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "no Send once a photo waits")
        shot(app, "added")
        tile.tap()
        expectation(for: NSPredicate(format: "isSelected == false"), evaluatedWith: tile)
        waitForExpectations(timeout: 10)
        gone(send)
    }

    func testARoomTileAddsAPhoto() throws {
        let app = try launch(room: true)
        openTray(app, plus: roomPlus)
        let tile = panel(app).buttons["Sample photo 1"]
        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        tile.tap()
        expectation(for: NSPredicate(format: "isSelected == true"), evaluatedWith: tile)
        waitForExpectations(timeout: 10)
    }

    private func checkPickerCovers(_ app: XCUIApplication, plus: XCUIElement, tapping row: XCUIElement) {
        XCTAssertTrue(row.waitForExistence(timeout: 5), "no \(row)")
        row.tap()
        // The picker covers the chat: the X can no longer be tapped. A dropped presentation leaves it tappable.
        // kosmos#7609: the pickers run in their own system process, whose first launch can take over 8 s.
        expectation(for: NSPredicate(format: "isHittable == false"), evaluatedWith: plus)
        waitForExpectations(timeout: 20)
        shot(app, "picker")
    }

    func testAllPhotosOpensThePicker() throws {
        let app = try launch()
        openTray(app, plus: chatPlus)
        checkPickerCovers(app, plus: app.buttons["Close photos"], tapping: panel(app).buttons["All photos"])
    }

    func testFilesOpensItsPicker() throws {
        let app = try launch(room: true)
        openTray(app, plus: roomPlus)
        checkPickerCovers(app, plus: app.buttons["Close photos"], tapping: panel(app).buttons["Files"])
    }

    // Don't Allow: not a dead panel. Today's picker is one tap away, and no grid or All photos row pretends otherwise.
    func testAccessOffStillChoosesAPhoto() throws {
        let app = try launch(photos: "off")
        openTray(app, plus: chatPlus)
        let p = panel(app)
        XCTAssertTrue(p.buttons["Open Settings"].waitForExistence(timeout: 5), "no way to change the answer")
        XCTAssertFalse(p.buttons["Sample photo 1"].exists, "a grid with access off")
        XCTAssertFalse(p.buttons["All photos"].exists, "All photos with nothing above it")
        XCTAssertTrue(p.buttons["Files"].exists, "Files went with access off")
        shot(app, "off")
        checkPickerCovers(app, plus: app.buttons["Close photos"], tapping: p.buttons["Choose photos"])
    }

    func testLimitedShowsTheChosenAndAllPhotos() throws {
        let app = try launch(photos: "limited")
        openTray(app, plus: chatPlus)
        let p = panel(app)
        XCTAssertTrue(p.buttons["Sample photo 3"].waitForExistence(timeout: 5), "the chosen photos did not show")
        XCTAssertFalse(p.buttons["Sample photo 4"].exists, "CONTROL: more than the chosen photos")
        XCTAssertTrue(p.buttons["All photos"].exists, "no way to any other photo")
        XCTAssertTrue(p.buttons["Open Settings"].exists, "no way to change the choice")
        shot(app, "limited")
    }

    // The X closes it and the + comes back, tappable: so "covered" above means a picker opened.
    func testTheXClosesTheTray() throws {
        let app = try launch()
        openTray(app, plus: chatPlus)
        app.buttons["Close photos"].tap()
        gone(panel(app))
        let plus = app.buttons[chatPlus]
        expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: plus)
        waitForExpectations(timeout: 5)
    }

    // Design review: the last row scrolls fully clear of the bottom row and the home bar.
    func testTheLastRowScrollsClearOfTheBottomRow() throws {
        let app = try launch()
        openTray(app, plus: chatPlus)
        let p = panel(app)
        let last = p.buttons["Sample photo 23"]
        XCTAssertTrue(last.waitForExistence(timeout: 5), "no last tile")
        // Far enough to pass any row, and from a tile so the bottom row takes no part.
        let top = p.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
        let up = p.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.02))
        var seen: [CGFloat] = [last.frame.maxY]
        for _ in 0..<8 { top.press(forDuration: 0.05, thenDragTo: up); seen.append(last.frame.maxY) }
        let row = p.buttons["All photos"].frame
        XCTAssertLessThanOrEqual(last.frame.maxY, row.minY, "the last tile stops under the bottom row: \(seen), row \(row)")
        shot(app, "scrolled to the end")
    }

    // The search row's keyboard: the + takes it down too, or the box and the tray would sit behind it.
    func testThePlusFromSearchTakesItsKeyboardDown() throws {
        let app = try launch()
        let search = app.buttons["Search this conversation"]
        XCTAssertTrue(search.waitForExistence(timeout: 20), "no search button")
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "CONTROL: search brought no keyboard up")
        XCTAssertTrue(app.buttons[chatPlus].waitForExistence(timeout: 3) && app.buttons[chatPlus].isHittable, "no + while searching, so this checks nothing")
        app.buttons[chatPlus].tap()
        XCTAssertTrue(panel(app).waitForExistence(timeout: 5), "the tray did not open")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
        waitForExpectations(timeout: 5)
        expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: app.buttons["Close photos"])
        waitForExpectations(timeout: 5)
    }

    func testTheRowFitsAtTheLargestText() throws {
        let app = try launch(args: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openTray(app, plus: chatPlus)
        let screen = app.windows.firstMatch.frame
        for name in ["All photos", "Files"] {
            let row = panel(app).buttons[name]
            XCTAssertTrue(row.waitForExistence(timeout: 5), "no \(name)")
            XCTAssertTrue(row.frame.minX >= screen.minX && row.frame.maxX <= screen.maxX, "\(name) runs off the screen: \(row.frame) in \(screen)")
        }
        shot(app, "largest text")
    }

    // Josh 11:00: with the keyboard up, the grid takes the keyboard's exact place as it drops, with no jump in the box. The
    // box is read as often as XCUITest can through the swap and back; it may not move. CONTROL: it did move for the keyboard.
    // backAllowance: kosmos#8081, a room rises about 39 pt for a moment on the way back. Remove it with that card.
    private func checkTheBoxHolds(_ app: XCUIApplication, plus label: String, box: XCUIElement, backAllowance: CGFloat = 1.5) {
        XCTAssertTrue(box.waitForExistence(timeout: 20), "no message box")
        let down = box.frame.minY
        box.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no on-screen keyboard")
        expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: app.keyboards.firstMatch)
        waitForExpectations(timeout: 5)
        Thread.sleep(forTimeInterval: 1)   // risen, so the box's place is the keyboard's
        let up = box.frame.minY
        XCTAssertLessThan(up, down - 100, "CONTROL: the keyboard did not lift the box")
        app.buttons[label].tap()
        var seen: [CGFloat] = []
        // Through the swap, and at least four readings: one reading took over a second on a loaded CI runner.
        let end = Date().addingTimeInterval(1.2)
        while Date() < end || seen.count < 4 { seen.append(box.frame.minY) }
        XCTAssertTrue(panel(app).exists, "the tray did not open")
        XCTAssertFalse(app.keyboards.firstMatch.exists && app.keyboards.firstMatch.isHittable, "the keyboard stayed up")
        XCTAssertGreaterThan(seen.count, 2, "too few readings to mean anything")
        for y in seen { XCTAssertEqual(y, up, accuracy: 1.5, "the box moved on the way down: \(seen), kept at \(up)") }
        // The keyboard's element starts below its suggestion bar, so its top says nothing about its real one. The box held, and
        // the tray sits directly under it, so it took the room the keyboard had.
        let gap = panel(app).frame.minY - box.frame.maxY
        XCTAssertTrue(gap >= 0 && gap <= 30, "the tray is not directly under the box: \(gap) pt")
        shot(app, "swapped")
        // And back: the X returns to the keyboard, with the box still where it was.
        app.buttons["Close photos"].tap()
        seen = []
        let back = Date().addingTimeInterval(1.2)
        while Date() < back || seen.count < 4 { seen.append(box.frame.minY) }
        for y in seen { XCTAssertEqual(y, up, accuracy: backAllowance, "the box moved on the way back: \(seen), kept at \(up)") }
        XCTAssertEqual(box.frame.minY, up, accuracy: 1.5, "the box did not settle back where it was")
        XCTAssertFalse(panel(app).exists, "the tray stayed under the keyboard")
    }

    func testTheBoxHoldsThroughTheSwapInAChat() throws {
        let app = try launch()
        checkTheBoxHolds(app, plus: chatPlus, box: app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch)
    }

    func testTheBoxHoldsThroughTheSwapInARoom() throws {
        let app = try launch(room: true)
        checkTheBoxHolds(app, plus: roomPlus, box: app.textFields.matching(NSPredicate(format: "placeholderValue == 'Message Spring catalogue'")).firstMatch, backAllowance: 45)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
}
