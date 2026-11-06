package dev.agentcouncil.securelink
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg class SaveArgs { lateinit var value: String }
@InvokeArg class WebArgs { lateinit var url: String }
@TauriPlugin
class SecureLinkPlugin(private val activity: Activity): Plugin(activity) {
  private val alias = "CouncilCompanionConnection"
  private val prefs get() = activity.getSharedPreferences("council_connection", 0)
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @Command fun load(invoke: Invoke) {
    try {
      val stored = prefs.getString("encrypted", null)
      val out = JSObject()
      if (stored != null) {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        out.put("value", String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
      }
      invoke.resolve(out)
    } catch (_: Exception) { invoke.reject("Cannot unlock the saved connection.") }
  }
  @Command fun save(invoke: Invoke) {
    try {
      val value = invoke.parseArgs(SaveArgs::class.java).value.toByteArray(Charsets.UTF_8)
      require(value.size <= 8192)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val encrypted = Base64.encodeToString(cipher.iv + cipher.doFinal(value), Base64.NO_WRAP)
      check(prefs.edit().putString("encrypted", encrypted).commit())
      invoke.resolve()
    } catch (_: Exception) { invoke.reject("Could not securely save the connection.") }
  }
  @Command fun clear(invoke: Invoke) {
    if (prefs.edit().clear().commit()) invoke.resolve()
    else invoke.reject("Could not remove the saved connection.")
  }
  @Command fun openWeb(invoke: Invoke) {
    try {
      val uri = Uri.parse(invoke.parseArgs(WebArgs::class.java).url)
      require(uri.scheme == "https" && uri.host != null && uri.userInfo == null)
      activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
      invoke.resolve()
    } catch (_: Exception) { invoke.reject("Cannot open the browser.") }
  }
}

