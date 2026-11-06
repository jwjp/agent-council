import Tauri
import Security
import UIKit

// Device-only, no iCloud synchronization; never exposed to webview commands.
enum ConnectionVault {
  static let service = "dev.agentcouncil.companion.connection"
  static let account = "approved-host"
  static var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service, kSecAttrAccount as String: account]
  }
  static func load() throws -> String? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data,
          let value = String(data: data, encoding: .utf8) else { throw VaultError.failed }
    return value
  }
  static func save(_ value: String) throws {
    let values: [String: Any] = [kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw VaultError.failed }
  }
  static func clear() throws {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError.failed }
  }
  enum VaultError: Error { case failed }
}
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

