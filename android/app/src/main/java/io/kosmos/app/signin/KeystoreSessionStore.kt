package io.kosmos.app.signin

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * kosmos#8046 slice 1 (board client): the hardware-backed session-token store, the real implementation of
 * [SessionStore]. ISOLATED in its own file (Liu Kang 2026-11-06) so this security-sensitive code reviews on
 * its own; the rest of the board client depends only on the interface. The iOS analog is SessionKeychain.
 *
 * This is the ONE Android-only file in the board-client core, so it is NOT exercised by the JVM unit tests
 * (it needs the Android Keystore + a real Context). The build compiles it against the SDK; it is verified for
 * real on a device.
 *
 * DECISION (recorded on the #8046 plan): the token is sealed with an AES-256-GCM key held in the platform
 * AndroidKeyStore, and the sealed bytes live in a private SharedPreferences file. Rejected: Jetpack Security's
 * EncryptedSharedPreferences, the other option the plan named, because androidx.security:security-crypto is
 * deprecated by Google (2024) and would add a deprecated dependency for what the platform Keystore does
 * directly. The key never leaves the Keystore; only the sealed bytes are stored.
 *
 * WEAKEST PART: this is Android-only, so the JVM suite cannot prove round-trip correctness the way the device
 * proof is proven against the WebCrypto vector. The sealing/opening is verified on a device, and it is the
 * focus of the /challenge-loop that runs on the whole branch before the slice 1 PR.
 */
class KeystoreSessionStore(context: Context) : SessionStore {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun load(): String? {
        val sealed = prefs.getString(KEY_TOKEN, null) ?: return null
        val blob = SignIn.fromBase64url(sealed) ?: return null
        if (blob.size <= IV_BYTES) return null
        return try {
            val iv = blob.copyOfRange(0, IV_BYTES)
            val ciphertext = blob.copyOfRange(IV_BYTES, blob.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Exception) {
            // A key rotated out from under us, or tampered bytes: treat as no stored token (a forced sign-in).
            null
        }
    }

    override fun save(token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(KEY_TOKEN, SignIn.base64url(iv + ciphertext)).apply()
    }

    override fun clear() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "kosmos_session_v1"
        const val PREFS = "kosmos_session"
        const val KEY_TOKEN = "token"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12   // GCM standard nonce length
        const val TAG_BITS = 128  // GCM authentication tag, appended to the ciphertext by the cipher
    }
}
