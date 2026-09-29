import UIKit
import WebKit
import Capacitor
import AVFoundation
import MediaPlayer
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
        CAPPluginMethod(name: "syncNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secure", returnType: CAPPluginReturnPromise)
    ]
    private var playbackCategoryConfigured = false
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var nowPlayingState: [String: Any] = [:]
    private var coverKey = ""
    private var coverGeneration = 0
    private var coverTask: URLSessionDataTask?
    private var coverArtwork: MPMediaItemArtwork?

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

    // The WKWebView audio element remains the only player. Native code only
    // publishes music metadata and routes track buttons back to that element.
    private func installTrackCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.skipBackwardCommand.isEnabled = false
        commands.skipForwardCommand.isEnabled = false
        commands.seekBackwardCommand.isEnabled = false
        commands.seekForwardCommand.isEnabled = false
        guard remoteTargets.isEmpty else { return }
        commands.previousTrackCommand.isEnabled = true
        commands.nextTrackCommand.isEnabled = true
        let previous = commands.previousTrackCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.remoteTrackCommand('previous')", completionHandler: nil)
            }
            return .success
        }
        let next = commands.nextTrackCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.remoteTrackCommand('next')", completionHandler: nil)
            }
            return .success
        }
        remoteTargets = [(commands.previousTrackCommand, previous), (commands.nextTrackCommand, next)]
    }

    private func publishNowPlaying() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlayingState["title"] as? String ?? "Mineradio",
            MPMediaItemPropertyArtist: nowPlayingState["artist"] as? String ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: (nowPlayingState["playing"] as? Bool == true) ? 1.0 : 0.0
        ]
        let duration = nowPlayingState["duration"] as? Double ?? 0
        let position = nowPlayingState["position"] as? Double ?? 0
        if duration.isFinite && duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = min(duration, max(0, position))
        }
        if let artwork = coverArtwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func applyCover(_ image: UIImage, key: String, generation: Int) {
        guard generation == coverGeneration && key == coverKey else { return }
        coverArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        publishNowPlaying()
    }

    private func loadCover(_ text: String) {
        guard text != coverKey else { return }
        coverTask?.cancel()
        coverKey = text
        coverGeneration += 1
        coverArtwork = nil
        let generation = coverGeneration
        guard !text.isEmpty else { publishNowPlaying(); return }
        if text.hasPrefix("data:"), let comma = text.firstIndex(of: ","),
           text[..<comma].contains(";base64"),
           let data = Data(base64Encoded: String(text[text.index(after: comma)...])),
           let image = UIImage(data: data) {
            applyCover(image, key: text, generation: generation)
            return
        }
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            publishNowPlaying(); return
        }
        var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 12)
        request.setValue("image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8", forHTTPHeaderField: "Accept")
        coverTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let data = data, data.count < 8 * 1024 * 1024,
                  let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode),
                  let image = UIImage(data: data) else { return }
            DispatchQueue.main.async { self?.applyCover(image, key: text, generation: generation) }
        }
        coverTask?.resume()
    }

    @objc func syncNowPlaying(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.nowPlayingState = [
                "title": call.getString("title") ?? "Mineradio",
                "artist": call.getString("artist") ?? "",
                "duration": (call.options["duration"] as? NSNumber)?.doubleValue ?? 0,
                "position": (call.options["position"] as? NSNumber)?.doubleValue ?? 0,
                "playing": call.options["playing"] as? Bool ?? false
            ]
            self.installTrackCommands()
            self.loadCover(call.getString("cover") ?? "")
            self.publishNowPlaying()
            call.resolve()
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
