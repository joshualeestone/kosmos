import XCTest

// kosmos#9002: the one Duo check CI runs (ios/tools/ui-sample.sh). The rest of DuoPanesUITests are by hand on a Mac.
final class DuoFoldUITests: DuoPanesCase {
    // Folds or unfolds by the app's own control, then waits for the app to say it did (no clock to race on a slow runner).
    private func fold(_ app: XCUIApplication, _ want: String) {
        let c = app.descendants(matching: .any).matching(identifier: "duo-sample-fold").firstMatch
        XCTAssertTrue(c.waitForExistence(timeout: 10), "CONTROL: the sample fold control is not there")
        c.tap()
        XCTAssertTrue(holds(10) { c.label == want }, "the sample did not become \(want) (it reads \(c.label))")
    }

    // The page is opened while folded, then the phone unfolds: the list comes back beside it with the tabs.
    func testAPageOpenedFoldedHasTheTabsBackOnAnUnfold() throws {
        let app = try launch("tap", ["KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"])
        let info = app.buttons["room-info"], plus = app.buttons["Add a file to this conversation"]
        XCTAssertTrue(info.waitForExistence(timeout: 30), "the room did not open")
        XCTAssertTrue(holds(8) { self.pastMiddle(app, plus) && self.tabsShow(app) }, "CONTROL: unfolded, the room is not beside its list with the tabs")
        fold(app, "sample folded")
        XCTAssertTrue(holds(10) { self.atLeft(app, plus) && !self.tabsShow(app) }, "folded, the room is not alone without the tabs")
        info.tap()
        let about = words(app, "What it is for")
        XCTAssertTrue(about.waitForExistence(timeout: 10) && !tabsShow(app), "the page opened folded has the tab bar over it")
        fold(app, "sample unfolded")
        XCTAssertTrue(holds(10) { self.pastMiddle(app, about) && self.tabsShow(app) }, "unfolded, the page is not beside its list with the tabs")
        shot(app, "opened folded, unfolded")
        // Three pages deep: a member's chat from that page.
        let member = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Cleo'")).firstMatch
        XCTAssertTrue(member.waitForExistence(timeout: 5), "CONTROL: no Cleo in the page's members")
        member.tap()
        let chat = labelled(app, "label == %@", "Message Cleo")
        XCTAssertTrue(holds(10) { self.pastMiddle(app, chat) && self.tabsShow(app) }, "a chat three pages deep is not beside the list with the tabs")
        shot(app, "three deep")
    }
}
