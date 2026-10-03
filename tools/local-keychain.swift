import Foundation
import Security

// This helper exposes only MediaFlock's own key through a private process pipe.
// It never accepts account names, service names, or secrets on the command line.
let action = CommandLine.arguments.dropFirst().first ?? "read"
guard action == "read" || action == "ensure" else { exit(2) }
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "org.mediaflock.local-subscriptions",
    kSecAttrAccount as String: "installation-encryption-key",
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne,
    kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
]
var item: CFTypeRef?
var status = SecItemCopyMatching(query as CFDictionary, &item)
if status == errSecItemNotFound && action == "ensure" {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { exit(3) }
    let key = Data(bytes)
    let attributes: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.mediaflock.local-subscriptions",
        kSecAttrAccount as String: "installation-encryption-key",
        kSecAttrLabel as String: "MediaFlock local subscriptions",
        kSecValueData as String: key,
    ]
    status = SecItemAdd(attributes as CFDictionary, nil)
    if status == errSecDuplicateItem { status = SecItemCopyMatching(query as CFDictionary, &item) }
    else if status == errSecSuccess { item = key as CFData }
}
guard status == errSecSuccess, let key = item as? Data, key.count == 32 else {
    FileHandle.standardError.write(Data("MediaFlock keychain access unavailable.\n".utf8))
    exit(4)
}
let output = try JSONSerialization.data(withJSONObject: ["key": key.base64EncodedString()])
FileHandle.standardOutput.write(output)
