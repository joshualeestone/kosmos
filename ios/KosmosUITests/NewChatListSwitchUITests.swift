import XCTest

// kosmos#8221 slice 5: Settings' "New chat list" switch. Off, a chat opens on the lazy list; on, the next chat opened is drawn
// by the UIKit list (ChatList's collection view, "chat-list-uikit"). This check deliberately does NOT call UIKitListArm.set:
// KOSMOS_SAMPLE_UIKITLIST, when set, wins over the switch, so the switch is only what decides here. It turns the switch
// back off in its teardown, which runs whether or not the check passed: several classes open a direct chat without
// UIKitListArm (EndPull, DeleteMessage, LongPressKeyboard, AttachMenu's chat arm), and on a simulator reused by hand they
// would otherwise run on the UIKit list.
final class NewChatListSwitchUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    // A fresh launch straight onto the Chat section (KOSMOS_SAMPLE_SCROLL=chat), and the switch put back off if it is on.
    override func tearDown() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "chat"]
        app.launch()
        let sw = app.switches["settings-new-chat-list"]
        if sw.waitForExistence(timeout: 20), sw.value as? String == "1" {
            sw.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        }
        XCTAssertEqual(sw.value as? String, "0", "teardown could not put the New chat list switch back off")
        app.terminate()
        super.tearDown()
    }

    private func openDana(_ app: XCUIApplication, _ when: String) {
        // Measured 11-08: after the swipes up to the switch, iOS 26 collapses the tab bar to the selected tab alone ("Settings",
        // value Collapsed), so Agents is not in it. Swiping back down brings the full bar back.
        let agents = app.tabBars.buttons["Agents"]
        for _ in 0..<6 where !agents.exists { app.swipeDown() }
        XCTAssertTrue(agents.waitForExistence(timeout: 5), "no Agents tab, \(when)")
        agents.tap()
        let row = app.staticTexts["Dana"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Dana row on Agents, \(when)")
        row.tap()
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 20), "Dana's chat did not open, \(when)")
    }

    private func closeChat(_ app: XCUIApplication) {
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 5), "no way back out of the chat")
        back.tap()
    }

    private func toggle(_ app: XCUIApplication) -> XCUIElement {
        app.tabBars.buttons["Settings"].tap()
        let sw = app.switches["settings-new-chat-list"]
        for _ in 0..<6 where !sw.isHittable { app.swipeUp() }
        XCTAssertTrue(sw.waitForExistence(timeout: 10) && sw.isHittable, "no New chat list switch in Settings")
        return sw
    }

    private func set(_ sw: XCUIElement, on: Bool) {
        // The knob is at the row's trailing end; a tap on the row's middle lands on the label and may not flip it.
        if (sw.value as? String == "1") != on { sw.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap() }
        XCTAssertEqual(sw.value as? String, on ? "1" : "0", "the switch did not turn \(on ? "on" : "off")")
    }

    func testTheSwitchChoosesTheListForTheNextChat() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1"]
        app.launch()
        let uikit = app.collectionViews["chat-list-uikit"]

        // Off (a fresh install's default, or put back to it): the lazy list.
        set(toggle(app), on: false)
        openDana(app, "switch off")
        sleep(1)
        XCTAssertFalse(uikit.exists, "the UIKit list drew the chat with the switch off")
        closeChat(app)

        // On: the next chat opened is the UIKit list.
        set(toggle(app), on: true)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "settings-new-chat-list-on"; shot.lifetime = .keepAlways; add(shot)
        openDana(app, "switch on")
        XCTAssertTrue(uikit.waitForExistence(timeout: 10), "the switch is on and the chat was not drawn by the UIKit list")
        closeChat(app)

        // Back to the default for whatever runs next on this simulator.
        set(toggle(app), on: false)
        openDana(app, "switch off again")
        sleep(1)
        XCTAssertFalse(uikit.exists, "the switch is off again and the UIKit list still drew the chat")
    }
}
