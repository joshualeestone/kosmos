package io.kosmos.app.signin

import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * kosmos#8046 slice 1 (board client): the software EC P-256 signing key, and the one conversion the device
 * proof turns on. Separate from SignIn so the signing material is isolated (Liu Kang 2026-11-06); the
 * hardware-backed key (Android Keystore) is a further isolated file, KeystoreDeviceKey.kt.
 *
 * THE RISK LIVES HERE. The coordinator (and iOS CryptoKit) speak ECDSA signatures as raw r||s, 64 bytes. The
 * JVM's Signature("SHA256withECDSA") speaks ASN.1 DER. So every signature this app makes must be turned from
 * DER to raw before it travels, and the WebCrypto vector (raw) must be turned to DER before the JVM will
 * verify it. EcdsaSig is that conversion, and SignInCryptoTest pins both directions against the coordinator's
 * own vector in devkey.rs.
 */
object EcdsaSig {
    private const val P256_HALF = 32  // a P-256 field element is 32 bytes; a raw signature is r(32) || s(32)

    /** A JVM DER ECDSA signature -> raw r||s (64 bytes). */
    fun derToRaw(der: ByteArray): ByteArray {
        var i = 0
        require(der.size >= 2 && der[i].toInt() and 0xFF == 0x30) { "not a DER SEQUENCE" }
        i++                       // SEQUENCE tag
        i += lengthBytes(der, i)  // step over the SEQUENCE length
        val r = readInteger(der, i); i = r.next
        val s = readInteger(der, i)
        return leftPad(r.value, P256_HALF) + leftPad(s.value, P256_HALF)
    }

    /** raw r||s (64 bytes) -> a canonical JVM-verifiable DER ECDSA signature. */
    fun rawToDer(raw: ByteArray): ByteArray {
        require(raw.size == 2 * P256_HALF) { "a raw P-256 signature is 64 bytes, got ${raw.size}" }
        val r = derInteger(raw.copyOfRange(0, P256_HALF))
        val s = derInteger(raw.copyOfRange(P256_HALF, 2 * P256_HALF))
        val body = r + s
        return byteArrayOf(0x30, body.size.toByte()) + body  // body length is < 128 for P-256, one length byte
    }

    // One ASN.1 INTEGER from a big-endian unsigned field element: strip leading zero bytes, then prepend a
    // 0x00 when the top bit is set (so it is not read as negative). Zero stays a single 0x00.
    private fun derInteger(field: ByteArray): ByteArray {
        var start = 0
        while (start < field.size - 1 && field[start].toInt() == 0) start++
        var v = field.copyOfRange(start, field.size)
        if (v[0].toInt() and 0x80 != 0) v = byteArrayOf(0x00) + v
        return byteArrayOf(0x02, v.size.toByte()) + v
    }

    private data class Int2(val value: ByteArray, val next: Int)

    private fun readInteger(der: ByteArray, at: Int): Int2 {
        require(der[at].toInt() and 0xFF == 0x02) { "expected a DER INTEGER" }
        var i = at + 1
        val lenAt = i
        val len = readLength(der, lenAt)
        i += lengthBytes(der, lenAt)
        return Int2(der.copyOfRange(i, i + len), i + len)
    }

    // Supports the short form and the 0x81 one-byte long form, which is all a P-256 signature can need.
    private fun readLength(der: ByteArray, at: Int): Int {
        val b = der[at].toInt() and 0xFF
        return when {
            b < 0x80 -> b
            b == 0x81 -> der[at + 1].toInt() and 0xFF
            else -> throw IllegalArgumentException("unsupported DER length form 0x${b.toString(16)}")
        }
    }

    private fun lengthBytes(der: ByteArray, at: Int): Int {
        val b = der[at].toInt() and 0xFF
        return if (b < 0x80) 1 else 1 + (b and 0x7F)
    }

    private fun leftPad(value: ByteArray, size: Int): ByteArray {
        // Drop a sign byte the INTEGER may carry, then left-pad with zeros to the field size.
        var v = value
        while (v.size > size && v[0].toInt() == 0) v = v.copyOfRange(1, v.size)
        require(v.size <= size) { "field element longer than $size bytes" }
        return ByteArray(size - v.size) + v
    }
}

/**
 * A software EC P-256 key, for the unit tests and previews. The real client signs with a hardware-backed key
 * (KeystoreDeviceKey, a following increment); this never ships as the device's key.
 */
class SoftwareDeviceKey private constructor(
    private val priv: PrivateKey,
    override val spki: ByteArray,
) : SignIn.DeviceKey {

    override fun sign(message: ByteArray): ByteArray {
        val sig = Signature.getInstance("SHA256withECDSA")
        sig.initSign(priv)
        sig.update(message)
        return EcdsaSig.derToRaw(sig.sign())
    }

    companion object {
        fun generate(): SoftwareDeviceKey {
            val kpg = KeyPairGenerator.getInstance("EC")
            kpg.initialize(ECGenParameterSpec("secp256r1"))
            val kp = kpg.generateKeyPair()
            // getEncoded() on an EC public key is X.509 SubjectPublicKeyInfo DER, i.e. the SPKI DER iOS signs over.
            return SoftwareDeviceKey(kp.private, kp.public.encoded)
        }
    }
}
