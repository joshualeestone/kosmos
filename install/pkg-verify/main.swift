// kosmos#6576: the .pkg's own check of a signed release, for a Mac with no Kosmos yet.
//
// A first install has no installed copy to check the download with (engine/manifest-verify.js runs from the
// installed copy), so the .pkg carries this helper: signed with the Developer ID Application identity and covered by
// the package's notarization. It checks the release manifest's Ed25519 signature against the release public keys
// compiled in below (the same list as engine/manifest-verify.js KEYS; install.pkg-verify-6576.test.js fails if they
// differ), then prints the sha256 values the install must match.
//
//   kosmos-pkg-verify <manifest> <sig> <version> <floor>
//
// Exit 0: trusted; prints `setup_sha256=`, `sha256=` and `tmux_sha256=` lines (64 lowercase hex each).
// Exit 97: refused, with one line on stderr saying why (bad signature, another version, older than the floor, a field
//          missing). The caller runs nothing.
// Exit 2: called wrongly or a file could not be read; the caller runs nothing either.
//
// The keys and the floor are built into each .pkg: after a release-key rotation, a .pkg downloaded before it refuses
// every release (97) and a fresh download of the .pkg is the way on.
//
// What it does not tell apart: a manifest names no channel, so a genuinely signed STAGING release at or above the
// floor passes as well as a production one. It is still a release Kosmos signed, not someone else's code.
import CryptoKit
import Foundation

// SubjectPublicKeyInfo (DER, base64) of each release key, as engine/manifest-verify.js KEYS writes them.
let releaseKeys = [
    "MCowBQYDK2VwAyEAk4/bWISGCvRqop3v6KPAhqgszMbtHHZEldo8q/a5a1g=",
]

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

/// 64 lowercase hex characters, judged byte by byte (a Character would let a digit with a combining mark through).
func isSha256(_ s: String) -> Bool {
    s.utf8.count == 64 && s.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
}

let args = CommandLine.arguments
guard args.count == 5 else { usage("usage: kosmos-pkg-verify <manifest> <sig> <version> <floor>") }
guard let manifest = FileManager.default.contents(atPath: args[1]) else { usage("cannot read the manifest") }
guard let sigText = try? String(contentsOfFile: args[2], encoding: .utf8) else { usage("cannot read the signature") }
guard let want = parseVersion(args[3]) else { usage("the version is not a.b.c") }
guard let floor = parseVersion(args[4]) else { usage("the floor is not a.b.c") }

// The signature is checked over the manifest's exact bytes before anything in it is read.
guard let sig = Data(base64Encoded: sigText.trimmingCharacters(in: .whitespacesAndNewlines)), sig.count == 64 else {
    refuse("the release manifest is not signed by the Kosmos release key")
}
let signed = releaseKeys.contains { b64 in
    // An Ed25519 SubjectPublicKeyInfo is a fixed 12-byte header and the 32-byte key.
    guard let der = Data(base64Encoded: b64), der.count == 44,
          der.prefix(12) == Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: der.suffix(32))
    else { return false }
    return key.isValidSignature(sig, for: manifest)
}
guard signed else { refuse("the release manifest is not signed by the Kosmos release key") }

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
