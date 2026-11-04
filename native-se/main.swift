// kosmos-se (kosmos#7116 slice 4, the Mac half): an admin's se-p256 roster key, held in this Mac's Secure Enclave.
//
// escrowd's roster takes two admin key types (kosmos-relay .claude/plans/reviewpage-5686.md, "Keys"). `se-p256` is
// ECDSA P-256 in Apple's MESSAGE mode: the message, not a digest, is what this helper is handed, and it is hashed
// with SHA-256 on this side of the call. escrowd checks it with coordinator/src/roster.rs verify_se, which takes a DER
// signature over the raw message. This helper is the only code that touches the key; engine/seadmin.js decides WHAT
// may be signed and is meant to be the only production caller (nothing calls either yet; the tests call this directly).
//
// The private key never leaves the Secure Enclave. What is stored is CryptoKit's dataRepresentation: a blob the
// Enclave wrapped under a key of its own, usable only by THIS Mac's Enclave. So the file needs no keychain access
// group and no signed app (measured 2026-11-03 on an unsigned swiftc build: create, reload from the blob, sign). The
// Enclave stops the key being used on another computer; it does not stop another program running as this user here.
//
// A key's access control is fixed when it is made and can never be added later, so the policy is a required argument
// of create rather than a default: `presence` for a real admin key, `none` only where no person is there to answer
// (a test). Measured 2026-11-03: making a `presence` key from a tmux/ssh session fails with errSecInteractionNotAllowed
// (-25308); from inside the app, with a person at the screen, is not measured yet (#7116).
//
// Usage:
//   kosmos-se create <keyfile> presence|none   make a key; refuses if <keyfile> exists. Prints the public key.
//   kosmos-se pub <keyfile>                    print the public key
//   kosmos-se sign <keyfile>                   read the message on stdin, print the DER signature
// Output is lowercase hex on one line; a public key is 65 bytes of uncompressed SEC1 (04 || x || y).
//
// sign refuses a message that does not start with one of SIGNABLE_TAGS, as a second fence behind engine/seadmin.js
// (which decodes every byte and checks the tag is the action the person chose). engine/seadmin-7116.test.js fails if
// this list and seadmin.js's SIGNED tags differ.
//
// Build: swiftc -O native-se/main.swift -o native-se/kosmos-se

import CryptoKit
import Foundation
import LocalAuthentication

let SIGNABLE_TAGS: [String] = [
    "kosmos-escrowd-roster-change v1",
    "kosmos-escrowd-roster-cancel v1",
    "kosmos-escrowd-reviewer-enrol v1",
    "kosmos-escrowd-reviewer-revoke v1",
]

// kosmos#7892: what a presence key's Touch ID or password prompt says the signature is for. It is chosen here from the
// signed message's own tag, never taken from an argument, so no caller can make the prompt describe another action.
// Expected, not yet seen (that needs a presence key and a person): macOS shows it after the program's name ("kosmos-se
// is trying to ..."), and inside the app that name may still read kosmos-se. engine/seadmin-7116.test.js fails if a tag
// in SIGNABLE_TAGS has no reason here.
let SIGN_REASONS: [String: String] = [
    "kosmos-escrowd-roster-change v1": "approve a change to your company's Kosmos admins",
    "kosmos-escrowd-roster-cancel v1": "cancel a pending change to your company's Kosmos admins",
    "kosmos-escrowd-reviewer-enrol v1": "add a reviewer for your company's Kosmos backups",
    "kosmos-escrowd-reviewer-revoke v1": "remove a reviewer for your company's Kosmos backups",
]
// The longest message escrowd's encoders make is a few hundred bytes; anything far larger is not one of them.
let MAX_MESSAGE = 64 * 1024

func fail(_ why: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(("kosmos-se: " + why + "\n").data(using: .utf8)!)
    exit(code)
}

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

