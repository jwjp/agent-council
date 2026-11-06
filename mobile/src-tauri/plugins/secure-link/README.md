# Native connection vault

Rust-only load/save/clear and HTTPS system-browser dispatch. No frontend invoke handler or permissions are registered.

iOS uses device-only Keychain items while unlocked. Android stores AES/GCM ciphertext in non-backed-up preferences with an Android Keystore key. Desktop use fails explicitly; it never falls back to plaintext. See [native companion](../../../../docs/NATIVE_COMPANION.md) for verification limits.
