import XCTest

// kosmos#7645: KeyboardSlideUITests' two long-chat checks on a project room. With the room at its newest post, bringing the
// keyboard up keeps that post visible above the message box; a room read higher up stays where it was (iOS 26 moved a DM
// read higher up, #7609). Sample room (a Debug build), Spring catalogue made long (KOSMOS_SAMPLE_ROOM_LONG, 220 posts).
// #7654 part 2 made both pass on iOS 27 and 26.5 (measured on this Mac, one run of each per system). Still not in
// ios/tools/ui-sample.sh: CI's slower runner stopped this 220-post room short once already (#7654 round 3), and one run
// each is not yet evidence it holds there. Run it by hand with -only-testing:KosmosUITests/RoomKeyboardUITests.
final class RoomKeyboardUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    // The swipes past the end are a person's scroll coming to rest at the newest post (KeyboardSlideUITests' long check).
    func testRoomNewestStaysAboveTheBox() throws {
        let app = Self.launch([:])
        let box = Self.box(app)
        for _ in 0..<6 { app.swipeUp(velocity: .fast) }
        let newest = Self.post(app, 220)
        XCTAssertTrue(newest.waitForExistence(timeout: 10), "the swipes did not reach the newest post")
        KeyboardSlideUITests.settle(newest)
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest post was not above the box before the keyboard")
        try KeyboardSlideUITests.keyboardUp(app, box, newest, shot: "room-long-keyboard-up", test: self)
        KeyboardSlideUITests.assertAbove(newest, box, app.keyboards.firstMatch)
    }

    // KOSMOS_SAMPLE_ROOM_SCROLLUP moves the reader up the room 3 s after opening, as a reader's own scroll does.
    func testRoomReadHigherUpStaysWhereItWas() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_ROOM_SCROLLUP": "40", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let rows = app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' of 220.'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15), "no sample posts")
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "the sample scroll-up never came to rest")
        let newest = Self.post(app, 220)
        XCTAssertFalse(newest.exists && newest.isHittable, "the scroll up never moved the reader off the newest post")
        KeyboardSlideUITests.settle(rows.firstMatch)
        // The highest post on screen below the top bar and the needs-you notice, found again after the keyboard by its label.
        var top = app.navigationBars.firstMatch.frame.maxY
        let notice = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'need you on this project'")).firstMatch
        if notice.exists { top = max(top, notice.frame.maxY) }
        // kosmos#7690: chosen once the list has gone still: on CI's runner it moved about 490 pt after the scroll-up marker, before the
        // keyboard was asked for, and a row read during that move was gone whatever the hold did. Two looks with no change.
        func firstRow() -> XCUIElement? { rows.allElementsBoundByIndex.filter({ $0.isHittable && $0.frame.minY > top }).min(by: { $0.frame.minY < $1.frame.minY }) }
        var still: (String, CGFloat)?
        for _ in 0..<10 {
            guard let f = firstRow() else { Thread.sleep(forTimeInterval: 0.5); continue }
            let now = (f.label, f.frame.minY)
            if let s = still, s.0 == now.0, abs(s.1 - now.1) < 1 { break }
            still = now
            Thread.sleep(forTimeInterval: 1)
        }
        guard let chosen = still else { XCTFail("no post on screen after the scroll up"); return }
        let label = chosen.0, y0 = chosen.1
        let row = app.staticTexts[label]
        let beforeTap = row.exists ? Int(row.frame.minY) : -1
        try KeyboardSlideUITests.keyboardUp(app, box, row, shot: "room-read-higher-keyboard-up", test: self)
        if !(row.exists && row.isHittable) {   // what is on the screen, for a failure on CI's runner, where nothing else shows it (kosmos#7690)
            let seen = rows.allElementsBoundByIndex.filter { $0.isHittable }.map { "\($0.label.prefix(14)) at \(Int($0.frame.minY))" }.joined(separator: ", ")
            XCTFail("'\(label)', read higher up from \(Int(y0)), left the screen when the keyboard came up (at \(beforeTap) just before the tap, exists \(row.exists), keyboard top \(Int(app.keyboards.firstMatch.frame.minY)), on screen: \(seen))")
            return
        }
        XCTAssertEqual(row.frame.minY, y0, accuracy: 4, "'\(label)' moved from \(y0) to \(row.frame.minY)")
        XCTAssertFalse(newest.exists && newest.isHittable, "the reader was pulled down to the newest post")
    }

    private static func launch(_ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue",
                                 "KOSMOS_SAMPLE_ROOM_LONG": "1"]
        for (k, v) in env { app.launchEnvironment[k] = v }
        app.launch()
        return app
    }

    // The room's message box, by its prompt.
    private static func box(_ app: XCUIApplication) -> XCUIElement {
        let box = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Message Spring catalogue'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        return box
    }

    private static func post(_ app: XCUIApplication, _ n: Int) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Post \(n) of 220.'")).firstMatch
    }
}
