import UIKit
import WebKit
import Capacitor
import AVFoundation
import CryptoKit
import Security

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

class MineradioViewController: CAPBridgeViewController {
    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MineradioNativePlugin())
        view.backgroundColor = UIColor(red: 0.02, green: 0.025, blue: 0.03, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = view.backgroundColor
        webView?.scrollView.backgroundColor = view.backgroundColor
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        webView?.scrollView.bounces = false
        setNeedsStatusBarAppearanceUpdate()
    }
}

@objc(MineradioNativePlugin)
class MineradioNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MineradioNativePlugin"
    let jsName = "MineradioNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secure", returnType: CAPPluginReturnPromise)
    ]
    private var playbackCategoryConfigured = false

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        if !playbackCategoryConfigured {
            try session.setCategory(.playback, mode: .default, options: [])
            playbackCategoryConfigured = true
        }
        try session.setActive(true)
    }

    @objc func activateAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try self.activateSession(); call.resolve() }
            catch { call.reject("无法激活 iOS 播放会话") }
        }
    }

    // Keychain stores only a device-bound AES key. No API key is written in
    // plaintext or put into NSUserDefaults, localStorage or an exported backup.
    private func encryptionKey() throws -> SymmetricKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "Mineradio.Agent", kSecAttrAccount as String: "device-encryption-key"]
        var lookup = query; lookup[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data { return SymmetricKey(data: data) }
        guard status == errSecItemNotFound else { throw NSError(domain: "MineradioKeychain", code: Int(status)) }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        var save = query; save[kSecValueData as String] = data
        save[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let saved = SecItemAdd(save as CFDictionary, nil)
        guard saved == errSecSuccess else { throw NSError(domain: "MineradioKeychain", code: Int(saved)) }
        return key
    }

    @objc func secure(_ call: CAPPluginCall) {
        do {
            let key = try encryptionKey()
            let value = call.getString("value") ?? ""
            if call.getString("action") == "encrypt" {
                let box = try AES.GCM.seal(Data(value.utf8), using: key)
                call.resolve(["value": box.combined!.base64EncodedString()])
            } else if call.getString("action") == "decrypt", let data = Data(base64Encoded: value) {
                let decrypted = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
                guard let text = String(data: decrypted, encoding: .utf8) else { throw NSError(domain: "MineradioKeychain", code: -1) }
                call.resolve(["value": text])
            } else { call.reject("无效的钥匙串操作") }
        } catch { call.reject("iOS 钥匙串不可用，密钥未保存") }
    }
}
