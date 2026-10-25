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
check(rows.map { $0.kind } == [.kosmos, .post, .post, .post, .post, .external, .kosmos, .kosmos, .kosmos, .post],
      "every kind, in order, each refusal its own row until the room is drawn: \(rows.map { $0.kind })")
check(rows[safe: 1]?.byPerson == true && rows[safe: 1]?.from == nil, "the person's own post carries no sender")
check(rows[safe: 2]?.from == "cleo" && rows[safe: 3]?.from == "cleo" && rows[safe: 4]?.from == "eli", "an agent's post names its sender")
check(rows[safe: 1]?.mentioned == ["cleo"], "the agents a post addressed")
check(rows[safe: 4]?.replyTo == "m2", "a reply names the post it answers")
check(rows[safe: 4]?.reactions == [Board.Reaction(emoji: "🔥", count: 2, mine: true)], "a reaction pill, with the person's own marked")
check(rows[safe: 5]?.externalAgent == true && rows[safe: 5]?.from == "Maple", "an outside agent's message")
check(rows[safe: 6]?.refusal == Board.Refusal(key: "dana", who: "Dana", doing: nil, because: "it is not on this project"), "a refusal keeps who, and why")
check(rows[safe: 6]?.text == "Dana tried to post here and Kosmos stopped it: It is not on this project.", "one refusal, in the board's words (its reason as a sentence)")
let folded = Board.foldRefusals(rows)
check(folded.count == rows.count - 1 && folded[safe: 6]?.text == "Dana and Gus tried to post here and Kosmos stopped them: It is not on this project.",
      "consecutive refusals for one reason are one line naming everyone, in the board's words")
check(rows[safe: 8]?.text == "This went back and forth for a while, so Kosmos stopped it.", "a valve's own reason")
check(page?.olderCount == 0 && page?.olderCursor == nil, "the whole room fit: no older page")
check(rows[safe: 0]?.id == "k|2026-10-22T15:00:00.000Z|0", "a Kosmos line's identity is the computer's key (its place), not this page's index (k|<at>|p0)")

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
var newer = Array(rows.suffix(7))
if let i = newer.firstIndex(where: { $0.id == "m4" }) { newer[i].reactions = [Board.Reaction(emoji: "👍", count: 1, mine: true)] }   // m4's reactions changed since
check(newer.first?.id == "m3" && shownBefore.last?.id == "m4", "premise: the two pages overlap on m3 and m4")
let merged = Board.mergeRoom(shownBefore, with: newer)
check(merged.map { $0.id } == rows.map { $0.id }, "rows already shown are kept once, new ones added, in time order")
check(merged.first { $0.id == "m4" }?.reactions == [Board.Reaction(emoji: "👍", count: 1, mine: true)], "a row seen again takes its newer reading")
check(Board.mergeRoom(rows, with: rows).count == rows.count, "re-reading the same page adds nothing, Kosmos lines included")
// A page that begins inside a run of refusals (Gus's only), merged with one that has both: still one line, never
// "Dana and Gus tried..." beside "Gus tried...".
let fromGus = Array(rows.suffix(3))
check(fromGus.first?.refusal?.who == "Gus", "premise: this page begins at the run's second refusal")
let splitItems = Board.roomItems(Board.mergeRoom(fromGus, with: rows), now: now, calendar: cal)
let refusalLines = splitItems.compactMap { i -> String? in if case let .row(r, _, _) = i.kind, r.refusal != nil { return r.text } else { return nil } }
check(refusalLines == ["Dana and Gus tried to post here and Kosmos stopped them: It is not on this project."], "a run split across pages is one line: \(refusalLines)")
var otherReason = rows; otherReason[7].refusal = Board.Refusal(key: "gus", who: "Gus", doing: nil, because: "quiet hours")
check(Board.foldRefusals(otherReason).count == rows.count, "CONTROL: refusals for different reasons stay two lines")
var tried = rows; tried[7].refusal = Board.Refusal(key: "gus", who: "Gus", doing: "react", because: "it is not on this project")
check(Board.foldRefusals(tried).count == rows.count, "a refusal that says what was tried keeps its own line (pjFoldRoomRows)")
var addable = rows; addable[6].refusal?.addable = true
check(Board.foldRefusals(addable).count == rows.count, "an addable refusal keeps its own line")
var twice = rows; twice[7].refusal = Board.Refusal(key: "dana", who: "Dana", doing: nil, because: "it is not on this project")
check(Board.foldRefusals(twice).count == rows.count, "one agent held twice is not a group: two lines, as the board")
check(Board.refusedLine(["Dana"], doing: nil, because: nil) == "Dana tried to post here and Kosmos stopped it: No reason was recorded.", "no reason, in the board's words")
let boardPage = (try? String(contentsOf: URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? ".").appendingPathComponent("web/index.html"), encoding: .utf8)) ?? ""
check(boardPage.contains("' here and Kosmos stopped it: '") && boardPage.contains("' tried to post here and Kosmos stopped them: '") && boardPage.contains("'no reason was recorded'"),
      "the board still draws these words (web/index.html pjRoomRow), so a change there fails here")
let late = Board.RoomRow(id: "m9", atRaw: "2026-10-22T15:02:30.000Z", at: nil, kind: .post, from: "dana", byPerson: false, text: "late")
check(Board.mergeRoom(rows, with: [late]).map { $0.id }.firstIndex(of: "m9") == 3, "a post written late lands in its time place")

let whole = Board.RoomRow(id: "m60", atRaw: "2026-10-22T15:02:00Z", at: Board.isoDate("2026-10-22T15:02:00Z"), kind: .post, from: "eli", byPerson: false, text: "a")
let half = Board.RoomRow(id: "m61", atRaw: "2026-10-22T15:02:00.500Z", at: Board.isoDate("2026-10-22T15:02:00.500Z"), kind: .post, from: "eli", byPerson: false, text: "b")
check(whole.at != nil && half.at != nil, "premise: both times parse")
check(Board.mergeRoom([half], with: [whole]).map { $0.id } == ["m60", "m61"], "a time kept without milliseconds sorts by when it was, not as text")

