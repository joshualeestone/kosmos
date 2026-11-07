import Foundation

// kosmos#7954: the iPhone's Sweep loader (SweepLogic). Two halves: its constants are pinned to the board's CSS text
// (web/index.html .spin-sweep, @keyframes sweepLite and calmPulse, read from KOSMOS_REPO), and its motion is checked
// against those constants. Each check can fail: the CSS pins have a control that runs them on a page with one keyframe
// moved and must find it missing, and the order check has a control that reverses the dots and must find it false.
var failures = 0, total = 0
func check(_ ok: Bool, _ what: String) { total += 1; if ok { print("ok   " + what) } else { failures += 1; print("FAIL " + what) } }
func near(_ a: Double, _ b: Double, _ e: Double = 1e-9) -> Bool { abs(a - b) < e }

let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }

// A number as the board's CSS writes it: whole numbers bare, others without a leading zero (.2, 1.08).
func css(_ x: Double) -> String {
    if x == x.rounded() { return String(Int(x)) }
    let s = String(x)
    return s.hasPrefix("0.") ? String(s.dropFirst()) : s
}
func pct(_ x: Double) -> String { String(Int((x * 100).rounded())) }

// Every rule of the board's Sweep that SweepLogic copies, written from SweepLogic's constants. Returns the ones missing.
func missingPins(_ page: String) -> [String] {
    var want = [
        "--dot: calc(var(--sz)*\(SweepLogic.dotShare))",
        // Each dot sits at the top of its rotator, centred: the ring SweepLogic.dots places them on.
        "position: absolute; top: 0; left: 50%; width: var(--dot); height: var(--dot);",
        // Reduce Motion: no scale (SweepLogic's 1.0) and the pulse's resting opacity.
        "transform: none !important; opacity: \(css(SweepLogic.calmHigh)); }",
        ".spin-sweep i::before { animation: sweepLite \(css(SweepLogic.loop))s ease-in-out infinite; opacity: \(css(SweepLogic.restOpacity)); }",
        "@keyframes sweepLite { 0%, \(pct(SweepLogic.restFrom))%, 100% { opacity: \(css(SweepLogic.restOpacity)); transform: scale(\(css(SweepLogic.restScale))); } "
            + "\(pct(SweepLogic.peakAt))% { opacity: \(css(SweepLogic.litOpacity)); transform: scale(\(css(SweepLogic.litScale))); } }",
        "animation: calmPulse \(css(SweepLogic.calmLoop))s ease-in-out infinite",
        "@keyframes calmPulse { 0%, 100% { opacity: \(css(SweepLogic.calmHigh)); } 50% { opacity: \(css(SweepLogic.calmLow)); } }",
    ]
    for i in 0..<SweepLogic.count {
        want.append(".spin i:nth-child(\(i + 1)) { transform: rotate(\(i * 360 / SweepLogic.count)deg); }")
        var delay = String(format: "%.3f", SweepLogic.loop - SweepLogic.step * Double(i))
        if delay.hasPrefix("0.") { delay.removeFirst() }
        want.append(".spin-sweep i:nth-child(\(i + 1))::before { animation-delay: -\(delay)s; }")
    }
    return want.filter { !page.contains($0) }
}

let page = repoText("web/index.html")
check(!page.isEmpty, "the board's page was read (KOSMOS_REPO)")
let missing = missingPins(page)
check(missing.isEmpty, "every Sweep rule SweepLogic copies is on the board's page as written" + (missing.isEmpty ? "" : ": missing \(missing)"))
check(!missingPins(page.replacingOccurrences(of: "0%, 72%, 100%", with: "0%, 70%, 100%")).isEmpty,
      "control: a page with the rest keyframe moved fails the same pins")

// The easing is CSS ease-in-out: its ends, its midpoint, and one value of cubic-bezier(.42,0,.58,1).
check(near(SweepLogic.easeInOut(0), 0) && near(SweepLogic.easeInOut(1), 1) && near(SweepLogic.easeInOut(0.5), 0.5, 1e-6),
      "ease-in-out holds 0, 0.5 and 1")
check(near(SweepLogic.easeInOut(0.25), 0.129161, 1e-4), "ease-in-out(0.25) is the CSS curve's (\(SweepLogic.easeInOut(0.25)))")

