// kosmos-se (kosmos#7116 slice 4, the Mac half): an admin's se-p256 roster key, held in this Mac's Secure Enclave.
//
// escrowd's roster takes two admin key types (kosmos-relay .claude/plans/reviewpage-5686.md, "Keys"). `se-p256` is
// ECDSA P-256 in Apple's MESSAGE mode: the signer hashes the message with SHA-256 itself. escrowd checks it with
// coordinator/src/roster.rs verify_se, which takes a DER signature over the raw message. This helper is the only code
// that touches the key; engine/seadmin.js decides WHAT may be signed and is the only caller.
//
// The private key never leaves the Secure Enclave. What is stored is CryptoKit's dataRepresentation: a blob the
// Enclave wrapped under a key of its own, usable only by THIS Mac's Enclave. So the file needs no keychain access
// group and no signed app (measured 2026-11-03 on an unsigned swiftc build: create, reload from the blob, sign). The
// file is still written 0600, because whoever can read it on this Mac can ask the Enclave to sign with it; the
// Enclave is what stops it being copied to another computer, not what stops another program on this one.
//
// Usage:
//   kosmos-se create <keyfile>   make a key; refuses if <keyfile> exists. Prints the public key.
//   kosmos-se pub <keyfile>      print the public key
//   kosmos-se sign <keyfile>     read the message on stdin, print the DER signature
// Output is lowercase hex on one line; a public key is 65 bytes of uncompressed SEC1 (04 || x || y).
//
// sign refuses a message that does not start with one of SIGNABLE_TAGS, as a second fence behind engine/seadmin.js
// (which decodes every byte and checks the tag is the action the person chose). The list must equal seadmin.js's
// SIGNED tags; engine/seadmin-7116.test.js reads this file and fails if they differ.
//
// Build: swiftc -O native-se/main.swift -o kosmos-se

import CryptoKit
import Foundation

let SIGNABLE_TAGS: [String] = [
    "kosmos-escrowd-roster-change v1",
    "kosmos-escrowd-roster-cancel v1",
    "kosmos-escrowd-reviewer-enrol v1",
    "kosmos-escrowd-reviewer-revoke v1",
]

// The longest message escrowd's encoders make is a few hundred bytes; anything far larger is not one of them.
let MAX_MESSAGE = 64 * 1024

func fail(_ why: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(("kosmos-se: " + why + "\n").data(using: .utf8)!)
    exit(code)
}

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

func load(_ path: String) -> SecureEnclave.P256.Signing.PrivateKey {
    guard let blob = FileManager.default.contents(atPath: path) else { fail("cannot read the key file") }
    do { return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob) }
    catch { fail("this Mac's Secure Enclave cannot open that key file") }
}

let args = CommandLine.arguments
guard args.count == 3 else { fail("usage: kosmos-se create|pub|sign <keyfile>", 2) }
let (verb, path) = (args[1], args[2])

switch verb {
case "create":
    guard SecureEnclave.isAvailable else { fail("this Mac has no Secure Enclave", 3) }
    let key: SecureEnclave.P256.Signing.PrivateKey
    do { key = try SecureEnclave.P256.Signing.PrivateKey() }
    catch { fail("the Secure Enclave refused to make a key") }
    // O_EXCL: never overwrite a key someone may already have enrolled; 0600 from the first byte.
    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    guard fd >= 0 else { fail(errno == EEXIST ? "the key file already exists" : "cannot create the key file") }
    let blob = key.dataRepresentation
    let wrote = blob.withUnsafeBytes { write(fd, $0.baseAddress, blob.count) }
    let synced = fsync(fd) == 0
    close(fd)
    guard wrote == blob.count && synced else { unlink(path); fail("cannot write the key file") }
    print(hex(key.publicKey.x963Representation))
case "pub":
    print(hex(load(path).publicKey.x963Representation))
case "sign":
    let key = load(path)
    let message = FileHandle.standardInput.readDataToEndOfFile()
    guard message.count <= MAX_MESSAGE else { fail("the message is too long to be an escrowd action") }
    guard SIGNABLE_TAGS.contains(where: { message.starts(with: Data($0.utf8)) }) else {
        fail("refusing to sign bytes that are not an escrowd admin action")
    }
    do { print(hex(try key.signature(for: message).derRepresentation)) }
    catch { fail("the Secure Enclave refused to sign") }
default:
    fail("usage: kosmos-se create|pub|sign <keyfile>", 2)
}
