import XCTest

/// Josh 2026-11-06 18:14 and 18:18: Allow this iPhone and Connecting to your Mac draw the orb at 132 pt or more, above the
/// words and centred with them; every sign-in step is vertically centred, with the floating dots behind it, and the box
/// being typed into stays above the keyboard. Measured from the running app's frames; each case keeps a screenshot.
final class CentredWaitsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    /// The middle of the space between the top bar and the tab bar, and how far `y` is from it as a share of that space.
    private func offCentre(_ y: CGFloat, top: CGFloat, bottom: CGFloat) -> CGFloat { abs(y - (top + bottom) / 2) / (bottom - top) }

    func testWaitsDrawTheOrbCentredWithTheWords() {
        for wait in ["allow", "connecting"] {
            let app = XCUIApplication()
            app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
            app.launchEnvironment["KOSMOS_SAMPLE_WAIT"] = wait
            app.launch()
            let screen = app.windows.firstMatch.frame
            let tabs = app.tabBars.firstMatch
            XCTAssertTrue(tabs.waitForExistence(timeout: 10), "\(wait): the tab bar is not showing")
            let bottom = tabs.frame.minY
            let top = screen.minY + 100   // under the top bar (the K and the buttons)
            if wait == "allow" {
                // One combined element (the orb and the words, as VoiceOver reads them).
                let group = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Allow this iPhone on Studio Mac.'")).firstMatch
                XCTAssertTrue(group.waitForExistence(timeout: 10), "allow: the wait is not showing")
                keep(app, "wait-allow")
                XCTAssertGreaterThanOrEqual(group.frame.height, 132, "allow: the group is not tall enough to hold the orb: \(group.frame)")
                XCTAssertLessThan(offCentre(group.frame.midY, top: top, bottom: bottom), 0.08, "allow: the orb and words are not centred: \(group.frame) between \(top) and \(bottom)")
            } else {
                let orb = app.otherElements["Waiting for your Mac"]
                let title = app.staticTexts["Connecting to Studio Mac."]
                XCTAssertTrue(orb.waitForExistence(timeout: 10) && title.exists, "connecting: the orb or the words are not showing")
                keep(app, "wait-connecting")
                XCTAssertGreaterThanOrEqual(orb.frame.width, 131.5, "connecting: the orb is under 132 pt: \(orb.frame)")
                XCTAssertLessThanOrEqual(orb.frame.maxY, title.frame.minY, "connecting: the orb is not above the words")
                XCTAssertLessThan(abs(orb.frame.midX - title.frame.midX), 2, "connecting: the orb is not centred over the words")
                let groupMid = (orb.frame.minY + title.frame.maxY) / 2
                XCTAssertLessThan(offCentre(groupMid, top: top, bottom: bottom), 0.1, "connecting: the orb and words are not centred together")
            }
            app.terminate()
        }
    }

    func testSignInIsCentredAndTheKeyboardLeavesTheBoxInSight() {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_SIGNIN"] = "1"
        app.launch()
        let email = app.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 10), "the sign-in screen is not showing")
        let screen = app.windows.firstMatch.frame
        keep(app, "signin")
        XCTAssertLessThan(offCentre(email.frame.midY, top: screen.minY, bottom: screen.maxY), 0.15, "the email box is not near the middle: \(email.frame) in \(screen)")
        email.tap()
        let keyboard = app.keyboards.firstMatch
        if keyboard.waitForExistence(timeout: 5) {
            Thread.sleep(forTimeInterval: 0.8)   // the keyboard's slide and the re-centring
            keep(app, "signin-keyboard")
            XCTAssertLessThanOrEqual(email.frame.maxY, keyboard.frame.minY, "the keyboard covers the email box: \(email.frame) vs \(keyboard.frame)")
            XCTAssertGreaterThanOrEqual(email.frame.minY, screen.minY + 20, "the email box went off the top: \(email.frame)")
        } else {
            // A simulator with a hardware keyboard shows none; the centring above still holds. Said, not skipped silently.
            XCTContext.runActivity(named: "no on-screen keyboard appeared, so the keyboard half was not measured") { _ in }
        }
    }
}
