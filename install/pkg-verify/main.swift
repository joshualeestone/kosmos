// kosmos#6576: the .pkg's own check of a signed release, for a Mac with no Kosmos yet.
//
// A first install has no installed copy to check the download with (engine/manifest-verify.js runs from the
// installed copy), so the .pkg carries this helper: signed with the Developer ID Application identity and covered by
// the package's notarization. It checks the release manifest's Ed25519 signature against the release public keys
// compiled in below (the same list as engine/manifest-verify.js KEYS; install.pkg-verify-6576.test.js fails if they
// differ), then prints the sha256 values the install must match.
//
//   kosmos-pkg-verify <manifest> <sig> <version> <floor> [<key list> <key list sig>]
//
// kosmos#6609: with a recovery key built in (recoveryKeys below), the release keys come from the key list instead: a
// list a recovery key signed, fetched beside the manifest, checked as engine/manifest-verify.js verifyKeyList checks
// it and not below minKeyListSeq. Then releaseKeys are not used at all, and a list that is missing or does not check
// out refuses (97) as a bad signature does. With no recovery key (as shipped) the list is not read.
// This helper keeps no record of lists. Its floor is minKeyListSeq, built in, raised to the highest list this Mac's
// existing Kosmos has taken when the postinstall passes it (an eighth argument). So on a Mac with no Kosmos (or with
// none at the default home) a revocation reaches .pkg installs only through a .pkg built after minKeyListSeq was
// raised to the revoking list: a .pkg built before that takes any recovery-signed list at or above its own floor.
//
// Exit 0: trusted; prints `setup_sha256=`, `sha256=` and `tmux_sha256=` lines (64 lowercase hex each).
// Exit 97: refused, with one line on stderr saying why (bad signature, another version, older than the floor, a field
//          missing). The caller runs nothing.
// Exit 2: called wrongly or a file could not be read; the caller runs nothing either.
//
// The keys and the floor are built into each .pkg. With no recovery key, after a release-key rotation a .pkg
// downloaded before it refuses every release (97) and a fresh download of the .pkg is the way on; with one, the list
// names the keys instead (see above).
//
// What it does not tell apart: a manifest names no channel, so a genuinely signed STAGING release at or above the
// floor passes as well as a production one. It is still a release Kosmos signed, not someone else's code.
import CryptoKit
import Foundation

// SubjectPublicKeyInfo (DER, base64) of each release key, as engine/manifest-verify.js KEYS writes them.
let releaseKeys = [
    "MCowBQYDK2VwAyEAk4/bWISGCvRqop3v6KPAhqgszMbtHHZEldo8q/a5a1g=",
]

// kosmos#6609: the recovery keys, engine/manifest-verify.js RECOVERY_KEYS (install.pkg-verify-keylist-6609.test.js
// fails if they differ). Empty: off.
let recoveryKeys: [String] = []
// engine/manifest-verify.js MIN_KEY_LIST_SEQ. A first install has no record of a list taken before, so this is its
// whole floor.
let minKeyListSeq = 1
let maxSeq = 2147483647
let keyListType = "kosmos-release-keys"

func refuse(_ why: String) -> Never {
    FileHandle.standardError.write(("Kosmos: " + why + "\n").data(using: .utf8)!)
    exit(97)
}

func usage(_ why: String) -> Never {
    FileHandle.standardError.write(("kosmos-pkg-verify: " + why + "\n").data(using: .utf8)!)
    exit(2)
}

/// a.b.c compared numerically; anything else is not a version (nil).
func parseVersion(_ v: String) -> [Int]? {
    let parts = v.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else { return nil }
    var out: [Int] = []
    for p in parts {
        guard !p.isEmpty, p.count <= 6, p.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(p) else { return nil }
        out.append(n)
    }
    return out
}

func isOlder(_ a: [Int], _ b: [Int]) -> Bool {
    for i in 0..<3 where a[i] != b[i] { return a[i] < b[i] }
    return false
}

/// An Ed25519 public key from its SubjectPublicKeyInfo base64, as engine/manifest-verify.js ed25519Key reads one: 59
/// base64 characters and one "=", decoding to the fixed 12-byte header and 32 bytes, and spelled canonically (the
/// bytes re-encoded are the same string). Anything else is nil.
func ed25519Key(_ b64: String) -> Curve25519.Signing.PublicKey? {
    let u = Array(b64.utf8)
    guard u.count == 60, u[59] == 61,
          u[0..<59].allSatisfy({ ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 43 || $0 == 47 }),
          let der = Data(base64Encoded: b64), der.count == 44, der.base64EncodedString() == b64,
          der.prefix(12) == Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
    else { return nil }
    return try? Curve25519.Signing.PublicKey(rawRepresentation: der.suffix(32))
}

/// Does one of `keys` sign `bytes` with the base64 signature `sigText`?
func signedBy(_ keys: [String], _ sigText: String, _ bytes: Data) -> Bool {
    guard let sig = Data(base64Encoded: sigText.trimmingCharacters(in: .whitespacesAndNewlines)), sig.count == 64 else { return false }
    return keys.contains { ed25519Key($0)?.isValidSignature(sig, for: bytes) == true }
}

