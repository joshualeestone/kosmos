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
// kosmos#7421 build 11 (Mona Lisa): the Projects sort button says Sort: <order>, and looks pressed off its default only.
check(Board.sortButtonLabel(Board.projectSortLabel(.az)) == "Sort: Name A to Z", "the Projects sort button says Sort: <order>, as Agents does")
check(Board.projectSortDefault == .newest && Board.ProjectSort(rawValue: "") == nil, "Projects' default is Newest first, and an unknown saved order is not a ProjectSort (the view falls back to the default)")
check(Board.sortProjects([a, b, c], .za).map { $0.name } == ["gamma", "beta", "Alpha"], "name Z to A")
check(Board.ProjectSort.allCases.map(Board.projectSortLabel) == ["Newest first", "Oldest first", "Name A to Z", "Name Z to A"], "the board's four labels, no update order")
let orphan = proj(name: "Orphan", parent: "gone")
let underArchived = proj(name: "Child", parent: "old")
let archivedParent = proj(archived: true, name: "Old")
check(Board.projectTree([orphan, underArchived, archivedParent], sort: .az).map { "\($0.depth):\($0.project.name)" } == ["0:Child", "0:Orphan"],
      "a child whose parent is gone or archived sits at the top level, never disappears")
let x = proj(name: "X", parent: "y", id: "x"), y = proj(name: "Y", parent: "x", id: "y")
check(Board.projectTree([x, y], sort: .az).map { $0.project.name } == ["X", "Y"], "a cycle shows each project once and hides none")

section("the tree's connector lines and the faces (kosmos#7269)")
// Root has two children (the second with its own child), then a second root with none.
let rt = proj(name: "Root", id: "rt"), k1 = proj(name: "Kid one", parent: "rt", id: "k1"), k2 = proj(name: "Kid two", parent: "rt", id: "k2")
let gk = proj(name: "Grandkid", parent: "k2", id: "gk"), solo = proj(name: "Solo", id: "solo")
let lined = Board.projectTree([solo, gk, k2, rt, k1], sort: .az)
check(lined.map { "\($0.depth):\($0.project.name):\($0.lastKid ? "L" : "-")\($0.hasKids ? "K" : "-")" }
      == ["0:Root:-K", "1:Kid one:--", "1:Kid two:LK", "2:Grandkid:L-", "0:Solo:--"],
      "the last of each parent's children stops its line; a parent with children shown under it starts one: \(lined.map { "\($0.depth):\($0.project.name):\($0.lastKid ? "L" : "-")\($0.hasKids ? "K" : "-")" })")
check(lined.map { $0.through } == [[], [], [], [], []], "Kid two is the last child, so no line runs past its grandchild")
let k3 = proj(name: "Kid zed", parent: "rt", id: "k3")
let ladder = Board.projectTree([solo, gk, k2, rt, k1, k3], sort: .az)
check(ladder.map { "\($0.project.name):\($0.through)" } == ["Root:[]", "Kid one:[]", "Kid two:[]", "Grandkid:[1]", "Kid zed:[]", "Solo:[]"],
      "a grandchild carries its grandparent's line on to Kid zed: \(ladder.map { "\($0.project.name):\($0.through)" })")
// Four levels: A > B (then a later sibling B2) > C (then C2) > D. D carries level 1 (B's line to B2) and level 2 (C's line to C2).
let la = proj(name: "A", id: "la"), lb = proj(name: "B", parent: "la", id: "lb"), lb2 = proj(name: "B2", parent: "la", id: "lb2")
let lc = proj(name: "C", parent: "lb", id: "lc"), lc2 = proj(name: "C2", parent: "lb", id: "lc2"), ld = proj(name: "D", parent: "lc", id: "ld")
let deep = Board.projectTree([ld, lc2, lc, lb2, lb, la], sort: .az)
check(deep.map { "\($0.project.name):\($0.through)" } == ["A:[]", "B:[]", "C:[1]", "D:[1, 2]", "C2:[1]", "B2:[]"],
      "every ancestor line that runs on is carried, at every depth: \(deep.map { "\($0.project.name):\($0.through)" })")
check(Board.projectTree([orphan, underArchived, archivedParent], sort: .az).allSatisfy { !$0.lastKid && !$0.hasKids },
      "a child lifted to the top level (parent gone or archived) draws no line and its old parent starts none")
check(Board.projectTree([x, y], sort: .az).allSatisfy { !$0.lastKid }, "a cycle's rows, both at the top, draw no line")
check(Board.faceBubbles(0) == (0, 0) && Board.faceBubbles(3) == (3, 0) && Board.faceBubbles(10) == (10, 0), "up to ten: every face, no +")
check(Board.faceBubbles(12) == (9, 3) && Board.faceBubbles(15) == (9, 6) && Board.faceBubbles(11) == (9, 2), "a crowd: nine faces and the rest as +N (Josh's +3 for twelve)")
check(Board.faceBubbles(5, room: 4) == (3, 2) && Board.faceBubbles(4, room: 4) == (4, 0) && Board.faceBubbles(3, room: 2) == (1, 2),
      "less room (large text, a deep row): fewer faces, the +N grows, the total always adds up")
check(Board.faceBubbles(-1) == (0, 0) && Board.faceBubbles(5, room: 0) == (0, 5), "nonsense in: never a negative or a lost member")

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

