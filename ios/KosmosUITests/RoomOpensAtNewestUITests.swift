import XCTest

// kosmos#7654: a long room opens on its newest post, the first time and when it is opened again with its posts already
// read (the second open takes a different path in RoomView). Sample room (a Debug build), Spring catalogue made long
// (KOSMOS_SAMPLE_ROOM_LONG). Nothing in the room is touched: the room's own opening is what is checked. Run in CI by the
// ios workflow's "ui tests (sample board)" job (ios/tools/ui-sample.sh).
final class RoomOpensAtNewestUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testRoomOf150OpensOnItsNewestPost() throws {
        let app = Self.launch(150)
        Self.assertOnNewest(app, 150, shot: "room-150-opened", test: self)
    }

    func testRoomOf220OpensOnItsNewestPost() throws {
        let app = Self.launch(220)
        Self.assertOnNewest(app, 220, shot: "room-220-opened", test: self)
    }

    // Back to the projects list, then the same room again: its posts are already in the store, so the room is placed by
    // its appearance, not by a new last post.
    func testRoomOf220OpenedAgainOpensOnItsNewestPost() throws {
        let app = Self.launch(220)
        Self.assertOnNewest(app, 220, shot: "room-220-first-open", test: self)
        let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5), "no Back button in the room's top bar")
        back.tap()
        // The room is proven closed by its box going (the list stays in the tree under a pushed room).
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: Self.box(app))
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "the room did not close")
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Spring catalogue'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10) && row.isHittable, "the Spring catalogue row is not showing")
        row.tap()
        Self.assertOnNewest(app, 220, shot: "room-220-opened-again", test: self)
    }

    private static func launch(_ n: Int) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue",
                                 "KOSMOS_SAMPLE_ROOM_LONG": String(n)]
        app.launch()
        return app
    }

    private static func box(_ app: XCUIApplication) -> XCUIElement {
        app.textFields.matching(NSPredicate(format: "placeholderValue == 'Message Spring catalogue'")).firstMatch
    }

    private static func assertOnNewest(_ app: XCUIApplication, _ n: Int, shot: String, test: XCTestCase) {
        let box = box(app)
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        // Presence first: some post of this room is drawn, so the newest missing means the room stopped short of it.
        let any = app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' of \(n).'")).firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 15), "no posts of the \(n)-post room")
        KeyboardSlideUITests.settle(any)
        let newest = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Post \(n) of \(n).'")).firstMatch
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = shot; a.lifetime = .keepAlways; test.add(a)
        XCTAssertTrue(newest.exists && newest.isHittable, "\(shot): the \(n)-post room did not open on its newest post")
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "\(shot): the newest post ends at \(newest.frame.maxY), under the box at \(box.frame.minY)")
    }
}
