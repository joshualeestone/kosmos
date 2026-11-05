import XCTest

// kosmos#8045: the tray against iOS's real prompt and a simulator's real photo library, not the sample tiles. Left out of
// ui-sample.sh (a CI simulator's library and prompt are not ours to rely on). Run it alone on a Mac:
//   TEST_RUNNER_KOSMOS_UI_PLUS=1 xcodebuild test ... -only-testing:KosmosUITests/PhotoTrayRealLibraryUITests
final class PhotoTrayRealLibraryUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launched() throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.resetAuthorizationStatus(for: .photos)   // as a first run: iOS has not asked
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        app.launch()
        let plus = app.buttons["Add a photo or file"]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the + did not show")
        plus.tap()
        return app
    }

    // iOS's own prompt, answered with the button whose label begins with `answer`. It says Kosmos's words.
    private func answerPrompt(_ answer: String) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let wording = springboard.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Only the photos you tap leave your iPhone'")).firstMatch
        XCTAssertTrue(wording.waitForExistence(timeout: 15), "iOS's prompt did not show Kosmos's wording")
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = "prompt"; a.lifetime = .keepAlways; add(a)
        let button = springboard.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", answer)).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), "the prompt has no \(answer)")
        button.tap()
    }

    func testFullAccessShowsRealPhotosAndATapAddsOne() throws {
        let app = try launched()
        answerPrompt("Allow Full Access")
        let panel = app.descendants(matching: .any)["attach-panel"]
        let tile = panel.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Photo, '")).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 15), "no real photo in the tray")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "real photos"; a.lifetime = .keepAlways; add(a)
        tile.tap()
        expectation(for: NSPredicate(format: "isSelected == true"), evaluatedWith: tile)
        waitForExpectations(timeout: 20)
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 20), "a real photo did not reach the box")
    }

    func testDontAllowStillChoosesAPhoto() throws {
        let app = try launched()
        answerPrompt("Don")
        let panel = app.descendants(matching: .any)["attach-panel"]
        let choose = panel.buttons["Choose photos"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), "a dead panel after Don't Allow")
        XCTAssertEqual(panel.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Photo, '")).count, 0, "photos showed with access off")
        let close = app.buttons["Close photos"]
        choose.tap()
        expectation(for: NSPredicate(format: "isHittable == false"), evaluatedWith: close)
        waitForExpectations(timeout: 20)
    }
}
