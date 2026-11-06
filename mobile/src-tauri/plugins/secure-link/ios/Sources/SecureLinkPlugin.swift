import Tauri
import Security
import UIKit

private struct SaveArgs: Decodable { let value: String }
private struct WebArgs: Decodable { let url: String }
class SecureLinkPlugin: Plugin {
  @objc public func load(_ invoke: Invoke) throws {
    do {
      if let value = try ConnectionVault.load() { invoke.resolve(["value": value]) }
      else { invoke.resolve([:]) }
    } catch { invoke.reject("Cannot unlock the saved connection.") }
  }
  @objc public func save(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SaveArgs.self)
    guard args.value.utf8.count <= 8192 else { invoke.reject("Invalid connection size."); return }
    do { try ConnectionVault.save(args.value); invoke.resolve() }
    catch { invoke.reject("Could not securely save the connection.") }
  }
  @objc public func clear(_ invoke: Invoke) throws {
    do { try ConnectionVault.clear(); invoke.resolve() }
    catch { invoke.reject("Could not remove the saved connection.") }
  }
  @objc public func openWeb(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WebArgs.self)
    guard let url = URL(string: args.url), url.scheme == "https", url.host != nil,
          url.user == nil, url.password == nil else { invoke.reject("Only HTTPS links are allowed."); return }
    DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { ok in
      if ok { invoke.resolve() } else { invoke.reject("Cannot open the browser.") }
    } }
  }
}
@_cdecl("init_plugin_secure_link")
public func initPlugin() -> Plugin { SecureLinkPlugin() }

