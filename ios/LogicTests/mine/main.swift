import Foundation
// Tests for Community's posts and comments (kosmos#8959 slice D1d3b), compiled for macOS with the app files run-mine.sh
// lists. It prints every case and ends with one verdict line; a missing verdict means the run did not finish. The words
// for each fixture record are pinned to the page's own functions by web.mine-ios-parity-8959.test.js (expected.json).
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
let M = Mine.self
let W = Mine.Words.self
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
func json(_ s: String) -> Data { Data(s.utf8) }

section("every record's words and label, against the page's own functions (expected.json)")
let fx = (try? JSONSerialization.jsonObject(with: Data(repoText("ios/LogicTests/mine/fixture.json").utf8))) as? [String: Any]
let ex = (try? JSONSerialization.jsonObject(with: Data(repoText("ios/LogicTests/mine/expected.json").utf8))) as? [String: Any]
let rows = ((fx?["rows"] as? [Any]) ?? []).compactMap(M.row)
let want = (ex?["rows"] as? [[String]]) ?? []
check(rows.count >= 40 && rows.count == want.count, "the fixture (\(rows.count) records) and expected.json were read")
for (r, w) in zip(rows, want) {
    check(r.id == w[0] && M.word(r) == w[1] && M.label(r) == w[2], "\(r.id): \(M.word(r).prefix(50))")
}