section("the Projects tab's badge")
check(AppTabs.projectsUnread(fromStatus: Data(#"{"counts":{"waiting":2,"projectsUnread":3}}"#.utf8)) == 3, "the board's unread room posts")
check(AppTabs.projectsUnread(fromStatus: Data(#"{"counts":{"projectsUnread":0}}"#.utf8)) == nil && AppTabs.projectsUnread(fromStatus: Data(#"{"counts":{}}"#.utf8)) == nil, "CONTROL: 0 or absent is no badge")

section("Tasks earned from the status poll (no board page needed)")
check(AppTabs.tasksTab(fromStatus: Data(#"{"agents":[],"tasksTab":true}"#.utf8)) == true, "the engine's flag on, read")
check(AppTabs.tasksTab(fromStatus: Data(#"{"agents":[],"tasksTab":false}"#.utf8)) == false, "CONTROL: off reads off")
check(AppTabs.tasksTab(fromStatus: Data(#"{"agents":[]}"#.utf8)) == nil, "an older Mac that does not say: nothing")

section("a re-read after more than a page arrived")
let away = Board.RoomPage(rows: [Board.RoomRow(id: "m80", atRaw: "2026-10-22T17:00:00.000Z", at: nil, kind: .post, from: "eli", byPerson: false, text: "later")],
                          olderCount: 60, olderCursor: "2026-10-22T16:00:00.000Z|0", held: false)
let gap = Board.refreshRoom(rows, older: (0, nil), page: away)
check(gap.rows.map { $0.id } == ["m80"] && gap.older.cursor == "2026-10-22T16:00:00.000Z|0" && gap.older.count == 60,
      "a page sharing no row with what is shown replaces it and takes its own cursor, so no gap is hidden")
let overlapPage = Board.RoomPage(rows: Array(rows.suffix(3)), olderCount: 7, olderCursor: "c-new", held: false)
let kept = Board.refreshRoom(rows, older: (2, "c-old"), page: overlapPage)
check(kept.rows.count == rows.count && kept.older.cursor == "c-old", "CONTROL: an overlapping page merges and the older cursor stays")
check(Board.refreshRoom(nil, older: nil, page: away).older.cursor == "2026-10-22T16:00:00.000Z|0", "a first read takes the page's cursor")

section("rows above the newest page stay current")
let silentPage = Board.parseRoom(Data(#"{"rows":[{"kind":"post","id":"m3","text":"x","at":"2026-10-22T15:03:00.000Z"},{"kind":"post","id":"m4","text":"y","at":"2026-10-22T15:04:00.000Z"}],"unanswered":{},"olderCount":2,"olderCursor":"c"}"#.utf8), names: names)!
var waiting = Board.RoomRow(id: "m1", atRaw: "2026-10-22T15:01:00.000Z", at: Board.isoDate("2026-10-22T15:01:00.000Z"), kind: .post, from: nil, byPerson: true, text: "@dana?")
waiting.unanswered = ["Dana"]
let m3 = silentPage.rows[0]
let afterAnswer = Board.refreshRoom([waiting, m3], older: (2, "c"), page: silentPage)
check(afterAnswer.rows.first { $0.id == "m1" }?.unanswered == [], "a post above the newest page loses its silence line once the room-wide map says Dana answered")
let noMap = Board.parseRoom(Data(#"{"rows":[{"kind":"post","id":"m3","text":"x","at":"2026-10-22T15:03:00.000Z"}],"olderCount":2,"olderCursor":"c"}"#.utf8))!
check(Board.refreshRoom([waiting, m3], older: (2, "c"), page: noMap).rows.first { $0.id == "m1" }?.unanswered == ["Dana"], "CONTROL: a computer that sends no map leaves the line as it was")
let reactAnswer = Data(#"{"ok":true,"op":"add","emoji":"❤️","of":"m1","reactions":[{"emoji":"❤️","count":1,"mine":true}]}"#.utf8)
check(Board.reacted(reactAnswer).map { $0.of == "m1" && $0.reactions == [Board.Reaction(emoji: "❤️", count: 1, mine: true)] } == true, "the react answer's own pills, for a post the re-read cannot reach")
check(Board.reacted(Data(#"{"ok":false,"because":"no such post"}"#.utf8)) == nil, "CONTROL: a refused react patches nothing")

section("a post in the air settles only on a NEW row")
let ok1 = Board.RoomRow(id: "m50", atRaw: nil, at: nil, kind: .post, from: nil, byPerson: true, text: "ok")
let ok2 = Board.RoomRow(id: "m51", atRaw: nil, at: nil, kind: .post, from: nil, byPerson: true, text: "ok")
check(Board.settledPosts([("ok", ["m50"], nil)], rows: [ok1]).isEmpty, "an earlier \"ok\" never settles a new \"ok\" still on its way")
check(Board.settledPosts([("ok", ["m50"], nil)], rows: [ok1, ok2]) == [0], "CONTROL: the new row settles it")
check(Board.settledPosts([("ok", ["m50"], nil), ("ok", ["m50"], nil)], rows: [ok1, ok2]) == [0], "one new row settles one post, not two")
// What the computer stores (engine/chat.js storeText, measured: "Pages 9  to 12\nare done   \n\n\nthanks" is kept as
// "Pages 9 to 12\nare done\n\nthanks").
let storedRow = Board.RoomRow(id: "m95", atRaw: nil, at: nil, kind: .post, from: nil, byPerson: true, text: "Pages 9 to 12\nare done\n\nthanks")
check(Board.settledPosts([("Pages 9  to 12\nare done   \n\n\nthanks", [], nil)], rows: [storedRow]) == [0], "a post the computer re-spaced still settles its bubble")
check(Board.settledPosts([("Pages 9 to 11", [], nil)], rows: [storedRow]).isEmpty, "CONTROL: different words never do")
let pressAt = Board.isoDate("2026-10-24T10:00:00.000Z")
let lastWeek = Board.RoomRow(id: "m7", atRaw: "2026-10-17T10:00:00.000Z", at: Board.isoDate("2026-10-17T10:00:00.000Z"), kind: .post, from: nil, byPerson: true, text: "Thanks")
let justNow = Board.RoomRow(id: "m90", atRaw: "2026-10-24T10:00:02.000Z", at: Board.isoDate("2026-10-24T10:00:02.000Z"), kind: .post, from: nil, byPerson: true, text: "Thanks")
check(Board.settledPosts([("Thanks", [], pressAt)], rows: [lastWeek]).isEmpty, "an older same-words post read in later (scrolling up) never settles a new one")
check(Board.settledPosts([("Thanks", [], pressAt)], rows: [lastWeek, justNow]) == [0], "CONTROL: the post written after the press does")
check(Board.roomPostRefusedBeforeSending(text: String(repeating: "a", count: 10001), connected: true) == .refused("That is longer than a post can be (10,000 characters). Shorten it and post again."), "too long: Not posted, nothing sent")
check(Board.roomPostRefusedBeforeSending(text: "hi", connected: false) != nil, "not connected: Not posted, nothing sent")
check(Board.roomPostRefusedBeforeSending(text: String(repeating: "a", count: 10000), connected: true) == nil, "CONTROL: at the limit, connected: it is sent")

section("Reply's @name")
func mention(_ d: String, _ f: String?, _ p: String? = nil) -> String { Board.replyMention(draft: d, from: f, previous: p).text }
check(mention("", "monalisa") == "@monalisa ", "the session name, which the engine reads as one @word (never \"@Mona Lisa\")")
check(mention("see this", "eli") == "@eli see this", "the person's words are kept, after the name")
check(mention("thanks @Eli.", "eli") == "thanks @Eli.", "already named: nothing added")
check(mention("@elijah hi", "eli") == "@eli @elijah hi", "CONTROL: @elijah is not @eli")
let first = Board.replyMention(draft: "", from: "cleo", previous: nil)
check(first.mention == "@cleo ", "the mention Reply inserted is handed back, to swap next time")
check(mention(first.text, "dana", first.mention) == "@dana ", "a second Reply swaps the name, never \"@dana @cleo\" (which would ask both)")
check(mention("@cleo see this", "dana", nil) == "@dana @cleo see this", "CONTROL: a name the person typed themselves is never taken off")
check(mention(first.text + "thanks", nil, first.mention) == "thanks", "Reply on the person's own post takes the earlier name off and adds none")
check(Board.isOnlyMention("@cleo ", mention: "@cleo ") && Board.isOnlyMention(" @Cleo", mention: "@cleo "), "a box holding only the mention is not a post (#4359)")
check(!Board.isOnlyMention("@cleo hi", mention: "@cleo ") && !Board.isOnlyMention("@cleo", mention: nil), "CONTROL: words after it, or a name the person typed, are a post")
check(Board.mentionRanges("@eli and @elijah", "eli").count == 1, "highlighting lights whole names only")
check(Board.mentionRanges("@eli.x", "eli").isEmpty, "CONTROL: a dot inside a longer name is not the end of the name")

section("the request: the newest page, or the page before the computer's cursor")
let mac = URL(string: "https://studio.kosmosplus.com")!
let r1 = Board.roomRequest(mac: mac, project: "spring-catalogue", n: 50)
check(r1?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/spring-catalogue/room?n=50", "the newest page: \(r1?.url?.absoluteString ?? "nil")")
let r2 = Board.roomRequest(mac: mac, project: "spring-catalogue", n: 50, cursor: "2026-10-22T15:00:00.000Z|0")
check(r2?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/spring-catalogue/room?n=50&cursor=2026-10-22T15:00:00.000Z%7C0", "the cursor, escaped: \(r2?.url?.absoluteString ?? "nil")")
check(Board.roomRequest(mac: mac, project: "../x", n: 50) == nil && Board.roomRequest(mac: mac, project: "Spring", n: 50) == nil, "a project id the board cannot have is refused")
check(Board.roomRequest(mac: mac, project: "p", n: 0) == nil && Board.roomRequest(mac: mac, project: "p", n: 201) == nil, "n outside 1 to 200 is refused")

section("the Projects list: the real route's answer")
let projData = (try? Data(contentsOf: here.appendingPathComponent("projects.json"))) ?? Data()
let plist = Board.parseProjects(projData)
check(plist?.projects.count == 4 && plist?.agentsUnreadable == false, "the four projects parse")
let tree = Board.projectTree(plist?.projects ?? [], sort: .az)
check(tree.map { "\($0.depth):\($0.project.name)" } == ["0:Spring catalogue", "1:Cover shoot", "0:Website"],
      "the child sits under its parent, one level in, and the archived project is not in the tree: \(tree.map { "\($0.depth):\($0.project.name)" })")
check(Board.archivedProjects(plist?.projects ?? []).map { $0.name } == ["Old launch"], "the archived project has its own list")
let web = plist?.projects.first { $0.name == "Website" }
check(web.map { Board.projectWord($0, agentsUnreadable: false) } == .paused, "a paused project says Paused")
check(plist?.projects.first { $0.name == "Spring catalogue" }.map { Board.projectWord($0, agentsUnreadable: false) } == .some(nil),
      "nothing running: no word at all (#4730)")
check(plist?.projects.first { $0.name == "Spring catalogue" }?.description == "The print catalogue for March.", "the description")
check(plist?.projects.allSatisfy { $0.folderProblem == nil } == true, "a readable folder has no problem line")
let folders = Board.parseProjects(Data(#"{"projects":[{"id":"a","name":"A","folderState":{"state":"missing","because":"the folder is gone"}},{"id":"b","name":"B","folderState":{"state":"unreadable"}},{"id":"c","name":"C","folderState":{"state":"readable"}}]}"#.utf8))?.projects ?? []
check(folders.map { $0.folderProblem } == ["the folder is gone", "we cannot read this folder", nil], "an unreadable folder has a line, its own reason or the board's sentence: \(folders.map { $0.folderProblem })")

section("the status word, ranked as the board ranks it")
func proj(_ needs: Int = 0, q: Int = 0, working: Int = 0, restarting: Int = 0, paused: Bool = false, archived: Bool = false, name: String = "P", created: String? = nil, parent: String? = nil, id: String? = nil) -> Board.ProjectRow {
    Board.ProjectRow(id: id ?? name.lowercased(), name: name, description: "", unread: nil, parent: parent, archived: archived, archivedAt: nil, paused: paused,
                     createdAt: created.flatMap { Board.isoDate($0) }, members: [], folderProblem: nil, needsYou: needs, needsYouQuestions: q, working: working, restarting: restarting)
}
check(Board.projectWord(proj(2, q: 2, working: 1), agentsUnreadable: false) == .question, "only questions: the calm Question")
check(Board.projectWord(proj(2, q: 1, working: 1), agentsUnreadable: false) == .issue, "anything else that needs you: Issue")
check(Board.projectWord(proj(working: 1, paused: true), agentsUnreadable: false) == .paused, "Paused above Working")
check(Board.projectWord(proj(working: 1, restarting: 1), agentsUnreadable: false) == .working, "Working above Restarting")
check(Board.projectWord(proj(restarting: 1), agentsUnreadable: false) == .restarting, "Restarting")
check(Board.projectWord(proj(2, working: 1), agentsUnreadable: true) == nil, "agents unreadable: no word that could not be read")
check(Board.projectWord(proj(working: 1, paused: true), agentsUnreadable: true) == .paused, "a pause is the person's own setting, still shown")
check(Board.unreadBubble(nil) == nil && Board.unreadBubble(0) == nil && Board.unreadBubble(7) == "7" && Board.unreadBubble(150) == "99+", "the unread bubble's words")

section("the four orders, and the tree's edges")
let a = proj(name: "beta", created: "2026-10-01T00:00:00.000Z"), b = proj(name: "Alpha", created: "2026-10-03T00:00:00.000Z"), c = proj(name: "gamma")
check(Board.sortProjects([a, b, c], .newest).map { $0.name } == ["Alpha", "beta", "gamma"], "newest first; an undated project after every dated one")
check(Board.sortProjects([a, b, c], .oldest).map { $0.name } == ["beta", "Alpha", "gamma"], "oldest first; undated still last")
check(Board.sortProjects([a, b, c], .az).map { $0.name } == ["Alpha", "beta", "gamma"], "name A to Z, ignoring case")
check(Board.sortProjects([a, b, c], .za).map { $0.name } == ["gamma", "beta", "Alpha"], "name Z to A")
check(Board.ProjectSort.allCases.map(Board.projectSortLabel) == ["Newest first", "Oldest first", "Name A to Z", "Name Z to A"], "the board's four labels, no update order")
let orphan = proj(name: "Orphan", parent: "gone")
let underArchived = proj(name: "Child", parent: "old")
let archivedParent = proj(archived: true, name: "Old")
check(Board.projectTree([orphan, underArchived, archivedParent], sort: .az).map { "\($0.depth):\($0.project.name)" } == ["0:Child", "0:Orphan"],
      "a child whose parent is gone or archived sits at the top level, never disappears")
let x = proj(name: "X", parent: "y", id: "x"), y = proj(name: "Y", parent: "x", id: "y")
check(Board.projectTree([x, y], sort: .az).map { $0.project.name } == ["X", "Y"], "a cycle shows each project once and hides none")

section("posting: the board's reading of the answer")
let pr = Board.roomPostRequest(mac: mac, project: "spring-catalogue", text: "  @dana how are pages 9 to 12?  ", replyTo: "m4")
let prBody = pr?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(pr?.httpMethod == "POST" && pr?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/spring-catalogue/room", "a POST to that project's room")
check(prBody?["text"] as? String == "@dana how are pages 9 to 12?" && prBody?["reply_to"] as? String == "m4", "the words, trimmed, and the post it answers")
check(Board.roomPostRequest(mac: mac, project: "p", text: "   ") == nil, "nothing to post: nothing sent")
check(Board.roomPostRequest(mac: mac, project: "p", text: String(repeating: "a", count: 10001)) == nil, "over the board's limit: nothing sent")
func post(_ status: Int, _ json: String?) -> Board.RoomPostResult { Board.roomPostResult(status: status, body: json.map { Data($0.utf8) }) }
check(post(200, #"{"delivery":{"state":"placed","outcomes":{"dana":"placed"}}}"#) == .posted(note: nil), "kept")
check(post(200, #"{"delivery":{"state":"placed","outcomes":{},"ambiguousNote":"@da matched Dana and Dawn, so neither got it as a request."}}"#) == .posted(note: "@da matched Dana and Dawn, so neither got it as a request."), "kept, with the ambiguous @word's sentence")
check(post(200, #"{"delivery":{"state":"could_not","because":"there is no project by that name, so there is no room to post into"}}"#) == .refused("There is no project by that name, so there is no room to post into."), "refused: the computer's own sentence")
check(post(400, #"{"error":"that is not a name we can read"}"#) == .refused("That is not a name we can read."), "an error status: its sentence")
check(post(502, nil) == .unsure && post(0, nil) == .unsure, "no answer, or a server error with no sentence: it may have gone, never said to have failed")
check(post(503, #"{"error":"the board is restarting"}"#) == .refused("The board is restarting."), "a server error WITH its own sentence is the board's refusal")
check(Board.roomPostLine(.refused("It is quiet hours.")) == "Not posted. It is quiet hours." && Board.roomPostLine(.unsure) == "Not confirmed. We could not tell whether it was posted." && Board.roomPostLine(.posted(note: nil)) == nil, "the bubble's words")

section("a room notification opens its room")
let coordinator = URL(string: "https://login.kosmosplus.com")!
// The notice as the extension leaves it: `projectId` is written there from the computer's answer (PhoneNotice.withRoom;
// the relay's push never carries it, which ios/LogicTests/main.swift checks from the relay's own payload shape).
let roomPush: [AnyHashable: Any] = ["kind": "posted", "projectId": "springcatalogue", "address": "Studio.KosmosPlus.com", "session": "eli", "id": "post:m4"]
check(PushBridge.roomToOpen(fromNotification: roomPush, coordinator: coordinator) == PushBridge.RoomTarget(host: "studio.kosmosplus.com", project: "springcatalogue"), "a posted push names its computer and project")
var other = roomPush; other["kind"] = "replied"
check(PushBridge.roomToOpen(fromNotification: other, coordinator: coordinator) == nil, "CONTROL: any other kind opens as before (the agent)")
var bad = roomPush; bad["projectId"] = "../x"
check(PushBridge.roomToOpen(fromNotification: bad, coordinator: coordinator) == nil, "a project id the board cannot have opens nothing natively")
var far = roomPush; far["address"] = "evil.example.com"
check(PushBridge.roomToOpen(fromNotification: far, coordinator: coordinator) == nil, "an address outside Kosmos+ opens nothing")
check(PushBridge.roomBoardURL(PushBridge.RoomTarget(host: "studio.kosmosplus.com", project: "springcatalogue"))?.absoluteString == "https://studio.kosmosplus.com/?tab=projects&project=springcatalogue", "the board's room page, for a computer the app does not keep")
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? ".")
let manager = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/PushNotificationManager.swift"), encoding: .utf8)) ?? ""
let content = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/ContentView.swift"), encoding: .utf8)) ?? ""
if let r = manager.range(of: "PushBridge.roomToOpen("), let b = manager.range(of: "PushBridge.boardURL(") {
    check(r.lowerBound < b.lowerBound, "the room is asked about before the agent's page, so a room tap is never sent to the agent")
} else { check(false, "the tap handler asks about the room and the board") }
let studio = PushBridge.RoomTarget(host: "studio.kosmosplus.com", project: "springcatalogue")
check(PushBridge.roomOpening(studio, keptAddress: "Studio.KosmosPlus.com") == .native(studio), "the computer the app keeps: the native room (address without case)")
check(PushBridge.roomOpening(studio, keptAddress: "home.kosmosplus.com") == .board(URL(string: "https://studio.kosmosplus.com/?tab=projects&project=springcatalogue")!), "CONTROL: another computer: the board's room page on that computer")
check(PushBridge.roomOpening(studio, keptAddress: nil) == .board(URL(string: "https://studio.kosmosplus.com/?tab=projects&project=springcatalogue")!), "no kept computer: the board's room page")
check(content.contains("PushBridge.roomOpening(target, keptAddress:"), "ContentView decides through roomOpening")

section("files on a room post (kosmos#7062)")
// room-files.json is the REAL route's answer too, captured from a sandboxed board: one post with a text file and a PDF,
// then one posted with no words, which the board stores with the file's name as its text.
let filesFixture = (try? Data(contentsOf: here.appendingPathComponent("room-files.json"))) ?? Data()
check(!filesFixture.isEmpty, "premise: the captured page with files is there")
let filesRows = Board.parseRoom(filesFixture, names: ["roo": "Roo"])?.rows ?? []
check(filesRows.count == 2, "both posts parse: \(filesRows.count)")
let two = filesRows[safe: 0]?.attachments ?? []
check(two.map(\.name) == ["print-run-quotes.txt", "cover-draft.pdf"] && two.map(\.kind) == ["text", "pdf"], "a post's files, in order, with their kinds")
check(two.allSatisfy { Board.attachmentId($0.url) == $0.id }, "each file's address is its own /api/attachment/<id>")
check(two[safe: 1]?.preview == two[safe: 1].map { $0.url + "/preview" } && two[safe: 0]?.preview == nil,
      "a PDF's picture is its /preview; a text file's preview (its words, not an address) is never taken for one")
check(filesRows[safe: 0].map(Board.roomWords) == "Here are the quotes and the cover draft.", "words beside files are shown")
check(filesRows[safe: 1].map(Board.roomWords) == "", "a post that is only its file's name shows the card, not the name twice (the board's pjWords)")
check(filesRows[safe: 1]?.attachments.count == 1, "a post with one file")
// By hand, not captured: a row carrying only the single `attachment` form (older rows), which the captured page never
// reaches because the Mac now also sends `attachments` (review 1).
let single = Board.parseRoom(Data(#"{"rows":[{"kind":"post","id":"s1","from":"roo","text":"brief.txt","at":"2026-10-24T15:00:00.000Z","attachment":{"id":"0123456789abcdef01234567","name":"brief.txt","type":"text/plain","kind":"text","url":"/api/attachment/0123456789abcdef01234567"}}]}"#.utf8))?.rows ?? []
check(single.first?.attachments.map(\.name) == ["brief.txt"] && single.first.map(Board.roomWords) == "", "the single `attachment` form (made by hand) is read too")
// Control: words that are not exactly the names stay, so the rule cannot hide a real message.
check(Board.roomWords(Board.RoomRow(id: "x", atRaw: nil, at: nil, kind: .post, from: "roo", byPerson: false,
      text: "print-run-quotes.txt is ready", attachments: two.prefix(1).map { $0 })) == "print-run-quotes.txt is ready",
      "CONTROL: words that only mention a file name are kept")
// The bubble draws what roomWords says, never the raw text (review 1: the tests above would pass if it went back).
let roomView = (try? String(contentsOf: here.appendingPathComponent("../../Kosmos/RoomView.swift"), encoding: .utf8)) ?? ""
// Review 2: aimed at the drawing itself, so a revert of either branch goes red.
// Only RoomBubble's own source: Kosmos's lines (drawn elsewhere in the file, never with files) keep their raw text.
let bubbleSource = roomView.components(separatedBy: "struct RoomBubble").dropFirst().first?.components(separatedBy: "\nstruct ").first ?? ""
check(!bubbleSource.isEmpty && bubbleSource.contains("Board.roomWords(row)") && bubbleSource.contains("AttributedString(words)") && bubbleSource.contains("Board.messageText(words)")
      && !bubbleSource.contains("AttributedString(row.text)") && !bubbleSource.contains("Board.messageText(row.text)") && !bubbleSource.contains("Text(row.text)"),
      "RoomBubble shows roomWords, not the stored text")
let filesItems = Board.roomItems(filesRows, now: now, calendar: cal)
check(filesItems.compactMap { if case let .row(r, _, _) = $0.kind { return r.attachments.count } else { return nil } } == [2, 1],
      "premise: the drawn rows are the parsed rows, files and all")

section("a held room (kosmos#7072)")
// room-held.json, reopen-ok.json and reopen-refused.json are the REAL route's answers, captured from a sandboxed board
// held as server.room-held-5800.test.js holds one (agent posts over the room's budget, then the valve).
let heldData = (try? Data(contentsOf: here.appendingPathComponent("room-held.json"))) ?? Data()
check(!heldData.isEmpty, "premise: the captured held page is there")
let heldPage = Board.parseRoom(heldData, names: ["roo": "Roo"])
check(heldPage?.held == true, "a held room reads as held")
let fractional = ISO8601DateFormatter()
fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
check(heldPage?.heldUntil != nil && heldPage?.heldUntil == fractional.date(from: "2026-10-25T00:20:46.531Z"),
      "its until is the time the computer gave: \(String(describing: heldPage?.heldUntil))")
check(page?.held == false && page?.heldUntil == nil, "CONTROL: the open room's captured page is not held and has no until")
let atFive = Board.heldNotice(until: Date(timeIntervalSince1970: 0), time: { _ in "5:20 PM" })
check(atFive == "This room has reached its limit for agent posts, because it kept going back and forth without a result. Your agents' posts will most likely not go through until you post something yourself or reopen the room. Otherwise it should lift on its own by 5:20 PM. An agent whose post was held can still send one summary to wrap things up.",
      "the notice, word for word, with the time it lifts")
check(!Board.heldNotice(until: nil).contains("lift on its own"), "no time given: no lift sentence (the board's NaN rule)")
// The board still says what the PHONE says (review 4: built from the phone's own output, never a second copy, so a
// rewording on either side goes red). The board writes the notice in three JS string pieces, with ' as \'; the lift
// sentence is its own piece; the refusal is two pieces around its reason.
let jsQuote = { (s: String) in s.replacingOccurrences(of: "'", with: "\\'") }
let noticeNoTime = Board.heldNotice(until: nil)
// Guarded, not force-unwrapped (review 5): a rewording that loses a split point turns a named check red.
let splitAt = noticeNoTime.range(of: "without a result.")?.lowerBound, tailAt = noticeNoTime.range(of: " An agent whose")?.lowerBound
let liftPiece = Board.heldNotice(until: Date(), time: { _ in "\u{1}" }).components(separatedBy: "\u{1}").first?
    .components(separatedBy: "reopen the room.").last ?? ""
let refusalBare = Board.reopenRefusal(status: nil, nil) ?? ""
let refusalSplit = refusalBare.range(of: ". Try")?.lowerBound
check(splitAt != nil && tailAt != nil && refusalSplit != nil && !liftPiece.isEmpty, "premise: the phone's notice and refusal still have the board's split points")
var noticePieces: [String] = []
if let splitAt, let tailAt, splitAt < tailAt {
    noticePieces = [String(noticeNoTime[..<splitAt]), String(noticeNoTime[splitAt..<tailAt]), String(noticeNoTime[tailAt...])].map(jsQuote)
}
let refusalPiece = refusalSplit.map { "'" + String(refusalBare[..<$0]) + "' + (because ? ': ' + because : '') + '" + String(refusalBare[$0...]) + "'" } ?? ""
for phrase in noticePieces + ["'" + liftPiece + "'",
               ">" + Board.reopenButton + "</button>", "pjRoomAnnounce('" + Board.reopenedAnnouncement + "')",
               "pjRoomAnnounce('" + Board.heldAnnouncement + "')", refusalPiece] {
    check(!phrase.isEmpty && boardPage.contains(phrase), "the board says what the phone says: \(phrase.prefix(60))")
}
func capturedAnswer(_ name: String) -> (Int?, Data?) {
    guard let d = try? Data(contentsOf: here.appendingPathComponent(name)),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return (nil, nil) }
    return (o["status"] as? Int, o["body"].flatMap { try? JSONSerialization.data(withJSONObject: $0) })
}
let okAnswer = capturedAnswer("reopen-ok.json")
check(okAnswer.0 == 200 && Board.reopenRefusal(status: okAnswer.0, okAnswer.1) == nil, "the computer's reopen answer reads as reopened")
let noAnswer = capturedAnswer("reopen-refused.json")
check(Board.reopenRefusal(status: noAnswer.0, noAnswer.1) == "We could not reopen the room: there is no project by that name. Try again, or post in the room.",
      "a refusal, with the computer's reason, in the board's sentence")
check(Board.reopenRefusal(status: nil, nil) == "We could not reopen the room. Try again, or post in the room.", "no answer at all is a refusal, never a reopen")
check(Board.reopenRefusal(status: 200, Data("<html>sign in</html>".utf8)) != nil, "CONTROL: a 200 that is not the board's answer is never a reopen")
check(Board.reopenRefusal(status: 204, okAnswer.1) == nil && Board.reopenRefusal(status: 302, okAnswer.1) != nil, "any 2xx with ok is a reopen (the board's res.ok); a redirect is not")
// A read started before a reopen landed (numbered 4 when the reopen landed after read 4 started) never writes the hold;
// the reopen's own re-read (5) does. With no reopen yet, every read does.
check(!Board.readMayWriteHold(read: 4, reopenedAt: 4) && !Board.readMayWriteHold(read: 3, reopenedAt: 4)
      && Board.readMayWriteHold(read: 5, reopenedAt: 4) && Board.readMayWriteHold(read: 1, reopenedAt: nil),
      "only a read started after the last reopen may write the hold")
let reopenReq = Board.reopenRequest(mac: URL(string: "https://studio.kosmosplus.com/")!, project: "springcatalogue")
check(reopenReq?.httpMethod == "POST" && reopenReq?.url?.path == "/api/project/springcatalogue/room/reopen", "Reopen is the board's POST /api/project/<id>/room/reopen")
check(Board.reopenRequest(mac: URL(string: "https://studio.kosmosplus.com/")!, project: "../x") == nil, "an id that is not a project's makes no request")

section("the room's working line (kosmos#7080)")
// status-working.json is a REAL GET /api/status row, captured from a sandboxed board for a working agent on the test
// fleet (as server.todayreason-7030.test.js reads one). Its work is unattributed (stateProject null).
let statusData = (try? Data(contentsOf: here.appendingPathComponent("status-working.json"))) ?? Data()
let realRows = (try? JSONSerialization.jsonObject(with: statusData) as? [String: Any])?["agents"] as? [[String: Any]] ?? []
check(realRows.first?["state"] as? String == "working" && realRows.first.map { $0["stateProject"] is NSNull } == true,
      "premise: the captured row is a working agent whose work is unattributed")
let realAgents = Board.parseAgents(statusData) ?? []
check(realAgents.first?.state == "working" && realAgents.first?.stateProject == nil, "a null stateProject reads as unattributed")
check(Board.workingNames(members: ["roo"], agents: realAgents, project: "springcatalogue", spokeSinceStatus: []).isEmpty,
      "an unattributed working agent shows in no room (the board's under-claim, #2882)")
// The same real row with its work attributed (stateProject set here; every other field as the board sent it).
func statusWith(_ rows: [(String, String, String, String?)]) -> [Board.Agent] {
    let base = realRows.first ?? [:]
    let list = rows.map { (session, name, state, project) -> [String: Any] in
        var r = base; r["sessionName"] = session; r["name"] = name; r["state"] = state; r["stateProject"] = project ?? NSNull(); return r
    }
    return Board.parseAgents((try? JSONSerialization.data(withJSONObject: ["agents": list])) ?? Data()) ?? []
}
let fleetNow = statusWith([("roo", "Roo", "working", "springcatalogue"), ("pixel", "Pixel", "working", "springcatalogue"),
                           ("juno", "Juno", "working", "website"), ("tam", "Tam", "idle", "springcatalogue"),
                           ("kit", "Kit", "working", "springcatalogue")])
check(fleetNow.first?.stateProject == "springcatalogue", "stateProject is read from the status row")
let workingNow = Board.workingNames(members: ["kit", "juno", "roo", "tam", "pixel"], agents: fleetNow, project: "springcatalogue", spokeSinceStatus: [])
check(workingNow == ["Kit", "Roo", "Pixel"], "this project's working members, in the room's member order: \(workingNow)")
check(Board.workingNames(members: ["roo", "pixel"], agents: fleetNow, project: "springcatalogue", spokeSinceStatus: ["roo"]) == ["Pixel"],
      "an agent whose post arrived after the status read is left out until the next read (#1150)")
check(Board.workingNames(members: ["ghost"], agents: fleetNow, project: "springcatalogue", spokeSinceStatus: []).isEmpty,
      "a member the status does not list is not working")
check(Board.workingLine([]) == nil, "nobody working: no line")
check(Board.workingLine(["Roo"]) == "Roo is working\u{2026}", "one: is working")
check(Board.workingLine(["Roo", "Pixel"]) == "Roo and Pixel are working\u{2026}", "two: A and B are working")
check(Board.workingLine(["Kit", "Roo", "Pixel"]) == "Kit, Roo, and Pixel are working\u{2026}", "three: the board's serial comma")
// The board still words it this way (paintRoomBusy), so the two cannot drift unseen.
for phrase in ["const WORKING_VERB = '" + Board.workingVerb + "';", "who.length === 2 ? who[0] + ' and ' + who[1]",
               "who.slice(0, -1).join(', ') + ', and ' + who[who.length - 1]", "(working.length === 1 ? ' is ' : ' are ') + WORKING_VERB + '&hellip;",
               ".filter((a) => a && a.state === 'working' && a.stateProject === projectId)"] {
    check(boardPage.contains(phrase), "the board's working line still says: \(phrase.prefix(60))")
}
// Who spoke in a read: nobody on a room's first read; afterwards, an agent with a post the room did not have.
let before = Array(rows.prefix(4))
let speakers = Board.newSpeakers(before: before, fresh: rows)
check(Board.newSpeakers(before: nil, fresh: rows).isEmpty, "a room's first read marks nobody as having just spoken")
check(Array(rows.prefix(4)).filter { $0.kind == .post && $0.from == "cleo" }.count >= 1,
      "premise: cleo spoke before this read")
check(speakers.sorted() == ["eli"], "only agents with a post the room did not have count, never Kosmos's lines or an outside agent's: \(speakers.sorted())")
// A log the computer could not read (ok:false, no rows, at 200) is marked, so it is never a baseline (the board's ok check).
check(Board.parseRoom(Data(#"{"ok":false,"rows":[]}"#.utf8))?.unread == true, "a page the computer could not read is marked unread")
check(Board.parseRoom(Data(#"{"ok":true,"rows":[]}"#.utf8))?.unread == false && Board.parseRoom(Data(#"{"rows":[]}"#.utf8))?.unread == false,
      "a real page (ok true, or no ok at all) is a baseline")
check(boardPage.contains("body.ok !== false"), "premise: the board seeds who spoke only from a page it could read")
// When each spoke against the status read (#1150): strictly after counts; at or before it does not; no read, nobody.
let statusRead = Date(timeIntervalSince1970: 1_800_000_000)
let stamps = ["early": statusRead.addingTimeInterval(-5), "same": statusRead, "late": statusRead.addingTimeInterval(5)]
check(Board.spokeSince(stamps, statusAt: statusRead) == ["late"], "only a post after the status read hides its agent")
check(Board.spokeSince(stamps, statusAt: nil).isEmpty, "no status read yet: nobody is hidden")
// One read's stamping, in the order loadRoom runs it: a first read stamps nobody; a later read the computer could not
// answer leaves the room baselined; a reply in the read after it is stamped (review 4).
let t1 = Date(timeIntervalSince1970: 1_800_000_100), t2 = t1.addingTimeInterval(5), t3 = t2.addingTimeInterval(5)
let sp1 = Board.stampSpeakers([:], baselined: false, before: nil, fresh: before, unread: false, at: t1)
check(sp1.spokeAt.isEmpty && sp1.baselined, "a room's first real read stamps nobody and becomes the baseline")
let sp0 = Board.stampSpeakers([:], baselined: false, before: [], fresh: before, unread: false, at: t1)
check(sp0.spokeAt.isEmpty, "rows shown before any real read are no baseline (an unreadable first read left them empty)")
let sp2 = Board.stampSpeakers(sp1.spokeAt, baselined: sp1.baselined, before: before, fresh: before, unread: true, at: t2)
check(sp2.baselined && sp2.spokeAt.isEmpty, "a later read the computer could not answer keeps the baseline")
let sp3 = Board.stampSpeakers(sp2.spokeAt, baselined: sp2.baselined, before: before, fresh: rows, unread: false, at: t3)
check(sp3.spokeAt == ["eli": t3], "the reply in the read after it is stamped with that read's time: \(sp3.spokeAt)")
let firstUnread = Board.stampSpeakers([:], baselined: false, before: nil, fresh: [], unread: true, at: t1)
check(!firstUnread.baselined, "a first read the computer could not answer is no baseline")
// The names are the bold pieces (the board's <b>), and nothing else is.
let pieces = Board.workingLineParts(["Kit", "Roo", "Pixel"]) ?? []
check(pieces.filter(\.name).map(\.text) == ["Kit", "Roo", "Pixel"] && pieces.filter { !$0.name }.map(\.text) == [", ", ", and ", " are working\u{2026}"],
      "the names, and only the names, are marked to be set bold")
check(Board.workingLineParts([]) == nil, "nobody working: no pieces")
check(boardPage.contains("working.map((a) => '<b>' + esc(a.name) + '</b>')"), "premise: the board sets each working name bold")

section("the @ picker (kosmos#7085)")
// The token being typed, at the end of the box, on the engine's boundary (the board's MENTION_TOKEN).
check(Board.mentionToken("@")?.typed == "", "a bare @ opens the list")
check(Board.mentionToken("Can @ro")?.typed == "ro", "the letters after the @ are what is typed")
check(Board.mentionToken("ask (@mona.lisa_2-b")?.typed == "mona.lisa_2-b", "the key characters: letters, digits, . _ -")
check(Board.mentionToken("mail admin@mara") == nil, "an @ inside a word never opens it (admin@mara)")
check(Board.mentionToken("@roo thanks") == nil, "a space closes the token")
check(Board.mentionToken("hello") == nil && Board.mentionToken("") == nil, "no @: no list")
check(Board.mentionToken("é@ro")?.typed == "ro", "a letter outside the engine's set is a boundary, as in the matcher")
// Who is offered: the project's members in the room's order, by the start of the key or the shown name, without case.
let crew = [Board.ProjectMember(session: "roo", name: "Roo", hasAvatar: false, provider: nil),
            Board.ProjectMember(session: "monalisa", name: "Mona Lisa", hasAvatar: false, provider: nil),
            Board.ProjectMember(session: "pixel", name: "Pixel", hasAvatar: false, provider: nil),
            Board.ProjectMember(session: "", name: "Nobody", hasAvatar: false, provider: nil)]
check(Board.mentionMatches(crew, typed: "").map(\.session) == ["roo", "monalisa", "pixel"], "a bare @ offers everyone with a key, in the room's order")
check(Board.mentionMatches(crew, typed: "MO").map(\.session) == ["monalisa"], "matched by the key's start, without case")
let named = [Board.ProjectMember(session: "dana-2", name: "Writer", hasAvatar: false, provider: nil)]
check(Board.mentionMatches(named, typed: "wri").map(\.session) == ["dana-2"], "matched by the shown name's start")
check(Board.mentionMatches(named, typed: "DANA").map(\.session) == ["dana-2"], "matched by the key's start alone, without case")
check(Board.mentionMatches(crew, typed: "lisa").isEmpty, "the start only, never the middle of a name")
check(Board.mentionMatches(crew, typed: "zed").isEmpty, "nobody matching: an empty list")
// A pick replaces the token with "@<key> ".
check(Board.mentionPick("Can @mo", key: "monalisa") == "Can @monalisa ", "a pick puts the key and a closing space")
check(Board.mentionPick("@", key: "roo") == "@roo ", "a pick from a bare @")
check(Board.mentionPick("no token", key: "roo") == nil, "no token left: nothing is changed")
check(Board.mentionPick("@ro", key: "") == nil, "a member with no key inserts nothing")
check(Board.mentionOpened(0) == Board.mentionNone && Board.mentionOpened(1) == "1 agent matches, above the box."
      && Board.mentionOpened(3) == "3 agents match, above the box.", "what VoiceOver hears when the list opens")
// The board still has these rules and words, so the two cannot drift unseen.
for phrase in [#"const MENTION_TOKEN = /(^|[^A-Za-z0-9._-])@([A-Za-z0-9._-]*)$/;"#,
               "c.key.toLowerCase().startsWith(q) || c.shown.toLowerCase().startsWith(q)",
               "const ins = '@' + c.key + ' ';", "'<div class=\"none\">" + Board.mentionNone + "</div>'"] {
    check(boardPage.contains(phrase), "the board's @ picker still says: \(phrase.prefix(60))")
}

section("files on a room post from the phone (kosmos#7093)")
// The upload: the board's ATTACH_ROOM route, the chat's headers and its five-minute wait.
let roomUp = Board.roomUploadRequest(mac: mac, project: "springcatalogue", name: "price list (v2).pdf", type: "application/pdf")
check(roomUp?.httpMethod == "PUT" && roomUp?.url?.path == "/api/project/springcatalogue/attachment",
      "a room's file goes up with PUT /api/project/<id>/attachment")
check(roomUp?.value(forHTTPHeaderField: "X-Attachment-Name") == "price%20list%20(v2).pdf"
      && roomUp?.value(forHTTPHeaderField: "Content-Type") == "application/pdf" && roomUp?.timeoutInterval == Board.uploadTimeout,
      "the chat's headers: the name as encodeURIComponent, the type, the Mac's five minutes")
check(Board.roomUploadRequest(mac: mac, project: "../x", name: "a", type: "") == nil, "an id that is not a project's uploads nothing")
let agentUp = Board.uploadRequest(mac: mac, session: "dana", name: "a.pdf", type: "")
check(agentUp?.url?.path == "/api/agent/dana/attachment" && agentUp?.value(forHTTPHeaderField: "Content-Type") == "application/octet-stream",
      "the chat's own upload is unchanged")
// Where the files wait: a key no agent's name can be.
check(Board.roomAttachKey("springcatalogue") == "room:springcatalogue" && !Board.isAgentSession(Board.roomAttachKey("springcatalogue")),
      "a room's waiting files never share an agent's key")
// The post carries the ids, as the board's pjPostSend does.
let fileA = Board.Attached(id: "0123456789abcdef01234567", name: "price list.pdf")
let fileB = Board.Attached(id: "89abcdef0123456789abcdef", name: "cover.jpg")
let withFiles = Board.roomPostRequest(mac: mac, project: "springcatalogue", text: "Here they are", attachments: [fileA.id, fileB.id])
let sentBody = withFiles?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(sentBody?["attachments"] as? [String] == [fileA.id, fileB.id] && sentBody?["text"] as? String == "Here they are",
      "a post with files sends their ids in `attachments`")
let plainBody = Board.roomPostRequest(mac: mac, project: "springcatalogue", text: "hi")?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(plainBody != nil && plainBody?["attachments"] == nil, "a post without files sends no `attachments`")
check(Board.roomPostRequest(mac: mac, project: "springcatalogue", text: "x", attachments: ["../etc"]) == nil
      && Board.roomPostRequest(mac: mac, project: "springcatalogue", text: "x", attachments: Array(repeating: fileA.id, count: 11)) == nil,
      "an id that is not a file's, or more than ten, sends nothing")
// Files alone post their names (the board's attach-only fill); words stay as typed.
check(Board.roomPostWords("", files: [fileA, fileB], replyMention: nil) == "price list.pdf, cover.jpg", "files alone: their names")
check(Board.roomPostWords("@dana ", files: [fileA], replyMention: "@dana ") == "@dana price list.pdf", "after a Reply's @name alone: the @name, then the names")
check(Board.roomPostWords("Look at this", files: [fileA], replyMention: nil) == "Look at this", "words typed: the words, as typed")
check(Board.roomPostWords("", files: [], replyMention: nil) == "", "nothing typed and no files: nothing")
// What happens to a post's files after its answer (review 2): kept, they went; refused, back; not confirmed, back unless
// a read already showed it kept.
check(Board.roomFilesAfter(.posted(note: nil), settledByRead: false) == .stayOff, "kept: the files went with it")
check(Board.roomFilesAfter(.refused("no"), settledByRead: false) == .comeBack && Board.roomFilesAfter(.refused("no"), settledByRead: true) == .comeBack,
      "refused: the files come back, even if a read matched someone else's same-words post")
check(Board.roomFilesAfter(.unsure, settledByRead: false) == .comeBack, "not confirmed, nothing showing it: the files come back")
check(Board.roomFilesAfter(.unsure, settledByRead: true) == .stayOff, "not confirmed but a read showed it kept: they went")
// The ten count the files of posts still in the air, so a refused post can never leave more than ten.
check(Board.roomFilesCounted(waiting: 6, uploading: 1, inAir: [[fileA, fileB], [fileA]]) == 10, "waiting, on their way and in the air all count")
check(Board.uploadRefusal(size: nil, waiting: Board.roomFilesCounted(waiting: 7, uploading: 0, inAir: [[fileA, fileB, fileA]])) != nil,
      "seven waiting and three in the air: no more can be added")
for phrase in ["url: () => '/api/project/' + encodeURIComponent(PJ_CURRENT) + '/attachment',",
               "input.value = (onlyMention ? replyMention : '') + attachList(ATTACH_ROOM).map((r) => r.name).join(', ');",
               "pendingIds.length ? { attachments: pendingIds } : {},",
               "aria-label=\"Add a file to this conversation\""] {
    check(boardPage.contains(phrase), "the board's room attach still says: \(phrase.prefix(60))")
}

section("a reply's header goes to its post (kosmos#7101)")
// The board's words and timing, so the two cannot drift unseen.
check(boardPage.contains("', the message this answers. Go to it'") && Board.replyJumpAction == "Go to the message this answers",
      "VoiceOver's action names what the board's header label says it does")
check(Board.replyJumpLabel(who: "Cleo", gist: "Which cover?") == "Cleo: Which cover?, the message this answers. Go to it",
      "the header reads the board's label: who, the gist, then what it does")
check(boardPage.contains("setTimeout(() => row.classList.remove('msg-flash'), \(Int(Board.replyJumpFlash * 1000)));"),
      "the post flashes for as long as the board's does")
check(boardPage.contains("row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });"),
      "premise (the board's own source): it centres the post, and does not animate it for less motion")
// The header reaches the post by its id: the room's items carry each post's own id (Board.roomItems).
let jumpItems = Board.roomItems(rows, now: Date(), calendar: .current)
let missing = rows.filter { r in !jumpItems.contains { $0.id == r.id } }
check(rows.contains { $0.kind == .post } && rows.filter { $0.kind != .kosmos }.allSatisfy { r in jumpItems.contains { $0.id == r.id } },
      "every post or outside message (what a header can name) is an item with its own id; not items: \(missing.map { "\($0.kind)" })")
// The gist: the first line; a files-only post's first file; else "a message" (the board's pjReplyGist fallbacks).
let gistFile = Board.Attachment(id: "0123456789abcdef01234567", name: "report.pdf", type: "", size: nil, kind: "other",
                                url: "/api/attachment/0123456789abcdef01234567", preview: nil)
let gistRow = Board.RoomRow(id: "m1", atRaw: nil, at: nil, kind: .post, from: "cleo", byPerson: false, text: "  Which cover?\nThe blue one")
check(Board.replyGist(gistRow, shownName: "Cleo") == "Which cover?", "the gist is the first line")
let selfNamed = Board.RoomRow(id: "m4", atRaw: nil, at: nil, kind: .post, from: "cleo", byPerson: false, text: "Cleo: which cover?")
check(Board.replyGist(selfNamed, shownName: "Cleo") == "which cover?", "an agent's own leading name is dropped, since the header names it")
let personNamed = Board.RoomRow(id: "m5", atRaw: nil, at: nil, kind: .post, from: nil, byPerson: true, text: "You: which cover?")
check(Board.replyGist(personNamed, shownName: "You") == "You: which cover?", "never from the person's own post")
let outsideNamed = Board.RoomRow(id: "m7", atRaw: nil, at: nil, kind: .external, from: "Cleo", byPerson: false, text: "Cleo: hi")
check(Board.replyGist(outsideNamed, shownName: "Cleo") == "Cleo: hi", "never from an outside message, drawn as written")
let long = Board.RoomRow(id: "m6", atRaw: nil, at: nil, kind: .post, from: "cleo", byPerson: false, text: String(repeating: "a", count: 120) + "\r\nnext")
check(Board.replyGist(long, shownName: "Cleo") == String(repeating: "a", count: 80) + "\u{2026}", "a long first line is cut to 80 with an ellipsis, a CRLF's \\r gone")
var filesOnly = Board.RoomRow(id: "m2", atRaw: nil, at: nil, kind: .post, from: "cleo", byPerson: false, text: "")
filesOnly.attachments = [gistFile]
check(Board.replyGist(filesOnly, shownName: "Cleo") == "report.pdf", "a post of files alone: its first file's name")
var unnamedFile = filesOnly
unnamedFile.attachments = [Board.Attachment(id: "0123456789abcdef01234567", name: "", type: "", size: nil, kind: "other",
                                            url: "/api/attachment/0123456789abcdef01234567", preview: nil)]
check(Board.replyGist(unnamedFile, shownName: "Cleo") == "a file", "a file with no name: a file")
let nothingRow = Board.RoomRow(id: "m3", atRaw: nil, at: nil, kind: .post, from: "cleo", byPerson: false, text: " ")
check(Board.replyGist(nothingRow, shownName: "Cleo") == "a message", "nothing at all: a message")
check(boardPage.contains("return f ? (typeof f.name === 'string' && f.name ? f.name : 'a file') : 'a message';"), "the board's gist still falls back so")
check(boardPage.contains("--gold-deep: #" + String(format: "%06x", Board.replyFlashHex) + ";"), "the flash is the board's --gold-deep")

// kosmos#7096: the room's search, against the board's pjRoomFilterRows.
do {
    func post(_ id: String, _ from: String?, _ text: String) -> Board.RoomRow {
        Board.RoomRow(id: id, atRaw: nil, at: nil, kind: .post, from: from, byPerson: from == nil, text: text)
    }
    var refused = Board.RoomRow(id: "r1", atRaw: nil, at: nil, kind: .kosmos, from: nil, byPerson: false,
                                text: "Dana tried to post here and Kosmos stopped it: The room is held.")
    refused.refusal = Board.Refusal(key: "dana", who: "Dana", doing: "reply", because: "the room is held")
    var external = Board.RoomRow(id: "x1", atRaw: nil, at: nil, kind: .external, from: "zoe@elsewhere", byPerson: false, text: "Hello from outside")
    external.externalAgent = false
    let rows = [post("p1", nil, "Ship the catalogue"), post("p2", "dana", "Pages 1 to 8 done"), post("p3", "ghost", "An id with no name"),
                Board.RoomRow(id: "v1", atRaw: nil, at: nil, kind: .kosmos, from: nil, byPerson: false, text: "Paused: too many turns"),
                Board.RoomRow(id: "n1", atRaw: nil, at: nil, kind: .kosmos, from: nil, byPerson: false, text: "Dana joined the room"),
                refused, external]
    let names = ["dana": "Dana Price"]
    func ids(_ q: String) -> [String] { Board.roomFilter(rows, name: { names[$0] }, query: q).map(\.id) }
    check(ids("  ") == ["p1", "p2", "p3", "v1", "n1", "r1", "x1"], "room search: no words keeps every row, in order")
    check(ids("YOU") == ["p1"], "room search: the person's post is named you, in any case")
    check(ids("price") == ["p2"], "room search: an agent's post by its shown name; a note naming Dana by first name only does not match the surname")
    check(ids("dana") == ["p2", "n1", "r1"], "room search: an agent's name, a note's text and a refusal's writer")
    check(ids("ghost") == ["p3"], "room search: an agent with no shown name is matched by its id")
    check(ids("too many") == ["v1"], "room search: a valve band by its reason, and it has no writer")
    check(ids("held") == ["r1"], "room search: a refusal by why")
    check(ids("reply") == ["r1"], "room search: a refusal by what it tried")
    check(ids("kosmos stopped") == [], "room search: not by the sentence drawn for a refusal")
    check(ids("zoe") == ["x1"], "room search: an outside message by its sender")
    check(ids(" ship ") == ["p1"], "room search: the words are trimmed")
    // A Kosmos line has no writer even if one ever carried a sender (the board's valve rule: "the guarantee must live
    // here", not in the route stripping `from`).
    let valveFrom = Board.RoomRow(id: "v2", atRaw: nil, at: nil, kind: .kosmos, from: "dana", byPerson: false, text: "Paused")
    check(Board.roomFilter([valveFrom], name: { names[$0] }, query: "dana").isEmpty, "room search: a Kosmos line is never matched by a sender")
    var unnamed = refused
    unnamed.refusal = Board.Refusal(key: "eli", who: nil, doing: nil, because: "no seat")
    check(Board.roomFilter([unnamed], name: { _ in nil }, query: "eli").count == 1, "room search: a refusal with no shown name, by its writer's id")
    check(Board.roomFilter([external], name: { $0 == "zoe@elsewhere" ? "Zoe Park" : nil }, query: "park").count == 1,
          "room search: an outside message by a name for its sender when one is known (as pjNameOf)")
    // The search runs before refusals fold: two refusals for one reason, searched by one writer, stay one line by that
    // writer, not a folded line naming both.
    var r2 = refused
    r2.refusal = Board.Refusal(key: "eli", who: "Eli", doing: nil, because: "the room is held")
    var r3 = refused
    r3.refusal = Board.Refusal(key: "dana", who: "Dana", doing: nil, because: "the room is held")
    let r2b = Board.RoomRow(id: "r2", atRaw: nil, at: nil, kind: .kosmos, from: nil, byPerson: false,
                            text: Board.refusedLine(["Eli"], doing: nil, because: "the room is held"))
    var eliRow = r2b; eliRow.refusal = r2.refusal
    let r3b = Board.RoomRow(id: "r3", atRaw: nil, at: nil, kind: .kosmos, from: nil, byPerson: false,
                            text: Board.refusedLine(["Dana"], doing: nil, because: "the room is held"))
    var danaRow = r3b; danaRow.refusal = r3.refusal
    let folded = Board.roomItems(Board.roomFilter([eliRow, danaRow], name: { _ in nil }, query: "eli"), now: Date(), calendar: .current)
    let lines = folded.compactMap { item -> String? in if case let .row(row, _, _) = item.kind { return row.text } else { return nil } }
    check(lines.count == 1 && lines[0].contains("Eli") && !lines[0].contains("Dana"),
          "room search: filtered before refusals fold, so one writer's refusal is not folded with another's")
    // The control for the line above: unfiltered, the same two do fold into one line naming both.
    let both = Board.roomItems([eliRow, danaRow], now: Date(), calendar: .current).compactMap { item -> String? in
        if case let .row(row, _, _) = item.kind { return row.text } else { return nil }
    }
    check(both.count == 1 && both[0].contains("Eli") && both[0].contains("Dana"), "room search: the same two refusals unfiltered fold into one line")
    // The board's rules this mirrors are still the board's (a change there turns this red).
    check(boardPage.contains("const who = m.kind === 'valve' ? ''") && boardPage.contains("m.operator === true ? 'you'")
          && boardPage.contains("(m.kind === 'refused') ? ((m.doing ? m.doing + ' ' : '') + (m.because || ''))")
          && boardPage.contains(Board.roomPartialLine)
          && boardPage.contains("const PJ_HIDDEN_BY_SEARCH = '" + Board.roomHiddenBySearch + "'"),
          "room search: the board's pjRoomFilterRows and partial-read line still say what the phone mirrors")
    // A reply's jump to a post the search hides.
    let allRows = [post("o1", "dana", "the original"), post("r9", nil, "a reply")]
    let kept = [allRows[1]]
    check(Board.roomJumpHidden("o1", shown: kept, all: allRows, searching: true), "room jump: an original the search hides is hidden")
    check(!Board.roomJumpHidden("o1", shown: allRows, all: allRows, searching: true), "room jump: an original among the matches is not")
    check(!Board.roomJumpHidden("o1", shown: kept, all: allRows, searching: false), "room jump: not while not searching")
    check(!Board.roomJumpHidden("gone", shown: kept, all: allRows, searching: true), "room jump: a post the room does not hold is not called hidden")
    // Which rooms' rows came from a read that could not read all of the room.
    let partial = Board.partialRooms([], project: "a", partial: true)
    check(partial == ["a"], "room partial: a landed read that could not read all of the room marks it")
    check(Board.partialRooms(partial, project: "a", partial: false) == [], "room partial: a whole read clears it")
    check(Board.partialRooms(partial, project: "b", partial: false) == ["a"], "room partial: another room's read leaves it")
}

section("the provider tally on a project row (kosmos#7114)")
func member(_ s: String, _ provider: String?) -> Board.ProjectMember { Board.ProjectMember(session: s, name: s, hasAvatar: false, provider: provider) }
let tally = Board.providerTally([member("a", "Gemini"), member("b", "Claude"), member("c", "Gemini (Google subscription)"), member("d", nil),
                                 member("e", "zeta"), member("f", "Claude"), member("g", ""), member("h", "acme"), member("i", "OpenAI")])
check(tally.map(\.word) == ["Claude", "GPT", "Gemini", "zeta", "acme"], "the board's order, then others as they came: \(tally.map(\.word))")
check(tally.map(\.n) == [2, 1, 2, 1, 1], "counted per word: both Gemini families as one, members with no provider left out")
check(tally.map(\.mark) == ["MarkClaude", "MarkOpenAI", "MarkGemini", nil, nil], "the board's marks; a chip for a provider without one")
// Every row of the table, each with its word and mark (review 1: three rows were never exercised).
let everyRow = Board.providerTally(Board.providerTallyOrder.reversed().map { member($0.provider, $0.provider) })
check(everyRow.map(\.word) == ["Claude", "GPT", "Gemini", "Grok", "Meta", "Qwen"], "every provider's word, in the board's order: \(everyRow.map(\.word))")
check(everyRow.map(\.mark) == ["MarkClaude", "MarkOpenAI", "MarkGemini", "MarkGrok", "MarkMeta", "MarkQwen"], "every provider's own mark")
check(Board.providerTally([member("z", "Anthropic")]).first?.mark == "MarkClaude", "Anthropic wears Claude's mark, as on the board")
check(tally.first { $0.word == "acme" }?.initial == "A", "a provider without a mark: its initial, as the board's chip")
check(Board.providerTallySpoken(tally) == ", 2 Claude, 1 GPT, 2 Gemini, 1 zeta, 1 acme", "what VoiceOver hears after the count")
// The wrapping layout's line breaking: an entry moves on when it and the spacing before it would pass the width.
check(Board.flowLines([30, 30, 30], width: 100, spacing: 8) == [[0, 1], [2]], "30+8+30+8+30 = 106 over 100: the third moves on")
check(Board.flowLines([30, 30, 24], width: 100, spacing: 8) == [[0, 1, 2]], "exactly 100: one line")
check(Board.flowLines([120, 10], width: 100, spacing: 8) == [[0], [1]], "an entry wider than the row takes a line of its own")
check(Board.TallyEntry(word: "  ", mark: nil, n: 1).initial == "?", "a blank provider: the board's ?")
// The phone's pick-to-mark pairs are the board's PROVIDER_MARK_KEY (review 4).
let markKeyName = ["MarkClaude": "claude", "MarkOpenAI": "openai", "MarkGemini": "gemini", "MarkGrok": "xai", "MarkMeta": "meta", "MarkQwen": "qwen"]
let keyBlock = boardPage.range(of: "const PROVIDER_MARK_KEY = {").flatMap { s in boardPage.range(of: "};", range: s.upperBound..<boardPage.endIndex).map { String(boardPage[s.upperBound..<$0.lowerBound]) } } ?? ""
// And the other way: every board key whose mark the phone carries is mapped on the phone too.
let boardKeyPairs = keyBlock.components(separatedBy: CharacterSet(charactersIn: ",\n")).compactMap { part -> (String, String)? in
    let bits = part.components(separatedBy: ":").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '")) }
    guard bits.count == 2, !bits[0].isEmpty, !bits[0].contains("/"), !bits[0].contains("*") else { return nil }
    return (bits[0], bits[1])
}
let carried = Set(markKeyName.values)
for (key, mark) in boardKeyPairs where carried.contains(mark) {
    check(markKeyName[Board.providerMarkAsset[key] ?? ""] == mark, "the board's \(key) -> \(mark) is on the phone too")
}
for (pick, asset) in Board.providerMarkAsset.sorted(by: { $0.key < $1.key }) {
    check(keyBlock.contains("\(pick): '\(markKeyName[asset] ?? "?")'"), "the board's PROVIDER_MARK_KEY maps \(pick) to \(markKeyName[asset] ?? "?")")
}
// Breaking again at the reported width replays the same lines (review 5's measured case: fractional widths, no width).
let fuzzCase = [26.119318709913866, 49.06327076039232, 58.943043076048966, 24.890714868242927, 79.20508911955574, 57.18406969193589, 35.76352088355623]
let once = Board.flowLayout(fuzzCase, width: .infinity, spacing: 8)
check(once.lines.count == 1 && Board.flowLines(fuzzCase, width: once.widths.max() ?? 0, spacing: 8) == once.lines,
      "placed at the width it reported, the tally keeps its lines")
let twoLines = Board.flowLayout([30, 30, 30], width: 100, spacing: 8)
check(twoLines.widths == [68, 30] && Board.flowLines([30, 30, 30], width: twoLines.widths.max()!, spacing: 8).count >= 2,
      "each line's width as compared")
check(Board.flowLines([], width: 100, spacing: 8).isEmpty && Board.flowLines([5, 5], width: .infinity, spacing: 8) == [[0, 1]],
      "nothing: no lines; no width given: one line")
check(Board.providerTally([member("d", nil)]).isEmpty && Board.providerTallySpoken([]) == "", "nobody with a provider: no tally, nothing said")
// The board still counts so, with these words.
// The phone's table written as the board's PJ_TALLY rows, so any field of any row drifting fails (review 1).
let tallyRows = Board.providerTallyOrder.map { "['\($0.provider)', '\($0.pick)', '\($0.word)']" }
check(boardPage.contains(tallyRows[0...2].joined(separator: ", ") + ",") && boardPage.contains(tallyRows[3...6].joined(separator: ", ") + ","),
      "the board's PJ_TALLY is the phone's order, picks and words")
// The board's whole table, row for row (review 2: a row added to it could not fail the substring checks).
if let start = boardPage.range(of: "const PJ_TALLY = ["), let end = boardPage.range(of: "];", range: start.upperBound..<boardPage.endIndex) {
    let block = boardPage[start.upperBound..<end.lowerBound].replacingOccurrences(of: "\n", with: " ")
    let boardRows = block.components(separatedBy: "[").dropFirst().map { "[" + ($0.components(separatedBy: "]").first ?? "") + "]" }
    check(boardRows == tallyRows, "the board's PJ_TALLY, row for row: \(boardRows.count) rows")
} else { check(false, "the board's PJ_TALLY was not found") }
check(boardPage.contains("esc(', ' + rows.map(([word, c]) => c.n + ' ' + word).join(', '))"), "the board says it so to a screen reader")
// Each mark is the board's own first-run mark (the template ones drawn in the text colour, so currentColor is black).
let markKeys = ["MarkClaude": "claude", "MarkOpenAI": "openai", "MarkGemini": "gemini", "MarkGrok": "xai", "MarkMeta": "meta", "MarkQwen": "qwen"]
for (asset, key) in markKeys.sorted(by: { $0.key < $1.key }) {
    let file = repo.appendingPathComponent("ios/Kosmos/Assets.xcassets/\(asset).imageset/\(key).svg")
    let ours = ((try? String(contentsOf: file, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let start = boardPage.range(of: "data-pmark=\"\(key)\" role=\"img\"").flatMap { boardPage.range(of: "<svg", range: $0.upperBound..<boardPage.endIndex) }
    let end = start.flatMap { boardPage.range(of: "</svg>", range: $0.lowerBound..<boardPage.endIndex) }
    let theirs = start.flatMap { s in end.map { String(boardPage[s.lowerBound..<$0.upperBound]) } } ?? "missing"
    check(!ours.isEmpty && ours == (key == "qwen" ? theirs : theirs.replacingOccurrences(of: "currentColor", with: "#000000")),
          "\(asset) is the board's \(key) mark")
}
check(Set(Board.providerMarkAsset.values) == Set(markKeys.keys), "every mark the tally names is in the asset catalog")

extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
