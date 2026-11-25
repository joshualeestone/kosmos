import Foundation
// Tests for the native Global skills screen's logic (kosmos#8959 slice D1b1), compiled for macOS with the app files
// run-globalskills.sh lists. It prints every case and ends with one verdict line; a missing verdict means the run did
// not finish.
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
func json(_ s: String) -> Data { Data(s.utf8) }
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
let G = GlobalSkills.self

section("the requests: the board's routes on the kept computer, signed as the board's own")
let list = G.listRequest(mac)
check(list.httpMethod == "GET" && list.url?.absoluteString == "https://studio.kosmosplus.com/api/skills", "the list is GET /api/skills")
for r in [list, G.addRequest(mac, name: "A", body: "b")!, G.removeRequest(mac, key: "a")!] {
    check(r.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r.httpShouldHandleCookies == false
          && r.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "\(r.httpMethod ?? "?"): the kept cookie by hand and the board's header")
}
let add = G.addRequest(mac, name: "  How we write emails ", body: "Short sentences.\n")
let sentAdd = add?.httpBody.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: String] }
check(add?.httpMethod == "POST" && add?.url?.path == "/api/skills" && sentAdd == ["name": "How we write emails", "body": "Short sentences.\n"],
      "add POSTs { name, body }, the name trimmed and the words as written (the page trims only the name)")
check(add?.value(forHTTPHeaderField: "Content-Type") == "application/json", "as JSON")
check(G.addRequest(mac, name: "  ", body: "x") == nil && G.addRequest(mac, name: "x", body: " \n") == nil, "a blank name or blank words is not sent")
check(G.addRequest(mac, name: String(repeating: "n", count: 81), body: "x") == nil && G.addRequest(mac, name: String(repeating: "n", count: 80), body: "x") != nil,
      "the page's 80-character name limit")
check(G.addRequest(mac, name: "x", body: String(repeating: "語", count: 25_000)) != nil,
      "long words are sent (75 KB of CJK): the engine refuses an oversized skill in its own sentence, not a grey button (review 1)")
check(G.clipped(String(repeating: "w", count: 65537), utf16: G.bodyMax).utf16.count == 65536, "the words field stops at the page's 65536")
check(G.clipped("ab😀c", utf16: 3) == "ab" && G.clipped("ab😀c", utf16: 4) == "ab😀" && G.clipped("abc", utf16: 3) == "abc",
      "counted in UTF-16 units as maxlength does, and never cut inside a character")
check(G.canAdd(name: String(repeating: "😀", count: 40), body: "x") && !G.canAdd(name: String(repeating: "😀", count: 41), body: "x"),
      "the name's 80 is UTF-16 units too (40 emoji fit, 41 do not)")
let rm = G.removeRequest(mac, key: "how-we-write-emails")
check(rm?.httpMethod == "DELETE" && rm?.url?.absoluteString == "https://studio.kosmosplus.com/api/skills/how-we-write-emails", "remove is DELETE /api/skills/<key>")
check(G.removeRequest(mac, key: "a/b")?.url?.absoluteString == "https://studio.kosmosplus.com/api/skills/a%2Fb", "a key is one path segment, as encodeURIComponent")
check(G.removeRequest(mac, key: "") == nil, "no key, nothing sent")
check(G.segment("a b'(c)~*!_.-") == "a%20b'(c)~*!_.-", "encodeURIComponent's set")

