import XCTest
import Security
final class VaultTests: XCTestCase {
  override func setUpWithError() throws { try ConnectionVault.clear() }
  override func tearDownWithError() throws { try ConnectionVault.clear() }

  func testSaveRestoreUpdateAndExplicitClear() throws {
    XCTAssertNil(try ConnectionVault.load())
    try ConnectionVault.save("fixture-only · 한글 connection")
    XCTAssertEqual(try ConnectionVault.load(), "fixture-only · 한글 connection")
    try ConnectionVault.save("replacement fixture")
    XCTAssertEqual(try ConnectionVault.load(), "replacement fixture")
    try ConnectionVault.clear()
    try ConnectionVault.clear()
    XCTAssertNil(try ConnectionVault.load())
  }
  func testDeviceOnlyProtectionAndNoCloudSync() throws {
    try ConnectionVault.save("fixture-only")
    var query = ConnectionVault.query
    query[kSecReturnAttributes as String] = true
    var item: CFTypeRef?
    XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &item), errSecSuccess)
    let attributes = try XCTUnwrap(item as? [String: Any])
    XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
    XCTAssertNotEqual(attributes[kSecAttrSynchronizable as String] as? Bool, true)
  }
  func testCorruptEncodingFailsClosedInsteadOfBecomingMissing() throws {
    var query = ConnectionVault.query
    query[kSecValueData as String] = Data([0xff, 0xfe])
    XCTAssertEqual(SecItemAdd(query as CFDictionary, nil), errSecSuccess)
    XCTAssertThrowsError(try ConnectionVault.load())
  }
}
