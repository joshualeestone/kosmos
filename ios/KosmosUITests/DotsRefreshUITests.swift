import XCTest

/// kosmos#8078: pull to refresh on a running app, with a real drag. A list whose scroll view is not found has no pull at all,
/// and nothing else would notice, so this is what guards that. The sample mode holds each refresh open for a few seconds
/// (KOSMOS_SAMPLE_PULL_SECONDS, Debug only), since a sample refresh would otherwise end before anything could look at it.
final class DotsRefreshUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(tab: String?) -> XCUIApplication {
        let app = XCUIApplication()
        var env = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_PULL_SECONDS": "4"]
        if let tab { env["KOSMOS_SAMPLE_TAB"] = tab }
        app.launchEnvironment = env
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        return app
    }

    private func pull(_ app: XCUIApplication, distance: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)), withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    private func dots(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["Refreshing"]
    }

    private func pullRefreshes(tab: String?, named: String) {
        let app = launch(tab: tab)
        sleep(3)   // the sample list settles
        XCTAssertFalse(dots(app).exists, named + ": dots at rest, before any pull")
        pull(app, distance: 320)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), named + ": no dots after a long pull, so its list was not found or the refresh did not start")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "dots-" + named
        shot.lifetime = .keepAlways
        add(shot)
        // Ends on its own, and the dots go with it.
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
    }

    /// The list must come back exactly where it was: an inset not given back would leave the rows under the bar or low.
    func testTheListComesBackWhereItWas() {
        let app = launch(tab: nil)
        let row = app.staticTexts["Cleo"]
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        sleep(2)
        let before = row.frame.minY
        pull(app, distance: 320)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3))
        XCTAssertGreaterThan(row.frame.minY, before + 20, "CONTROL: while refreshing, the list is held lower")
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        sleep(1)
        XCTAssertEqual(row.frame.minY, before, accuracy: 1, "the list did not come back to where it was")
    }

    func testAgentsPullShowsTheDotsAndEnds() { pullRefreshes(tab: nil, named: "agents") }
    func testTasksPullShowsTheDotsAndEnds() { pullRefreshes(tab: "tasks", named: "tasks") }
    func testSettingsPullShowsTheDotsAndEnds() { pullRefreshes(tab: "settings", named: "settings") }
    func testProjectsPullShowsTheDotsAndEnds() { pullRefreshes(tab: "projects", named: "projects") }

    /// A pushed screen: its pull must reach its own list and not the one underneath, and leaving mid-refresh must not
    /// misplace the list underneath on the way back.
    func testAPushedScreenPullsItsOwnListAndBackIsWhereItWas() {
        let app = launch(tab: "tasks")
        let row = app.staticTexts["Pages 9 to 12"]
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        sleep(2)
        let before = row.frame.minY
        XCTAssertTrue(app.staticTexts["Needs you"].isHittable, "CONTROL: the tile is on the list")
        row.tap()
        sleep(2)
        // The page repeats the row's words as its title, so the list's own tile says which screen this is.
        let onlyOnTheList = app.staticTexts["Needs you"]
        XCTAssertFalse(onlyOnTheList.exists && onlyOnTheList.isHittable, "CONTROL: the task's page is showing")
        XCTAssertFalse(dots(app).exists)
        pull(app, distance: 320)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "the pushed page's pull did not reach its own list")
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(2)
        XCTAssertEqual(row.frame.minY, before, accuracy: 1, "the list underneath moved")
    }

    /// Leaving while the dots run gives the space back off screen: the list must still come back where it was.
    func testLeavingMidRefreshLeavesTheListWhereItWas() {
        let app = launch(tab: "tasks")
        let row = app.staticTexts["Pages 9 to 12"]
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        sleep(2)
        let before = row.frame.minY
        pull(app, distance: 320)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3))
        row.tap()
        sleep(2)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        sleep(2)
        XCTAssertFalse(dots(app).exists, "dots left behind")
        XCTAssertEqual(row.frame.minY, before, accuracy: 1, "the list did not come back where it was")
    }

    func testAShortPullStartsNothing() {
        let app = launch(tab: nil)
        sleep(3)
        pull(app, distance: 30)
        sleep(1)
        XCTAssertFalse(dots(app).exists, "a short pull started a refresh")
    }

    func testTheSystemSpinnerIsNotDrawn() {
        let app = launch(tab: nil)
        sleep(3)
        pull(app, distance: 320)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3))
        XCTAssertEqual(app.activityIndicators.count, 0, "iOS's own spinner is on screen beside the dots")
    }
}
