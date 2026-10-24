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

extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
