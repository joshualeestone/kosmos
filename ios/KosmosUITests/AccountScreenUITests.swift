import XCTest

// kosmos#8959 slice B1a: Settings' "Your Kosmos+ account" opens the native account screen (AccountView), not the web
// page. In a sample run (KOSMOS_SAMPLE_AGENTS=1) the screen lists sample computers and never asks Kosmos+, so this check
// sees the rows, the Retire sheet with Kosmos+'s sentence and the sign-out buttons, and takes a screenshot of each.
final class AccountScreenUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testAccountRowOpensTheNativeScreen() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Your Kosmos+ account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()

        XCTAssertTrue(app.navigationBars["Kosmos+ account"].waitForExistence(timeout: 10), "the native account screen did not open")
        XCTAssertTrue(app.staticTexts["Answering now"].waitForExistence(timeout: 5), "the answering computer's words are missing")
        XCTAssertTrue(app.staticTexts["Retired. Its address is free again."].exists, "the retired computer is not listed")
        XCTAssertTrue(app.staticTexts["Has not answered in 20 days. It may be off, or gone."].exists, "the silent computer's words are missing")
        // The retired one has no Retire; the three others each have their own. Two rows are named old-mini (one retired,
        // one silent), so exactly one "Retire old-mini" shows the retired row has none.
        XCTAssertTrue(app.buttons["Retire studio"].exists && app.buttons["Retire laptop"].exists, "Retire missing on a computer that answers")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == 'Retire old-mini'")).count, 1, "the retired old-mini has a Retire, or the silent one has none")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Retire '")).count, 3, "Retire on every computer not retired, and only those")
        shot(app, "account-screen")

        app.buttons["Retire studio"].tap()
        XCTAssertTrue(app.staticTexts["Type K7QX to retire studio; it will stop answering and its name is free again after a day."].waitForExistence(timeout: 5),
                      "the Retire sheet does not show Kosmos+'s sentence")
        XCTAssertTrue(app.textFields["account-retire-code"].exists, "no field for the code")
        shot(app, "account-retire")
        app.buttons["Cancel"].tap()

        // A List builds its rows only near the screen (slice B1c added sections above these), so scroll until each shows.
        noSelling(app, "the plan, computers and second step")
        reveal(app, app.buttons["account-sign-out-everywhere"])
        XCTAssertTrue(app.buttons["account-sign-out"].exists && app.buttons["account-sign-out-everywhere"].exists, "no sign-out buttons")
        reveal(app, app.buttons["account-more"])
        XCTAssertTrue(app.buttons["account-more"].exists, "no way to the rest of the account")
        // kosmos#8959 slice B2: the footer says only what the in-app page still offers, and nothing on the phone sells.
        // Review 4: the footer may be built a moment after its row, so wait for it.
        XCTAssertTrue(app.staticTexts["Your Kosmos+ address, and choosing one if you have none yet, are on your Kosmos+ account page."].waitForExistence(timeout: 3),
                      "the More on Kosmos+ footer does not say what that page offers in the app")
        noSelling(app, "sign out and More on Kosmos+")
        shot(app, "account-sign-out")
        // The plan line sits at the top: scroll back up to it. Review 4: full swipes, up to 25 (a pull to refresh at the
        // top only reads the sample again), and the row must be on screen, not only built.
        let plan = app.staticTexts["account-plan"]
        for _ in 0..<25 where !(plan.exists && plan.isHittable) { app.swipeDown() }
        // The sample answers as an active plan; reading /v1/account/me is LogicTests/account's (planLine, standingNote,
        // planAnswer). The label is the spoken form, so the drawn words (Account.planActive) are checked there too.
        XCTAssertTrue(plan.waitForExistence(timeout: 3) && plan.isHittable, "the plan section does not show its line after scrolling to the top")
        XCTAssertEqual(plan.label, "Kosmos+, Active", "VoiceOver does not read the plan line as words")
        XCTAssertFalse(app.staticTexts["account-standing"].exists, "a standing note for a plan in good standing")
        noSelling(app, "the plan, again")
        shot(app, "account-plan")
    }

    // kosmos#8959 slice B2: nothing on the phone's account screen sells (kosmos#718's CAN_BUY_HERE). A List builds only the
    // rows near the screen, so this covers what is built where it is called: the top and the end (the account row test),
    // and the passkeys and new places (testPasskeysAndNewPlaces). The server's own standing sentence may name a
    // subscription or seats; the sample's plan is good, so it shows none, and the note's look is not UI-checked here.
    private func noSelling(_ app: XCUIApplication, _ place: String) {
        let selling = NSPredicate(format: "label CONTAINS[c] 'billing' OR label CONTAINS[c] 'subscription' OR label CONTAINS[c] 'payment' OR label CONTAINS[c] 'checkout' OR label CONTAINS[c] 'cloud machine' OR label CONTAINS[c] 'upgrade' OR label CONTAINS[c] 'buy ' OR label CONTAINS[c] 'renew' OR label CONTAINS[c] 'seats' OR label CONTAINS[c] 'price'")
        XCTAssertEqual(app.descendants(matching: .any).matching(selling).count, 0, "money words on the built rows near \(place) (kosmos#718)")
    }

    // kosmos#8959 slice B1b: with no second step set up (the sample's state), the screen offers one. Setting up an
    // authenticator shows the key, and a six-digit code turns it on: the section then says so, with the reset words.
    func testSecondStepOfferedThenOn() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Your Kosmos+ account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars["Kosmos+ account"].waitForExistence(timeout: 10), "the native account screen did not open")

        let appButton = app.buttons["account-second-app"]
        // Slice B2 review 3: the plan section above the computers pushes this further down a lazy List; scroll to it first.
        reveal(app, appButton)
        XCTAssertTrue(appButton.waitForExistence(timeout: 5) && appButton.isHittable, "no offer to set up an authenticator app")
        XCTAssertTrue(app.buttons["account-second-sms"].exists, "texts can be sent in the sample, so they are offered too")
        let on = app.descendants(matching: .any)["account-second-on"]
        XCTAssertFalse(on.exists, "the step reads as on before it is set up")
        shot(app, "account-second-offer")

        appButton.tap()
        XCTAssertTrue(app.navigationBars["Add your key"].waitForExistence(timeout: 5), "the authenticator setup did not open")
        let key = app.staticTexts["account-second-key"]
        XCTAssertTrue(key.exists, "the key is not shown")
        XCTAssertEqual(key.label, "Key: J B S W Y 3 D P E H P K 3 P X P", "the key is not read out letter by letter")
        let field = app.textFields["account-second-code"]
        XCTAssertTrue(field.exists, "no field for the code")
        field.tap(); field.typeText("12345")
        app.buttons["Confirm"].tap()
        XCTAssertTrue(app.staticTexts["The code is six digits."].waitForExistence(timeout: 3), "five digits were not refused")
        shot(app, "account-second-key")
        field.tap(); field.typeText("6")
        app.buttons["Confirm"].tap()

        XCTAssertTrue(on.waitForExistence(timeout: 5), "the section does not say the step is on")
        XCTAssertTrue(on.label.contains("Two-step sign-in is on"), "the on row does not say so: \(on.label)")
        XCTAssertTrue(on.label.contains("From now on, signing in asks for the email code and then a code from your authenticator app."), "the words for an authenticator are missing: \(on.label)")
        XCTAssertFalse(app.buttons["account-second-app"].exists, "the offer is still there once the step is on")
        shot(app, "account-second-on")
    }

    // kosmos#8959 slice B1c: the sample lists two passkeys, each with Remove (which asks first, in the page's words), and
    // Add a passkey; and one sign-in from a new place, with Not me (which asks first). A sample never asks Kosmos+ or
    // Apple's sheet, so Add shows the page's "Passkey added." and nothing is removed or signed out.
    func testPasskeysAndNewPlaces() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Your Kosmos+ account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars["Kosmos+ account"].waitForExistence(timeout: 10), "the native account screen did not open")

        let add = app.buttons["account-passkey-add"]
        XCTAssertTrue(app.staticTexts["Passkeys"].waitForExistence(timeout: 10), "no Passkeys section")
        // A List builds its rows only near the screen, so scroll until Add shows (it is below the fold).
        reveal(app, add)
        noSelling(app, "passkeys")
        XCTAssertTrue(add.exists, "no Add a passkey")
        let removeRow = app.buttons["account-passkey-remove-sample-1"]
        reveal(app, removeRow)   // review 4: scrolling to Add can leave the first row unbuilt
        XCTAssertTrue(removeRow.exists && app.buttons["account-passkey-remove-sample-2"].exists, "a passkey is listed without Remove")
        XCTAssertTrue(removeRow.label.hasPrefix("Remove iPhone, added "), "Remove does not say which passkey, dated: \(removeRow.label)")
        XCTAssertTrue(app.staticTexts["Not used yet."].exists || app.staticTexts.containing(NSPredicate(format: "label ENDSWITH 'Not used yet.'")).count == 1,
                      "the never-used passkey does not say so")
        shot(app, "account-passkeys")

        removeRow.tap()
        let question = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Remove iPhone, added ' AND label CONTAINS 'If it is saved on this iPhone, also delete it in'")).firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 5), "Remove does not ask first, naming the passkey and where a saved one is deleted")
        shot(app, "account-passkey-remove")
        closeDialog(app)
        // Review 1: the dialog's own button is also "Remove iPhone", so what proves it closed is its question gone, and
        // what proves nothing was removed is no "Passkey removed." (a sample run removes nothing either way).
        XCTAssertTrue(question.waitForNonExistence(timeout: 5), "the remove dialog did not close")
        XCTAssertFalse(app.staticTexts["Passkey removed."].exists, "closing the dialog removed the passkey")
        reveal(app, add)

        add.tap()
        XCTAssertTrue(app.staticTexts["Passkey added."].waitForExistence(timeout: 5), "Add does not say the passkey was added")

        let notMe = app.buttons["account-not-me-np-1"]
        reveal(app, notMe)
        noSelling(app, "sign-ins from new places")
        XCTAssertTrue(notMe.exists, "the new place has no Not me")
        XCTAssertTrue(notMe.label.hasPrefix("Not me: sign out everywhere, for the sign-in "), "Not me does not say which sign-in: \(notMe.label)")
        XCTAssertTrue(app.staticTexts["Safari on a Mac"].exists, "the new place is not listed")
        shot(app, "account-new-places")
        notMe.tap()
        XCTAssertTrue(app.staticTexts["This signs your account out everywhere, this iPhone included."].waitForExistence(timeout: 5),
                      "Not me does not ask first")
        shot(app, "account-not-me")
        closeDialog(app)
        XCTAssertTrue(app.staticTexts["This signs your account out everywhere, this iPhone included."].waitForNonExistence(timeout: 5),
                      "the Not me dialog did not close")
        XCTAssertTrue(app.navigationBars["Kosmos+ account"].exists, "closing the dialog left the account screen")
    }

    /// Closes a confirmation dialog without choosing. On a phone with a newer iOS the dialog is a popover with no Cancel
    /// button (it closes by a tap outside), so its dismiss region is tapped when there is no Cancel.
    private func closeDialog(_ app: XCUIApplication) {
        let cancel = app.buttons["Cancel"]
        if cancel.exists { cancel.tap(); return }
        let outside = app.otherElements["PopoverDismissRegion"]
        if outside.exists { outside.tap(); return }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.02)).tap()
    }

    /// Scrolls until `element` exists and can be tapped (rows below the fold are not built until they come near).
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
