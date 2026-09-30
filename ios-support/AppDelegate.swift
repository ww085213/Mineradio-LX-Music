import UIKit
import WebKit
import Capacitor
import AVFoundation
import MediaPlayer
import NowPlaying
import Observation
import CryptoKit
import Security

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

class MineradioSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
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

// iPadOS 27 provides one explicit system Now Playing session. The WKWebView
// audio element is still the only decoder; these commands return to its queue.
@available(iOS 27.0, *)
@Observable
@MainActor
final class MineradioOfficialNowPlayingModel: MediaSessionRepresentable {
    // UIKit imports a non-generic KeyPath symbol; Observation's generated
    // registrar needs Swift's generic key-path type in this scope.
    typealias KeyPath<Root, Value> = Swift.KeyPath<Root, Value>
    let id = "com.ww085213.mineradio.mobile.music"
    var trackID = ""
    var title = "Mineradio"
    var artist = ""
    var duration: TimeInterval = 0
    var position: TimeInterval = 0
    var isPlaying = false
    var artworkData: Data?
    var artworkRevision = 0
    @ObservationIgnored var onCommand: ((String) -> Void)?

    var content: (any MediaContentRepresentable)? {
        guard !trackID.isEmpty else { return nil }
        let artwork: Artwork? = artworkData.map { data in
            Artwork(id: "\(trackID)#\(artworkRevision)") { _ in
                try ArtworkRepresentation(data: data)
            }
        }
        return MusicContent(id: trackID, songTitle: title, artistName: artist,
                            albumName: "", type: .audio,
                            duration: duration > 0 ? .finite(duration) : nil,
                            artwork: artwork)
    }

    var playbackSnapshot: MediaPlaybackSnapshot? {
        guard !trackID.isEmpty else { return nil }
        return MediaPlaybackSnapshot(state: isPlaying ? .playing(rate: 1.0) : .paused,
                                     elapsedTime: max(0, position), timestamp: .now)
    }

    var commands: [MediaCommand] {
        [
            .play { self.onCommand?("play") },
            .pause { self.onCommand?("pause") },
            .previous { self.onCommand?("previous") },
            .next { self.onCommand?("next") }
        ]
    }

    func update(_ state: [String: Any], coverData: Data?) {
        let newTitle = state["title"] as? String ?? "Mineradio"
        let newArtist = state["artist"] as? String ?? ""
        let index = state["queueIndex"] as? Int ?? -1
        let newTrackID = "\(index):\(newTitle):\(newArtist)"
        if trackID != newTrackID { trackID = newTrackID; artworkRevision += 1 }
        title = newTitle
        artist = newArtist
        duration = state["duration"] as? Double ?? 0
        position = state["position"] as? Double ?? 0
        isPlaying = state["playing"] as? Bool ?? false
        if artworkData != coverData { artworkData = coverData; artworkRevision += 1 }
    }
}

@available(iOS 27.0, *)
@MainActor
final class MineradioOfficialNowPlaying {
    let model = MineradioOfficialNowPlayingModel()
    let session: MediaSession<MineradioOfficialNowPlayingModel>

    init(onCommand: @escaping (String) -> Void) {
        model.onCommand = onCommand
        session = MediaSession(model)
    }