func load(_ path: String, _ context: LAContext? = nil) -> SecureEnclave.P256.Signing.PrivateKey {
    // Opened once, never through a symlink, and every check is on the open descriptor, so what is checked is what is read.
    let fd = open(path, O_RDONLY | O_NOFOLLOW)
    guard fd >= 0 else { fail(errno == ELOOP ? "the key file is not a plain file" : "cannot read the key file") }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    var st = stat()
    guard fstat(fd, &st) == 0 else { fail("cannot read the key file") }
    guard (st.st_mode & S_IFMT) == S_IFREG else { fail("the key file is not a plain file") }
    guard st.st_uid == getuid() else { fail("the key file belongs to someone else") }
    guard (st.st_mode & 0o777) == 0o600 else { fail("the key file is readable by others (it must be 0600)") }
    guard let blob = try? handle.readToEnd(), !blob.isEmpty else { fail("cannot read the key file") }
    do { return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob, authenticationContext: context) }
    catch { fail("this Mac's Secure Enclave cannot open that key file") }
}

func readMessage() -> Data {
    var message = Data()
    while message.count <= MAX_MESSAGE {
        let chunk = FileHandle.standardInput.readData(ofLength: MAX_MESSAGE + 1 - message.count)
        if chunk.isEmpty { break }
        message.append(chunk)
    }
    guard message.count <= MAX_MESSAGE else { fail("the message is too long to be an escrowd action") }
    return message
}

let args = CommandLine.arguments
let usage = "usage: kosmos-se create <keyfile> presence|none | pub <keyfile> | sign <keyfile>"
guard args.count >= 3 else { fail(usage, 2) }
let (verb, path) = (args[1], args[2])

switch verb {
case "create":
    guard args.count == 4, ["presence", "none"].contains(args[3]) else { fail(usage, 2) }
    guard SecureEnclave.isAvailable else { fail("this Mac has no Secure Enclave", 3) }
    let key: SecureEnclave.P256.Signing.PrivateKey
    do {
        if args[3] == "presence" {
            var err: Unmanaged<CFError>?
            guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                           [.privateKeyUsage, .userPresence], &err) else {
                fail("cannot make the access control for a presence key")
            }
            key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: ac)
        } else {
            key = try SecureEnclave.P256.Signing.PrivateKey()
        }
    } catch { fail("the Secure Enclave refused to make a key (\(error.localizedDescription))") }
    // O_EXCL: never overwrite a key someone may already have enrolled; 0600 from the first byte.
    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { fail(errno == EEXIST ? "the key file already exists" : "cannot create the key file") }
    let blob = key.dataRepresentation
    // fchmod: open's mode is reduced by the umask, and load() accepts exactly 0600.
    let moded = fchmod(fd, 0o600) == 0
    let wrote = blob.withUnsafeBytes { write(fd, $0.baseAddress, blob.count) }
    let synced = fsync(fd) == 0
    close(fd)
    guard moded && wrote == blob.count && synced else { unlink(path); fail("cannot write the key file") }
    // The public key printed below is about to be enrolled, so the directory entry must survive a crash too.
    let dir = open((path as NSString).deletingLastPathComponent.isEmpty ? "." : (path as NSString).deletingLastPathComponent, O_RDONLY)
    guard dir >= 0, fsync(dir) == 0 else { if dir >= 0 { close(dir) }; unlink(path); fail("cannot write the key file") }
    close(dir)
    print(hex(key.publicKey.x963Representation))
case "pub":
    guard args.count == 3 else { fail(usage, 2) }
    print(hex(load(path).publicKey.x963Representation))
case "sign":
    guard args.count == 3 else { fail(usage, 2) }
    // The message and its reason first, so the context carries the reason before the key is ever bound to it.
    let message = readMessage()
    guard let tag = SIGNABLE_TAGS.first(where: { message.starts(with: Data($0.utf8)) }), let reason = SIGN_REASONS[tag] else {
        fail("refusing to sign bytes that are not an escrowd admin action")
    }
    let context = LAContext()
    context.localizedReason = reason
    let key = load(path, context)
    // The prompt, if the key asks for one, appears at the signature below.
    do { print(hex(try key.signature(for: message).derRepresentation)) }
    catch { fail("the Secure Enclave refused to sign") }
default:
    fail(usage, 2)
}
