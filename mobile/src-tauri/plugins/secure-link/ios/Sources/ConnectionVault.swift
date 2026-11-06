import Foundation
import Security

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
    guard status == errSecSuccess else { throw VaultError.osStatus(status) }
    guard let data = item as? Data,
          let value = String(data: data, encoding: .utf8) else { throw VaultError.invalidEncoding }
    return value
  }
  static func save(_ value: String) throws {
    let values: [String: Any] = [kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw VaultError.osStatus(status) }
  }
  static func clear() throws {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw VaultError.osStatus(status) }
  }
  enum VaultError: Error, CustomStringConvertible {
    case osStatus(OSStatus), invalidEncoding
    var description: String {
      switch self {
      case .osStatus(let code): return "Keychain OSStatus \(code)"
      case .invalidEncoding: return "Invalid connection encoding"
      }
    }
  }
}