// The keyframes: at rest, lit at 20% of the loop, falling until 72% and at rest from there on.
let L = SweepLogic.loop
let rest = SweepLogic.look(0, dot: 0), lit = SweepLogic.look(0.2 * L, dot: 0)
check(near(rest.opacity, 0.2) && near(rest.scale, 0.6), "dot 0 at rest at t = 0")
check(near(lit.opacity, 1) && near(lit.scale, 1.08), "dot 0 lit at 20% of its loop")
let falling = SweepLogic.look(0.715 * L, dot: 0), landed = SweepLogic.look(0.72 * L, dot: 0), late = SweepLogic.look(0.8 * L, dot: 0)
check(falling.opacity > 0.2 + 1e-6 && falling.opacity < 0.21, "dot 0 still falling just before 72% (\(falling.opacity))")
check(near(landed.opacity, 0.2) && near(landed.scale, 0.6) && near(late.opacity, 0.2) && near(late.scale, 0.6), "dot 0 at rest at 72% and after")
check(near(SweepLogic.look(0.37, dot: 3).opacity, SweepLogic.look(0.37 + L * 7, dot: 3).opacity), "the loop repeats every 1.2 s")

// Each dot lights 0.15 s after the one before, so the light goes clockwise (dot 0 at the top, dot 2 at the right). The
// gap is read around the loop (dot 7's peak can land early in the next 1.2 s).
func peak(_ i: Int) -> Double { stride(from: 0.0, to: L, by: 0.001).max { SweepLogic.look($0, dot: i).opacity < SweepLogic.look($1, dot: i).opacity }! }
func gapsOk(_ ps: [Double]) -> Bool { zip(ps, ps.dropFirst()).allSatisfy { a, b in var g = (b - a).truncatingRemainder(dividingBy: L); if g < 0 { g += L }; return near(g, 0.15, 0.002) } }
let peaks = (0..<8).map(peak)
check(gapsOk(peaks), "each dot peaks 0.15 s after the one before: \(peaks)")
check(!gapsOk(Array(peaks.reversed())), "control: the reversed order fails the same check")

// Geometry: eight dots a share of .19 of the side wide, dot 0 at the top centre and dot 2 at the right, with the ring
// pulled in so a lit dot touches the edge and never crosses it.
let side = 20.0, edge = side * 0.19 * 1.08 / 2, ds = SweepLogic.dots(0, side: side, reduceMotion: false)
check(ds.count == 8, "eight dots")
check(near(ds[0].x, 10) && near(ds[0].y, edge), "dot 0 at the top centre (\(ds[0].x), \(ds[0].y))")
check(near(ds[2].x, side - edge) && near(ds[2].y, 10), "dot 2 at the right (\(ds[2].x), \(ds[2].y))")
let big = SweepLogic.dots(0.24, side: side, reduceMotion: false)[0]
check(near(big.diameter, side * 0.19 * 1.08), "a lit dot is 1.08 times its width (\(big.diameter))")
check(stride(from: 0.0, to: L, by: 0.005).allSatisfy { t in SweepLogic.dots(t, side: side, reduceMotion: false).allSatisfy {
    $0.x - $0.diameter / 2 >= -1e-9 && $0.x + $0.diameter / 2 <= side + 1e-9 && $0.y - $0.diameter / 2 >= -1e-9 && $0.y + $0.diameter / 2 <= side + 1e-9 } },
      "every dot stays inside the box at every moment of the loop")

// Reduce Motion: every dot the same, full size, pulsing .85 to .4 over 1.6 s, never moving.
let calm0 = SweepLogic.dots(0, side: side, reduceMotion: true), calmMid = SweepLogic.dots(0.8, side: side, reduceMotion: true)
check(calm0.allSatisfy { near($0.opacity, 0.85) && near($0.diameter, side * 0.19) }, "Reduce Motion: all at .85, full size, at t = 0")
check(calmMid.allSatisfy { near($0.opacity, 0.4) }, "Reduce Motion: all at .4 halfway through 1.6 s")
check(zip(calm0, calmMid).allSatisfy { near($0.x, $1.x) && near($0.y, $1.y) && near($0.diameter, $1.diameter) }, "Reduce Motion: nothing moves or grows")

// kosmos#7945 follow-up: the launch frame is dot 0 at its brightest and largest, the three before it trailing (dimmer
// the further back), dot 1 starting to light, and dots 2 and 3 at rest.
let launch = SweepLogic.dots(SweepLogic.launchAt, side: side, reduceMotion: false)
check(near(launch[0].opacity, SweepLogic.litOpacity) && near(launch[0].diameter, side * SweepLogic.dotShare * SweepLogic.litScale),
      "the launch frame lights dot 0, at the top, at its brightest")
