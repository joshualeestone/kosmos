import Network
import XCTest

// kosmos#8953: a web page an agent sent opens on the phone, in WebFileView, never on the computer's board (the page
// with a Close bar), and nothing in it reaches the network. The sample chat with Cleo carries "Launch page.html"
// (KOSMOS_SAMPLE_WEBFILE=1); the sample's page names this test's own listener (KOSMOS_SAMPLE_WEBFILE_PROBE) in a sample
// of the ways a page can load something: a stylesheet, an @import, a font, a script, preconnect, dns-prefetch, prefetch,
// preload, modulepreload and icon links, a picture and its srcset, a frame, video, audio, object, embed, a form's image
// input, a CSS background, a refresh and links (one with ping). The listener counts every connection it gets; the page
// must cost it none.
final class WebFileUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let s = XCTAttachment(screenshot: app.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    // A loopback listener that counts the connections it accepts. The simulator shares the Mac's loopback, so the app's
    // requests to 127.0.0.1 reach it.
    private final class Probe {
        let listener: NWListener
        private let lock = NSLock()
        private var n = 0
        private var seen: [String] = []
        var count: Int { lock.lock(); defer { lock.unlock() }; return n }
        var paths: [String] { lock.lock(); defer { lock.unlock() }; return seen }
        // kosmos#8966: whether the count stays where it is for the whole window, watched every tenth of a second, so a
        // connection fails the check the moment it arrives instead of after a fixed sleep. A window is still needed:
        // "nothing came" can only be shown over time.
        func stays(at count: Int, for seconds: Double) -> Bool {
            let end = Date().addingTimeInterval(seconds)
            repeat { if self.count != count { return false }; usleep(100_000) } while Date() < end
            return self.count == count
        }
        init() throws {
            let p = NWParameters.tcp
            p.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
            listener = try NWListener(using: p)
            listener.newConnectionHandler = { [weak self] c in
                guard let self else { return }
                self.lock.lock(); self.n += 1; self.lock.unlock()
                c.start(queue: .global())
                // The request line names what was asked for, so a failure says which load got out.
                c.receive(minimumIncompleteLength: 1, maximumLength: 512) { data, _, _, _ in
                    let line = data.flatMap { String(data: $0, encoding: .utf8) }?.split(separator: "\r\n").first.map(String.init) ?? "(no request line)"
                    self.lock.lock(); self.seen.append(line); self.lock.unlock()
                    c.cancel()
                }
            }
        }
        func start() -> UInt16? {
            let ready = DispatchSemaphore(value: 0)
            listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
            listener.start(queue: .global())
            return ready.wait(timeout: .now() + 5) == .success ? listener.port?.rawValue : nil
        }
    }

    func testAWebPageOpensOnThePhoneAndLoadsNothing() throws {
        let probe = try Probe()
        guard let port = probe.start() else { return XCTFail("the probe listener did not start") }
        let address = "http://127.0.0.1:\(port)"
        // CONTROL: the listener counts a real connection, so a count of zero later means nothing came, not a deaf listener.
        // A plain TCP connection (not a URL request), so it is opened once and never retried.
        let done = expectation(description: "control connection")
        let control = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        control.stateUpdateHandler = { if case .ready = $0 { done.fulfill() } }
        control.start(queue: .global())
        wait(for: [done], timeout: 10)
        control.cancel()
        // The baseline is the count once it has stopped changing for two seconds.
        var baseline = probe.count
        for _ in 0..<10 { sleep(2); if probe.count == baseline { break }; baseline = probe.count }
        XCTAssertGreaterThanOrEqual(baseline, 1, "the control request did not reach the listener")

        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "cleo", "KOSMOS_SAMPLE_WEBFILE": "1",
                                 "KOSMOS_SAMPLE_WEBFILE_PROBE": address]
        app.launch()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Launch page.html")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 20), "the web page's card is not in Cleo's chat")
        shot(app, "chat-with-web-page")
        card.tap()

        let page = app.webViews["webfile.page"]
        XCTAssertTrue(page.waitForExistence(timeout: 10), "the web page did not open on the phone")
        XCTAssertTrue(page.staticTexts["Launch page"].waitForExistence(timeout: 10), "the page's own words are not drawn")
        XCTAssertFalse(app.buttons["Close"].exists, "the board's page opened (its Close bar is on screen)")
        XCTAssertTrue(app.buttons["Done"].exists && app.staticTexts["Pictures and styles this page loads from elsewhere are not shown, and its links do not open."].exists,
                      "the viewer's Done and its line about blocked loads are missing")
        // No link is left in the page (Board.withoutLinks), so none can be activated by VoiceOver or a keyboard either.
        XCTAssertEqual(page.links.count, 0, "the page still has links: \(page.links.allElementsBoundByIndex.map(\.label))")
        // Past the page's one-second refresh, which must not go anywhere.
        XCTAssertTrue(probe.stays(at: baseline, for: 2), "loading the page reached the network: \(probe.count - baseline) connection(s)")
        shot(app, "web-page-open")
        // Tapping a link had WebKit open a connection to its host before the navigation was refused; every link is
        // inert, including two that try to take it back (an !important rule outside the layer, and an inline one).
        for name in ["A link away", "A loud link", "An inline link"] {
            let link = page.staticTexts[name]
            XCTAssertTrue(link.exists, "the page has no \(name)")
            link.tap()
            XCTAssertTrue(probe.stays(at: baseline, for: 2), "tapping \(name) reached the network")
        }
        XCTAssertTrue(page.staticTexts["Launch page"].exists, "the page navigated away")
        XCTAssertEqual(probe.count, baseline, "the page reached the network: \(probe.count - baseline) connection(s); request lines seen in all: \(probe.paths)")

        app.buttons["Done"].tap()
        let gone = NSPredicate(format: "exists == false")
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: gone, evaluatedWith: page)], timeout: 5), .completed, "Done did not close the page")
        XCTAssertTrue(card.exists, "CONTROL: back in the chat after Done")

        // An SVG is drawn as a picture: shown, and neither its image nor its link reaches the network.
        let chart = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Chart.svg")).firstMatch
        XCTAssertTrue(chart.waitForExistence(timeout: 5), "the SVG's card is not in Cleo's chat")
        chart.tap()
        let svg = app.webViews["webfile.page"]
        XCTAssertTrue(svg.waitForExistence(timeout: 10), "the SVG did not open on the phone")
        XCTAssertTrue(svg.images.firstMatch.waitForExistence(timeout: 10), "the SVG is not drawn")
        shot(app, "svg-open")
        svg.images.firstMatch.tap()
        XCTAssertTrue(probe.stays(at: baseline, for: 2), "the SVG reached the network")
        XCTAssertTrue(svg.exists, "the SVG is no longer shown after a tap")
        app.buttons["Done"].tap()
        probe.listener.cancel()
    }
}