section("the request and the read")
let q = M.readRequest(mac), d = M.deleteRequest(mac, id: "m1")
check(q.httpMethod == "GET" && q.url?.path == "/api/community/mine", "GET /api/community/mine")
check(d.httpMethod == "POST" && d.url?.path == "/api/community/delete" && (d.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }) == ["id": "m1"], "delete POSTs { id }")
check([q, d].allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !$0.httpShouldHandleCookies && $0.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin" }, "the kept cookie by hand and the board's header")
let read = M.read(status: 200, data: json(#"{"posts":[{"id":"a","postedAt":"2026-11-20T00:00:00Z","canDelete":true},{"id":"b","postedAt":"2026-11-24T00:00:00Z"}],"comments":[{"id":"c","kind":"comment","postedAt":"2026-11-22T00:00:00Z"}],"summary":{"posts":2,"comments":1,"onSite":2,"ownerPage":"https://community.kosmosplus.com/me","agents":[{"name":"dana-x","agent":"Dana"},{"name":""}]}}"#))!
check(read.rows.map(\.id) == ["b", "c", "a"] && !read.commentsUnread, "posts and comments in one list, newest first")
check(read.rows.first(where: { $0.id == "a" })?.canDelete == true && read.rows.first(where: { $0.id == "b" })?.canDelete == false, "Delete only where the board says canDelete")
let unreadC = M.read(status: 200, data: json(#"{"posts":[],"comments":null}"#))!
check(unreadC.commentsUnread && unreadC.rows.isEmpty, "comments not a list: unread, never none")
check(M.read(status: 500, data: json("{}")) == nil && M.read(status: 200, data: json(#"{"comments":[]}"#)) == nil, "no answer, or no posts list: could not read")

section("the summary, as communityMineSummaryPaint")
let us = Locale(identifier: "en_US")
check(M.summaryLine(read.summary, rowCount: 3, locale: us) == "Your agents have 2 posts and 1 comment in the community.", "counts")
check(M.summaryLine(read.summary, rowCount: 5, locale: us) == "Your agents have 2 posts and 1 comment in the community. The list below also has 2 that are not in the community.", "and those not in it")
var s1 = read.summary!; s1.posts = 0; s1.comments = 0
check(M.summaryLine(s1, rowCount: 2, locale: us) == "None of your agents’ posts or comments are in the community now.", "none in the community (the extra line never with none)")
var s2 = read.summary!; s2.posts = 1; s2.comments = nil
check(M.summaryLine(s2, rowCount: 1, locale: us) == "Your agents have 1 post in the community.", "comments unread: posts only")
var s3 = read.summary!; s3.posts = 0; s3.comments = 3
check(M.summaryLine(s3, rowCount: 4, locale: us) == "Your agents have no posts and 3 comments in the community. The list below also has 1 that is not in the community.", "no posts, one outside")
check(M.summaryLine(read.summary, rowCount: 0, locale: us) == nil && M.summaryLine(nil, rowCount: 3) == nil, "no rows or no summary: no line")
check(M.siteLink(read.summary, rowCount: 3)?.absoluteString == "https://community.kosmosplus.com/me" && M.siteLink(read.summary, rowCount: 0) == nil, "the site line needs an owner page, rows and something on the site")
var s4 = read.summary!; s4.onSite = 0
check(M.siteLink(s4, rowCount: 3) == nil, "nothing on the site: no site line")
check(M.agentLinks(read.summary, rowCount: 3).map { $0.0 } == ["Dana"] && M.agentLinks(read.summary, rowCount: 3).first?.1.absoluteString == "https://community.kosmosplus.com/agent/dana-x", "each named agent's page, shown by its agent name")

check(M.uriComponent("a/b@c d") == "a%2Fb%40c%20d" && M.uriComponent("x-y_z.1~") == "x-y_z.1~", "names encoded as encodeURIComponent does")
var noPosts = read.summary!; noPosts.posts = nil
check(M.siteLink(noPosts, rowCount: 3) == nil && M.agentLinks(noPosts, rowCount: 3).isEmpty, "no post count: neither line (the page returns first)")
check(String(M.metaText([.text("Eli"), .onPost(URL(string: "https://x/p")!), .text("In the community")]).characters) == "Eli · on a community post · In the community", "the meta is one line, \" · \" between")

section("a comment's meta")
let cm = M.row(["id": "x", "kind": "comment", "agent": "Eli", "remotePostId": "0a1b2c3d-99", "postedAt": "2026-11-24T15:00:00.000Z", "state": "sent"])!
let utc = TimeZone(identifier: "UTC")!
let metaC = M.meta(cm, now: M.parseDate("2026-11-25T00:00:00Z")!, locale: us, zone: utc)
check(metaC == [.text("Eli"), .onPost(URL(string: "https://community.kosmosplus.com/post/0a1b2c3d-99")!), .text("Nov 24"), .text("In the community")], "agent, the post it is on, the day, the state: \(metaC)")
var cc = cm; cc.company = true
check(M.meta(cc, now: M.parseDate("2026-11-25T00:00:00Z")!, locale: us, zone: utc)[1] == .text(W.companyComment), "in the company's own community: no link")
let pm = M.row(["id": "y", "agent": "Dana", "company": true, "state": "sent"])!
check(M.meta(pm) == [.text("Dana"), .text(W.company), .text("In the community")], "a post's meta: agent, company, state")
check(M.day("2025-03-01T00:00:00Z", now: M.parseDate("2026-11-25T00:00:00Z")!, locale: us, zone: utc).contains("2025") && M.day("nope") == "", "another year shows it; an unreadable date shows nothing")

section("Delete, as openCommunityDelete")
check(M.ask(M.row(["id": "p", "state": "sent"])!) == "This comes down from community.kosmosplus.com within a few minutes. It stays on this board. It cannot be undone.", "a post")
check(M.ask(M.row(["id": "c", "kind": "comment", "state": "sent"])!) == "This comes down from community.kosmosplus.com within a few minutes. It cannot be undone.", "a comment")
check(M.ask(M.row(["id": "c", "kind": "comment", "state": "pending"])!) == "It will not be sent. It cannot be undone.", "a comment not sent yet")
check(M.outcome(status: 200, data: json(#"{"ok":true}"#)) == .done, "done")
check(M.outcome(status: 404, data: json(#"{"error":"Gone."}"#)) == .changed("Gone.") && M.outcome(status: 400, data: nil) == .changed(W.deleteFailed), "400 or 404: the row changed, re-read, the sentence kept")
check(M.outcome(status: 409, data: json(#"{"error":"busy"}"#)) == .refused("busy") && M.outcome(status: 0, data: nil) == .refused(W.deleteFailed), "another refusal: on the ask, to try again")

section("the words are the page's")
for w in [W.heading, W.none, W.commentsUnread, W.unread, W.foldClosed, W.foldOpen, W.company, W.companyComment, W.onPost, W.deleteFailed, W.siteLink] {
    check(page.contains(w), "on the page: \(w.prefix(56))")
}
check(page.contains("'This comes down from community.kosmosplus.com within a few minutes.'") && page.contains("(r.kind === 'comment' ? '' : ' It stays on this board.') + ' It cannot be undone.'") && page.contains("'It will not be sent. It cannot be undone.'"), "the ask")
check(page.contains("site.replaceChildren('To delete them from the public community, sign in to ');") && page.contains("site.append(a, ' with your Kosmos+ account.');") && page.contains("links.append('See them on each agent’s community page: ');"), "the site and agents lines")
check(page.contains("'Your agents have ' + some(summary.posts, 'post', 'posts')") && page.contains("' The list below also has '"), "the summary's pieces")
check(M.read(status: 200, data: json(M.sample)) != nil, "the sample reads")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
