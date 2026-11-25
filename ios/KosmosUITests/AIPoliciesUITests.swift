import XCTest

// kosmos#8959 slice D1b2: Settings' "AI policies" opens the native list (AIPoliciesView), not the board's page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) the screen lists the sample computer's two policies and never asks a real one, so
// this check sees the list, that handing a policy out asks first in the page's words, and that Remove asks once. It
// drives only the sample build's path; the real requests and answers are the logic suite's.
final class AIPoliciesUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testAIPoliciesRowOpensTheNativeList() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-ai-policies"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no AI policies row in Settings")
        row.tap()

        XCTAssertTrue(app.navigationBars["AI policies"].waitForExistence(timeout: 10), "the native AI policies screen did not open")
        XCTAssertTrue(app.staticTexts["Legal"].waitForExistence(timeout: 5), "the sample's first policy is not listed")
        XCTAssertTrue(app.staticTexts["Every agent gets all of these; each one starts following them at its next restart."].exists, "the page's lead is missing")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'From https://example.com/ai-policy, updated '")).count == 1,
                      "the linked policy's source line is missing")
        shot(app, "ai-policies-list")

        // Remove asks once: the first press arms it, the policy is still there.
        let remove = app.buttons["policy-remove-p2"]
        reveal(app, remove)
        remove.tap()
        XCTAssertEqual(remove.label, "Remove it for good?", "the first press did not ask")
        XCTAssertTrue(app.staticTexts["Engineering"].exists, "the first press removed the policy without asking")
        remove.tap()
        XCTAssertTrue(app.staticTexts["Removed. No agents are running, so there was nothing to take back."].waitForExistence(timeout: 5),
                      "the page's removed sentence is missing")
        noteShown(app, "Removed. No agents are running, so there was nothing to take back.", inForm: false)

        // Adding asks first, in the page's words, naming the policy.
        let name = app.textFields["policy-name"]
        reveal(app, name)
        name.tap(); name.typeText("Security")
        let words = app.textViews["policy-words"]
        reveal(app, words)
        words.tap(); words.typeText("Never paste a key into a chat.")
        let save = app.buttons["policy-save"]
        reveal(app, save)
        save.tap()
        let ask = app.alerts["Hand “Security” to every agent?"]
        XCTAssertTrue(ask.waitForExistence(timeout: 5), "handing a policy out did not ask first")
        XCTAssertTrue(ask.buttons["Not yet"].exists && ask.buttons["Hand it out"].exists, "the confirm's buttons are not the page's")
        shot(app, "ai-policies-confirm")
        ask.buttons["Hand it out"].tap()
        XCTAssertTrue(app.staticTexts["Saved. No agents are running yet; each one gets it when it exists."].waitForExistence(timeout: 5),
                      "the page's saved sentence is missing")
        noteShown(app, "Saved. No agents are running yet; each one gets it when it exists.", inForm: true)
        shot(app, "ai-policies-saved")
    }

    /// The change's sentence is shown once, as the note, in the footer beside what was tapped (review round 2's fix):
    /// under the list for a remove or rename, under the form for an add. Each footer's note has its own identifier, so
    /// this needs no frames (a lazy List drops a footer scrolled off screen).
    private func noteShown(_ app: XCUIApplication, _ said: String, inForm: Bool) {
        let here = app.staticTexts[inForm ? "policy-note-form" : "policy-note-list"]
        XCTAssertTrue(here.waitForExistence(timeout: 5), "the note is not in the " + (inForm ? "form's" : "list's") + " footer")
        XCTAssertEqual(here.label, said)
        // Not asserted: that the other footer has no note. It is usually off screen, so the check could not fail; the
        // view's one noteInForm flag picks a single footer, which is the guarantee.
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement, swipes: Int = 8) {
        for _ in 0..<swipes where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