/// The release keys a key list names, checked as engine/manifest-verify.js verifyKeyList checks it, and not below
/// `floor`. Refuses (97) otherwise.
func keyListKeys(_ bytes: Data, _ sigText: String, floor: Int) -> [String] {
    guard signedBy(recoveryKeys, sigText, bytes) else { refuse("the release key list is not signed by the Kosmos recovery key") }
    guard let obj = try? JSONSerialization.jsonObject(with: bytes), let list = obj as? [String: Any] else {
        refuse("the signed release key list is not readable")
    }
    guard (list["type"] as? String) == keyListType else { refuse("the signed file is not a release key list") }
    guard let raw = list["release_keys"] as? [Any], !raw.isEmpty else { refuse("the signed release key list names no release key") }
    let keys = raw.compactMap { $0 as? String }
    guard keys.count == raw.count, Set(keys).count == keys.count, keys.allSatisfy({ ed25519Key($0) != nil }) else {
        refuse("the signed release key list holds a key that is not one")
    }
    // A JSON true also arrives as a number (1); the form check below refuses it, as the list must then read "seq": 1.
    guard let n = list["seq"] as? NSNumber, let seq = Int(exactly: n.doubleValue), seq >= 1, seq <= maxSeq else {
        refuse("the signed release key list has no sequence number")
    }
    guard !keys.contains(where: { recoveryKeys.contains($0) }) else {
        refuse("the signed release key list names a recovery key as a release key")
    }
    // The list must be byte for byte what tools/lib/release-keys-sign.js writes for these fields (JSON.stringify with
    // two-space indent, this field order, one trailing newline). JSONSerialization and JSON.parse differ on inputs
    // that form never holds (a field named twice, a byte-order mark, another encoding), so a list in any other form is
    // refused rather than read in a way the installed copies might not read it.
    guard let issued = list["issued"] as? String, issued.utf8.count == 10,
          issued.utf8.enumerated().allSatisfy({ $0.offset == 4 || $0.offset == 7 ? $0.element == 45 : ($0.element >= 48 && $0.element <= 57) })
    else { refuse("the signed release key list is not in the form Kosmos writes") }
    let canonical = "{\n  \"type\": \"\(keyListType)\",\n  \"release_keys\": [\n"
        + keys.map { "    \"\($0)\"" }.joined(separator: ",\n")
        + "\n  ],\n  \"seq\": \(seq),\n  \"issued\": \"\(issued)\"\n}\n"
    guard Data(canonical.utf8) == bytes else { refuse("the signed release key list is not in the form Kosmos writes") }
    guard seq >= floor else { refuse("the release key list offered (\(seq)) is older than this installer or this Mac's Kosmos accepts, so nothing was installed") }
    return keys
}

/// 64 lowercase hex characters, judged byte by byte (a Character would let a digit with a combining mark through).
func isSha256(_ s: String) -> Bool {
    s.utf8.count == 64 && s.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
}

let args = CommandLine.arguments
guard args.count == 5 || args.count == 7 || args.count == 8 else {
    usage("usage: kosmos-pkg-verify <manifest> <sig> <version> <floor> [<key list> <key list sig> [<list seq taken>]]")
}
guard let manifest = FileManager.default.contents(atPath: args[1]) else { usage("cannot read the manifest") }
guard let sigText = try? String(contentsOfFile: args[2], encoding: .utf8) else { usage("cannot read the signature") }
guard let want = parseVersion(args[3]) else { usage("the version is not a.b.c") }
guard let floor = parseVersion(args[4]) else { usage("the floor is not a.b.c") }

// The release keys: the built-in ones, or with a recovery key built in, the ones a checked key list names.
var trusted = releaseKeys
if !recoveryKeys.isEmpty {
    guard args.count >= 7, let listBytes = FileManager.default.contents(atPath: args[5]),
          let listSig = try? String(contentsOfFile: args[6], encoding: .utf8)
    else { refuse("the release key list could not be read, so the release could not be checked") }
    // The highest list this Mac's existing Kosmos has taken (the postinstall reads its record), when there is one: the
    // floor is never below it, so an older list than that copy already has is refused here too. It can only raise
    // the floor.
    var listFloor = minKeyListSeq
    if args.count == 8 {
        let s = args[7]
        guard !s.isEmpty, s.utf8.count <= 10, s.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }), let taken = Int(s), taken <= maxSeq else {
            usage("the list seq taken is not a whole number up to \(maxSeq)")
        }
        listFloor = max(listFloor, taken)
    }
    trusted = keyListKeys(listBytes, listSig, floor: listFloor)
}

// The signature is checked over the manifest's exact bytes before anything in it is read.
guard signedBy(trusted, sigText, manifest) else { refuse("the release manifest is not signed by the Kosmos release key") }

guard let obj = try? JSONSerialization.jsonObject(with: manifest), let m = obj as? [String: Any] else {
    refuse("the signed release manifest could not be read")
}
guard let version = m["version"] as? String, let got = parseVersion(version) else {
    refuse("the signed release manifest names no version")
}
// The version the site's pointer offered, and not older than the oldest release this package accepts: an old, genuinely signed
// release served again by the download site is refused.
guard version == args[3], got == want else { refuse("the signed release is \(version), not the \(args[3]) offered, so nothing was installed") }
guard !isOlder(got, floor) else { refuse("the release offered (\(version)) is older than the oldest release this installer accepts, so nothing was installed") }
// The postinstall fetched the arm64 manifest (the only build); the signed manifest must say so too.
guard (m["arch"] as? String) == "arm64" else { refuse("the signed release manifest is not for this Mac (arm64)") }
// Every field is checked before any is printed: a refusal prints nothing a caller could take as a pin.
var lines: [String] = []
for field in ["setup_sha256", "sha256", "tmux_sha256"] {
    guard let v = m[field] as? String, isSha256(v) else { refuse("the signed release manifest has no \(field)") }
    lines.append("\(field)=\(v)")
}
print(lines.joined(separator: "\n"))
exit(0)