section("By project's key (kosmos#7421)")
// kosmos#7342 (Mona Lisa): a Mentions-only or Muted project (the board's notify, #7210) is quiet: its row's bubble is grey,
// since its count adds nothing to the Projects tab. "all" or none is not.
let notifyRows = Board.parseProjects(Data(#"{"projects":[{"id":"m","name":"M","notify":"muted"},{"id":"n","name":"N","notify":"mentions"},{"id":"a","name":"A","notify":"all"},{"id":"x","name":"X"}]}"#.utf8))?.projects ?? []
check(notifyRows.map(\.quiet) == [true, true, false, false], "a muted or mentions-only project is quiet; all and none are not")
// kosmos#7489: the native New project form: a name is enough; one POST /api/projects; the board's answer read honestly.
let npMac = URL(string: "https://studio.kosmosplus.com")!
check(!NewProject.canCreate(NewProject.Draft(name: "   ")) && NewProject.canCreate(NewProject.Draft(name: "Lease")), "a name (not blank) is enough to create")
let npReq = NewProject.request(mac: npMac, draft: NewProject.Draft(name: " Henderson lease ", description: ""))
let npBody = npReq?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(npReq?.httpMethod == "POST" && npReq?.url?.path == "/api/projects" && npBody?["name"] as? String == "Henderson lease" && npBody?["description"] == nil,
      "Create sends the trimmed name to the board's own route, and no empty description")
check(NewProject.request(mac: npMac, draft: NewProject.Draft(name: "")) == nil, "nothing is sent without a name")
check(NewProject.result(sent: true, status: 200, body: Data(#"{"id":"henderson-lease","project":{}}"#.utf8)) == .made(id: "henderson-lease"), "made: the new project's id")
check(NewProject.result(sent: true, status: 400, body: Data(#"{"error":"A project with that name already exists."}"#.utf8)) == .refused("A project with that name already exists."), "a refusal is the board's own sentence")
check(NewProject.result(sent: true, status: 0, body: nil) == .unknown && NewProject.result(sent: true, status: 502, body: nil) == .unknown, "no answer, or a server error with no sentence, may have made it: unknown")
check(NewProject.result(sent: false, status: 0, body: nil) == .refused(NewProject.fallback), "nothing sent: certainly not made")
let firsts = Board.firstProjects(Board.parseProjects(Data(#"{"projects":[{"id":"z","name":"Zeta","agents":[{"sessionName":"a"}]},{"id":"b","name":"beta","agents":[{"sessionName":"a"},{"sessionName":"c"}]}]}"#.utf8)))
let agentsSrc = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/AgentsView.swift"), encoding: .utf8)) ?? ""
let clientSrc = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/BoardClient.swift"), encoding: .utf8)) ?? ""
// Wiring guards (source checks, not behaviour): the order reaches the list with the person's stars, re-sorted only where
// the list re-sorts, so starred agents stay on top and rows never move under a thumb (review 1 blocker).
check(clientSrc.contains("Board.agentOrder(rows, sort: agentSort, projects: sortProjects, stars: known)") && clientSrc.contains("Board.agentOrder(agents, sort: sort, projects: projects, stars: shownStars)"), "kosmos#7421: the chosen order is applied with the stars, on a re-sort and when picked")
check(agentsSrc.contains("client.setAgentSort(sortChoice, projects: projectNames)") && agentsSrc.contains("ForEach(client.agents)"), "kosmos#7421: the Agents list shows the client's order and hands it the person's pick")
// kosmos#7034 wiring guards (source checks): the row stars by a swipe, a long press and a VoiceOver action, and shows it.
check(agentsSrc.contains(".swipeActions(edge: .leading, allowsFullSwipe: true) { starButton(agent) }") && agentsSrc.contains(".contextMenu { starButton(agent) }") && agentsSrc.contains("starred: client.isStarred(agent.session)"),
      "kosmos#7034: a row is starred by a swipe (VoiceOver offers it) or a long press, and shows its star")
// kosmos#7419: the long-press sheet. The seven quick reactions in Mona Lisa's order, each one the board's own (the 80 the
// phone keeps as ComposerExtras.emoji, PJ_EMOJI); every message long-press opens the sheet, and no reaction menu is left.
check(Board.quickReactions == ["👍", "❤️", "🔥", "😂", "👀", "✅", "🎉"], "kosmos#7419: the sheet's seven quick reactions, Josh's three first")
let composerLogicSrc = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/ComposerLogic.swift"), encoding: .utf8)) ?? ""
check(!composerLogicSrc.isEmpty && Board.quickReactions.allSatisfy { composerLogicSrc.contains("\"\($0)\"") }, "kosmos#7419: each quick reaction is one of the board's 80 (More offers the same list)")
let sheetChat = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/ChatView.swift"), encoding: .utf8)) ?? ""
// kosmos#7034 build 11 (Mona Lisa): a visible star in the chat header, outline or gold, the same save as the row swipe.
check(sheetChat.contains("Image(systemName: starred ? \"star.fill\" : \"star\")") && sheetChat.contains("await client.toggleStar(agent.session)") && sheetChat.contains("await client.readStarsIfUnknown()") && sheetChat.contains("starred ? \"Unstar \\(shown.name)\" : \"Star \\(shown.name)\""),
      "kosmos#7034: the chat header has a star, gold when starred, saved as the row swipe saves it")
let sheetRoom = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/RoomView.swift"), encoding: .utf8)) ?? ""
let sheetSrc = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/ComposerExtras.swift"), encoding: .utf8)) ?? ""
// kosmos#7419 build 11 (Mona Lisa): the pressed message stays lit above the chat's own dim (the system's is off at the
// small height), cut out on the bubble's own shape in every bubble kind; nothing (no ring) is drawn on the bubble.
let litSrcs = ["ChatView.swift", "ChatFiles.swift", "ChatChoices.swift", "RoomView.swift"].map { (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/" + $0), encoding: .utf8)) ?? "" }
check(litSrcs.allSatisfy { $0.contains(".overlay(PressedBubbleMark())") }, "kosmos#7419: every bubble kind marks where it is for the lit dim")
check(sheetSrc.contains("presentationBackgroundInteraction(voiceOver ? .disabled : .enabled(upThrough: small))") && sheetSrc.contains("transformAnchorPreference(key: PressedBubbleKey.self") && sheetSrc.contains("FillStyle(eoFill: true)") && sheetSrc.contains("close: { target = nil }"),
      "kosmos#7419: at the small height (VoiceOver off) the chat draws its own dim with the pressed bubble cut out, the visible area joining the rows' preference, and a tap on it closes the sheet")
check(!sheetSrc.contains("PressedRing") && litSrcs.allSatisfy { !$0.contains("PressedRing") }, "kosmos#7419: no ring is drawn on the pressed message (gold is only a reaction already the person's)")
check(sheetChat.components(separatedBy: ".messageActions(").count - 1 == 2 && sheetRoom.components(separatedBy: ".messageActions(").count - 1 == 1,
      "kosmos#7419: the chat bubble, the files bubble and the room's post open the sheet on a long press")
check(!sheetChat.contains("Button(\"React with \" + e)") && !sheetRoom.contains("Button { react(\"👍\") }"), "kosmos#7419: no reaction menu is left beside the sheet")
check(sheetSrc.contains("ForEach(ComposerExtras.emoji, id: \\.self) { e in cell(e) }") && sheetSrc.contains("count: 8)")
      && sheetSrc.contains("\"More reactions\"") && sheetSrc.contains("\"Copy text\"") && sheetSrc.contains("highPriorityGesture(LongPressGesture(minimumDuration: 0.5)"),
      "kosmos#7419: More shows the board's 80 eight to a row; Copy text; a half-second press that a lifted finger cannot turn into a tap")
check(sheetChat.components(separatedBy: ".messageActionsHost()").count - 1 == 1 && sheetRoom.components(separatedBy: ".messageActionsHost()").count - 1 == 1
      && sheetSrc.contains(".presentationDetents([small(t), .large], selection: $detent)") && sheetSrc.contains("onDismiss: { let run = afterClose"),
      "review 1: one sheet per chat and per room; More resizes through a chosen detent; Reply runs once the sheet has gone")
check(sheetChat.contains(".accessibilityElement(children: .ignore)\n        // kosmos#7419 review 3") && sheetChat.contains(".messageActionsAccessibility("),
      "review 3: VoiceOver gets Message actions on the chat bubble's own element, after the one that drops its children's")
let filesSrc = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/ChatFiles.swift"), encoding: .utf8)) ?? ""
check(filesSrc.contains("if let sheet, let openSheet { Button(\"Message actions\") { openSheet(sheet) } }") && sheetChat.contains("sheet: MessageActionTarget("),
      "review 4: on a message with files, VoiceOver offers Message actions on each card (the container's own is never offered)")
check(firsts["a"] == "beta" && firsts["c"] == "beta" && firsts["z"] == nil, "an agent's first project is its project names A to Z, without case")

section("an agent's notification opens its chat natively (kosmos#7418)")
// Josh 10-27: a message notification opened the board's old agent page. Every kind the board sends that names an agent
// (engine/phonenotify.js KINDS: needs_you, replied, ready, and a posted one the extension could not place in a room).
for kind in ["needs_you", "replied", "ready", "posted"] {
    let push: [AnyHashable: Any] = ["kind": kind, "address": "Studio.KosmosPlus.com", "session": "eli", "agent": "Eli", "id": "x"]
    check(PushBridge.agentToOpen(fromNotification: push, coordinator: coordinator) == PushBridge.AgentTarget(host: "studio.kosmosplus.com", session: "eli", name: "Eli"), "a \(kind) push names its computer and agent")
}
var nameless: [AnyHashable: Any] = ["kind": "replied", "address": "studio.kosmosplus.com", "session": "eli-2", "agent": "An agent"]
check(PushBridge.agentToOpen(fromNotification: nameless, coordinator: coordinator)?.name == "Eli-2", "the board's \"An agent\" stand-in reads as the session instead")
nameless["agent"] = nil
check(PushBridge.agentToOpen(fromNotification: nameless, coordinator: coordinator)?.name == "Eli-2", "no name at all: the session")
var badAgent = roomPush; badAgent["kind"] = "replied"; badAgent["session"] = "../eli"
check(PushBridge.agentToOpen(fromNotification: badAgent, coordinator: coordinator) == nil, "a session the board cannot have opens nothing natively")
var farAgent = roomPush; farAgent["kind"] = "replied"; farAgent["address"] = "evil.example.com"
check(PushBridge.agentToOpen(fromNotification: farAgent, coordinator: coordinator) == nil, "an address outside Kosmos+ opens nothing")
let eli = PushBridge.AgentTarget(host: "studio.kosmosplus.com", session: "eli", name: "Eli")
check(PushBridge.agentOpening(eli, shownAddress: "Studio.KosmosPlus.com", coordinator: coordinator) == .native(eli), "the computer the app shows: the native chat (address without case)")
check(PushBridge.agentOpening(eli, shownAddress: "home.kosmosplus.com", coordinator: coordinator) == .board(URL(string: "https://studio.kosmosplus.com/?tab=detail&agent=eli")!), "CONTROL: another computer: that computer's board page for the agent, as before")
check(PushBridge.agentOpening(eli, shownAddress: nil, coordinator: coordinator) == .board(URL(string: "https://studio.kosmosplus.com/?tab=detail&agent=eli")!), "no computer shown yet: the board page")
if let r = manager.range(of: "PushBridge.roomToOpen("), let a = manager.range(of: "PushBridge.agentToOpen("), let b = manager.range(of: "PushBridge.boardURL(") {
    check(r.lowerBound < a.lowerBound && a.lowerBound < b.lowerBound, "the tap asks about the room, then the agent's chat, and only then the board page")
} else { check(false, "the tap handler asks about the room, the agent and the board") }
check(content.contains("PushBridge.agentOpening(target, shownAddress: board.switcherShown"), "ContentView decides through agentOpening, against the computer the app shows")
let agentsSource = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/AgentsView.swift"), encoding: .utf8)) ?? ""
check(agentsSource.contains(".onChange(of: agentRequest) { _ in openRequested() }") && agentsSource.contains("openRequested()   // kosmos#7418"), "the Agents tab opens a request when it arrives and when the tab first shows (a cold launch)")
// Josh 20:43: a Splinter notice must never open Shredder (neighbours by name): the session is matched whole.
let splinterPush: [AnyHashable: Any] = ["kind": "replied", "address": "studio.kosmosplus.com", "session": "claudebot", "agent": "Splinter"]
check(PushBridge.agentToOpen(fromNotification: splinterPush, coordinator: coordinator)?.session == "claudebot", "a notice opens exactly the agent that sent it (its session, whole)")
check(agentsSource.contains("client.agents.first(where: { $0.session == target.session })"), "the Agents tab finds the notice's agent by its whole session, never a position or a prefix")
// Review 2: the agentToOpen and agentOpening checks above test behaviour; the source checks below are wiring guards
// only (that the view code still calls the tested logic the way it did), not proof of what the screen does.
var unknownKind = roomPush; unknownKind["kind"] = "someday"; unknownKind["projectId"] = nil
check(PushBridge.agentToOpen(fromNotification: unknownKind, coordinator: coordinator) == nil, "review 1: a kind the board does not send yet opens as before, never a chat by accident")
check(content.contains("shownAddress: board.switcherShown ?? kept?.address"), "review 1: on a cold launch (nothing shown yet, or the Face ID lock up) the kept computer decides, so the tap still opens the chat")
let chatSource = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/ChatView.swift"), encoding: .utf8)) ?? ""
// kosmos#7420 diagnostic (source checks): the record holds numbers and event names, never what was written. Every trace
// line is checked for the fields that carry words (a message's text, a name, the draft).
let traceLines = chatSource.components(separatedBy: "\n").filter { $0.contains("Self.trace(") }
// Review 1: an allow-list, not a ban-list. Every value a trace line puts in the record is one of these numbers, yes/no
// flags or fixed words; anything new (an id, a session, a name) fails here until it is judged and added.
let allowedInTrace: Set<String> = ["atBottom", "earlier.filling", "earlier.loading", "earlier.open", "earlier.rows.count", "endSeen",
    "endVisible", "fresh.olderCount", "fresh.rows.count", "Int(diagKeyboard)", "Int(now.height)", "Int(now.width)", "mine",
    "personScrolling", "phase == .active ? \"active\" : phase == .background ? \"background\" : \"inactive\"", "pinned", "settledAtEnd", "why"]
var tracedValues: [String] = []
for l in traceLines {
    var rest = Substring(l)
    while let open = rest.range(of: "\\(") {
        var depth = 1, i = open.upperBound
        while i < rest.endIndex, depth > 0 { if rest[i] == "(" { depth += 1 } else if rest[i] == ")" { depth -= 1 }; if depth > 0 { i = rest.index(after: i) } }
        tracedValues.append(String(rest[open.upperBound..<min(i, rest.endIndex)]))
        rest = i < rest.endIndex ? rest[rest.index(after: i)...] : ""
    }
}
let strayValues = tracedValues.filter { !allowedInTrace.contains($0) }
check(traceLines.count >= 10 && !tracedValues.isEmpty && strayValues.isEmpty,
      "kosmos#7420: the diagnostic records only allowed numbers and flags (\(tracedValues.count) values; not allowed: \(strayValues))")
check(!chatSource.contains("keepAnchor scrollTo \\(id)"), "review 1: no message id in the record")
check(chatSource.contains("diagThreadAt = Date(); diagEverDrew = !onScreen.isEmpty") && !chatSource.contains(".onChange(of: thread == nil)"),
      "review 5: the never-drawn clock starts when the list first exists, not in an onChange that never sees its own creation")
check(chatSource.contains("guard visible, scenePhase == .active, !searchMode, onScreen.isEmpty") && chatSource.contains("if onScreen.isEmpty { diagTick &+= 1 }")
      && !chatSource.contains(".onChange(of: onScreen.isEmpty)"), "review 1: the check runs only for the chat on screen, and never makes the chat redraw per row")
check(chatSource.contains("if diagRing.count > 80") && chatSource.contains("onScreen.isEmpty, !endVisible || neverDrew, !topVisible, count > 0, thread != nil") && chatSource.contains("ShareLink(item: report"),
      "kosmos#7420: a bounded record, the blank check, and a share the person chooses (nothing sent by itself)")
check(chatSource.contains("Button { infoOpen = true } label: { title"), "kosmos#7424: the DM header's name and status open the info page, as the (i) button does")
let roomSource = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/RoomView.swift"), encoding: .utf8)) ?? ""
check(roomSource.contains("let low = reduceMotion ? 0.35 : 0.45, half = (reduceMotion ? 1.6 : 1.1) / 2") && roomSource.contains(".delay(Double(i) * 0.16), value: up)") && roomSource.contains(".offset(y: up && !reduceMotion ? -4 : 0)"), "kosmos#7427: the chat's dots (WaveDots) are the board's wave (1.1 s, 0.16 s apart, 4 pt rise; Reduce Motion 1.6 s, no rise)")
check(roomSource.contains("withTransaction(t) { up = false }"), "kosmos#7427 review 3: the wave restarts when the line scrolls back into view")
check(chatSource.contains("#else\n            WaveDots()") && !chatSource.contains("repeatForever(autoreverses: true)) { bright = true }") && agentsSource.contains("WorkingDots(color: Palette.pillWord(pill))"), "kosmos#7427: the chat's working line and the Agents pill use the wave, not a pulse in unison")
check(agentsSource.contains(".id(agent.session)"), "review 1: a notice for another agent while a chat is open starts that chat afresh, not the old one renamed")
if let a = content.range(of: ".onChange(of: pushManager.accountChanges)"), let c = content.range(of: "agentRequest = nil; roomRequest = nil") {
    check(a.lowerBound < c.lowerBound && content.distance(from: a.lowerBound, to: c.lowerBound) < 400, "review 1: a sign-out drops a chat or room a notice asked for")
} else { check(false, "review 1: the account-change handler drops pending notice requests") }

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

section("an addable refusal's Add (kosmos#7111)")
// A refusal row as the room route sends one (kind refused, its from, why, and addable).
let refusedPage = Board.parseRoom(Data(#"{"rows":[{"kind":"refused","at":"2026-10-25T09:00:00.000Z","from":"juno","because":"juno is not on this project","addable":true,"key":"k1"},{"kind":"refused","at":"2026-10-25T09:01:00.000Z","from":"tam","because":"the room is held","key":"k2"}]}"#.utf8),
                                   names: ["juno": "Juno", "tam": "Tam"])
let addableRow = refusedPage?.rows.first { $0.refusal?.key == "juno" }
let plainRow = refusedPage?.rows.first { $0.refusal?.key == "tam" }
check(addableRow != nil && plainRow != nil, "premise: both refusals parse")
if let addableRow, let plainRow {
    check(Board.addMemberShown(addableRow, members: ["kit"], live: ["juno", "kit"]), "addable, not a member, still on this computer: Add")
    check(!Board.addMemberShown(addableRow, members: ["kit", "juno"], live: ["juno", "kit"]), "already a member: no Add (it goes away once added)")
    check(!Board.addMemberShown(addableRow, members: ["kit"], live: ["kit"]), "an agent this computer no longer has: no Add (never a ghost)")
    check(!Board.addMemberShown(plainRow, members: ["kit"], live: ["tam", "kit"]), "a refusal that adding would not end: no Add")
}
check(Board.addMemberLabel("Juno") == "Add Juno to this project" && Board.addedMemberLine("Juno") == "Added Juno to this project.",
      "the board's words for the button and what VoiceOver hears")
let addReq = Board.addMemberRequest(mac: mac, project: "springcatalogue", agent: "juno")
check(addReq?.httpMethod == "POST" && addReq?.url?.path == "/api/project/springcatalogue/agent/juno", "Add posts to the board's route")
check(Board.addMemberRequest(mac: mac, project: "../x", agent: "juno") == nil && Board.addMemberRequest(mac: mac, project: "springcatalogue", agent: "a/b") == nil,
      "nothing sent for a bad project or agent")
check(Board.addMemberRefusal(status: 200, Data("{}".utf8)) == nil, "added: no refusal")
check(Board.addMemberRefusal(status: 200, Data("<html>sign in to the wifi</html>".utf8)) == "We could not change that project.",
      "a 200 this build cannot read is never taken for an add")
check(Board.addMemberRefusal(status: 409, Data(#"{"error":"that agent is already on this project"}"#.utf8)) == "That agent is already on this project.",
      "refused: the route's reason as a sentence")
check(Board.addMemberRefusal(status: nil, nil) == "We could not change that project.", "no answer: the board's fallback")
for phrase in ["'\">Add ' + esc(nameR)\n        + ' to this project</button>", "pjRoomAnnounce('Added ' + ((p && pjNameOf(p, who)) || who) + ' to this project.');",
               "fetch('/api/project/' + encodeURIComponent(PJ_CURRENT) + '/agent/' + encodeURIComponent(who), { method: 'POST' });",
               "const add = m.addable === true && !onIt && live", "'We could not change that project.'"] {
    check(boardPage.contains(phrase), "the board's Add still says: \(phrase.prefix(60))")
}

section("the provider marks the phone carries are the board's own (kosmos#7114; nothing draws them since #7269 until the agent page, #7267, planned)")
// Each mark is the board's own first-run mark (the template ones drawn in the text colour, so currentColor is black).
let markKeys = ["MarkClaude": "claude", "MarkOpenAI": "openai", "MarkGemini": "gemini", "MarkGrok": "xai", "MarkMeta": "meta", "MarkQwen": "qwen"]
for (asset, key) in markKeys.sorted(by: { $0.key < $1.key }) {
    let file = repo.appendingPathComponent("ios/Kosmos/Assets.xcassets/\(asset).imageset/\(key).svg")
    let ours = ((try? String(contentsOf: file, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let start = boardPage.range(of: "data-pmark=\"\(key)\" role=\"img\"").flatMap { boardPage.range(of: "<svg", range: $0.upperBound..<boardPage.endIndex) }
    let end = start.flatMap { boardPage.range(of: "</svg>", range: $0.lowerBound..<boardPage.endIndex) }
    let theirs = start.flatMap { s in end.map { String(boardPage[s.lowerBound..<$0.upperBound]) } } ?? "missing"
    check(!ours.isEmpty && ours == theirs.replacingOccurrences(of: "currentColor", with: "#000000"),
          "\(asset) is the board's \(key) mark")
}

section("the room's needs-you notice (kosmos#7106)")
// projects-needs.json is a REAL projects answer, captured from a sandboxed engine and then trimmed to the fields the phone
// reads (engine/projects.list with real fleet
// cards): cleo asked a question about this project; eli's card says working but Kosmos keeps restarting it (a crash loop
// in a live room); dana is working; farah is idle.
let needsList = Board.parseProjects((try? Data(contentsOf: here.appendingPathComponent("projects-needs.json"))) ?? Data())
let needsProject = needsList?.projects.first
check(needsProject?.members.map(\.needsYouHere) == ["question", nil, "crash_loop", nil], "the route's own count for this project is read")
let notice = needsProject.flatMap { Board.needsNotice($0.members, names: ["cleo": "Cleo", "eli": "Eli"]) }
check(notice?.head == "2 agents need you on this project.", "the head counts the route's members: \(notice?.head ?? "none")")
check(notice?.rows.map(\.session) == ["cleo", "eli"], "a row per counted member, in the project's order; eli counts though his card says working")
check(notice?.rows.first?.why == "Waiting for your answer." && notice?.rows.first?.act == "Answer" && notice?.rows.first?.key == "question:Which cover photo?",
      "a question: the board's words, Answer, and the engine's key")
check(notice?.rows.last?.why == "Kosmos keeps restarting it, and it keeps stopping within a couple of minutes." && notice?.rows.last?.act == "Open",
      "a crash loop: the board's words and Open")
check(notice?.rows.first?.name == "Cleo" && notice?.namedInHead == nil, "names from the status card; several, so no row is named in the head")
let one = Board.needsNotice([Board.ProjectMember(session: "cleo", name: "cleo", hasAvatar: false, provider: nil, needsYouHere: "question",
                                                  needsYouKey: nil, because: "Which cover photo?")], names: ["cleo": "Cleo"])
check(one?.head == "Cleo needs you on this project." && one?.namedInHead == "cleo", "one: the head names it, and its row does not again")
check(one?.rows.first?.key == "question:Which cover photo?", "no key from the route: built as the engine builds it")
let longEmoji = String(repeating: "😀", count: 200)
let longKeyed = Board.needsNotice([Board.ProjectMember(session: "cleo", name: "cleo", hasAvatar: false, provider: nil, needsYouHere: "question",
                                                        needsYouKey: nil, because: longEmoji)])
check(longKeyed?.rows.first?.key == "question:" + Board.utf16Prefix(longEmoji, 300) && longKeyed?.rows.first?.key.utf16.count == 9 + 300,
      "a long question's built key: 300 UTF-16 units, as the engine's cut")
let keyed = Board.needsNotice([Board.ProjectMember(session: "cleo", name: "cleo", hasAvatar: false, provider: nil, needsYouHere: "question",
                                                    needsYouKey: "question:Which cover?", because: "Something newer")])
check(keyed?.rows.first?.key == "question:Which cover?", "the route's own key is what Dismiss sends, never one built again")
let parsedKeyed = Board.parseProjects(Data(#"{"projects":[{"id":"p1","name":"P","agents":[{"sessionName":"cleo","needsYouHere":"question","needsYouKey":"question:X","because":"Y"}]}]}"#.utf8))
check(parsedKeyed?.projects.first?.members.first?.needsYouKey == "question:X", "the route's needsYouKey is read")
let unknownReason = Board.needsNotice([Board.ProjectMember(session: "x", name: "X", hasAvatar: false, provider: nil, needsYouHere: "something_new")])
check(unknownReason?.rows.first?.why == "Kosmos needs you to look at it." && unknownReason?.rows.first?.key == "something_new", "a reason this build does not know: the board's other")
check(Board.needsNotice([Board.ProjectMember(session: "x", name: "X", hasAvatar: false, provider: nil)]) == nil, "nobody counted: no notice")
// Dismiss: the board's route and body.
let dismiss = Board.needsDismissRequest(mac: mac, project: "springcatalogue", agent: "cleo", reason: "question:Which cover photo?")
let dismissBody = dismiss?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
check(dismiss?.httpMethod == "POST" && dismiss?.url?.path == "/api/project/springcatalogue/needs-dismiss"
      && dismissBody == ["agent": "cleo", "reason": "question:Which cover photo?"], "Dismiss posts {agent, reason} to the board's route")
check(Board.needsDismissRequest(mac: mac, project: "../x", agent: "cleo", reason: "q") == nil
      && Board.needsDismissRequest(mac: mac, project: "springcatalogue", agent: "cleo", reason: "") == nil, "nothing sent for a bad project or no reason")
// The board still words and routes it so.
// Both ways: every reason the board words is one the phone words (a new one would otherwise get "other" silently).
if let start = boardPage.range(of: "const PJ_NEEDS_WHY = {"), let end = boardPage.range(of: "};", range: start.upperBound..<boardPage.endIndex) {
    let block = String(boardPage[start.upperBound..<end.lowerBound])
    let boardReasons = block.components(separatedBy: "\n").compactMap { line -> String? in
        let t = line.trimmingCharacters(in: .whitespaces)
        guard let colon = t.firstIndex(of: ":"), t.contains("['") else { return nil }
        return String(t[..<colon])
    }
    check(Set(boardReasons) == Set(Board.needsWhy.keys), "the phone words exactly the board's reasons: \(boardReasons.sorted())")
} else { check(false, "the board's PJ_NEEDS_WHY was not found") }
for (reason, words) in Board.needsWhy {
    check(boardPage.contains("\(reason): ['\(words.why)', '\(words.act)']"), "the board's PJ_NEEDS_WHY still says \(reason)")
}
for phrase in ["' needs you' : n + ' agents need you';", "const head = rows.length ? who + ' on this project.' : who + '.';",
               "fetch('/api/project/' + encodeURIComponent(project) + '/needs-dismiss', {", "body: JSON.stringify({ agent: who, reason: btn.dataset.pnReason }),",
               "'Dismissed. It comes back if something changes.'", "'Kosmos could not dismiss that. Try again in a moment.'"] {
    check(boardPage.contains(phrase), "the board's notice still says: \(phrase.prefix(60))")
}
check(boardPage.contains(Board.needsDismissed) && boardPage.contains(Board.needsDismissFailed), "the phone's sentences are the board's")
check(Board.needsDismissSaid(status: 200) == Board.needsDismissed && Board.needsDismissSaid(status: 204) == Board.needsDismissed,
      "taken: the board's Dismissed sentence")
check(Board.needsDismissSaid(status: 400) == Board.needsDismissFailed && Board.needsDismissSaid(status: nil) == Board.needsDismissFailed,
      "refused or no answer: the board's could-not sentence")
// The fallback key is 300 UTF-16 units, as the engine's slice, never splitting an emoji.
let emojiQuestion = String(repeating: "😀", count: 200)
check(Board.utf16Prefix(emojiQuestion, 300).utf16.count == 300 && Board.utf16Prefix(emojiQuestion, 301).utf16.count == 300,
      "a key cut by UTF-16 units, an emoji never split in half")
// Before #7108 the board sliced 300 units; with it, keyWords also drops a trailing half of an emoji, as utf16Prefix does.
check(boardPage.contains("'question:' + String(m.because || '').slice(0, 300)") || boardPage.contains("'question:' + keyWords(m.because)"),
      "the board builds the fallback key from the first 300 units of the question")

section("the line above a sealed or waiting shared room (kosmos#7137)")
// The gate, as the board's fedGateMode: hidden until live (or staging), shown to a Kosmos+ member, and on staging
// shown while membership is unknown (absent or not a real bool), never when it is a real false.
let fgT: Any = NSNumber(value: true), fgF: Any = NSNumber(value: false), fgOne: Any = NSNumber(value: 1)
check(Board.fedGateMode(sourceChannel: "stable", federationLive: fgF, kosmosPlus: fgT) == "hidden", "gate: not live on a stable build is hidden, member or not")
check(Board.fedGateMode(sourceChannel: nil, federationLive: nil, kosmosPlus: fgT) == "hidden", "gate: nothing said is hidden")
check(Board.fedGateMode(sourceChannel: "stable", federationLive: fgT, kosmosPlus: fgT) == "show", "gate: live and a member shows")
check(Board.fedGateMode(sourceChannel: "stable", federationLive: fgT, kosmosPlus: fgF) == "signup", "gate: live, not a member, is the sign-up gate")
check(Board.fedGateMode(sourceChannel: "stable", federationLive: fgT, kosmosPlus: nil) == "signup", "gate: live, membership unknown, on a stable build is the sign-up gate (fail-safe)")
check(Board.fedGateMode(sourceChannel: "staging", federationLive: fgF, kosmosPlus: nil) == "show", "gate: staging, membership unknown, shows")
check(Board.fedGateMode(sourceChannel: "staging", federationLive: nil, kosmosPlus: fgF) == "signup", "gate: staging, a real false, is the sign-up gate")
check(Board.fedGateMode(sourceChannel: "stable", federationLive: fgOne, kosmosPlus: fgT) == "hidden", "gate: federationLive 1 is not true (the board's === true)")
check(Board.fedGateMode(sourceChannel: "stable", federationLive: fgT, kosmosPlus: fgOne) == "signup", "gate: kosmos_plus 1 is not true (the board's === true)")
check(Board.fedGateMode(sourceChannel: "staging", federationLive: nil, kosmosPlus: "false") == "show", "gate: staging, the string \"false\" is unknown, not false (the board's !== false)")
// The board's own function, so a change to its rule turns these red (the phone's lines above follow it, line for line).
for line in ["  const staging = sourceChannel === 'staging';", "  const live = federationLive === true || staging;", "  if (!live) return 'hidden';",
             "  if (kosmosPlus === true) return 'show';", "  const unknownPlus = kosmosPlus !== true && kosmosPlus !== false;",
             "  if (staging && unknownPlus) return 'show';", "  return 'signup';",
             "function fedShow() {\n  return document.documentElement.getAttribute('data-fed-ui') === 'show';",
             "  const mode = fedGateMode(data.sourceChannel, data.federationLive, data.kosmos_plus);"] {
    check(boardPage.contains(line), "the board's gate still reads: \(line.prefix(70))")
}
// Read off one status answer, as the board stamps it from the poll.
check(Board.fedShown(fromStatus: Data(#"{"sourceChannel":"stable","federationLive":true,"kosmos_plus":true,"agents":[]}"#.utf8)), "status: live and a member, shown")
check(!Board.fedShown(fromStatus: Data(#"{"sourceChannel":"stable","federationLive":true,"kosmos_plus":false,"agents":[]}"#.utf8)), "status: not a member, not shown")
check(!Board.fedShown(fromStatus: Data(#"{"agents":[]}"#.utf8)), "status: an older Mac that says nothing, not shown")
check(!Board.fedShown(fromStatus: Data("not json".utf8)), "status: an unreadable answer, not shown")
// The read: the board's route, the project in its query, nothing else.
let ocMac = URL(string: "https://mac.example/")!
check(Board.ownCompareRequest(mac: ocMac, project: "book-launch")?.url?.absoluteString == "https://mac.example/api/federation/own-compare?project=book-launch"
      && Board.ownCompareRequest(mac: ocMac, project: "book-launch")?.httpMethod == "GET", "own-compare: a GET of the board's route for this project")
check(Board.ownCompareRequest(mac: ocMac, project: "a&b=c") == nil && Board.ownCompareRequest(mac: ocMac, project: "") == nil, "own-compare: no request for an id that is not one")
check(boardPage.contains("fetch('/api/federation/own-compare?project=' + encodeURIComponent(project), o)"), "the board reads the same route")
// The answer: a code is a non-empty string (the board's `o.code`), pending only when exactly true.
check(Board.parseOwnCompare(Data(#"{"code":"4821-0937","pending":false}"#.utf8)) == Board.OwnCompare(hasCode: true, pending: false), "answer: a code, not waiting")
check(Board.parseOwnCompare(Data(#"{"code":"4821-0937","pending":true}"#.utf8)) == Board.OwnCompare(hasCode: true, pending: true), "answer: a code, waiting")
check(Board.parseOwnCompare(Data(#"{"code":null,"pending":true}"#.utf8))?.hasCode == false, "answer: a null code is no code")
check(Board.parseOwnCompare(Data(#"{"code":"","pending":false}"#.utf8))?.hasCode == false, "answer: an empty code is no code (falsy, as the board's)")
check(Board.parseOwnCompare(Data(#"{"code":"x","pending":"true"}"#.utf8))?.pending == false, "answer: pending \"true\" is not true")
check(Board.parseOwnCompare(Data(#"{"error":"Federation is off."}"#.utf8))?.hasCode == false, "answer: an error body reads as no code")
check(Board.parseOwnCompare(Data("[]".utf8)) == Board.OwnCompare(hasCode: false, pending: false), "answer: a JSON array is an answer with no code (the board's typeof === 'object')")
check(Board.parseOwnCompare(Data("\"x\"".utf8)) == nil && Board.parseOwnCompare(Data("not json".utf8)) == nil, "answer: a bare string or not JSON is a miss")
// The line: only while the shared-room UI shows and this computer has a code; waiting or sealed by `pending`.
let sealedC = Board.OwnCompare(hasCode: true, pending: false), waitingC = Board.OwnCompare(hasCode: true, pending: true)
check(Board.ownSealLine(sealedC, fedShown: true) == Board.ownSealedLine, "line: a code, not waiting, says sealed")
check(Board.ownSealLine(waitingC, fedShown: true) == Board.ownWaitingLine, "line: a code, waiting, says waiting to be let in")
check(Board.ownSealLine(sealedC, fedShown: false) == nil && Board.ownSealLine(waitingC, fedShown: false) == nil, "line: none while the shared-room UI is not shown")
check(Board.ownSealLine(Board.OwnCompare(hasCode: false, pending: true), fedShown: true) == nil, "line: none without a code, waiting or not")
check(Board.ownSealLine(nil, fedShown: true) == nil, "line: none before a read lands, or after one that failed")
// The words: the board's two sentences said from the phone. The board's "this computer" is the person's computer here,
// and "under Members" is on your computer's board, as the phone's other lines name it (the phone has no Members code
// section). Nothing else changes.
check(boardPage.contains("o.pending ? 'This computer is waiting to be let in. The code to compare is under Members.' : 'This room is sealed on this computer. The code to compare is under Members.'"),
      "the board picks its sentence by pending, in these words")
func phoneSaid(_ board: String) -> String {
    board.replacingOccurrences(of: "This computer is", with: "Your computer is").replacingOccurrences(of: "on this computer.", with: "on your computer.")
        .replacingOccurrences(of: "is under Members.", with: "is on your computer's board, under Members.")
}
check(Board.ownSealedLine == phoneSaid("This room is sealed on this computer. The code to compare is under Members."), "the sealed sentence is the board's, said from the phone")
check(Board.ownWaitingLine == phoneSaid("This computer is waiting to be let in. The code to compare is under Members."), "the waiting sentence is the board's, said from the phone")
check(!Board.ownSealedLine.contains("this computer") && !Board.ownWaitingLine.contains("this computer"), "the phone never calls the Mac \"this computer\"")
// The keep rule, as the board's fedOwnLoad: an answer replaces; a failed read keeps the last through two misses.
let kept1 = Board.ownCompareAfter(nil, answer: sealedC)
check(kept1 == Board.OwnCompareKept(compare: sealedC, missed: 0), "keep: an answer is kept, no misses")
let miss1 = Board.ownCompareAfter(kept1, answer: nil), miss2 = Board.ownCompareAfter(miss1, answer: nil), miss3 = Board.ownCompareAfter(miss2, answer: nil)
check(miss1.compare == sealedC && miss2.compare == sealedC, "keep: one and two failed reads keep the line")
check(miss3.compare == nil && miss3.missed == 3, "keep: the third failed read in a row drops it")
check(Board.ownCompareAfter(miss2, answer: waitingC) == Board.OwnCompareKept(compare: waitingC, missed: 0), "keep: an answer after misses replaces and resets the count")
check(Board.ownCompareAfter(kept1, answer: Board.OwnCompare(hasCode: false, pending: false)).compare?.hasCode == false, "keep: an answer with no code drops the line at once")
check(Board.ownCompareAfter(nil, answer: nil) == Board.OwnCompareKept(compare: nil, missed: 1), "keep: a first read that fails shows nothing")
check(boardPage.contains("const missed = mine ? 0 : (prev ? (prev.missed || 0) + 1 : 1);")
      && boardPage.contains("const code = mine ? (typeof mine.code === 'string' ? mine.code : null) : (prev && missed < 3 ? prev.code : null);")
      && boardPage.contains("const pending = mine ? mine.pending === true : !!(prev && missed < 3 && prev.pending);")
      && boardPage.contains("return res.ok && body && typeof body === 'object' ? body : null;"),
      "the board keeps its code through two misses, and any 2xx object is an answer")
check(boardPage.contains("line.hidden = !(below && o && o.code && o.project === PJ_CURRENT && fedShow());"), "the board's condition: a code, this project, the UI shown")
check(boardPage.contains(".ownseal-phone { font: var(--text-callout) var(--font-ui); color: var(--label-3);"), "the board's line is callout in the third label colour")
// The drawing and the wiring, in the app's own source.
let roomBody = roomView.components(separatedBy: "var body: some View {").dropFirst().first ?? ""
let sealDraw = "if let seal = store.ownSealLine(project.id) {\n                Text(seal).font(.callout).foregroundColor(Palette.tertiary)"
check(roomBody.contains("if searchMode { searchBar }\n            // kosmos#7137") && roomBody.contains(sealDraw)
      && (roomBody.range(of: sealDraw)?.lowerBound ?? roomBody.endIndex) < (roomBody.range(of: "            thread\n")?.lowerBound ?? roomBody.startIndex),
      "the room draws the line in callout and the third colour, above the conversation")
let projectsSource = (try? String(contentsOf: here.appendingPathComponent("../../Kosmos/ProjectsView.swift"), encoding: .utf8)) ?? ""
check(projectsSource.contains("guard client.fedShown else { ownCompare[project] = nil; return }"), "the store reads own-compare only while the UI shows, and forgets it otherwise")
check(projectsSource.contains("guard same(epoch), ownSeq[project] == seq else { return }"), "only the newest read for a project writes (the board's FED_OWN_SEQ)")
check(projectsSource.contains("let read = answer.flatMap { (200...299).contains($0.1.statusCode) ? Board.parseOwnCompare($0.0) : nil }\n        ownCompare[project] = Board.ownCompareAfter(ownCompare[project], answer: read)"),
      "a 2xx JSON answer replaces, anything else is a miss under the keep rule")
check(projectsSource.contains("func enterOwnCompare(_ project: String) { ownCompare[project] = nil; ownSeq[project, default: 0] += 1; ownAsk[project] = nil }")
      && roomView.contains("visible = true\n            store.enterOwnCompare(project.id)"), "entering the room starts the line empty and drops a read in the air (the board's fedOwnReset)")
check(projectsSource.contains("Task { await self.loadOwnCompare(project) }   // kosmos#7137: with each room read, landed or not (at most every 10 s)\n        let epoch = client.chatEpoch\n        roomReads[project, default: 0] += 1"),
      "the read is asked with each room read, before it is sent, so a failing room still drops a stale line (review 2)")
// The pace (review 3: tested as behaviour, not as source): the board's fedOwnTick. Never while a read is in flight,
// then only once the last read finished more than 10 s ago (answered or missed), and at once the first time.
let t0 = Date(timeIntervalSince1970: 1_700_000_000)
check(Board.ownShouldAsk(nil, now: t0, every: 10), "pace: the first ask is at once")
check(!Board.ownShouldAsk(Board.OwnAsk(inFlight: true, doneAt: nil), now: t0, every: 10), "pace: never while the first read is in flight")
check(!Board.ownShouldAsk(Board.OwnAsk(inFlight: true, doneAt: t0), now: t0.addingTimeInterval(60), every: 10),
      "pace: never while a read is in flight, however long ago the last finished (a slow answer is never dropped by a new ask)")
check(!Board.ownShouldAsk(Board.OwnAsk(inFlight: false, doneAt: t0), now: t0.addingTimeInterval(5), every: 10), "pace: not 5 s after the last finished")
check(!Board.ownShouldAsk(Board.OwnAsk(inFlight: false, doneAt: t0), now: t0.addingTimeInterval(10), every: 10), "pace: not at exactly 10 s (the board's >)")
check(Board.ownShouldAsk(Board.OwnAsk(inFlight: false, doneAt: t0), now: t0.addingTimeInterval(10.5), every: 10), "pace: again once 10 s have passed since it finished")
check(Board.ownShouldAsk(Board.OwnAsk(inFlight: false, doneAt: nil), now: t0, every: 10), "pace: asked again at once when nothing has finished and nothing is in flight")
// A slow route: answers take 12 s while the room reads every 5 s. With the pace above every read lands (none is
// cut short by the next ask), so three misses in a row drop the line, as the board's.
var simAsk: Board.OwnAsk? = nil, simKept: Board.OwnCompareKept? = Board.OwnCompareKept(compare: sealedC, missed: 0), simLanding: Date? = nil, simAsked = 0, simLastAsk: Date? = nil, simMinGap = Double.infinity
for tick in 0..<40 {
    let now = t0.addingTimeInterval(Double(tick) * 5)
    if let l = simLanding, now >= l { simAsk = Board.OwnAsk(inFlight: false, doneAt: now); simKept = Board.ownCompareAfter(simKept, answer: nil); simLanding = nil }
    if Board.ownShouldAsk(simAsk, now: now, every: 10) {
        if let l = simLastAsk { simMinGap = min(simMinGap, now.timeIntervalSince(l)) }
        simLastAsk = now; simAsk = Board.OwnAsk(inFlight: true, doneAt: simAsk?.doneAt); simLanding = now.addingTimeInterval(12); simAsked += 1
    }
}
check(simKept?.compare == nil && (simKept?.missed ?? 0) >= 3, "pace: a 12 s route still lands every read, so a stale line drops at the third miss")
check(simAsked > 3 && simMinGap > 12 + 10 - 5, "pace: asked again only once a read has landed and 10 s more have passed (never two asks closer than that)")
check(Board.ownShouldAsk(Board.OwnAsk(inFlight: false, doneAt: t0), now: t0.addingTimeInterval(-60), every: 10), "pace: a clock set back since the last read is due (review 4)")
check(boardPage.contains("const due = !o || o.project !== PJ_CURRENT || (!document.hidden && Date.now() - (o.at || 0) > FED_OWN_REFRESH_MS);")
      && boardPage.contains("if (PJ_CURRENT && due && !asking && FED_OWN_BUSY !== PJ_CURRENT) fedOwnLoad(PJ_CURRENT);")
      && boardPage.contains("const FED_OWN_REFRESH_MS = 10000;") && projectsSource.contains("static let ownEvery: TimeInterval = 10"),
      "the board's pace: due 10 s after the last read finished, never while one is asking")
// The store's use of it (the store is not compiled here, so its wiring is read from its source).
check(projectsSource.contains("guard Board.ownShouldAsk(ownAsk[project], now: Date(), every: Self.ownEvery) else { return }\n        ownAsk[project, default: Board.OwnAsk()].inFlight = true")
      && projectsSource.contains("guard same(epoch), ownSeq[project] == seq else { return }\n        ownAsk[project] = Board.OwnAsk(inFlight: false, doneAt: Date())"),
      "the store asks only when the pace allows, marks the read in flight, and stamps it done when it lands")
check(projectsSource.contains("ownSeq[project, default: 0] += 1; ownAsk[project] = nil }"), "entering the room asks at once")
check(projectsSource.contains("func ownSealLine(_ project: String) -> String? { Board.ownSealLine(ownCompare[project]?.compare, fedShown: client.fedShown) }"),
      "the drawn line is gated on the client's fedShown (review 2: a store that ignored the gate passed)")
check(projectsSource.contains("needsFailed = [:]; ownCompare = [:]; ownSeq = [:]; ownAsk = [:]"), "another account or computer forgets the reads")
check(projectsSource.contains("    @discardableResult\n    func loadRoom(_ project: String) async -> Bool {"), "loadRoom keeps its @discardableResult (review 1: a function placed between them took it)")
let clientSource = (try? String(contentsOf: here.appendingPathComponent("../../Kosmos/BoardClient.swift"), encoding: .utf8)) ?? ""
check(clientSource.contains("fedShown = Board.fedShown(fromStatus: data)") && clientSource.contains("projectsUnread = nil\n        fedShown = false"),
      "the client takes the gate from each status read and forgets it with the Mac")

section("an outside row shown while waiting to be let in (kosmos#7130)")
// Outside rows as the room route sends them (server.js, #7129): `unverified` is present only when exactly true. The
// phone counts only a real JSON true, as the board's `m.unverified === true`.
let unvPage = Board.parseRoom(Data(#"{"rows":[{"kind":"external","id":"u1","from":"Ivy","fromKind":"person","text":"unchecked","at":"2026-10-25T10:00:00.000Z","external":true,"unverified":true},{"kind":"external","id":"u2","from":"Ivy","fromKind":"person","text":"plain","at":"2026-10-25T10:01:00.000Z","external":true},{"kind":"external","id":"u3","from":"Ivy","fromKind":"agent","text":"false","at":"2026-10-25T10:02:00.000Z","external":true,"unverified":false},{"kind":"external","id":"u4","from":"Ivy","fromKind":"agent","text":"a string","at":"2026-10-25T10:03:00.000Z","external":true,"unverified":"true"},{"kind":"external","id":"u5","from":"Ivy","fromKind":"agent","text":"a number","at":"2026-10-25T10:04:00.000Z","external":true,"unverified":1}]}"#.utf8), names: [:])
let unvRows = Dictionary((unvPage?.rows ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
check(unvRows.count == 5 && unvRows.values.allSatisfy { $0.kind == .external }, "premise: all five outside rows parse")
check(unvRows["u1"]?.unverified == true, "unverified: true marks the row")
check(unvRows["u2"]?.unverified == false, "a row without the field is unmarked")
check(unvRows["u3"]?.unverified == false, "unverified: false is unmarked")
check(unvRows["u4"]?.unverified == false, "the string \"true\" is not true (the board's === true)")
check(unvRows["u5"]?.unverified == false, "the number 1 is not true (the board's === true)")
// The phone draws the board's own sentence, under the words, only for an outside row the board marks.
check(boardPage.contains("(m.unverified === true ? '<div class=\"msg-ext-unv\">" + Board.unverifiedLine + "</div>' : '')"),
      "the board draws the same sentence, under the same exactly-true condition, in .msg-ext-unv")
check(boardPage.contains(".msg-ext-unv { font: .75rem var(--font-ui); color: var(--label-2);"), "the board's line is 12 px in its secondary label colour (the phone: .caption, secondary)")
check(boardPage.contains(".msg-ext-tag, .msg-ext-unv,"), "the board's Copy leaves the line out (the phone's Copy takes the row's words only)")
// Review 1: the drawing itself, in RoomBubble's own source, so deleting or restyling the phone's line goes red: only on
// a marked outside row, in .caption and the secondary colour, after the words and before the file cards, and Copy
// still takes the row's words.
let unvDraw = "if row.kind == .external && row.unverified {\n                Text(Board.unverifiedLine).font(.caption).foregroundColor(Palette.secondary)\n                    .fixedSize(horizontal: false, vertical: true)\n                    .padding(.top, -2)"
let unvAt = bubbleSource.range(of: unvDraw)
let wordsAt = bubbleSource.range(of: "AttributedString(words)")
let filesAt = bubbleSource.range(of: "if !row.attachments.isEmpty {")
check(unvAt != nil, "RoomBubble draws the line on a marked outside row, in .caption and the secondary colour, wrapping, 2 pt under the words")
if let unvAt, let wordsAt, let filesAt {
    check(wordsAt.upperBound < unvAt.lowerBound && unvAt.upperBound < filesAt.lowerBound, "the line sits under the words, before any file cards")
}
check(bubbleSource.components(separatedBy: "Board.unverifiedLine").count == 2, "the line is drawn in one place only")
// Review 2: both Copy paths, VoiceOver's action and the long press's (kosmos#7419: the sheet's Copy text, handed row.text),
// and no other pasteboard write in the bubble.
check(bubbleSource.contains("Button(\"Copy\") { UIPasteboard.general.string = Board.roomWords(row) }")
      && bubbleSource.contains("reply: answerable ? reply : nil, text: Board.roomWords(row))")
      && bubbleSource.components(separatedBy: "UIPasteboard.general.string =").count == 2,
      "both Copy paths (VoiceOver's action and the long-press sheet) take the row's words, never the line")

// kosmos#7488: the native New Agent flow. Its words are the desktop's, read from the board's own page so they cannot drift.
for w in [NewAgent.Words.kindTitle, NewAgent.Words.roleTitle, NewAgent.Words.roleHint, NewAgent.Words.pickAnother,
          NewAgent.Words.ownName, NewAgent.Words.ownLine, NewAgent.Words.ownFull, NewAgent.Words.maxHelpers,
          NewAgent.Words.dailyLimit, NewAgent.Words.pauses, NewAgent.Words.hello]
    + NewAgent.Kind.allCases.flatMap({ [NewAgent.Words.kindName($0), NewAgent.Words.kindLine($0)] }) {
    check(boardPage.contains(w), "the desktop says it too: \(w)")
}
check(boardPage.contains("The lead agent brings in up to ${max} helpers when parts of a task can be done at the same time. Otherwise, it works alone.")
      && NewAgent.Words.swarmExplain(3) == "The lead agent brings in up to 3 helpers when parts of a task can be done at the same time. Otherwise, it works alone.",
      "the swarm explanation is the desktop's, following the helpers")
check(boardPage.contains("'Say Hello to ' + shown") && NewAgent.Words.sayHello("Ada") == "Say Hello to Ada", "Say Hello to <name>, as the desktop")
check(boardPage.contains("min=\"2\" max=\"10\" step=\"1\" value=\"3\"") && NewAgent.helpersRange == 2...10 && NewAgent.helpersStart == 3, "helpers 2 to 10, starting at 3, as the desktop's slider")
check(NewAgent.capWords(6) == "6,000,000 tokens a day", "the limit reads in tokens a day, as the desktop's token mode")
let naRoles = Data(#"""
{"models":[{"key":"opus","provider":"anthropic","label":"Opus","default":false},{"key":"sonnet","provider":"anthropic","label":"Sonnet","default":true},{"key":"gpt-5","provider":"openai","label":"GPT-5"}],
 "own":{"key":"own","blurb":"An agent whose job you write yourself","instructions":"You are **{{NAME}}**, an assistant.\nDo the work."},
 "roles":[{"key":"writer","label":"Writer","blurb":"Writes","instructions":"x","group":"Words"},
          {"key":"pm","label":"Project Manager","blurb":"Runs","instructions":"y","group":"Running the work"},
          {"key":"editor","label":"Editor","blurb":"Edits","instructions":"z","group":"Words"},
          {"key":"","label":"No key"}]}
"""#.utf8)
let naCat = NewAgent.parseCatalogue(naRoles, swarms: false)
check(naCat?.roles.map(\.key) == ["writer", "pm", "editor"], "menu roles as served, a keyless row dropped")
check(naCat?.recommended?.key == "pm", "the recommended role is pm, as the desktop's buildPicker")
check(naCat?.models.map(\.key) == ["opus", "sonnet"] && naCat?.defaultModel?.key == "sonnet", "Claude models only, the served default chosen")
check(naCat?.groups.map(\.name) == ["Words", "Running the work"] && naCat?.groups.first?.roles.map(\.key) == ["writer", "editor"], "grouped in the catalogue's order")
check(naCat?.own?.label == "Describe it yourself" && NewAgent.ownExample(naCat!) == "You are **your agent**, an assistant.\nDo the work.", "own starts from the example, the name read as the desktop does")
check(NewAgent.parseCatalogue(Data("{}".utf8), swarms: false) == nil, "a reply without roles is not a catalogue")
check(Board.swarmsOn(fromStatus: Data(#"{"swarms":true,"agents":[]}"#.utf8)) && Board.swarmsOn(fromStatus: Data(#"{"agents":[{"swarm":{}}]}"#.utf8))
      && !Board.swarmsOn(fromStatus: Data(#"{"agents":[{"name":"a"}]}"#.utf8)), "Swarm shows when the board says so, as SWARMS_ON")
if let c = naCat {
    func bodyOf(_ d: NewAgent.Draft) -> [String: Any]? {
        NewAgent.createRequest(mac: npMac, draft: d, catalogue: c).flatMap { $0.httpBody }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
    var d = NewAgent.Draft(); d.roleKey = "pm"; d.name = "  Ada "; d.label = "Project Manager"; d.model = "sonnet"
    let b1 = bodyOf(d)
    check(b1?["name"] as? String == "Ada" && b1?["role"] as? String == "pm" && b1?["label"] == nil && b1?["model"] as? String == "sonnet"
          && b1?["reportsTo"] == nil && b1?["kind"] == nil && b1?["notifyCreated"] as? Bool == true, "single: an unchanged label and you as manager do not travel")
    check(NewAgent.createRequest(mac: npMac, draft: d, catalogue: c)?.url?.absoluteString == npMac.absoluteString.replacingOccurrences(of: "/$", with: "", options: .regularExpression) + "/api/agents"
          && NewAgent.createRequest(mac: npMac, draft: d, catalogue: c)?.httpMethod == "POST", "POST /api/agents, the desktop's route")
    d.label = "Lead"; d.reportsTo = "boss-1"
    check(bodyOf(d)?["label"] as? String == "Lead" && bodyOf(d)?["reportsTo"] as? String == "boss-1", "a changed label and a manager travel")
    d.name = " "
    check(bodyOf(d) == nil && !NewAgent.canCreate(d, c), "nothing is sent without a name")
    var o = NewAgent.Draft(); o.roleKey = "own"; o.name = "Ada"
    check(!NewAgent.canContinueRole(o, c), "own needs words in its box")
    o.ownWords = NewAgent.ownExample(c)
    check(NewAgent.canContinueRole(o, c) && !NewAgent.canCreate(o, c), "own's Role label is required, as the engine requires it")
    o.label = "Researcher"
    check(bodyOf(o)?["label"] as? String == "Researcher" && bodyOf(o)?["instructions"] == nil, "own: the label always travels; the untouched example does not")
    o.ownWords = "You are **your agent**, an assistant.\nRead leases."
    check(bodyOf(o)?["instructions"] as? String == "You are **Ada**, an assistant.\nRead leases.", "own: edited words travel, with the agent's name in place")
    var s = NewAgent.Draft(kind: .swarm); s.roleKey = "writer"; s.name = "Hive"; s.maxHelpers = 99; s.capMillions = 6
    let sb = bodyOf(s)
    check(sb?["kind"] as? String == "swarm" && sb?["maxHelpers"] as? Int == 10 && sb?["dailyTokenLimit"] as? Int == 6_000_000
          && sb?["provider"] as? String == "anthropic", "swarm: kind, helpers (kept in range), the limit in tokens, Claude")
}
check(NewAgent.result(sent: true, status: 200, body: Data(#"{"outcome":"created","name":"ada-1","shownAs":"Ada"}"#.utf8)) == .made(session: "ada-1", shownAs: "Ada"), "created: the session and its shown name")
check(NewAgent.result(sent: true, status: 400, body: Data(#"{"outcome":"refused","because":"There is already an agent called Ada."}"#.utf8)) == .refused("There is already an agent called Ada."), "refused: the board's own sentence")
check(NewAgent.result(sent: true, status: 200, body: Data(#"{"outcome":"partial","because":"It could not start."}"#.utf8)) == .refused("It could not start."), "partial is rolled back by the engine: its sentence")
check(NewAgent.result(sent: true, status: 0, body: nil) == .unknown && NewAgent.result(sent: true, status: 502, body: nil) == .unknown, "no answer may have made it")
check(NewAgent.result(sent: true, status: 200, body: Data(#"{"outcome":"created","name":"../x"}"#.utf8)) == .unknown, "a made answer with no usable session is unknown, never guessed")
check(NewAgent.result(sent: false, status: 0, body: nil) == .refused(NewAgent.fallback), "nothing sent is certainly not made")

extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
