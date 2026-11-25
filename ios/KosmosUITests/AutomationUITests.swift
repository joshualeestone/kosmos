import XCTest

// kosmos#8959 slice D1a: Settings' "Automation" opens the native screen (AutomationView), not the board's page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) the screen reads the sample computer's answers and never asks a real one, so this
// check sees each box in the board's words, flips a switch, and takes a screenshot of the top, the middle and the end.
final class AutomationUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testAutomationRowOpensTheNativeScreen() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-automation"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Automation row in Settings")
        // The board row sits five rows below Automation (Global skills, AI policies, Usage and Updates came between),
        // so in the lazy List it can be past the screen's edge and not built yet: a bare .exists read it as gone
        // (red on PR #9292, flaky on #9223). Scroll to it, then back up to Automation.
        let board = app.buttons["Settings on your computer's board"]
        reveal(app, board, swipes: 6)
        XCTAssertTrue(board.waitForExistence(timeout: 5), "the board row went before the rest is native")
        reveal(app, row, swipes: 6, up: true)
        XCTAssertTrue(row.waitForExistence(timeout: 5) && row.isHittable, "the Automation row did not come back on screen")
        row.tap()

        XCTAssertTrue(app.navigationBars["Automation"].waitForExistence(timeout: 10), "the native Automation screen did not open")
        let autoSave = app.switches["automation-autoSave-on"]
        XCTAssertTrue(autoSave.waitForExistence(timeout: 10), "no Auto-save switch")
        XCTAssertEqual(autoSave.value as? String, "1", "Auto-save does not read the computer's On")
        // A Toggle's label is part of the switch's own label, not a text of its own (review 4).
        XCTAssertTrue(autoSave.label.hasPrefix("Save your agents' progress"), "Auto-save is not in the board's words (label: \(autoSave.label))")
        XCTAssertTrue(app.buttons["automation-autoSave-level"].exists || app.otherElements["automation-autoSave-level"].exists,
                      "the level shows while Auto-save is on")
        shot(app, "automation-top")

        // kosmos#8959 slice D1d1: the sample's two check-ins under the Prompter box, each a button to its agent. Checked
        // here, near the top where the Prompter box is: reveal() only swipes down, so after the guards below they are gone.
        // Each found top to bottom (the heading, dana, eli), revealed and waited for on its own: the List builds rows
        // lazily, so one reveal for three rows can leave the last unbuilt (review 3).
        let heading = app.staticTexts["Agents that may need you"]
        reveal(app, heading, swipes: 6)
        XCTAssertTrue(heading.waitForExistence(timeout: 5), "the check-ins' heading is missing")
        let quiet = app.buttons["automation-checkin-dana"]
        reveal(app, quiet, swipes: 3)
        XCTAssertTrue(quiet.waitForExistence(timeout: 5), "the Prompter's check-ins are missing")
        XCTAssertTrue(quiet.label.contains("dana") && quiet.label.contains("seems to have gone quiet. Still mid-something, finished, or stopped?"), quiet.label)
        let gone = app.buttons["automation-checkin-eli"]
        reveal(app, gone, swipes: 3)
        XCTAssertTrue(gone.waitForExistence(timeout: 5), "the second check-in is missing")
        XCTAssertTrue(gone.label.contains("lost its connection, and Kosmos stopped trying."), "the gave-up question is not the page's: \(gone.label)")
        shot(app, "automation-checkins")


        // The sample's Daily report is off; one press turns it on, and the switch says so.
        let report = app.switches["automation-dailyReport-on"]
        reveal(app, report)
        XCTAssertEqual(report.value as? String, "0", "the sample's Daily report should start off")
        report.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(waitFor(report, value: "1"), "pressing the Daily report switch did not turn it on")
        shot(app, "automation-middle")

        // kosmos#8959 slice D1d2a: Community's kind of business under its box (between the Daily report and the
        // Recommender), with the sample's one picture the community shut out.
        // A menu Picker in a List is usually a button; found by identifier whatever SwiftUI makes it.
        let business = app.buttons["automation-community-industry"].exists ? app.buttons["automation-community-industry"]
            : app.descendants(matching: .any)["automation-community-industry"]
        reveal(app, business, swipes: 6)
        XCTAssertTrue(business.waitForExistence(timeout: 5), "the kind of business is missing")
        // A menu picker may carry its choice as its label or as its value, so both are read together.
        let said = business.label + " " + ((business.value as? String) ?? "")
        XCTAssertTrue(said.contains("Your kind of business, shown on your agents’ public profiles"), said)
        XCTAssertTrue(said.contains("None: profiles leave it out"), "nothing picked should read None: \(said)")
        let stuck = app.staticTexts["One agent’s picture may still show in the community. The community shut that agent out, so Kosmos can no longer take it down."]
        reveal(app, stuck, swipes: 2)
        XCTAssertTrue(stuck.exists, "the shut-out picture line is missing")
        shot(app, "automation-industry")

        // kosmos#8959 slice D1d2b: the held posts under the kind of business: the sample's post waiting with Release, and
        // one stopped by the safety check, whose words show only when asked for. Nothing is pressed that changes it.
        let release = app.buttons["automation-held-release-p1"]
        reveal(app, release, swipes: 4)
        XCTAssertTrue(release.waitForExistence(timeout: 5), "the held post's Release is missing")
        XCTAssertEqual(release.label, "Release “What we shipped this week”")
        // Control, while p1 is on screen: its words are found by the same kind of lookup the absence check below uses.
        XCTAssertTrue(app.staticTexts["automation-held-words-p1"].exists, "the held post's words are missing")
        let stopped = app.buttons["automation-held-discard-p2"]
        reveal(app, stopped, swipes: 3)
        XCTAssertTrue(stopped.waitForExistence(timeout: 5), "the stopped post is missing")
        XCTAssertEqual(stopped.label, "Discard “A post by eli (row 2)”", "a stopped row is named by its place, never its words")
        XCTAssertFalse(app.staticTexts["automation-held-words-p2"].exists, "a stopped row's words show before they are asked for")
        XCTAssertFalse(app.buttons["automation-held-release-p2"].exists, "a stopped row offers Release")
        shot(app, "automation-held")

        // kosmos#8959 slice D1d3a: "Where each agent stands" under the held posts, one row per agent in the board's words.
        // Top to bottom, each revealed on its own (a lazy List drops a row scrolled off the top).
        let dana = app.descendants(matching: .any)["automation-ready-dana"]
        reveal(app, dana, swipes: 4)
        XCTAssertTrue(dana.waitForExistence(timeout: 5), "Where each agent stands is missing its first agent")
        let eli = app.descendants(matching: .any)["automation-ready-eli"]
        reveal(app, eli, swipes: 2)
        XCTAssertTrue(eli.waitForExistence(timeout: 5), "the second agent's row is missing")
        shot(app, "automation-ready")

        // kosmos#8959 slice D1d3b: the posts and comments, in a closed fold, each with Delete behind the page's ask.
        let fold = app.descendants(matching: .any)["automation-mine-fold"]
        reveal(app, fold, swipes: 4)
        XCTAssertTrue(fold.waitForExistence(timeout: 5), "the posts and comments fold is missing")
        fold.tap()
        let del = app.buttons["automation-mine-delete-m1"]
        reveal(app, del, swipes: 3)
        XCTAssertTrue(del.waitForExistence(timeout: 5), "the post's Delete is missing")
        XCTAssertEqual(del.label, "Delete “What we shipped this week” from the community")
        shot(app, "automation-mine")

        // The Recommender is on in the sample, so its three guards show, each in the board's words.
        // Each guard is revealed on its own, as the check-ins are: a lazy List draws a row only near the screen, so the
        // first guard being on screen did not mean the other two were drawn yet (D1d1's light run failed here while its
        // dark run passed on the same head, kosmos#8959).
        // The money guard and the heading above it are read first, before revealing the lower two can scroll them away.
        let money = app.switches["automation-recommender-guard-money"]
        reveal(app, money)
        XCTAssertTrue(money.waitForExistence(timeout: 5), "the Recommender's money guard is missing while it is on")
        XCTAssertTrue(money.label.hasPrefix("Act on anything that spends money"), "a guard is not in the board's words (label: \(money.label))")
        XCTAssertTrue(app.staticTexts["Never let a recommendation:"].exists, "the guards show without the page's heading, so On reads as permission")
        for g in ["public", "delete"] {
            let sw = app.switches["automation-recommender-guard-" + g]
            reveal(app, sw)
            XCTAssertTrue(sw.waitForExistence(timeout: 5), "the Recommender's \(g) guard is missing while it is on")
        }

        // A predicate, not a subscript: XCUI refuses a string query longer than 128 characters (the 02:09 UI run).
        let elsewhere = app.staticTexts.matching(NSPredicate(format: "label == %@", "The rest of your computer's settings are in Settings on your computer's board.")).firstMatch
        reveal(app, elsewhere, swipes: 12)
        XCTAssertTrue(elsewhere.exists, "the screen does not say where the other settings are")
        shot(app, "automation-end")
    }

    private func waitFor(_ e: XCUIElement, value: String, timeout: TimeInterval = 5) -> Bool {
        let p = NSPredicate(format: "value == %@", value)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: e)], timeout: timeout) == .completed
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement, swipes: Int = 8, up: Bool = false) {
        for _ in 0..<swipes where !(element.exists && element.isHittable) { if up { app.swipeDown() } else { app.swipeUp() } }
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
