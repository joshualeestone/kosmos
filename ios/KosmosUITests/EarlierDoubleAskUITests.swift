import XCTest

// kosmos#8221 slice 16: a page of earlier messages lands above the reader, who is held where they were, so the top is no
// longer showing. The new list says so on the next turn of the main loop, and a read that resumed before that asked for the
// next page with no swipe (measured on 11-10: "earlier ask from read" in the same instant a page landed). On a phone that is one
// page more than the reader asked for; in EarlierDroppedUITests it was the setup that failed 3 times in 10.
// The race is made certain here: KOSMOS_SAMPLE_READ_ON_LAND=1 makes the read's request at the moment each page lands. The
// sample board's long chat (KOSMOS_SAMPLE_LONG) gives pages of 30 (KOSMOS_SAMPLE_OLDER_PAGE), each held back `delay`
// (KOSMOS_SAMPLE_OLDER_DELAY), so the line "Loading earlier messages" shows while a page is on its way.
// The control (KOSMOS_SAMPLE_NOTOPFIX=1) leaves the top showing until the list's own report, as before the slice: the second
// page is then asked for as the first lands, and the line is still up after the first page has landed. UIKit list only.
final class EarlierDoubleAskUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static let delay: Double = 6

    private static func launch(control: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_DELAY"] = String(Int(delay))
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_PAGE"] = "30"
        app.launchEnvironment["KOSMOS_SAMPLE_READ_ON_LAND"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_TRACE"] = "1"
        if control { app.launchEnvironment["KOSMOS_SAMPLE_NOTOPFIX"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        return app
    }

    private static func label(_ app: XCUIApplication, _ prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    // Up to the top of the latest messages, until the first page is asked for. Returns when the line was first seen, which is
    // at or after the ask, so the page lands at most `delay` after it.
    private func toTheTop(_ app: XCUIApplication) -> Date {
        XCTAssertTrue(Self.label(app, "Message 260 of 260").waitForExistence(timeout: 20), "the long chat did not open at its newest message")
        UIKitListArm.assertDrawn(app)
        let loading = Self.label(app, "Loading earlier messages")
        let near = Self.label(app, "Message 6")   // Message 60 to 69: near the top of the latest messages
        var swipes = 0
        while !near.exists && swipes < 60 { app.swipeDown(); swipes += 1 }
        XCTAssertTrue(near.exists, "never came near the top (\(swipes) swipes)")
        let a = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let b = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        var drags = 0
        while !loading.exists && drags < 25 { a.press(forDuration: 0.05, thenDragTo: b, withVelocity: .slow, thenHoldForDuration: 0.4); drags += 1 }
        XCTAssertTrue(loading.exists, "CONTROL: reaching the top did not ask for the first page (\(drags) drags)")
        return Date()
    }

    // 1.5 s after the first page is due: it has landed, and a page asked for as it landed is still `delay` from landing.
    private static func pastTheFirstPage(_ seen: Date) {
        let left = delay + 1.5 - Date().timeIntervalSince(seen)
        if left > 0 { Thread.sleep(forTimeInterval: left) }
    }

    func testAPageLandingIsNotAskedAgainBeforeTheListSaysWhereTheTopIs() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's earlier pages (kosmos#8221 slice 16)") }
        let app = Self.launch(control: false)
        let seen = toTheTop(app)
        Self.pastTheFirstPage(seen)
        XCTAssertTrue(Self.label(app, "Checking the venue list, item").exists, "the first page has not landed")
        XCTAssertTrue(Self.label(app, "Message 41 of 260").exists, "the first page's landing did not keep the reader's rows")
        XCTAssertFalse(Self.label(app, "Loading earlier messages").exists,
                       "the next page was asked for as the first landed, with no swipe (the read's request at landing went out)")
        // And it stays so: nothing asks while the reader stays below the top, through one whole 5 s read (review 5).
        Thread.sleep(forTimeInterval: 5.5)
        XCTAssertFalse(Self.label(app, "Loading earlier messages").exists, "a page was asked for later with no swipe")
        // Review 2: the hold lets go. Back up to the top of the first page, the page before it is asked for.
        let loading = Self.label(app, "Loading earlier messages")
        let a = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let b = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        var drags = 0
        while !loading.exists && drags < 25 { a.press(forDuration: 0.05, thenDragTo: b, withVelocity: .slow, thenHoldForDuration: 0.4); drags += 1 }
        XCTAssertTrue(loading.exists, "at the top of the first page, the page before it was not asked for (\(drags) drags): the hold did not let go")
    }

    func testControlWithoutTheFixThePageIsAskedAgainAsItLands() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's earlier pages (kosmos#8221 slice 16)") }
        let app = Self.launch(control: true)
        let seen = toTheTop(app)
        Self.pastTheFirstPage(seen)
        // Review 1: the first page has landed, so a line still up is a second page asked for, not the first still coming.
        XCTAssertTrue(Self.label(app, "Checking the venue list, item").exists, "CONTROL: the first page has not landed")
        XCTAssertTrue(Self.label(app, "Loading earlier messages").exists,
                      "CONTROL: with the fix off no page was asked for as the first landed, so this check cannot see the defect")
    }
}