    func update(_ state: [String: Any], coverData: Data?) {
        model.update(state, coverData: coverData)
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
    private var audioSessionActivated = false
    private var audioInterruptionObserver: NSObjectProtocol?
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var nowPlayingState: [String: Any] = [:]
    private var coverKey = ""
    private var coverGeneration = 0
    private var coverTask: URLSessionDataTask?
    private var coverArtwork: MPMediaItemArtwork?
    private var coverImageData: Data?
    private var officialNowPlaying: AnyObject?

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        if !playbackCategoryConfigured {
            try session.setCategory(.playback, mode: .default, options: [])
            playbackCategoryConfigured = true
        }
        if audioInterruptionObserver == nil {
            audioInterruptionObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main
            ) { [weak self] notification in
                let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if raw == AVAudioSession.InterruptionType.began.rawValue { self?.audioSessionActivated = false }
            }
        }
        guard !audioSessionActivated else { return }
        try session.setActive(true)
        audioSessionActivated = true
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
        if #available(iOS 27.0, *) { return }
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
        if #available(iOS 27.0, *) {
            // All call sites arrive on DispatchQueue.main (plugin call or cover
            // completion), so the observable session is updated on its actor.
            MainActor.assumeIsolated {
                let official: MineradioOfficialNowPlaying
                if let current = officialNowPlaying as? MineradioOfficialNowPlaying {
                    official = current
                } else {
                    official = MineradioOfficialNowPlaying { [weak self] command in
                        self?.webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.remoteSystemCommand('\(command)')", completionHandler: nil)
                    }
                    officialNowPlaying = official
                }
                official.update(nowPlayingState, coverData: coverImageData)
            }
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlayingState["title"] as? String ?? "Mineradio",
            MPMediaItemPropertyArtist: nowPlayingState["artist"] as? String ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: (nowPlayingState["playing"] as? Bool == true) ? 1.0 : 0.0
        ]
        let duration = nowPlayingState["duration"] as? Double ?? 0
        let position = nowPlayingState["position"] as? Double ?? 0
        let queueCount = nowPlayingState["queueCount"] as? Int ?? 0
        let queueIndex = nowPlayingState["queueIndex"] as? Int ?? -1
        if queueCount > 0 {
            info[MPNowPlayingInfoPropertyPlaybackQueueCount] = queueCount
            info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = max(0, min(queueCount - 1, queueIndex))
        }
        if duration.isFinite && duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = min(duration, max(0, position))
        }
        if let artwork = coverArtwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func applyCover(_ image: UIImage, key: String, generation: Int) {
        guard generation == coverGeneration && key == coverKey else { return }
        coverImageData = image.jpegData(compressionQuality: 0.88)
        if #unavailable(iOS 27.0) {
            coverArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        publishNowPlaying()
    }

    private func loadCover(_ text: String) {
        guard text != coverKey else { return }
        coverTask?.cancel()
        coverKey = text
        coverGeneration += 1
        coverArtwork = nil
        coverImageData = nil
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
        var candidates = [url]
        if url.path == "/api/image-proxy",
           let original = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
           let fallback = URL(string: original), ["http", "https"].contains(fallback.scheme?.lowercased() ?? "") {
            candidates.append(fallback)
        }
        fetchCover(candidates, index: 0, key: text, generation: generation)
    }

    private func fetchCover(_ candidates: [URL], index: Int, key: String, generation: Int) {
        guard generation == coverGeneration && key == coverKey && index < candidates.count else { return }
        var request = URLRequest(url: candidates[index], cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 12)
        request.setValue("image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8", forHTTPHeaderField: "Accept")
        coverTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self = self, generation == self.coverGeneration && key == self.coverKey else { return }
                if let data = data, data.count < 8 * 1024 * 1024,
                   let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode),
                   let image = UIImage(data: data) {
                    self.applyCover(image, key: key, generation: generation)
                } else {
                    self.fetchCover(candidates, index: index + 1, key: key, generation: generation)
                }
            }
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
                "playing": call.options["playing"] as? Bool ?? false,
                "queueCount": (call.options["queueCount"] as? NSNumber)?.intValue ?? 0,
                "queueIndex": (call.options["queueIndex"] as? NSNumber)?.intValue ?? -1
            ]
            self.installTrackCommands()
            self.loadCover(call.getString("cover") ?? "")
            self.publishNowPlaying()
            if #available(iOS 27.0, *), let official = self.officialNowPlaying as? MineradioOfficialNowPlaying {
                if UIApplication.shared.applicationState == .active && !official.session.isSystemPrimary {
                    Task { @MainActor in
                        do {
                            try await official.session.requestToBecomeSystemPrimary()
                            call.resolve(["officialNowPlaying": official.session.isSystemPrimary])
                        } catch {
                            call.resolve(["officialNowPlaying": false])
                        }
                    }
                } else {
                    call.resolve(["officialNowPlaying": official.session.isSystemPrimary])
                }
            } else {
                call.resolve(["officialNowPlaying": false])
            }
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
