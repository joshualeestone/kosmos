package io.kosmos.app.signin

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * kosmos#8046 slice 1 (board client): the hardware-backed device key, the real implementation of
 * [SignIn.DeviceKey]. ISOLATED in its own file (Liu Kang 2026-11-06) so the signing material reviews on its
 * own; the sign-in flow depends only on the interface. The iOS analog is the Secure Enclave key.
 *
 * The private key is generated in the platform AndroidKeyStore (EC P-256, sign-only, SHA-256) and never
 * leaves it; only [spki] (the public key as SPKI DER) and signatures come out. The DER-to-raw conversion is
 * the same [EcdsaSig] the device proof is pinned on against the coordinator's WebCrypto vector, so the bytes
 * this emits match what [SoftwareDeviceKey] emits in the tests.
 *
 * Android-only: not exercised by the JVM unit tests (it needs the Keystore). The build compiles it; it is
 * verified on a device, and it is in scope for the /challenge-loop on the whole branch before the PR.
 */
class KeystoreDeviceKey private constructor(
    private val privateKey: PrivateKey,
    override val spki: ByteArray,
) : SignIn.DeviceKey {

    override fun sign(message: ByteArray): ByteArray {
        val sig = Signature.getInstance("SHA256withECDSA")
        sig.initSign(privateKey)
        sig.update(message)
        return EcdsaSig.derToRaw(sig.sign())
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "kosmos_device_v1"

        /** The device's key, generated on first use and reused after. */
        fun orCreate(): KeystoreDeviceKey {
            val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            val entry = (ks.getEntry(ALIAS, null) as? KeyStore.PrivateKeyEntry) ?: generate(ks)
            return KeystoreDeviceKey(entry.privateKey, entry.certificate.publicKey.encoded)
        }

        private fun generate(ks: KeyStore): KeyStore.PrivateKeyEntry {
            val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
            kpg.initialize(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            kpg.generateKeyPair()
            return ks.getEntry(ALIAS, null) as KeyStore.PrivateKeyEntry
        }
    }
}
