import Foundation
// Tests for an agent's and a project's Files (kosmos#7679), compiled for macOS with the files run-files.sh lists. It
// prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? ".")
let boardPage = (try? String(contentsOf: repo.appendingPathComponent("web/index.html"), encoding: .utf8)) ?? ""
check(boardPage.count > 100_000, "premise: the board's page was read")
let mac = URL(string: "https://studio.kosmosplus.com")!

section("the reads")
let top = Board.filesRequest(mac: mac, owner: .agent("cleo"))
check(top?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/cleo/files?limit=10", "the section: the newest ten, as the board's agent panel")
check(top?.value(forHTTPHeaderField: "Accept") == "application/json", "asks for JSON, so a signed-out gate does not answer with its page")
check(Board.filesRequest(mac: mac, owner: .agent("cleo"), dir: "")?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/cleo/files/browse?dir=", "the browser's top folder")
check(Board.filesRequest(mac: mac, owner: .agent("cleo"), dir: "Covers/Spring")?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/cleo/files/browse?dir=Covers%2FSpring", "a folder inside (the slash encoded; the route decodes it)")
// Review 1: a + reaches the server's URLSearchParams as a space unless encoded, so "C++ notes" was asked for as "C   notes".
check(Board.filesRequest(mac: mac, owner: .agent("cleo"), dir: "C++ notes/a&b=c#d")?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/cleo/files/browse?dir=C%2B%2B%20notes%2Fa%26b%3Dc%23d", "a folder name with + & = # stays one name")
check(Board.filesRequest(mac: mac, owner: .agent("cleo"), dir: "../x") == nil && Board.filesRequest(mac: mac, owner: .agent("cleo"), dir: "/etc") == nil
      && Board.filesRequest(mac: mac, owner: .agent("cleo"), dir: "a//b") == nil, "never a folder outside the agent's Files")
check(Board.filesRequest(mac: mac, owner: .agent("../x")) == nil, "never a session that is not one")
check(Board.filesRequest(mac: mac, owner: .project("p1"))?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/p1/documents?limit=500", "a project's whole list, as the board's Documents view")
check(boardPage.contains("'/documents?limit=500'") && boardPage.contains("const AGENT_FILES_SHOWN = 10;"), "the board still reads these")

section("opening one")
check(Board.filesDownloadPath(owner: .agent("cleo"), name: "Spring proof.pdf") == "/api/agent/cleo/files/download?name=Spring%20proof%2Epdf", "an agent's file, the board's download route")
check(Board.filesDownloadPath(owner: .project("p1"), name: "Covers/a&b=c+d#e?.txt") == "/api/project/p1/file-download?name=Covers%2Fa%26b%3Dc%2Bd%23e%3F%2Etxt", "a project's, every separator inside the one name")
check(Board.filesDownloadPath(owner: .agent("cleo"), name: "../x") == nil && Board.filesDownloadPath(owner: .agent("cleo"), name: "") == nil, "never a name outside the Files")
let dots = Board.ListedFile(name: "notes..txt", size: 3, modified: nil, changedBy: nil)
let att = Board.filesAttachment(owner: .agent("cleo"), file: dots, id: "u1")
check(att?.url == "/api/agent/cleo/files/download?name=notes%2E%2Etxt" && att.map { Board.isBoardPath($0.url) } == true, "a name with two dots still opens (isBoardPath refuses a bare ..)")
let inSub = Board.ListedFile(name: "Covers/front.png", size: 1, modified: nil, changedBy: nil)
check(Board.filesAttachment(owner: .project("p1"), file: inSub, id: "u2")?.name == "front.png", "saved for Quick Look under its own name, never its path")
check(Board.filesAttachment(owner: .agent("cleo"), file: inSub, id: "u3")?.id == "u3", "the id given names its own folder (closed() removes it)")

section("the answers")
func page(_ s: String, _ status: Int = 200) -> Board.FilesRead { Board.filesResult(status: status, body: Data(s.utf8)) }
let browse = page(#"{"ok":true,"dir":"Covers","dirs":[{"name":"Covers/Old","modified":"2026-10-30T10:00:00.000Z"}],"files":[{"name":"Covers/front.png","size":2048,"modified":"2026-10-31T09:30:00.123Z","sha256":"ab"}],"stamp":"x"}"#)
if case .page(let p) = browse {
    check(p.dir == "Covers" && p.dirs.map(\.shownName) == ["Old"] && p.files.map(\.shownName) == ["front.png"] && p.files.first?.size == 2048, "a folder: its folders and files, shown by their last part")
    check(p.files.first?.modified != nil, "the board's toISOString time is read")
    check(p.dirs.first?.name == "Covers/Old", "a folder keeps the path it opens")
} else { check(false, "a folder's answer is a page") }
if case .page(let p) = page(#"{"ok":true,"missing":true,"total":0,"files":[],"stamp":"missing","folder":"/x"}"#) {
    check(p.missing && p.files.isEmpty && Board.filesEmpty(owner: .agent("cleo"), dir: p.dir) == "This agent has no files yet.", "no Files folder yet reads as empty, never a failure")
} else { check(false, "a missing folder is a page") }
check(page(#"{"ok":false,"because":"that folder changed while it was being read"}"#, 409) == .refused("That folder changed while it was being read."), "the route's own reason, as a sentence")
check(page(#"{"error":"there is no project by that name"}"#, 404) == .refused("There is no project by that name."), "a project route's error too")
check(page("<html>sign in</html>") == .refused("We cannot read this right now."), "the gate's sign-in page is never an empty folder")
check(page(#"{"ok":true,"total":3}"#) == .refused("We cannot read this right now."), "a 200 with no list is not an empty folder")
check(Board.filesResult(status: 0, body: nil) == .noAnswer, "no answer")
if case .page(let p) = page(#"{"ok":true,"files":[{"name":"../etc/passwd"},{"name":"ok.txt","size":-1},{"name":"/abs"}],"total":3}"#) {
    check(p.files.map(\.name) == ["ok.txt"] && p.files.first?.size == nil, "a row the routes would refuse is not drawn; a negative size is none")
} else { check(false, "rows are read") }

section("the words")
let f = Board.ListedFile(name: "a.pdf", size: 2_411_724, modified: Date(timeIntervalSince1970: 0), changedBy: "Maya")
check(Board.filesMeta(f, date: { _ in "Jan 1" }) == "2.3 MB \u{00B7} Jan 1 \u{00B7} changed by Maya", "the board's pjDocMeta: size, date, who changed it")
check(Board.filesMeta(Board.ListedFile(name: "b", size: nil, modified: nil, changedBy: "Maya"), date: { _ in "" }) == "changed by Maya", "no stray separator")
check(Board.sizeText(0) == "0 B" && Board.sizeText(1023) == "1023 B" && Board.sizeText(1536) == "2 KB" && Board.sizeText(1_048_576) == "1.0 MB", "the board's pjSize")
check(Board.filesTooBigToOpen(Board.ListedFile(name: "big.mov", size: 100 * 1024 * 1024 + 1, modified: nil, changedBy: nil))
      && !Board.filesTooBigToOpen(Board.ListedFile(name: "ok.pdf", size: 100 * 1024 * 1024, modified: nil, changedBy: nil))
      && !Board.filesTooBigToOpen(Board.ListedFile(name: "unknown", size: nil, modified: nil, changedBy: nil)), "a file past 100 MB is not fetched (review 2)")
check(boardPage.contains("if (n < 1024) return n + ' B';") && boardPage.contains("return (n / (1024 * 1024)).toFixed(1) + ' MB';") && boardPage.contains("' · changed by ' + f.changedBy"), "the board's sizes and line still")
check(Board.filesEmpty(owner: .agent("c"), dir: "x") == "This folder is empty." && Board.filesEmpty(owner: .project("p"), dir: "") == Board.filesProjectEmpty, "the empty lines")
check(boardPage.contains("(dir ? 'This folder is empty.' : 'This agent has no files yet.')"), "the board's agent empty lines still")
check(boardPage.contains("'Nothing here yet. Files you or your agents put in this project\\u2019s folder show up here.'"), "the board's project empty line still")
check(boardPage.contains("'That file did not open.'"), "the board's could-not-open line still")
let full = Board.FilesPage(dir: "", dirs: [], files: [dots], missing: false, truncated: false, total: 1)
check(Board.filesMore(full) == nil, "a whole list says nothing more")
let cut = Board.FilesPage(dir: "", dirs: [], files: [dots, inSub], missing: false, truncated: true, total: 900)
check(Board.filesMore(cut) == "Showing the first 2. The rest are in Files on your computer.", "a list the route cut short says so (review 1)")
let crumbs = Board.filesCrumbs("Covers/Spring")
check(crumbs.map(\.name) == ["Files", "Covers", "Spring"] && crumbs.map(\.path) == ["", "Covers", "Covers/Spring"], "breadcrumbs from Files down")

print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
