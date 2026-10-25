import Foundation
// Tests for the native New task sheet's logic (#7078), compiled for macOS with the app files run-newtask.sh lists.
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
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
let page = repoText("web/index.html")
check(page.count > 100_000, "premise: the board's page was read")

// Fixtures through the app's own parsers, as the Mac's answers arrive.
let list = Board.parseProjects(Data(#"""
{"projects":[
 {"id":"zeta","name":"Zeta","agents":[{"sessionName":"rex-discord","name":"Rex"}]},
 {"id":"book","name":"Book A","agents":[{"sessionName":"cleo-discord","name":"Cleo"},{"sessionName":"rex-discord","name":"Rex"}]},
 {"id":"launch","name":"Launch","parent":"book","agents":[]},
 {"id":"old","name":"Archive me","archived":true,"agents":[]}
]}
"""#.utf8))!
let tasks = Board.parseTasks(Data(#"""
{"tasks":[
 {"projectId":"book","number":3,"sentence":"Cover","state":"working"},
 {"projectId":"book","number":7,"sentence":"Index","state":"assigned"},
 {"projectId":"book","number":5,"sentence":"Done one","state":"closed"},
 {"projectId":"zeta","number":9,"sentence":"Elsewhere","state":"working"}
]}
"""#.utf8))

section("the projects offered, as the board's ntChoices")
let offered = NewTask.projects(list)
check(offered.map(\.project.id) == ["book", "launch", "zeta"], "not archived, A to Z, a sub-project right after its parent")
check(NewTask.projectWords(offered[1], in: list) == "Launch, in Book A", "pjChainOption: own name first, then its chain")
check(NewTask.projectWords(offered[0], in: list) == "Book A", "a top-level project is its bare name")
check(NewTask.firstProject(picked: "zeta", offered: offered) == "zeta", "the Tasks tab's picked project")
check(NewTask.firstProject(picked: nil, offered: offered) == "book", "else the first offered")
check(NewTask.firstProject(picked: "old", offered: offered) == "book", "an archived pick is not offered, so the first is")
check(NewTask.firstProject(picked: nil, offered: []) == nil, "no project at all: none, and Create stays off")

section("who and Part of follow the project")
check(NewTask.members(of: "book", in: list).map(\.session) == ["cleo-discord", "rex-discord"], "the project's members")
check(NewTask.members(of: "launch", in: list).isEmpty, "a project with nobody on it")
check(NewTask.parents(of: "book", in: tasks).map(\.number) == [7, 3], "open tasks of that project only, newest first")
check(NewTask.parents(of: nil, in: tasks).isEmpty && NewTask.parents(of: "book", in: nil).isEmpty, "no project or no read: none")
var d = NewTask.Draft(project: "book", what: "Proofread", done: "No typos left", who: "cleo-discord", parent: 7)
let moved = NewTask.aimed(d, at: "zeta")
check(moved.project == "zeta" && moved.what == "Proofread" && moved.done == "No typos left", "another project keeps the words")
check(moved.who == nil && moved.parent == nil, "and drops who and Part of, picked for the other project")
check(NewTask.aimed(d, at: "book") == d, "the same project changes nothing")
let stillOffered = NewTask.keepingOffered(d, members: NewTask.members(of: "book", in: list), parents: NewTask.parents(of: "book", in: tasks))
check(stillOffered == d, "picks still offered are kept")
let gone = NewTask.keepingOffered(d, members: [], parents: [])
check(gone.who == nil && gone.parent == nil && gone.what == d.what, "a pick no longer offered falls back to nobody and None (review 1); the words stay")
let readFailed = NewTask.keepingOffered(d, members: NewTask.members(of: "book", in: list), parents: nil)
check(readFailed.parent == 7, "a Tasks read that failed says nothing about Part of: the pick stays")

section("Create, as the board's ntGoState (#5956)")
check(NewTask.canCreate(d), "what, how you will know, and a project")
check(!NewTask.canCreate(NewTask.Draft(project: "book", what: "  ", done: "x")), "what needs doing is required")
check(!NewTask.canCreate(NewTask.Draft(project: "book", what: "x", done: " \n ")), "how you will know it is done is required")
check(!NewTask.canCreate(NewTask.Draft(project: nil, what: "x", done: "y")), "a project is required")

section("the request, as the board's nt-go sends it")
let mac = URL(string: "https://studio.kosmosplus.com/")!
d.detail = "  pages 1 to 40  "
let req = NewTask.request(mac: mac, draft: d)
check(req?.httpMethod == "POST" && req?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/book/tasks", "POST /api/project/<id>/tasks")
check(req?.value(forHTTPHeaderField: "Content-Type") == "application/json", "a JSON body")
let sent = req?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
check(sent["sentence"] as? String == "Proofread", "sentence")
check(sent["detail"] as? String == "pages 1 to 40", "details trimmed")
check(sent["doneWhen"] as? [String] == ["No typos left"], "doneWhen: one check, in a list")
check(sent["who"] as? String == "cleo-discord", "who: the member's session name (the board's nt-who value)")
check((sent["parent"] as? NSNumber)?.intValue == 7, "parent: a number")
check(NewTask.body(NewTask.Draft(project: "book", what: "  Fix the  index ", done: "x"))["sentence"] as? String == "  Fix the  index ",
      "the sentence is sent as typed, not trimmed (the board sends nt-what's value; the Mac tidies it)")
let plain = NewTask.body(NewTask.Draft(project: "book", what: "Just this", done: "It is there"))
check(Set(plain.keys) == ["sentence", "doneWhen"], "nothing picked: no detail, who or parent keys at all")
check(NewTask.request(mac: mac, draft: NewTask.Draft(project: "book", what: "", done: "y")) == nil, "no request while Create is off")
// isViaScreen (#7075): the request as BoardClient sends it carries the board's own Sec-Fetch-Site, so the Mac records the
// task as the person's, not a process's. CONTROL: the same wrapper leaves a request to Kosmos+ itself unmarked.
let coordinator = URL(string: "https://login.kosmosplus.com/")!
check(req.map { Board.forMac($0, coordinator: coordinator) }?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin",
      "through Board.forMac (the wrapper BoardClient applies to every send, pinned in LogicTests/main.swift), it says it is the person's screen")
check(Board.forMac(URLRequest(url: coordinator), coordinator: coordinator).value(forHTTPHeaderField: "Sec-Fetch-Site") == nil,
      "CONTROL: a request to Kosmos+ itself is left as it is")
check(NewTask.request(mac: mac, draft: NewTask.Draft(project: "../x", what: "a", done: "b")) == nil, "a project id that is not one is never put in a path")
// The board sends the same keys: each is in its nt-go handler's JSON (read from that handler alone, not the page).
let goStart = page.range(of: "getElementById('nt-go').addEventListener('click'")
let goEnd = goStart.flatMap { page.range(of: "const body = await res.json()", range: $0.upperBound..<page.endIndex) }
let goJSON = (goStart != nil && goEnd != nil) ? String(page[goStart!.upperBound..<goEnd!.lowerBound]) : ""
check(goJSON.contains("JSON.stringify({") && goJSON.count < 3000, "premise: the board's nt-go request was found")
for key in ["sentence", "detail", "doneWhen", "who", "parent"] {
    check(goJSON.contains(key + ":"), "the board's nt-go sends \(key)")
}
check(!goJSON.contains("notes:"), "CONTROL: a key the board does not send is not found there")

section("the Mac's answers, read as the board's nt-go reads them")
check(NewTask.result(status: 200, body: Data(#"{"task":{"number":12},"told":null}"#.utf8)) == .made(number: 12, note: nil), "made, with its number")
check(NewTask.result(status: 200, body: Data(#"{"task":{"number":12},"note":"Note: an open task with the same text already exists: #4 (Proofread)."}"#.utf8))
      == .made(number: 12, note: "Note: an open task with the same text already exists: #4 (Proofread)."), "the Mac's same-text note is kept, as sent")
check(NewTask.result(status: 200, body: nil) == .made(number: nil, note: nil), "a 2xx with no body is still made")
check(NewTask.result(status: 404, body: Data(#"{"error":"there is no project by that name"}"#.utf8)) == .refused("there is no project by that name"), "its own sentence")
check(NewTask.result(status: 400, body: Data(#"{"error":"each done-when check has to be one line of plain text"}"#.utf8)) == .refused(NewTask.doneWords), "the done-when refusal in the field's words")
check(repoText("engine/tasks.js").contains("return 'each done-when check has to be one line of plain text'"), "that is the Mac's own sentence")
check(NewTask.result(status: 400, body: Data(#"{"error":"each done-when check has to be 200 characters or fewer"}"#.utf8)) == .refused(NewTask.doneWords), "its length form too")
check(NewTask.result(status: 400, body: Data("not json".utf8)) == .refused(NewTask.fallback), "an unreadable refusal: the board's words")
check(NewTask.result(status: 500, body: Data("not json".utf8)) == .unknown, "a server error with no sentence of the Mac's: unknown")
check(NewTask.result(status: 502, body: Data("BOARD_NOT_ANSWERING".utf8)) == .unknown, "the relay's plain 502 when the Mac stops answering: unknown")
check(NewTask.result(status: 504, body: nil) == .unknown, "a gateway timeout: unknown")
check(NewTask.result(status: 502, body: Data(#"{"error":"upstream timeout"}"#.utf8)) == .unknown, "a gateway error is unknown even with a sentence (the Mac's create never sends 502)")
check(NewTask.result(status: 503, body: Data(#"{"error":"we could not read the projects, so the task was not made"}"#.utf8)) == .refused("we could not read the projects, so the task was not made"), "CONTROL: the Mac's own 503 sentence is its refusal")
check(NewTask.result(status: 500, body: Data(#"{"error":"the task list could not be saved"}"#.utf8)) == .refused("the task list could not be saved"), "a server error in the Mac's own words is its refusal")
check(NewTask.result(status: 0, body: Data(#"{"error":"stale"}"#.utf8)) == .unknown, "no answer: unknown, never a stale body or a refusal")
check(NewTask.result(status: 0, body: nil) == .unknown, "no answer and no body: unknown")
check(!page.contains(NewTask.unsureWords), "the no-answer words are the sheet's own, not borrowed from the board")
check(page.contains(NewTask.doneWords.replacingOccurrences(of: "\"", with: "\\\"")) || page.contains(NewTask.doneWords), "the done-when words are the board's own")
check(page.contains("'" + NewTask.fallback + "'"), "the fallback is the board's own")
check(NewTask.addedLine(number: 12, projectName: "Launch") == "Added task 12 to Launch.", "the Tasks view's line after a create")
check(NewTask.addedLine(number: nil, projectName: "Launch") == "Added task to Launch.", "without a number")
check(page.contains("'Added task ' + (made && made.number ? made.number + ' ' : '') + 'to ' + p.name + '.'"), "that line is the board's own")

section("a kept draft and the projects offered now")
let keptWords = NewTask.Draft(project: "old", what: "Proofread", done: "No typos left", who: "rex-discord", parent: 9)
let archivedAway = NewTask.settled(keptWords, picked: nil, offered: offered)
check(archivedAway.project == "book", "a kept project since archived is not kept: the first offered")
check(archivedAway.what == "Proofread" && archivedAway.done == "No typos left", "the words stay")
check(archivedAway.who == nil && archivedAway.parent == nil, "who and Part of, picked for the old project, do not")
check(NewTask.settled(NewTask.Draft(project: "gone"), picked: "zeta", offered: offered).project == "zeta", "a project gone: the Tasks tab's pick")
check(NewTask.settled(NewTask.Draft(), picked: "zeta", offered: offered).project == "zeta", "no project yet: the Tasks tab's pick")
let keptLaunch = NewTask.Draft(project: "launch", what: "Proofread", who: nil, parent: nil)
check(NewTask.settled(keptLaunch, picked: nil, offered: offered) == keptLaunch, "All projects: a kept project still offered stays while words are typed")
check(NewTask.settled(keptLaunch, picked: "zeta", offered: offered) == NewTask.Draft(project: "zeta"), "a project picked in Tasks: the sheet is for it, and a draft for another starts clean (ntAimAt)")
check(NewTask.settled(keptLaunch, picked: "launch", offered: offered) == keptLaunch, "a project picked in Tasks that is the draft's own: the draft stays")
let untyped = NewTask.Draft(project: "launch", who: nil, parent: nil)
check(NewTask.settled(untyped, picked: nil, offered: offered).project == "book", "All projects with nothing typed: the first offered, as the board's openNewTask")
check(page.contains("  if (!sameDraft) {\n    NT_FOR = p.id;\n    document.getElementById('nt-what').value = '';"), "the board starts clean for a different project")
check(page.contains("const drafted = NT_FOR && ['nt-what', 'nt-detail', 'nt-done'].some((id) => document.getElementById(id).value.trim());"), "the board keeps its project only for typed words")
let nothingOffered = NewTask.settled(keptWords, picked: nil, offered: [])
check(nothingOffered.project == nil && nothingOffered.who == nil && !NewTask.canCreate(nothingOffered), "nothing offered: no project, Create off")

section("nothing sent is not \"could not tell\"")
check(NewTask.result(sent: false, status: 0, body: nil) == .refused(NewTask.fallback), "no request left the phone: the board's could-not-add words")
check(NewTask.result(sent: true, status: 0, body: nil) == .unknown, "CONTROL: a request sent with no answer is still unknown")

section("the board's limits")
check(NewTask.capped(String(repeating: "a", count: 250), at: NewTask.whatMax).count == 200, "a title stops at 200")
check(NewTask.capped("short", at: NewTask.whatMax) == "short", "a short one is untouched")
let emoji = String(repeating: "a", count: 199) + "\u{1F600}"
check(NewTask.capped(emoji, at: 200) == String(repeating: "a", count: 199), "a character that would cross the limit is left out whole, counted as the page counts (UTF-16)")
check(page.contains(#"id="nt-what" type="text" maxlength="\#(NewTask.whatMax)""#), "200 is the board's limit for what needs doing")
check(page.contains(#"id="nt-done" type="text" maxlength="\#(NewTask.doneMax)""#), "and for how you will know")
check(page.contains(#"id="nt-detail" rows="3" maxlength="\#(NewTask.detailMax)""#), "2000 for the details")
let engine = repoText("engine/tasks.js")
check(engine.contains("const SENTENCE_MAX = \(NewTask.whatMax);") && engine.contains("const DETAIL_MAX = \(NewTask.detailMax);"), "the Mac's own limits are the same")

section("both questions are one line, as the board's inputs")
check(NewTask.oneLine("Proofread\nthe index") == "Proofread the index", "a line break becomes a space")
check(NewTask.oneLine("a\r\nb\rc") == "a b c", "every kind of line break")
check(NewTask.oneLine("No typos left ") == "No typos left ", "a line with no break is left as typed")
check(page.contains(#"id="nt-what" type="text""#) && page.contains(#"id="nt-done" type="text""#), "the board's two questions are one-line inputs")

section("the words that got could-not-tell hold Create back")
let heldWords = NewTask.Draft(project: "book", what: "Proofread", done: "No typos", detail: "")
let held = NewTask.Held(sent: heldWords, before: [3, 7])
check(NewTask.heldBack(heldWords, by: held), "the same words: held")
check(NewTask.heldBack(NewTask.Draft(project: "book", what: "Proofread ", done: "No typos"), by: held), "the same words with a stray space: still held")
check(!NewTask.heldBack(NewTask.Draft(project: "book", what: "Proofread the index", done: "No typos"), by: held), "other words: another task")
check(!NewTask.heldBack(NewTask.Draft(project: "zeta", what: "Proofread", done: "No typos"), by: held), "another project: another task")
check(!NewTask.heldBack(heldWords, by: nil), "nothing held: not held")

section("after could-not-tell, a read that came back")
let sentDraft = NewTask.Draft(project: "book", what: "Proofread the index ", done: "x")
let after = Board.parseTasks(Data(#"""
{"tasks":[
 {"projectId":"book","number":3,"sentence":"Cover","state":"working"},
 {"projectId":"book","number":7,"sentence":"Proofread the index","state":"assigned"},
 {"projectId":"book","number":12,"sentence":"Proofread the index","state":"unassigned"},
 {"projectId":"zeta","number":13,"sentence":"Proofread the index","state":"working"}
]}
"""#.utf8))!
check(NewTask.found(sentDraft, in: after, before: [3, 7]) == 12, "the new task with the sent words in that project is found")
check(NewTask.found(sentDraft, in: after, before: [3, 7, 12]) == nil, "CONTROL: one that was there before is not it")
check(NewTask.found(sentDraft, in: after, before: nil) == nil, "no list from before the send: cannot tell, so not found")
check(NewTask.found(NewTask.Draft(project: "zeta", what: "Other"), in: after, before: []) == nil, "other words are not it")

section("the board's own words")
check(page.contains(">" + NewTask.Words.what + "</label>"), "the first question is the board's label")
check(page.contains(#"placeholder=""# + NewTask.Words.whatExample + #"""#), "its example is the board's placeholder")
check(page.contains(">" + NewTask.Words.done + "</label>"), "the second question is the board's label")
check(page.contains(#"placeholder=""# + NewTask.Words.doneExample + #"""#), "its example is the board's placeholder")
check(page.contains(">" + NewTask.Words.doneHint + "</p>"), "the hint under it is the board's")
check(page.contains(">" + NewTask.Words.detail + "</label>"), "the details label is the board's")
check(page.contains(#"placeholder=""# + NewTask.Words.detailExample + #"""#), "its example is the board's placeholder")
check(page.contains(">" + NewTask.Words.whoHint + "</p>"), "the line under Who is on it is the board's")
check(!page.contains(">" + "Both are needed." + "</p>"), "CONTROL: words the board does not show are not found as a hint")
let partOf = page.range(of: #"for="nt-parent">Part of</label>"#), whoIs = page.range(of: #"for="nt-who">Who is on it</label>"#)
check(partOf != nil && whoIs != nil && partOf!.lowerBound < whoIs!.lowerBound, "the board asks Part of before Who is on it, as the sheet does")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
