import XCTest

/// kosmos#9202 (follow-up to #9101): the board page over the tabs, with its Close bar, is drawn on the board's own
/// ground, never Kosmos navy. #9101 moved the native colour behind the web board from navy (#17233D) to
/// UIColor.boardGround (#faf9f7 light, #0c0d0f dark) in five places; until this test nothing RENDERED it, so the claim
/// rested on a source read and a byte probe. This opens the page the way a person does (Agents' + on a sample board
/// with no computer address asks first, then opens the board page: BoardHandoffUITests), screenshots it, and reads the
/// pixels of the Close bar row's empty right side and of the strip just above it. Both are native (SwiftUI), so they
/// are the same whatever the web view below has loaded. Of #9101's five places this renders the Close bar's row
/// (ContentView.swift boardPage's bar background) and the safe-area strip above it; the outer backgrounds and the web
/// host sit under the web view and are covered by ios.board-ground-9101.test.js's source read, not by this.
///
/// Appearance: XCUIDevice.shared.appearance changes nothing on an iOS 27.0 simulator (TaskPageActionsUITests), and the
/// app follows the board's own Light/Dark when the board sets one (#9101), so the test accepts EITHER exact ground,
/// never navy, and names which it saw and the raw colours it read. A dark run is the simulator set to dark
/// (`xcrun simctl ui <device> appearance dark`) with a board that follows the phone, as the sample board does.
/// Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other sample-board UI tests are (ios/tools/ui-sample.sh runs it).
final class BoardGroundUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private struct RGB: Equatable { let r: Int, g: Int, b: Int }
    private static let light = RGB(r: 0xFA, g: 0xF9, b: 0xF7)
    private static let dark = RGB(r: 0x0C, g: 0x0D, b: 0x0F)
    private static let navy = RGB(r: 0x17, g: 0x23, b: 0x3D)

    /// The colour at a point of the image (in points), read through a 1x1 sRGB bitmap so the screenshot's own pixel
    /// format does not matter. `scale` is pixels per point, worked out from the image itself by the caller (review 1:
    /// UIImage.scale on a screenshot need not be the device scale). nil when the point is outside the image.
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

    private static func near(_ a: RGB, _ b: RGB, within t: Int = 3) -> Bool {
        abs(a.r - b.r) <= t && abs(a.g - b.g) <= t && abs(a.b - b.b) <= t
    }

    /// Which ground every sampled point is: "light", "dark", or a sentence naming the first point that is neither
    /// (and whether it is navy). The one judgement both tests below use, so the control exercises the same code.
    private static func judge(_ image: UIImage, _ points: [CGPoint], scale: CGFloat) -> String {
        var seen: String?
        for p in points {
            guard let c = colour(image, at: p, scale: scale) else { return "no pixel at \(p)" }
            if near(c, navy) { return "NAVY at \(p): \(c)" }
            let which = near(c, light) ? "light" : near(c, dark) ? "dark" : nil
            guard let w = which else { return "neither ground at \(p): \(c)" }
            if let s = seen, s != w { return "mixed grounds: \(s) then \(w) at \(p)" }
            seen = w
        }
        return seen ?? "no points"
    }

    func testTheBoardPageAndItsCloseBarAreOnTheBoardsGround() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launch()
        let plus = app.buttons["Add agent"]
        XCTAssertTrue(plus.waitForExistence(timeout: 15), "no + on Agents")
        plus.tap()
        let open = app.buttons["Open your computer's board"]
        XCTAssertTrue(open.waitForExistence(timeout: 5), "+ did not ask before opening the board")
        open.tap()
        let close = app.buttons["Close this page"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), "the board page with its Close bar did not open")
        // Review 1: the page has no slide; what must finish is the question's fade and its dimming, which would shift
        // every sample. Wait for it to be gone, then a short settle.
        XCTAssertTrue(open.waitForNonExistence(timeout: 5), "the question did not go away")
        Thread.sleep(forTimeInterval: 0.5)
        let shot = app.screenshot()
        let keep = XCTAttachment(screenshot: shot); keep.name = "board-page-closebar"; keep.lifetime = .keepAlways; add(keep)
        let frame = close.frame
        let width = app.frame.width
        // Review 1: pixels per point from the image itself, asserted to be a phone's 2 or 3, so a 1x reading cannot
        // quietly sample a third of the way to every point.
        let px = CGFloat(shot.image.cgImage?.width ?? 0)
        let scale = px / width
        XCTAssertTrue(abs(scale - 2) < 0.05 || abs(scale - 3) < 0.05, "the screenshot is \(px) px for \(width) pt: not a 2x or 3x phone")
        // The Close bar row's empty right side (the Spacer: no words, no icon), and the strip just above it, on the
        // right, clear of a notch or an island in the middle and below the status bar's own icons.
        let row = [CGPoint(x: width - 12, y: frame.midY), CGPoint(x: width * 0.75, y: frame.midY), CGPoint(x: width - 12, y: frame.minY + 4)]
        let top = [CGPoint(x: width - 40, y: max(1, frame.minY - 2))]
        let verdict = Self.judge(shot.image, row + top, scale: scale)
        let read = (row + top).map { p in Self.colour(shot.image, at: p, scale: scale).map { String(format: "#%02x%02x%02x", $0.r, $0.g, $0.b) } ?? "none" }
        let said = XCTAttachment(string: "ground: \(verdict); read: \(read.joined(separator: " ")); scale \(scale)"); said.lifetime = .keepAlways; add(said)
        XCTAssertTrue(verdict == "light" || verdict == "dark", "the board page is not on the board's ground: \(verdict) (read \(read))")
    }

    /// CONTROL: the same judge on an image painted navy says so, and on each exact ground names it, so the check above
    /// can fail and is not passing on a reader that answers one thing whatever it reads.
    func testControlTheJudgeSeesNavyAndEachGround() {
        func filled(_ c: RGB) -> UIImage {
            let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.preferredRange = .standard   // plain 8-bit sRGB (review 1)
            return UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40), format: f).image { ctx in
                UIColor(red: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: 1).setFill()
                ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
            }
        }
        let pts = [CGPoint(x: 5, y: 5), CGPoint(x: 30, y: 20)]
        XCTAssertTrue(Self.judge(filled(Self.navy), pts, scale: 1).hasPrefix("NAVY"), "the judge did not see navy")
        XCTAssertEqual(Self.judge(filled(Self.light), pts, scale: 1), "light")
        XCTAssertEqual(Self.judge(filled(Self.dark), pts, scale: 1), "dark")
        XCTAssertTrue(Self.judge(filled(RGB(r: 0x80, g: 0x20, b: 0x20)), pts, scale: 1).hasPrefix("neither"), "the judge took another colour for a ground")
    }
}
