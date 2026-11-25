import XCTest

// kosmos#8959 slice C: Settings' "Delete account" opens the native flow (DeleteAccountView), not the web page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) it never asks Kosmos+: the code is "sent", any six digits give a grant for an
// account with a subscription that is the only admin of a company, and confirming answers "deleted". This walks every
// screen, checks the red button does nothing until "I understand" is ticked, and takes a screenshot of each.
final class DeleteAccountUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testDeleteAccountIsNativeAndNeedsTheTick() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-delete-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Delete account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()

        // 1. The email, filled with the account's, and the page's three explanations.
        let email = app.textFields["delete-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10), "the native delete screen did not open")
        // Filled by the screen's .task, which may land a moment after the field appears.
        let filled = expectation(for: NSPredicate(format: "value == %@", "you@example.com"), evaluatedWith: email)
        wait(for: [filled], timeout: 5)
        XCTAssertTrue(app.staticTexts["For the Kosmos app's Kosmos+ account. We will email you a code first, so we know it is yours."].exists, "the page's intro is missing")
        reveal(app, app.staticTexts["Your billing records, because the law requires them, and entries already written to our server logs. Everything else is deleted."])
        XCTAssertTrue(app.staticTexts["Your billing records, because the law requires them, and entries already written to our server logs. Everything else is deleted."].exists,
                      "What we keep is missing")
        shot(app, "delete-email")
        reveal(app, app.buttons["delete-send"], up: true)
        app.buttons["delete-send"].tap()

        // 2. The emailed code.
        let code = app.textFields["delete-code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5), "no code screen")
        XCTAssertTrue(app.staticTexts["Type the six-digit code we sent to you@example.com. It is good for ten minutes."].exists, "the code line is missing")
        code.tap()
        code.typeText("123456")
        shot(app, "delete-code")
        reveal(app, app.buttons["delete-verify"])
        app.buttons["delete-verify"].tap()

        // 4. Confirm: every line, both of the sample's warnings, red only on the last button.
        XCTAssertTrue(app.staticTexts["Deleting the account for you@example.com."].waitForExistence(timeout: 5), "no confirm screen")
        XCTAssertTrue(app.staticTexts["Your sign-in and two-factor settings"].exists, "the list of what is deleted is missing")
        let company = app.staticTexts["You are the only admin of Sample Co. Make someone else an admin there first, or your company is left without one."]
        reveal(app, company)
        XCTAssertTrue(company.exists, "the only-admin warning is missing")
        reveal(app, app.staticTexts["It ends now, and you will not be charged again. What is left of this billing period is not refunded."])
        XCTAssertTrue(app.staticTexts["It ends now, and you will not be charged again. What is left of this billing period is not refunded."].exists,
                      "the subscription line is missing")
        shot(app, "delete-confirm")
        let go = app.buttons["delete-go"]
        reveal(app, go)
        XCTAssertTrue(app.staticTexts["Tick the box above to delete."].exists, "no hint while unticked")
        shot(app, "delete-confirm-unticked")
        go.tap()
        XCTAssertFalse(app.staticTexts["delete-done-title"].waitForExistence(timeout: 2), "Delete my account worked without the tick")
        XCTAssertTrue(go.exists, "the confirm screen left without the tick")

        app.buttons["delete-understood"].tap()
        XCTAssertFalse(app.staticTexts["Tick the box above to delete."].exists, "the hint stayed after the tick")
        XCTAssertTrue(app.buttons["delete-understood"].isSelected, "the tick is not announced as selected")
        shot(app, "delete-confirm-ticked")
        go.tap()

        // 5. Deleted: the page's words, and Done leaves the flow.
        let doneTitle = app.staticTexts["delete-done-title"]
        XCTAssertTrue(doneTitle.waitForExistence(timeout: 5), "no done screen")
        XCTAssertEqual(doneTitle.label, "Your Kosmos+ account is deleted", "the done title is not the page's")
        XCTAssertTrue(app.staticTexts["We sent a note to you@example.com saying so."].exists, "the done note is missing")
        XCTAssertTrue(app.staticTexts["Kosmos keeps working on your computers. You can make a new Kosmos+ account any time."].exists, "the done words are missing")
        shot(app, "delete-done")
        app.buttons["delete-done"].tap()
        XCTAssertTrue(app.buttons["settings-delete-account"].waitForExistence(timeout: 5), "Done did not go back to Settings")
    }

    // "Send the code again" on the code screen, and "Keep my account" on the confirm screen, which goes back without deleting.
    func testKeepMyAccountGoesBack() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-delete-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Delete account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.buttons["delete-send"].waitForExistence(timeout: 10), "the native delete screen did not open")
        app.buttons["delete-send"].tap()
        let code = app.textFields["delete-code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5), "no code screen")
        // The server's refusals for a used-up code say "ask for a new one": the screen offers it.
        app.buttons["delete-resend"].tap()
        let sentLine = app.staticTexts["delete-sent"]
        XCTAssertTrue(sentLine.waitForExistence(timeout: 5), "Send the code again said nothing")
        XCTAssertEqual(sentLine.label, "New code sent.", "the page's words")
        code.tap()
        code.typeText("123456")
        reveal(app, app.buttons["delete-verify"])
        app.buttons["delete-verify"].tap()
        let keep = app.buttons["delete-keep"]
        XCTAssertTrue(app.staticTexts["Deleting the account for you@example.com."].waitForExistence(timeout: 5), "no confirm screen")
        reveal(app, keep)
        keep.tap()
        XCTAssertTrue(app.buttons["settings-delete-account"].waitForExistence(timeout: 5), "Keep my account did not go back to Settings")
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
