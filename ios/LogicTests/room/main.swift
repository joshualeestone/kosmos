import Foundation
// Tests for a project's room (kosmos#7032, slice 9 of #6838), compiled for macOS with the app files run-room.sh lists.
// room-page.json is the REAL route's answer (GET /api/project/<id>/room?n=50), captured from a sandboxed board with a
// row of every kind; it is not hand-written, so the parser is tested against what the computer sends.
// It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() {
        passed += 1
        print("  ok   \(name)")
    } else {
        failed += 1
        print("  FAIL \(name) (line \(line))")
    }
}
func section(_ name: String) { print(name) }
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let fixture = (try? Data(contentsOf: here.appendingPathComponent("room-page.json"))) ?? Data()
check(!fixture.isEmpty, "premise: the captured room page is there")
var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "UTC")!
let now = ISO8601DateFormatter().date(from: "2026-10-22T18:00:00Z")!

section("parsing the real route's page")
let names = ["cleo": "Cleo", "eli": "Eli", "dana": "Dana", "gus": "Gus"]
let page = Board.parseRoom(fixture, names: names)
check(page != nil, "the page parses")
let rows = page?.rows ?? []
check(rows.map { $0.kind } == [.kosmos, .post, .post, .post, .post, .external, .kosmos, .kosmos, .post],
      "every kind, in order, with the two refusals for one reason folded into one line: \(rows.map { $0.kind })")
check(rows[safe: 1]?.byPerson == true && rows[safe: 1]?.from == nil, "the person's own post carries no sender")
check(rows[safe: 2]?.from == "cleo" && rows[safe: 3]?.from == "cleo" && rows[safe: 4]?.from == "eli", "an agent's post names its sender")
check(rows[safe: 1]?.mentioned == ["cleo"], "the agents a post addressed")
check(rows[safe: 4]?.replyTo == "m2", "a reply names the post it answers")
check(rows[safe: 4]?.reactions == [Board.Reaction(emoji: "🔥", count: 2, mine: true)], "a reaction pill, with the person's own marked")
check(rows[safe: 5]?.externalAgent == true && rows[safe: 5]?.from == "Maple", "an outside agent's message")
check(rows[safe: 6]?.text == "Dana and Gus tried to post here and Kosmos stopped it: it is not on this project",
      "consecutive refusals for one reason are one line naming everyone, in the board's words")
check(rows[safe: 7]?.text == "This went back and forth for a while, so Kosmos stopped it.", "a valve's own reason")
check(page?.olderCount == 0 && page?.olderCursor == nil, "the whole room fit: no older page")
check(rows[safe: 0]?.id.hasPrefix("k|2026-10-22T15:00:00.000Z|") == true, "a Kosmos line's identity is the computer's key (its place), not this page's index")

section("what is never drawn as something it is not")
let odd = Data(#"{"rows":[{"kind":"reopen","at":"2026-10-22T15:00:00.000Z"},{"kind":"post","at":"2026-10-22T15:01:00.000Z"},{"kind":"note","text":"","at":"2026-10-22T15:02:00.000Z"}],"olderCount":3,"olderCursor":"2026-10-22T15:00:00.000Z|0"}"#.utf8)
let oddPage = Board.parseRoom(odd)
check(oddPage?.rows.isEmpty == true, "an unknown kind, a post with no id or text, and an empty note are left out")
check(oddPage?.olderCount == 3 && oddPage?.olderCursor == "2026-10-22T15:00:00.000Z|0", "the cursor is the computer's, echoed as given")
check(Board.parseRoom(Data("not json".utf8)) == nil && Board.parseRoom(Data(#"{"error":"x"}"#.utf8)) == nil, "an answer that is not a room is nil")

section("runs are grouped by sender, so two agents in a row are two runs")
let items = Board.roomItems(rows, now: now, calendar: cal)
func runFlags(_ id: String) -> (Bool, Bool)? {
    for i in items { if case let .row(r, f, l) = i.kind, r.id == id { return (f, l) } }
    return nil
}
check(runFlags("m2").map { $0 == (true, false) } == true, "Cleo's first post starts her run")
check(runFlags("m3").map { $0 == (false, true) } == true, "her second post ends it")
check(runFlags("m4").map { $0 == (true, true) } == true, "Eli right after Cleo is a run of his own, never merged into hers")
check(items.first.map { if case .day("Today") = $0.kind { return true } else { return false } } == true, "a day line opens the room")

section("merging a re-read newest page")
let shownBefore = Array(rows.prefix(5))
var newer = Array(rows.suffix(6))
if let i = newer.firstIndex(where: { $0.id == "m4" }) { newer[i].reactions = [Board.Reaction(emoji: "👍", count: 1, mine: true)] }   // m4's reactions changed since
check(newer.first?.id == "m3" && shownBefore.last?.id == "m4", "premise: the two pages overlap on m3 and m4")
let merged = Board.mergeRoom(shownBefore, with: newer)
check(merged.map { $0.id } == rows.map { $0.id }, "rows already shown are kept once, new ones added, in time order")
check(merged.first { $0.id == "m4" }?.reactions == [Board.Reaction(emoji: "👍", count: 1, mine: true)], "a row seen again takes its newer reading")
check(Board.mergeRoom(rows, with: rows).count == rows.count, "re-reading the same page adds nothing, Kosmos lines included")
let late = Board.RoomRow(id: "m9", atRaw: "2026-10-22T15:02:30.000Z", at: nil, kind: .post, from: "dana", byPerson: false, text: "late")
check(Board.mergeRoom(rows, with: [late]).map { $0.id }.firstIndex(of: "m9") == 3, "a post written late lands in its time place")

section("the request: the newest page, or the page before the computer's cursor")
let mac = URL(string: "https://studio.kosmosplus.com")!
let r1 = Board.roomRequest(mac: mac, project: "spring-catalogue", n: 50)
check(r1?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/spring-catalogue/room?n=50", "the newest page: \(r1?.url?.absoluteString ?? "nil")")
let r2 = Board.roomRequest(mac: mac, project: "spring-catalogue", n: 50, cursor: "2026-10-22T15:00:00.000Z|0")
check(r2?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/spring-catalogue/room?n=50&cursor=2026-10-22T15:00:00.000Z%7C0", "the cursor, escaped: \(r2?.url?.absoluteString ?? "nil")")
check(Board.roomRequest(mac: mac, project: "../x", n: 50) == nil && Board.roomRequest(mac: mac, project: "Spring", n: 50) == nil, "a project id the board cannot have is refused")
check(Board.roomRequest(mac: mac, project: "p", n: 0) == nil && Board.roomRequest(mac: mac, project: "p", n: 201) == nil, "n outside 1 to 200 is refused")

extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
