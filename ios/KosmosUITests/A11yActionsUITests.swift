import XCTest

/// kosmos#8221 slice 13: on the UIKit list, VoiceOver's "Message actions" (the action a VoiceOver user picks to reach Copy
/// and Delete, the long-press sheet) opens that sheet. VoiceOver does not run on a simulator and a UI test cannot perform a
/// custom action, so the app runs it the way VoiceOver would, 6 s after the chat opens (KOSMOS_SAMPLE_A11YACTIONS, see
/// ChatList.sampleA11yActions), on the element whose label contains KOSMOS_SAMPLE_A11YACTIONS_TEXT, and this checks the sheet.
/// Dana's chat: "Great. What is left?" is the person's own message. The UIKit list only: the lazy list's bubbles are not in
/// hosted cells, which is what could drop the sheet's opener.
final class A11yActionsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private struct Report { let found: Bool; let names: [String]; let ran: Bool; let label: String }

    private func run(on text: String, fixOff: Bool = false) throws -> (XCUIApplication, Report) {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        guard UIKitListArm.on else { throw XCTSkip("the lazy list draws no hosted cells (UIKit list only)") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana",
                                 "KOSMOS_SAMPLE_A11YACTIONS": "6", "KOSMOS_SAMPLE_A11YACTIONS_TEXT": text]
        if fixOff { app.launchEnvironment["KOSMOS_SAMPLE_NOCELLACTIONS"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        UIKitListArm.assertDrawn(app)
        let marker = app.descendants(matching: .any).matching(identifier: "sample-a11y-scroll").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30), "CONTROL: the action never reported")
        // "sample a11y scroll actions elements <n>, found <bool>, names <a|b>, ran <bool>"
        let label = marker.label
        print("UI-NOTE kosmos#8221 slice 13 \(text)\(fixOff ? ", fix off" : ""): \(label)")
        let words = label.replacingOccurrences(of: ",", with: "").split(separator: " ").map(String.init)
        func after(_ key: String) -> String? { words.firstIndex(of: key).flatMap { $0 + 1 < words.count ? words[$0 + 1] : nil } }
        guard words.contains("actions"), let found = after("found"), let names = after("names"), let ran = after("ran") else {
            throw NSError(domain: "A11yActionsUITests", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreadable report: \(label)"])
        }
        return (app, Report(found: found == "true", names: names.split(separator: "|").map(String.init), ran: ran == "true", label: label))
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    // The control: the same action with the sheet's opener left out of the cell runs and opens nothing. If the sheet opens
    // here, the checks below cannot see a cell that lost the opener.
    func testWithoutTheOpenerInTheCellTheActionOpensNothing() throws {
        let (app, r) = try run(on: "Great. What is left?", fixOff: true)
        XCTAssertTrue(r.found, "CONTROL: no element with the message's label and an action: \(r.label)")
        XCTAssertTrue(r.ran, "CONTROL: the action did not run: \(r.label)")
        XCTAssertFalse(app.buttons["Copy text"].waitForExistence(timeout: 4), "CONTROL: the sheet opened with no opener in the cell")
    }

    // The person's own message: Copy and Delete.
    func testMessageActionsOnYourMessageOpensCopyAndDelete() throws {
        let (app, r) = try run(on: "Great. What is left?")
        XCTAssertTrue(r.found, "no element with the message's label and an action: \(r.label)")
        XCTAssertTrue(r.names.contains("Message_actions"), "the message has no Message actions for VoiceOver: \(r.label)")
        XCTAssertTrue(r.ran, "Message actions did not run: \(r.label)")
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 5), "Message actions opened no sheet with Copy text")
        XCTAssertTrue(app.buttons["Delete message"].exists, "the sheet on the person's own message has no Delete")
        shot(app, "VoiceOver Message actions, your message")
    }

    // An agent's message: Copy and Reply, no Delete.
    func testMessageActionsOnAnAgentsMessageOpensCopyWithoutDelete() throws {
        let (app, r) = try run(on: "Dana, ")
        XCTAssertTrue(r.found, "no element with Dana's label and an action: \(r.label)")
        XCTAssertTrue(r.names.contains("Message_actions"), "Dana's message has no Message actions for VoiceOver: \(r.label)")
        XCTAssertTrue(r.ran, "Message actions did not run: \(r.label)")
        XCTAssertTrue(app.buttons["Copy text"].waitForExistence(timeout: 5), "Message actions opened no sheet with Copy text")
        XCTAssertTrue(app.buttons["Reply"].exists, "the sheet on Dana's message has no Reply")
        XCTAssertFalse(app.buttons["Delete message"].exists, "Delete is offered on an agent's message")
        shot(app, "VoiceOver Message actions, agent's message")
    }
}