check(launch[7].opacity > launch[6].opacity && launch[6].opacity > launch[5].opacity && launch[5].opacity > SweepLogic.restOpacity
      && launch[1].opacity > SweepLogic.restOpacity && launch[1].opacity < launch[7].opacity
      && near(launch[2].opacity, SweepLogic.restOpacity) && near(launch[3].opacity, SweepLogic.restOpacity),
      "the launch frame: dots 7, 6, 5 trail behind dot 0, dimming; dot 1 starts to light; dots 2 and 3 at rest")

// SweepLogic.shown, what SweepDots draws: its first frame is the launch frame, with or without Reduce Motion; with Reduce
// Motion it fades into the pulse over calmFrom, in place, and is the pulse from then on.
func same(_ a: [SweepLogic.Dot], _ b: [SweepLogic.Dot]) -> Bool { zip(a, b).allSatisfy { near($0.x, $1.x) && near($0.y, $1.y) && near($0.diameter, $1.diameter) && near($0.opacity, $1.opacity) } }
check(same(SweepLogic.shown(0, side: side, reduceMotion: false), launch) && same(SweepLogic.shown(0, side: side, reduceMotion: true), launch),
      "a ring's first frame is the launch frame, with or without Reduce Motion")
let F = SweepLogic.calmFrom, A = SweepLogic.launchAt
check(same(SweepLogic.shown(F, side: side, reduceMotion: true), SweepLogic.dots(F + A, side: side, reduceMotion: true))
      && same(SweepLogic.shown(5, side: side, reduceMotion: true), SweepLogic.dots(5 + A, side: side, reduceMotion: true)),
      "Reduce Motion: the pulse from calmFrom on")
let halfway = SweepLogic.shown(F / 2, side: side, reduceMotion: true), calmThen = SweepLogic.dots(F / 2 + A, side: side, reduceMotion: true)
check(zip(zip(halfway, launch), calmThen).allSatisfy { p, c in
        let (h, l) = p
        return near(h.x, l.x) && near(h.y, l.y) && h.opacity >= min(l.opacity, c.opacity) - 1e-9 && h.opacity <= max(l.opacity, c.opacity) + 1e-9 }
      && !same(halfway, launch) && !same(halfway, calmThen),
      "Reduce Motion: halfway, every dot between the launch frame and the pulse, none moved")
check(same(SweepLogic.shown(2.5, side: side, reduceMotion: false), SweepLogic.dots(2.5 + A, side: side, reduceMotion: false)),
      "without Reduce Motion, the loop from launchAt on")

// The view wraps the clock at 24 s, a whole number of both loops, so the wrap shows no jump.
check(near(SweepLogic.look(24, dot: 5).opacity, SweepLogic.look(0, dot: 5).opacity) && near(SweepLogic.calmOpacity(24), SweepLogic.calmOpacity(0)),
      "24 s is a whole number of both loops")

