import Foundation
// Tests for Community's held posts (kosmos#8959 slice D1d2b), compiled for macOS with the app files run-held.sh lists. It
// prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
let page = repoText("web/index.html").replacingOccurrences(of: "\\u2019", with: "’")
check(page.count > 1_000_000, "the board page was read")
let H = Held.self
let W = Held.Words.self
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
func json(_ s: String) -> Data { Data(s.utf8) }

section("the requests")
let qh = H.queueRequest(mac, stopped: false), qs = H.queueRequest(mac, stopped: true)
check(qh.url?.absoluteString == "https://studio.kosmosplus.com/api/community/moderation?status=held&limit=200" && qs.url?.query == "status=quarantined&limit=200", "the two reads, 200 each, as the page")
let rel = H.releaseRequest(mac, id: "p1"), dis = H.discardRequest(mac, id: "p1")
let body = { (q: URLRequest) in q.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } }
check(rel.httpMethod == "POST" && rel.url?.path == "/api/community/release" && body(rel) == ["id": "p1"], "release POSTs { id }")
check(dis.httpMethod == "POST" && dis.url?.path == "/api/community/discard" && body(dis) == ["id": "p1"], "discard POSTs { id }")
check([qh, rel, dis].allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !$0.httpShouldHandleCookies && $0.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin" }, "the kept cookie by hand and the board's header (isViaScreen)")
check(page.contains("fetch('/api/community/moderation?status=' + status + '&limit=' + COMMUNITY_HELD_MAX)") && page.contains("const COMMUNITY_HELD_MAX = 200;"), "the page's reads")

section("the reads")
let held = H.queue(status: 200, data: json(#"{"queue":[{"id":"p1","status":"held","entry":"post","author":{"name":"Dana"},"topic":"Shipped","body":"Three fixes."},{"id":"c1","status":"held","entry":"comment","postId":"p1","agent":"eli","body":"Nice"},{"id":"c2","status":"held","entry":"comment","remotePostId":"0a1b2c3d-1111","agent":"eli","body":"Agreed, and here is a long line of words that runs past forty"},{"status":"held"}]}"#))!
let stopped = H.queue(status: 200, data: json(#"{"queue":[{"id":"p2","status":"quarantined","entry":"post","agent":"fay","topic":"Notes","body":"Mail me","findings":[{"cls":"email"},{"cls":"secret_token"},{"cls":"high_entropy"},{"cls":"other"}]},]}"#))!
let heldMore = H.queue(status: 200, data: json(#"{"queue":[{"id":"c3","status":"held","entry":"comment","postId":"p2","agent":"gus","body":"x"}]}"#))!
check(held.map(\.id) == ["p1", "c1", "c2"] && stopped.map(\.id) == ["p2"], "rows with an id and a status; one without is dropped")
check(H.queue(status: 500, data: json("{}")) == nil && H.read(held: held, stopped: nil) == nil, "either read failing: the list cannot be read")
let r = H.read(held: held + heldMore, stopped: stopped)!
check(r.rows.map(\.id) == ["p1", "c1", "c2", "c3", "p2"] && !r.fullHeld && !r.fullStopped, "the releasable rows first")
let full = H.read(held: Array(repeating: held[0], count: 200), stopped: [])!
check(H.listLine(full) == "Only the oldest 200 waiting are shown. There may be more; they show here as you release or discard these.", "a full held read")
check(W.onlyOldest(held: true, stopped: true).hasPrefix("Only the oldest 200 waiting and the oldest 200 stopped are shown.") && W.onlyOldest(held: false, stopped: true).hasPrefix("Only the oldest 200 stopped are shown."), "both, or stopped only")
check(H.listLine(nil) == W.unread && H.listLine(Held.Read(rows: [], fullHeld: false, fullStopped: false)) == W.empty && H.listLine(r) == nil, "could not read; nothing waiting; rows")

section("each row, as communityHeldPaint")
let s = H.shown(r.rows, policyStopped: nil)
check(s.map(\.title) == ["Shipped", "A comment by eli", "A comment by eli", "A comment by gus", "A post by fay"], "titles: the topic, a comment by its agent, a stopped row named neutrally")
check(s[0].meta == "Dana · Waiting for you to release it" && s[0].canRelease && s[0].label == "Shipped", "a held post: Release, its author")
check(s[1].meta == "eli · Waiting for you" + W.underHeld && !s[1].canRelease, "a comment under a held post: release the post first")
check(s[2].meta == "eli · Waiting for you to release it" + W.remoteComment && s[2].postLink?.absoluteString == "https://community.kosmosplus.com/post/0a1b2c3d-1111", "a comment on a community post: the link and the line")
check(s[2].label == "A comment by eli: Agreed, and here is a long line of words…", "a comment's label carries its first 40 characters")
check(s[4].stopped && !s[4].canRelease && s[4].meta == "fay · Stopped by the safety check" && s[4].label == "A post by fay (row 5)" && s[4].words == "Notes\nMail me", "a stopped post: named by its place, its topic with its words")
check(!s[4].title.contains("Notes") && !s[4].label.contains("Notes") && !s[4].label.contains("Mail"), "a stopped row's title and label carry neither its topic nor its words")
check(s[4].why == "Kosmos stopped this because it contains an email address and what looks like a password or key, so it cannot be released. Discard it, and the agent can write it again without that.", "its reason, each kind once, in order")
check(s[3].meta == "gus · Waiting for you" + W.underStopped && !s[3].canRelease, "a comment under a stopped post: discard only")
let policy = H.shown([held[0]], policyStopped: "Kosmos+ has paused it.")
check(policy[0].meta == "Dana · Waiting for you to release it" + W.policyKept, "the policy stop: a release stays on this computer")
var gone = held[0]; gone.notSent = true
check(H.shown([gone], policyStopped: "x")[0].meta.hasSuffix(W.notSent), "a deleted agent's row says so, before the policy line")
let plain = H.shown([Held.Row(id: "c9", status: "held", entry: "comment", postId: nil, remotePostId: nil, author: nil, agent: nil, topic: nil, body: "", findings: [], notSent: false)], policyStopped: nil)
check(plain[0].title == "A comment" && plain[0].meta == "Waiting for you to release it" + W.commentsNotSent, "a comment with no post and no agent")
check(H.reason([]) == "Kosmos stopped this because it did not pass the safety check, so it cannot be released. Discard it, and the agent can write it again without that.", "no known finding")
check(H.title(Held.Row(id: "x", status: "held", entry: nil, postId: nil, remotePostId: "r", author: nil, agent: "a", topic: nil, body: nil, findings: [], notSent: false)) == "A comment by a", "an older board's comment, by its routing fields")
let rowOf = { (b: String) in Held.Row(id: "x", status: "held", entry: "post", postId: nil, remotePostId: nil, author: nil, agent: nil, topic: nil, body: b, findings: [], notSent: false) }
check(H.shown([rowOf(String(repeating: "w", count: 241))], policyStopped: nil)[0].long, "over 240 characters: Read all")
check(H.shown([rowOf("a\nb\nc\nd\ne")], policyStopped: nil)[0].long && !H.shown([rowOf("a\nb\nc\nd")], policyStopped: nil)[0].long, "past 4 lines, however short: Read all (nothing cut off unseen above Release)")
check(page.contains("txt.split('\\n').length > COMMUNITY_HELD_CLAMP_LINES") || page.contains("COMMUNITY_HELD_CLAMP_LINES"), "the page's line clamp")
check(H.queue(status: 200, data: json(#"{"queue":[{"id":"q","status":"held","remotePostId":""}]}"#))?.first?.isComment == false, "an empty remotePostId is no comment's routing field (the page's falsy)")

section("the list's lines and the outcomes")
check(H.offLine(on: nil, policyStopped: nil) == nil && H.offLine(on: false, policyStopped: nil) == W.heldOff && H.offLine(on: true, policyStopped: nil) == nil && H.offLine(on: true, policyStopped: "Paused.") == W.heldPolicy("Paused."), "off, on, the policy stop")
check(H.outcome(status: 200, data: json(#"{"released":true}"#), releasing: true) == .done, "released")
check(H.outcome(status: 400, data: json(#"{"error":"only you can release this, from Settings"}"#), releasing: true) == .refused("only you can release this, from Settings"), "a refusal: the board's sentence")
check(H.outcome(status: 0, data: nil, releasing: true) == .unfinished(W.finishFailed + W.whereNow) && H.outcome(status: 0, data: nil, releasing: false) == .unfinished(W.discardFailed + W.whereNow), "no answer: either may have landed, so the list is read again")
check(H.outcome(status: 400, data: nil, releasing: false) == .refused(W.discardFailed), "a discard refused with no sentence")
check(H.outcome(status: 500, data: json(#"{"error":"we could not save that just now; try again"}"#), releasing: true) == .unfinished("we could not save that just now; try again" + W.whereNow), "a 5xx release: said where the list says things")
check(H.outcome(status: 503, data: nil, releasing: true) == .unfinished(W.finishFailed + W.whereNow), "with no sentence")

section("the words are the board page's own")
for w in [W.empty, W.unread, W.releaseFailed, W.discardFailed, W.finishFailed, W.keep, W.discardIt, W.show, W.hide, W.readAll, W.readLess, W.seePost, W.stoppedState, W.heldOff] {
    check(page.contains(w), "on the page: \(w.prefix(56))")
}
for w in [W.underStopped, W.underHeld, W.notSent, W.policyKept, W.remoteComment, W.commentsNotSent] { check(page.contains("'" + w + "'"), "on the page: \(w.prefix(56))") }
check(page.contains("'It never goes to the community, and it cannot be brought back.'") && page.contains("(communityHeldIsComment(r) ? '' : ' Any comments on it go with it.')"), "the discard ask")
check(page.contains("'Releasing…'") || page.contains("'Releasing\\u2026'"), "Releasing…")
check(page.contains("'A post or comment you release now stays on this computer and is not sent to the community. ' + policyStop"), "the policy line")
check(page.contains("<h4 class=\"dlab\" id=\"community-held-head\" style=\"margin:14px 0 4px;\">Waiting for you</h4>"), "the heading")
check(page.contains("const COMMUNITY_HELD_READ_ALL_CHARS = 240;") && page.contains("const COMMUNITY_HELD_LABEL_CHARS = 40;") && page.contains("const COMMUNITY_SITE = 'https://community.kosmosplus.com';"), "the page's constants")
check(H.read(held: H.queue(status: 200, data: json(H.sampleHeld)), stopped: H.queue(status: 200, data: json(H.sampleStopped)))?.rows.count == 2, "the sample reads")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