section("the list, as the page reads it")
check(G.list(status: 200, data: json(#"{"ok":true,"skills":[{"key":"a","name":"Alpha"},{"key":"b","name":"Beta"}]}"#))
      == .got([Board.Skill(key: "a", name: "Alpha"), Board.Skill(key: "b", name: "Beta")]), "names and keys, in the board's order")
check(G.list(status: 200, data: json(#"{"ok":true,"skills":[]}"#)) == .got([]), "none is an empty list (the screen says the page's \"No skills here yet.\")")
check(G.list(status: 200, data: json(#"{"ok":false,"because":"we could not read the skills folder","skills":[]}"#)) == .failed("We could not read the skills folder."),
      "a folder the computer could not read is its own sentence, not an empty list")
check(G.list(status: 200, data: json(#"{"ok":false,"skills":[]}"#)) == .failed("We could not read the skills folder."), "with no sentence, the page's default")
check(G.list(status: 500, data: json("<html>")) == .failed(G.Words.listFailed), "no answer from the computer: the page's could-not-reach line")
check(G.list(status: 0, data: json("")) == .failed(G.Words.listFailed), "no answer at all, the same")
check(G.list(status: 401, data: json("")) == .failed(Board.phoneShutOut) && G.list(status: 403, data: json(#"{"because":"gate"}"#)) == .failed(Board.phoneShutOut),
      "401 and 403 are the phone's sign-in line, never anyone's words")
check(G.list(status: 200, data: json(G.sampleList)) == .got([Board.Skill(key: "how-we-write-emails", name: "How we write emails"), Board.Skill(key: "release-notes", name: "Release notes")]),
      "the sample build's list parses")

section("a change's answer")
check(G.added(status: 200, data: json(#"{"ok":true,"key":"how-we-write-emails"}"#)) == .done, "added")
check(G.added(status: 400, data: json(#"{"ok":false,"because":"there is already a skill called a; pick another name rather than replacing it"}"#))
      == .refused("There is already a skill called a; pick another name rather than replacing it."), "a refusal is the computer's own sentence")
check(G.added(status: 400, data: json(#"{"ok":false}"#)) == .refused("We could not add that skill."), "with none, the page's default")
check(G.added(status: 200, data: json(#"{"ok":false,"because":"we could not write the skill file"}"#)) == .refused("We could not write the skill file."),
      "a 200 that says ok:false is not done")
check(G.added(status: 200, data: json("<html>signed in</html>")) == .refused(G.Words.addFailed), "a page that is not the computer's answer is not done")
check(G.added(status: 0, data: json("")) == .refused(G.Words.addFailed), "no answer: the page's could-not-reach line")
check(G.removed(status: 200, data: json(#"{"ok":true}"#)) == .done, "removed")
check(G.removed(status: 400, data: json(#"{"ok":false,"because":"there is no skill by this name here"}"#)) == .refused("There is no skill by this name here."), "a remove refused")
check(G.removed(status: 403, data: json(#"{"because":"x"}"#)) == .refused(Board.phoneShutOut), "a 403 is the sign-in line")
check(G.removed(status: 0, data: json("")) == .refused(G.Words.removeFailed), "no answer")

section("the words are the board page's own, and the routes are the computer's")
// The page writes some of these as HTML entities; compare with those decoded.
let page = repoText("web/index.html").replacingOccurrences(of: "&ldquo;", with: "“").replacingOccurrences(of: "&rdquo;", with: "”")
    .replacingOccurrences(of: "&rsquo;", with: "’").replacingOccurrences(of: "\\u2026", with: "…")
let pageFlat = page.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
let server = repoText("server.js")
check(page.count > 100_000 && server.count > 100_000, "the page and the server were read")
let W = G.Words.self
// Review 1: each word is looked for only where the page uses it (the section's markup and the two script functions), so
// a one-word string such as "Remove" cannot pass on some other part of a 100,000-line page.
func cut(_ from: String, _ to: String) -> String {
    guard let a = pageFlat.range(of: from), let b = pageFlat.range(of: to, range: a.upperBound..<pageFlat.endIndex) else { return "" }
    return String(pageFlat[a.lowerBound..<b.lowerBound])
}
let sectionHTML = cut(#"<section class="dsec" id="s-sec-gskills""#, #"<section class="dsec" id="s-sec-policy""#)
let script = cut("async function loadSkills(url, listId, msgId) {", "/* --- the company AI policy (#479)")
check(sectionHTML.count > 500 && script.count > 2000, "the section and its script were found (\(sectionHTML.count), \(script.count) characters)")
for w in [W.title, W.hint, W.addLabel, W.addHint, W.namePlaceholder, W.bodyPlaceholder, W.addButton] {
    check(sectionHTML.contains(w), "in the section: \(w.prefix(50))")
}
for w in [W.none, W.added, W.remove, W.removeArmed, W.listFailed, W.addFailed, W.removeFailed, W.addRefusedDefault,
          W.removeRefusedDefault, W.listRefusedDefault, "Looking…"] {
    check(script.contains(w), "in the page's script: \(w.prefix(50))")
}
check(!sectionHTML.contains("Remove it for good?"), "control: a script sentence is not in the section's markup, so the cut is the section")
check(sectionHTML.contains("Ask your agent: <b>“What skills should we install?”</b>"), "the page's Ask your agent line")
check(page.contains(#"id="g-skill-name" maxlength="80""#) && page.contains(#"id="g-skill-body" rows="5" maxlength="65536""#), "the two limits are the page's")
check(server.contains("pathname === '/api/skills' && (req.method === 'GET'") && server.contains("pathname === '/api/skills' && req.method === 'POST'")
      && server.contains(#"pathname.match(/^\/api\/skills\/([^/]+)$/)"#), "the computer has the three routes")
let stepUp = server.range(of: "const REMOTE_STEP_UP_EXACT = new Set([").flatMap { s in
    server.range(of: "]);", range: s.upperBound..<server.endIndex).map { String(server[s.upperBound..<$0.lowerBound]) } } ?? ""
let patterns = server.range(of: "const REMOTE_STEP_UP_PATTERNS = [").flatMap { s in
    server.range(of: "];", range: s.upperBound..<server.endIndex).map { String(server[s.upperBound..<$0.lowerBound]) } } ?? ""
check(stepUp.contains("'POST /api/update'") && !stepUp.contains("/api/skills"), "not on the exact step-up list (control: the list holds POST /api/update)")
check(patterns.contains("svc") && !patterns.contains("skills"), "nor matched by a step-up pattern (control: the patterns hold the svc token route)")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
