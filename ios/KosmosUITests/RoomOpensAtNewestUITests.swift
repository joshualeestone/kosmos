import XCTest

// kosmos#7654: a long room opens on its newest post, the first time and when it is opened again. Sample room (a Debug
// build), Spring catalogue made long (KOSMOS_SAMPLE_ROOM_LONG). The first three touch nothing: the room's own opening is
// what is checked. The fourth scrolls, to check that a person's scroll ends the opening's retries. Run in CI by the ios
// workflow's "ui tests (sample board)" job (ios/tools/ui-sample.sh).
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

    // Back to the projects list, then the same room again.
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

    // kosmos#7654 part 2: on iOS 17 and later the room is anchored on a post id and the opening jump sets the anchor without
    // retries, so this now checks that the anchor does not pull an early scroller back to the newest post. The round-3 cancel it
    // was written for (retries to 2.3 s, iOS 18 and later) no longer runs there; the "control" below is from that round.
    // kosmos#7654 round 3: a person's scroll during the opening ends its retries (iOS 18 and later, where they run to 2.3 s).
    // The room is dragged toward older posts as soon as a post shows, then left alone past the last retry: it must not be
    // pulled back to its newest post. The control (the cancel removed from RoomView) fails here. The retries are stretched ten
    // times (KOSMOS_SAMPLE_ROOM_RETRYSCALE, last at 23 s): unstretched, they end before XCUITest has found the list. A swipe that
    // starts more than 18 s after launch could miss them, so the check skips then (it would test nothing) and says so.
    func testRoomOf220ScrolledUpAtOnceIsNotPulledBack() throws {
        // The person's cancel exists only where the scroll phase is reported (iOS 18 and later); below it the retries stop at 0.5 s.
        guard #available(iOS 18.0, *) else { throw XCTSkip("the scroll phase is not reported below iOS 18") }
        let launched = Date()
        let app = Self.launch(220, ["KOSMOS_SAMPLE_ROOM_RETRYSCALE": "10"])
        XCTAssertTrue(Self.box(app).waitForExistence(timeout: 30), "no message box")
        let any = app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' of 220.'")).firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 15), "no posts of the 220-post room")
        // The room's own list (the one holding its posts), not a post: the first post found can be laid out off the screen.
        let list = app.scrollViews.containing(NSPredicate(format: "label CONTAINS ' of 220.'")).firstMatch
        XCTAssertTrue(list.exists && list.isHittable, "the room's list is not on screen")
        let late = Date().timeIntervalSince(launched)
        if late > 18 { throw XCTSkip("the swipe would start \(Int(late)) s after launch, after the stretched retries could have ended") }
        list.swipeDown(velocity: .fast)
        list.swipeDown(velocity: .fast)
        Thread.sleep(forTimeInterval: 24)   // past the last stretched retry (23 s after the opening jump)
        let newest = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Post 220 of 220.'")).firstMatch
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "room-220-scrolled-up-at-once"; a.lifetime = .keepAlways; add(a)
        XCTAssertFalse(newest.exists && newest.isHittable, "the room pulled the reader back to its newest post after their own scroll")
    }

    private static func launch(_ n: Int, _ more: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue",
                                 "KOSMOS_SAMPLE_ROOM_LONG": String(n)].merging(more) { _, new in new }
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
