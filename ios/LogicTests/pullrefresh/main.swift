import Foundation

var total = 0, failures = 0
func check(_ ok: Bool, _ what: String) { total += 1; if !ok { failures += 1; print("FAIL: " + what) } }

typealias L = PullRefreshLogic

// How far past its top, from the scroll view's numbers.
check(L.pulled(offsetY: -100, adjustedTop: 100) == 0, "resting at the top is not pulled")
check(L.pulled(offsetY: -130, adjustedTop: 100) == 30, "30 past the top")
check(L.pulled(offsetY: 200, adjustedTop: 100) == 0, "scrolled down is not pulled")

// A pull past the threshold, let go: one refresh.
var a = L()
check(!a.moved(pulled: 10, dragging: true), "not armed yet")
check(a.phase == .pulling(armed: false), "pulling")
check(a.moved(pulled: L.threshold, dragging: true), "arming is reported once, at the threshold")
check(!a.moved(pulled: L.threshold + 20, dragging: true), "and not again further on")
check(a.phase == .pulling(armed: true), "armed")
check(a.released(), "letting go starts it")
check(a.phase == .refreshing, "refreshing")

// While refreshing nothing starts another, and moving does not end it.
check(!a.moved(pulled: L.threshold * 2, dragging: true), "moving while refreshing does nothing")
check(!a.released(), "a second release does not start another")
check(!a.asked(), "nor does asking")
check(a.phase == .refreshing, "still refreshing")

// Ending gives the space back once, and nothing restarts until the list is back at its top.
check(a.ended(), "the work ended")
check(!a.ended(), "only once")
_ = a.moved(pulled: L.threshold + 5, dragging: true)
check(a.phase == .settling, "a finger still past the threshold does not arm it")
check(!a.released(), "so letting go starts nothing")
_ = a.moved(pulled: 0, dragging: false)
check(a.phase == .idle, "back at the top it is ready again")
_ = a.moved(pulled: L.threshold, dragging: true)
check(a.released(), "CONTROL: and a new pull works")

// Pulled past and brought back before letting go: nothing.
var b = L()
_ = b.moved(pulled: L.threshold + 1, dragging: true)
_ = b.moved(pulled: L.threshold - 1, dragging: true)
check(b.phase == .pulling(armed: false), "brought back above the threshold disarms it")
check(!b.released(), "letting go there starts nothing")
check(b.phase == .idle, "and it is at rest")
let edge = { () -> Bool in var c = L(); _ = c.moved(pulled: L.threshold - 0.5, dragging: true); return c.released() }()
check(!edge, "just short of the threshold starts nothing")

// A fling off the top has no finger on it.
var d = L()
_ = d.moved(pulled: L.threshold * 2, dragging: false)
check(d.phase == .idle, "a fling does not arm it")
check(!d.released(), "and starts nothing")

// UIKit can clear the finger before it tells the gesture's end, with a move in between (review 2).
var h = L()
_ = h.moved(pulled: L.threshold + 5, dragging: true)
_ = h.moved(pulled: L.threshold + 4, dragging: false)
check(h.phase == .pulling(armed: true), "an armed pull waits for the gesture's end when the finger clears first")
check(h.released(), "so the release still starts it")
var i = L()
_ = i.moved(pulled: L.threshold + 5, dragging: true)
_ = i.moved(pulled: 0, dragging: false)
check(i.phase == .idle, "back at the top with no finger, it is at rest")
check(!i.released(), "and a late end starts nothing")
var j = L()
_ = j.moved(pulled: 10, dragging: true)
_ = j.moved(pulled: 9, dragging: false)
check(j.phase == .idle, "a pull not armed does not wait")

// An end with no refresh does nothing, which is what the longest hold and a page's finish rely on.
var e = L()
check(!e.ended(), "ending with nothing running does nothing")
check(e.phase == .idle, "and it stays at rest")

// VoiceOver's way.
var f = L()
check(f.asked(), "asking at rest starts it")
check(f.phase == .refreshing, "refreshing")
var g = L()
_ = g.moved(pulled: 10, dragging: true)
check(!g.asked(), "asking during a pull does not")

// The dots' opacity.
check(L.shown(pulled: 0, refreshing: false) == 0, "none at rest")
check(L.shown(pulled: L.threshold / 2, refreshing: false) == 0.5, "half at half way")
check(L.shown(pulled: L.threshold * 3, refreshing: false) == 1, "never over all")
check(L.shown(pulled: 0, refreshing: true) == 1, "all while refreshing, wherever the list is")

// kosmos#8072: past the end of a chat, from the scroll view's numbers.
check(L.pastEnd(offsetY: 1000, content: 1800, view: 900, adjustedTop: 100, adjustedBottom: 100) == 0, "resting exactly at the end is not past it")
check(L.pastEnd(offsetY: 1040, content: 1800, view: 900, adjustedTop: 100, adjustedBottom: 100) == 40, "40 past the end")
check(L.pastEnd(offsetY: 200, content: 1800, view: 900, adjustedTop: 100, adjustedBottom: 100) == 0, "higher up is not past it")
check(L.pastEnd(offsetY: -100, content: 300, view: 900, adjustedTop: 100, adjustedBottom: 100) == 0, "a list too short to fill the screen, at rest, is not past it")
check(L.pastEnd(offsetY: -60, content: 300, view: 900, adjustedTop: 100, adjustedBottom: 100) == 40, "and 40 up from its top is 40 past it")
check(L.leastShow > 0 && L.leastShow < L.longestHold, "the dots are seen, and still end")
// The constants the feel rests on.
check(L.held < L.threshold, "the held space is less than the pull, so it settles back on release")
check(L.longestHold > 0 && L.longestHold <= 30, "the longest hold ends a wait offline")

print(failures == 0 ? "VERDICT: PASS \(total)/\(total)" : "VERDICT: FAIL \(total - failures)/\(total)")
exit(failures == 0 ? 0 : 1)