// kosmos#8058 (Josh 11-05): the small waits show the simple dots, not the orb. Read from KOSMOS_REPO (this checkout),
// not from a directory passed to run-sweep.sh.
do {
    let sites: [(file: String, has: String, what: String)] = [
        ("ChatFiles.swift", "case .loading:\n            SweepDots(size: 16, scales: false, framesPerSecond: 15, stillWhenReduced: true)", "an attachment loading: the dots, fixed 16 pt, 15 a second and still with Reduce Motion in the thread"),
        ("ChatView.swift", "HStack(spacing: 6) {\n                    SweepDots(size: 16, framesPerSecond: 15, stillWhenReduced: true)", "Loading earlier messages in a chat: the orb's rate and stillness on the thread"),
        ("ChatView.swift", "HStack(spacing: 6) {\n                            SweepDots(size: 16)", "Adding a file in a chat"),
        ("RoomView.swift", "HStack(spacing: 6) {\n                            SweepDots(size: 16)", "Adding a file in a room"),
        ("ComposerExtras.swift", "if dictation.finishing { SweepDots(size: 16, scales: false) }", "dictation finishing: the dots at the icon's fixed size"),
        ("FilesView.swift", "if opening { SweepDots(label: \"Loading\") }", "a file opening in the Files list"),
        ("ShellViews.swift", "HStack(spacing: 12) {\n            SweepDots()", "the Getting a file bar"),
    ]
    for site in sites {
        let text = repoText("ios/Kosmos/" + site.file)
        check(!text.isEmpty && text.contains(site.has), site.what + " (" + site.file + ")")
    }
    let room = repoText("ios/Kosmos/RoomView.swift")
    check(room.components(separatedBy: "HStack { Spacer(); SweepDots(label: \"Loading\", framesPerSecond: 15, stillWhenReduced: true); Spacer() }").count == 3,
          "a room loading earlier posts, live and in its archive: the dots, 15 a second in the thread (RoomView.swift)")
    // Josh 11-05 18:33: "only use the dots spinner in the mobile app and scrub any other instances". The guard: no app
    // source draws the orb or the system's spinner, so neither can come back unnoticed (KosmosOrb.swift itself excepted).
    // Josh 2026-11-06 18:14 put the orb back on three whole-screen waits only, drawn through WaitOrb (KosmosOrb.swift): its
    // uses are counted per file below, so a WaitOrb anywhere else, or a second one in either file, fails too.
    var offenders: [String] = [], read: [String] = [], refreshable = 0, refreshControls = 0, waitOrbs: [String: Int] = [:]
    for folder in ["ios/Kosmos", "ios/KosmosNotice"] {
        let names = (FileManager.default.enumerator(atPath: repo.appendingPathComponent(folder).path)?.allObjects as? [String]) ?? []
        for name in names where name.hasSuffix(".swift") && name != "KosmosOrb.swift" {
            let text = repoText(folder + "/" + name)
            read.append(folder + "/" + name)
            // A line whose first non-blank characters are // is skipped, so such a comment is neither an offender nor counted. A /* */ block or a trailing
            // comment is still read, so naming one there can trip the check.
            let code = text.split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
            for bad in ["KosmosOrb", "ProgressView", ".progressViewStyle", "UIActivityIndicatorView"] where code.contains(where: { $0.contains(bad) }) { offenders.append(name + ": " + bad) }
            // Every mention of WaitOrb, by occurrence (review 2), however it is written (WaitOrb.init too, review 3), less its
            // size constants (WaitOrb.side...), which WaitTick and the guard's own file name.
            if name != "KosmosOrb.swift" {
                let joined = code.joined(separator: "\n")
                let w = (joined.components(separatedBy: "WaitOrb").count - 1) - (joined.components(separatedBy: "WaitOrb.side").count - 1)
                if w > 0 { waitOrbs[name, default: 0] += w }
            }
            refreshable += code.filter { $0.contains(".refreshable") }.count
            refreshControls += code.filter { $0.contains("UIRefreshControl") }.count
        }
    }
    check(read.contains("ios/Kosmos/ChatView.swift") && read.contains(where: { $0.hasPrefix("ios/KosmosNotice/") }) && read.count > 20,
          "both app folders were read, subfolders included (\(read.count) files)")
    check(offenders.isEmpty, "only the dots: no orb and no system spinner anywhere in the app (caught by these names, // comment lines skipped; a renamed type or a hand-made spinner is not caught)" + (offenders.isEmpty ? "" : ": \(offenders)"))
    // The three orb waits, and nowhere else (reviews 2 and 3: two counts in a row could not fail on the case they named).
    // - WaitOrb: one mention in AgentsView (message()), one in NewAgentView, none anywhere else.
    // - message() takes an orb in Allow this iPhone's case and Connecting's, once each; with those two cases cut out, the
    //   only `orb` followed by a colon left in AgentsView is message()'s own parameter, so any other screen passing one fails,
    //   whatever its spacing or value.
    // - Making's WaitOrb is in madeScreen's last branch (the wait), not the seen or timed-out branches.
    // - WaitOrb draws at its side(...) (132 pt, 66 at the accessibility text sizes and in landscape).
    let agentsCode = repoText("ios/Kosmos/AgentsView.swift").split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }.joined(separator: "\n")
    func between(_ text: String, _ from: String, _ to: String) -> Range<String.Index>? {
        guard let a = text.range(of: from), let b = text.range(of: to, range: a.upperBound..<text.endIndex) else { return nil }
        return a.upperBound..<b.lowerBound
    }
    func orbColons(_ t: Substring) -> Int {
        var n = 0, rest = t[...]
        while let r = rest.range(of: "orb") {
            let before = r.lowerBound == rest.startIndex ? " " : rest[rest.index(before: r.lowerBound)]
            let after = rest[r.upperBound...].drop(while: { $0 == " " })
            if !(before.isLetter || before.isNumber || before == "_") && after.first == ":" { n += 1 }
            rest = rest[r.upperBound...]
        }
        return n
    }
    let allowR = between(agentsCode, "case .waitingForAllow(", "case .connecting(")
    let connR = between(agentsCode, "case .connecting(", "case .denied(")
    var outside = agentsCode
    if let c = connR { outside.removeSubrange(c) }
    if let a = between(outside, "case .waitingForAllow(", "case .connecting(") { outside.removeSubrange(a) }
    let allowHas = allowR.map { orbColons(agentsCode[$0]) } ?? -1
    let connectingHas = connR.map { orbColons(agentsCode[$0]) } ?? -1
    let outsideHas = orbColons(outside[...])
    let making = repoText("ios/Kosmos/NewAgentView.swift").split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }.joined(separator: "\n")
    let waitBranch: Substring = {
        guard let t = making.range(of: "} else if timedOut {"), let e = making.range(of: "} else {", range: t.upperBound..<making.endIndex),
              let s = making.range(of: "Spacer()", range: e.upperBound..<making.endIndex) else { return "" }
        return making[e.upperBound..<s.lowerBound]
    }()
    let orbSrc = repoText("ios/Kosmos/KosmosOrb.swift")
    check(waitOrbs == ["AgentsView.swift": 1, "NewAgentView.swift": 1] && allowHas == 1 && connectingHas == 1 && outsideHas == 1
          && waitBranch.contains("WaitOrb(label:") && orbSrc.contains("KosmosOrb(size: WaitOrb.side(typeSize")
          && orbSrc.contains("static let side: CGFloat = 132") && orbSrc.contains("static let sideAtLargeText: CGFloat = 66"),
          "the orb on exactly three waits (Allow this iPhone, Connecting, Making), 132 pt (\(waitOrbs); orb: Allow \(allowHas), Connecting \(connectingHas), elsewhere \(outsideHas) (the parameter); Making's wait branch \(waitBranch.contains("WaitOrb(label:")))")
    // kosmos#8078: iOS's own pull to refresh always draws iOS's spinner, so none may come back. Use dotsRefresh.
    check(refreshable == 0 && refreshControls == 0, "no system pull to refresh anywhere in the app (\(refreshable) + \(refreshControls))")
    let usesDots = ["AgentInfoView", "AgentsView", "FilesView", "ProjectInfoView", "ProjectsView", "SettingsView", "TaskPageView", "TasksView", "TodayView"]
        .reduce(0) { $0 + repoText("ios/Kosmos/" + $1 + ".swift").components(separatedBy: ".dotsRefresh {").count - 1 }
    check(usesDots == 10 && repoText("ios/Kosmos/ContentView.swift").contains("DotsRefreshDriver()"), "pull to refresh keeps the dots at its 11 places (\(usesDots) lists and the board page)")
    // A pull runs the closure of the latest render, not of the first: a closure reading a view's `let` sees that render's
    // value, and the Tasks list laid out a stale read this way (review 1). Read from source: no sample read ever changes.
    let refreshPiece = repoText("ios/Kosmos/DotsRefresh.swift")
    check(refreshPiece.contains("let _ = { driver.refreshAction = action }()") && !refreshPiece.contains(".onAppear"), "a pull runs the latest render's refresh, set on every render")
    // WebKit manages the web view's insets, so the board page holds no space (review 1).
    check(repoText("ios/Kosmos/ContentView.swift").contains("refresh.holdsSpace = false"), "the board page's pull never writes the web view's insets")
    // An inset changing on a list still estimating is what blanks it in the simulator (kosmos#7420), so the driver that holds
    // space stays out of a chat and a room. A chat has its own pull, past its end, which writes neither inset nor offset (kosmos#8072).
    check(!repoText("ios/Kosmos/ChatView.swift").contains("dotsRefresh") && !room.contains("dotsRefresh"), "the pull that holds space stays out of a chat and a room")
    let endPull = refreshPiece.components(separatedBy: "final class EndPullDriver").last ?? ""
    check(refreshPiece.contains("final class EndPullDriver") && !endPull.contains("contentInset") && !endPull.contains("setContentOffset") && !endPull.contains("contentOffset =") && !endPull.contains("contentOffset.y +") && !endPull.contains("contentOffset.y -") && !endPull.contains("scrollRectToVisible"),
          "a chat's pull past its end writes no inset and no offset")
}

print(failures == 0 ? "VERDICT: PASS \(total)/\(total)" : "VERDICT: FAIL \(total - failures)/\(total)")
exit(failures == 0 ? 0 : 1)
