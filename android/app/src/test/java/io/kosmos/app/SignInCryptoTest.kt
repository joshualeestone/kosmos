package io.kosmos.app

import io.kosmos.app.signin.EcdsaSig
import io.kosmos.app.signin.SignIn
import io.kosmos.app.signin.SoftwareDeviceKey
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * kosmos#8046 slice 1 (board client): the device-proof crypto, pinned by content to the coordinator's own
 * WebCrypto vector (devkey.rs a_webcrypto_vector_verifies), mirroring ios/LogicTests/main.swift. If any of
 * base64url, the device id, the signed message bytes, or the DER<->raw signature conversion drifts from the
 * coordinator, the vector stops verifying here, before it ever reaches a real sign-in.
 */
class SignInCryptoTest {

    private fun verifies(spki: ByteArray, rawSig: ByteArray, message: ByteArray): Boolean {
        val pub = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
        val v = Signature.getInstance("SHA256withECDSA")
        v.initVerify(pub)
        v.update(message)
        return v.verify(EcdsaSig.rawToDer(rawSig))
    }

    @Test fun webCryptoVector() {
        val spki = SignIn.fromBase64url(
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg3kVSogZ6EsxikmCEN0Ayo7wzD4OVBGegXurZ-XzpB-CWClbfd9GflpSkK5gkDfjipboV234X0qmNfDCEaIAkA"
        )!!
        val id = "k1.nIuw38MT55xf0l4wuLmgpkKs-q53DRza"
        val sig = SignIn.fromBase64url(
            "dJAzYXFx8mds36DkO6aAsWf8ALONWju7lMcfFAKvqP1iQJZl3ZPclUez-Z5lRV4JOw8RLGjbAYymUc-_8fuLhQ"
        )!!

        assertEquals("the id is the one the coordinator derives from that key", id, SignIn.deviceID(spki))
        assertTrue(
            "the message bytes are the ones WebCrypto signed",
            verifies(spki, sig, SignIn.proofMessage(email = "Her@X.test", code = "482913", deviceID = id))
        )
        assertFalse(
            "control: the same proof for another code does not verify",
            verifies(spki, sig, SignIn.proofMessage(email = "Her@X.test", code = "482914", deviceID = id))
        )
        assertFalse(
            "control: the email is signed exactly as sent (lowercased does not verify)",
            verifies(spki, sig, SignIn.proofMessage(email = "her@x.test", code = "482913", deviceID = id))
        )
    }

    @Test fun freshKeyProofAndBody() {
        val key = SoftwareDeviceKey.generate()
        assertTrue("a keyed id: k1. and 32 characters", key.id.startsWith("k1.") && key.id.length == 35)

        val body = SignIn.verifyBody(email = "Ada@Example.com", code = "123456", deviceName = "Ada's Pixel", key = key)
        val sigText = body["device_sig"] as String
        val sig = SignIn.fromBase64url(sigText)!!
        val keyText = body["device_key"] as String

        assertEquals("the signature is 64 raw bytes, not DER", 64, sig.size)
        assertArrayEquals("the key travels", key.spki, SignIn.fromBase64url(keyText))
        assertEquals("the id travels with it", key.id, body["device_id"])
        assertFalse(
            "base64url with no padding",
            sigText.contains("=") || sigText.contains("+") || sigText.contains("/")
        )
        assertTrue(
            "the fresh proof verifies over the email as typed",
            verifies(key.spki, sig, SignIn.proofMessage(email = "Ada@Example.com", code = "123456", deviceID = key.id))
        )
        assertEquals("the email goes as signed", "Ada@Example.com", body["email"])
        assertEquals("the code goes as signed", "123456", body["code"])
        assertEquals("start sends the email, the id and the name only", 3, SignIn.startBody("a@b.co", key.id, "n").size)
        assertEquals("second sends the challenge and the code", 2, SignIn.secondBody("c1", "123456").size)
    }

    @Test fun base64urlCodec() {
        assertEquals("empty is empty, no padding", "", SignIn.base64url(ByteArray(0)))
        assertEquals("one byte is two chars, no padding", "AA", SignIn.base64url(byteArrayOf(0)))
        assertEquals("two bytes are three chars, no padding", "AAA", SignIn.base64url(byteArrayOf(0, 0)))

        // The url alphabet: 0xFB 0xFF 0xFE exercises the 62/63 code points, which standard base64 writes as +//.
        val url = SignIn.base64url(byteArrayOf(0xFB.toByte(), 0xFF.toByte(), 0xFE.toByte()))
        assertFalse("never the standard alphabet", url.contains('+') || url.contains('/') || url.contains('='))

        val blob = ByteArray(40) { (it * 7 + 3).toByte() }
        assertArrayEquals("round trip", blob, SignIn.fromBase64url(SignIn.base64url(blob)))
        assertArrayEquals("tolerant of padding", byteArrayOf(0), SignIn.fromBase64url("AA=="))
        val std = url.replace('-', '+').replace('_', '/')
        assertArrayEquals("tolerant of the standard alphabet", SignIn.fromBase64url(url), SignIn.fromBase64url(std))
    }
}
