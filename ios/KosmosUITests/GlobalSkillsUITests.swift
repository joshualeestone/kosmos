import XCTest

// kosmos#8959 slice D1b1: Settings' "Global skills" opens the native list (GlobalSkillsView), not the board's page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) the screen lists the sample computer's two skills and never asks a real one, so
// this check sees the list, that Remove asks once before it acts, and a skill added, with a screenshot of each.
final class GlobalSkillsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testGlobalSkillsRowOpensTheNativeList() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-global-skills"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Global skills row in Settings")
        row.tap()

        XCTAssertTrue(app.navigationBars["Global skills"].waitForExistence(timeout: 10), "the native Global skills screen did not open")
        XCTAssertTrue(app.staticTexts["How we write emails"].waitForExistence(timeout: 5), "the sample's skill is not listed")
        XCTAssertTrue(app.staticTexts["Release notes"].exists, "the second sample skill is not listed")
        shot(app, "global-skills-list")

        // Remove asks once: the first press arms it, and the skill is still there.
        let remove = app.buttons["gskill-remove-release-notes"]
        XCTAssertTrue(remove.exists, "no Remove on a skill")
        // A tap on the name is not a tap on Remove (review 3: a list row would otherwise be the button's tap).
        app.staticTexts["Release notes"].tap()
        XCTAssertEqual(remove.label, "Remove the skill Release notes", "a tap on the skill's name armed Remove")
        remove.tap()
        XCTAssertEqual(remove.label, "Remove it for good?", "the first press did not ask")
        XCTAssertTrue(app.staticTexts["Release notes"].exists, "the first press removed the skill without asking")
        shot(app, "global-skills-remove-asks")
        remove.tap()
        XCTAssertTrue(waitGone(app.staticTexts["Release notes"]), "the second press did not remove the skill")

        // Adding: with nothing written the computer refuses in its own words (as the page, the button is never grey);
        // with a name and words the skill joins the list with the page's sentence.
        let add = app.buttons["gskill-add"]
        reveal(app, add)
        XCTAssertTrue(add.isEnabled, "Add skill is grey; the page's button never is")
        add.tap()
        XCTAssertTrue(app.staticTexts["Give the skill a short name in letters and numbers."].waitForExistence(timeout: 5),
                      "a blank name is not refused in the engine's own words")
        let name = app.textFields["gskill-name"]
        name.tap(); name.typeText("Meeting notes")
        let body = app.textViews["gskill-body"]
        body.tap(); body.typeText("One line per decision.")
        reveal(app, add)   // the keyboard may cover it now
        add.tap()
        XCTAssertTrue(app.staticTexts["Added. Every agent picks it up at its next restart."].waitForExistence(timeout: 5), "the page's added sentence is missing")
        let added = app.staticTexts["Meeting notes"]
        for _ in 0..<8 where !added.exists { app.swipeDown() }   // the list is above the form
        XCTAssertTrue(added.exists, "the added skill is not in the list")
        shot(app, "global-skills-added")
    }

    private func waitGone(_ e: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: e)], timeout: timeout) == .completed
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
