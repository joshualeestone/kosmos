import XCTest

// kosmos#7654: a long room opens on its newest post. On iOS 26 one jump to the end of a room drawn with estimated row
// heights fell short (150 posts: half a post, 220: four; measured 10-30), so the room's opening jump is retried. Sample
// room (a Debug build), Spring catalogue made long (KOSMOS_SAMPLE_ROOM_LONG). Nothing is touched: the room's own opening
// is what is checked. Run in CI by the ios workflow's "ui tests (sample board)" job (ios/tools/ui-sample.sh).
final class RoomOpensAtNewestUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testRoomOf150OpensOnItsNewestPost() throws { try Self.opensOnNewest(150, test: self) }

    func testRoomOf220OpensOnItsNewestPost() throws { try Self.opensOnNewest(220, test: self) }

    private static func opensOnNewest(_ n: Int, test: XCTestCase) throws {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue",
                                 "KOSMOS_SAMPLE_ROOM_LONG": String(n)]
        app.launch()
        let box = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == 'Message Spring catalogue' OR placeholderValue == 'Message Spring catalogue'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        // Presence first: some post of this room is drawn, so the newest missing below means the room stopped short of it.
        let any = app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' of \(n).'")).firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 15), "no posts of the \(n)-post room")
        KeyboardSlideUITests.settle(any)
        let newest = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Post \(n) of \(n).'")).firstMatch
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "room-\(n)-opened"; shot.lifetime = .keepAlways; test.add(shot)
        XCTAssertTrue(newest.exists && newest.isHittable, "the \(n)-post room did not open on its newest post")
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest post ends at \(newest.frame.maxY), under the box at \(box.frame.minY)")
    }
}
