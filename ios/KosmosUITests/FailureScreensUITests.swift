import XCTest

/// kosmos#9095: the four failure screens (LoadFailureView: offline, Kosmos+ not answering, a computer not answering, a
/// page that did not load) are drawn on the native ground, cream #faf9f7 in light and near-black #0c0d0f in dark
/// (Palette.ground), with Try again filled gold #e3b341, and no Kosmos navy (#17233D) or the old blue (#2F57C4)
/// anywhere above the tab bar. Until this test only one of the four had ever been SEEN (a hand-run shot); this drives
/// each with KOSMOS_SAMPLE_FAILURE (ContentView.sampleFailure, a Debug-only hold that starts past sign-in), screenshots
/// it, and reads the pixels: the ground at both edges, a grid over the whole screen above the tab bar, and Try again's
/// fill. Each screenshot is attached.
///
/// Appearance: each half launches with the board's own theme set (`-kosmos.boardTheme light|dark`, the UserDefaults
/// key Shell.boardThemeKey that BoardThemeProxy applies to every window at start), so the app draws that appearance
/// whatever the simulator's: XCUIDevice.shared.appearance changed nothing on iOS 26.5 or 27.0, and in one measured run on
/// 26.5 (11-27) these screens stayed light after `simctl ui appearance dark` too (not chased further). So both halves run
/// in CI, and each must draw its own exact ground: the other ground, navy or blue FAILS. This proves the board-theme
/// path, not a phone in dark mode with the board on "system"; Palette.ground and the gold resolve from the same trait
/// either way. Review 1: the web view keeps loading under the held screen, and a page that posts its theme ("system")
/// would hand the windows back to the simulator's appearance; so each screen's ground is read again 2 s later and must
/// still be the one asked for, which turns that race into a failure rather than a pass on the first frame.
/// Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other sample-board UI tests are (ios/tools/ui-sample.sh runs it).
final class FailureScreensUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private struct RGB: Equatable { let r: Int, g: Int, b: Int }
    private static let light = RGB(r: 0xFA, g: 0xF9, b: 0xF7)
    private static let dark = RGB(r: 0x0C, g: 0x0D, b: 0x0F)
    private static let navy = RGB(r: 0x17, g: 0x23, b: 0x3D)
    private static let blue = RGB(r: 0x2F, g: 0x57, b: 0xC4)
    private static let gold = RGB(r: 0xE3, g: 0xB3, b: 0x41)

    /// The four screens: the KOSMOS_SAMPLE_FAILURE value, and how to know its title.
    private static let screens: [(sample: String, title: NSPredicate)] = [
        ("offline", NSPredicate(format: "label == %@", "You're offline")),
        ("unreachable", NSPredicate(format: "label == %@", "Kosmos+ isn't answering")),
        ("mac", NSPredicate(format: "label ENDSWITH %@ AND NOT (label BEGINSWITH %@)", "isn't answering", "Kosmos+")),
        ("other", NSPredicate(format: "label == %@", "This page didn't load")),
    ]

    /// The colour at a point of the image (in points), through a 1x1 sRGB bitmap (as BoardGroundUITests reads it).
    private static func colour(_ image: UIImage, at p: CGPoint, scale: CGFloat) -> RGB? {
        guard let cg = image.cgImage else { return nil }
        let x = Int(p.x * scale), y = Int(p.y * scale)
        guard x >= 0, y >= 0, x < cg.width, y < cg.height, let crop = cg.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)) else { return nil }
        var px = [UInt8](repeating: 0, count: 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return RGB(r: Int(px[0]), g: Int(px[1]), b: Int(px[2]))
    }
    private static func near(_ a: RGB, _ b: RGB, within t: Int = 4) -> Bool {
        abs(a.r - b.r) <= t && abs(a.g - b.g) <= t && abs(a.b - b.b) <= t
    }
    private static func hex(_ c: RGB) -> String { String(format: "#%02x%02x%02x", c.r, c.g, c.b) }

    /// The ground every point is: "light", "dark", or a sentence naming the first point that is neither.
    private static func ground(_ image: UIImage, _ points: [CGPoint], scale: CGFloat) -> String {
        var seen: String?
        for p in points {
            guard let c = colour(image, at: p, scale: scale) else { return "no pixel at \(p)" }
            if near(c, navy) { return "NAVY at \(p): \(hex(c))" }
            let which = near(c, light) ? "light" : near(c, dark) ? "dark" : nil
            guard let w = which else { return "neither ground at \(p): \(hex(c))" }
            if let s = seen, s != w { return "mixed grounds: \(s) then \(w) at \(p)" }
            seen = w
        }
        return seen ?? "no points"
    }
    /// The first point of a grid over `rect` that is navy or the old blue, or nil.
    private static func forbidden(_ image: UIImage, in rect: CGRect, step: CGFloat, scale: CGFloat) -> String? {
        var y = rect.minY + step / 2
        while y < rect.maxY {
            var x = rect.minX + step / 2
            while x < rect.maxX {
                if let c = colour(image, at: CGPoint(x: x, y: y), scale: scale) {
                    if near(c, navy, within: 6) { return "NAVY at (\(Int(x)), \(Int(y))): \(hex(c))" }
                    if near(c, blue, within: 6) { return "the old BLUE at (\(Int(x)), \(Int(y))): \(hex(c))" }
                }
                x += step
            }
            y += step
        }
        return nil
    }

    private func checkAll(expect: String) throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        for screen in Self.screens {
            let app = XCUIApplication()
            app.launchArguments += ["-kosmos.boardTheme", expect]
            app.launchEnvironment["KOSMOS_SAMPLE_FAILURE"] = screen.sample
            app.launch()
            let title = app.staticTexts.matching(screen.title).firstMatch
            XCTAssertTrue(title.waitForExistence(timeout: 20), "\(screen.sample): its failure screen did not show")
            let retry = app.buttons["Try again"]
            XCTAssertTrue(retry.waitForExistence(timeout: 5), "\(screen.sample): no Try again")
            Thread.sleep(forTimeInterval: 0.5)
            let shot = app.screenshot()
            let keep = XCTAttachment(screenshot: shot); keep.name = "failure-\(screen.sample)-\(expect)"; keep.lifetime = .keepAlways; add(keep)
            let width = app.frame.width, height = app.frame.height
            let px = CGFloat(shot.image.cgImage?.width ?? 0)
            let scale = px / width
            XCTAssertTrue(abs(scale - 2) < 0.05 || abs(scale - 3) < 0.05, "the screenshot is \(px) px for \(width) pt: not a 2x or 3x phone")
            let bar = app.tabBars.firstMatch
            let bottom = bar.exists && bar.frame.minY > height / 2 ? bar.frame.minY : height - 100
            // The ground at both edges, clear of the centred words and buttons, below the status bar, above the tab bar.
            let edges = [0.2, 0.45, 0.7].flatMap { f -> [CGPoint] in
                let y = min(bottom - 8, max(60, height * f))
                return [CGPoint(x: 10, y: y), CGPoint(x: width - 10, y: y)]
            }
            let seen = Self.ground(shot.image, edges, scale: scale)
            let banned = Self.forbidden(shot.image, in: CGRect(x: 0, y: 0, width: width, height: bottom), step: 6, scale: scale)
            let f = retry.frame
            let fill = Self.colour(shot.image, at: CGPoint(x: f.minX + 8, y: f.midY), scale: scale)
            let said = XCTAttachment(string: "\(screen.sample) asked \(expect): ground \(seen); forbidden \(banned ?? "none"); Try again fill \(fill.map(Self.hex) ?? "none")")
            said.lifetime = .keepAlways; add(said)
            print("UI-NOTE kosmos#9095 \(screen.sample) asked \(expect): ground \(seen); forbidden \(banned ?? "none"); Try again \(fill.map(Self.hex) ?? "none")")
            XCTAssertNil(banned, "\(screen.sample): \(banned ?? "")")
            XCTAssertTrue(fill.map { Self.near($0, Self.gold, within: 6) } ?? false, "\(screen.sample): Try again is not gold: \(fill.map(Self.hex) ?? "none")")
            XCTAssertEqual(seen, expect, "\(screen.sample): asked for \(expect), drawn on: \(seen)")
            Thread.sleep(forTimeInterval: 2.0)
            let later = Self.ground(app.screenshot().image, edges, scale: scale)
            XCTAssertEqual(later, expect, "\(screen.sample): asked for \(expect), and 2 s later drawn on: \(later) (did the page under it post a theme?)")
            app.terminate()
        }
    }

    func testTheFourFailureScreensInLight() throws { try checkAll(expect: "light") }
    func testTheFourFailureScreensInDark() throws { try checkAll(expect: "dark") }

    /// CONTROL: the judges see navy, the old blue and each exact ground, so the checks above can fail.
    func testControlTheJudgesSeeNavyBlueAndEachGround() {
        func filled(_ c: RGB) -> UIImage {
            let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.preferredRange = .standard
            return UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40), format: f).image { ctx in
                UIColor(red: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: 1).setFill()
                ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
            }
        }
        let pts = [CGPoint(x: 5, y: 5), CGPoint(x: 30, y: 20)]
        let all = CGRect(x: 0, y: 0, width: 40, height: 40)
        XCTAssertTrue(Self.ground(filled(Self.navy), pts, scale: 1).hasPrefix("NAVY"))
        XCTAssertEqual(Self.ground(filled(Self.light), pts, scale: 1), "light")
        XCTAssertEqual(Self.ground(filled(Self.dark), pts, scale: 1), "dark")
        XCTAssertTrue(Self.ground(filled(Self.gold), pts, scale: 1).hasPrefix("neither"))
        XCTAssertNotNil(Self.forbidden(filled(Self.navy), in: all, step: 6, scale: 1))
        XCTAssertNotNil(Self.forbidden(filled(Self.blue), in: all, step: 6, scale: 1))
        XCTAssertNil(Self.forbidden(filled(Self.light), in: all, step: 6, scale: 1))
        XCTAssertNil(Self.forbidden(filled(Self.gold), in: all, step: 6, scale: 1))
        XCTAssertTrue(Self.near(Self.colour(filled(Self.gold), at: CGPoint(x: 10, y: 10), scale: 1)!, Self.gold, within: 6))
    }
}
