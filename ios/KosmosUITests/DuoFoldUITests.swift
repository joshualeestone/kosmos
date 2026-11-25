import XCTest

// kosmos#9002: the one Duo check CI runs (ios/tools/ui-sample.sh). The rest of DuoPanesUITests are by hand on a Mac.
final class DuoFoldUITests: DuoPanesCase {
    // The page is opened while folded, then the phone unfolds: the list comes back beside it with the tabs.
    func testAPageOpenedFoldedHasTheTabsBackOnAnUnfold() throws {
        let app = try launch("fold:40", ["KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"])
        let info = app.buttons["room-info"], plus = app.buttons["Add a file to this conversation"]
        XCTAssertTrue(info.waitForExistence(timeout: 30), "the room did not open")
        XCTAssertTrue(holds(8) { self.pastMiddle(app, plus) && self.tabsShow(app) }, "CONTROL: unfolded, the room is not beside its list with the tabs")
        XCTAssertTrue(holds(55) { self.atLeft(app, plus) && !self.tabsShow(app) }, "folded, the room is not alone without the tabs")
        info.tap()
        let about = words(app, "What it is for")
        XCTAssertTrue(about.waitForExistence(timeout: 10) && !tabsShow(app), "the page opened folded has the tab bar over it")
        XCTAssertTrue(holds(55) { self.pastMiddle(app, about) && self.tabsShow(app) }, "unfolded, the page is not beside its list with the tabs")
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
