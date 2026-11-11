package dev.agentcouncil.securelink
import android.app.Activity
import android.content.Intent
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg class SaveArgs { lateinit var value: String }
@InvokeArg class WebArgs { lateinit var url: String }
@TauriPlugin
class SecureLinkPlugin(private val activity: Activity): Plugin(activity) {
  private val vault = ConnectionVault(activity)
  @Command fun load(invoke: Invoke) {
    try {
      val out = JSObject()
      vault.load()?.let { out.put("value", it) }
      invoke.resolve(out)
    } catch (_: Exception) { invoke.reject("Cannot unlock the saved connection.") }
  }
  @Command fun save(invoke: Invoke) {
    try {
      vault.save(invoke.parseArgs(SaveArgs::class.java).value)
      invoke.resolve()
    } catch (_: Exception) { invoke.reject("Could not securely save the connection.") }
  }
  @Command fun clear(invoke: Invoke) {
    try {
      vault.clear()
      invoke.resolve()
    } catch (_: Exception) { invoke.reject("Could not remove the saved connection.") }
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

