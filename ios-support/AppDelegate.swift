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

@objc(MineradioNativePlugin)
class MineradioNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "MineradioNativePlugin"
    let jsName = "MineradioNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAudio", returnType: CAPPluginReturnPromise),
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
    private var musicPlayer: AVPlayer?
    private var musicItem: AVPlayerItem?
    private var itemStatusObserver: NSKeyValueObservation?
    private var itemEndObserver: NSObjectProtocol?
    private var timeObserver: Any?
    private var playerStatusObserver: NSKeyValueObservation?
    private var playbackURL = ""
    private var playbackGeneration = 0
    private var remoteSeekSerial = 0
    private var remoteSeekTarget: Double?
    private var pendingPlayCall: CAPPluginCall?
    private var requestedRate: Float = 1
    private var repeatCurrentItem = false
    private var nativeEnded = false

    private func finiteSeconds(_ time: CMTime) -> Double {
        let value = CMTimeGetSeconds(time)
        return value.isFinite && value >= 0 ? value : 0
    }

    private func playbackState(_ event: String, message: String = "") -> [String: Any] {
        let position = musicPlayer.map { finiteSeconds($0.currentTime()) } ?? 0
        let duration = musicItem.map { finiteSeconds($0.duration) } ?? 0
        return ["event": event, "url": playbackURL, "position": position,
                "duration": duration, "playing": musicPlayer?.timeControlStatus == .playing && !nativeEnded,
                "message": message]
    }

    private func emitPlaybackState(_ event: String, message: String = "") {
        let state = playbackState(event, message: message)
        notifyListeners("audioState", data: state)
        guard JSONSerialization.isValidJSONObject(state),
              let data = try? JSONSerialization.data(withJSONObject: state),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.nativePlaybackEvent(\(json))", completionHandler: nil)
        // The system advances elapsed time from the published rate. Replacing
        // Now Playing every half-second can fight a lock-screen scrub gesture.
        if event != "timeupdate" { publishNowPlaying() }
    }

    private func finishPendingPlay(_ error: String? = nil) {
        guard let call = pendingPlayCall else { return }
        pendingPlayCall = nil
        if let error = error { call.reject(error) }
        else { call.resolve(playbackState("ready")) }
    }

    private func applyNativeAudioSettings(_ call: CAPPluginCall) {
        requestedRate = Float(max(0.5, min(2, (call.options["rate"] as? NSNumber)?.doubleValue ?? Double(requestedRate))))
        repeatCurrentItem = call.options["loop"] as? Bool ?? repeatCurrentItem
        musicPlayer?.volume = Float(max(0, min(1, (call.options["volume"] as? NSNumber)?.doubleValue ?? Double(musicPlayer?.volume ?? 1))))
        musicPlayer?.isMuted = call.options["muted"] as? Bool ?? musicPlayer?.isMuted ?? false
        if musicPlayer?.timeControlStatus == .playing { musicPlayer?.rate = requestedRate }
    }

    private func prepareMusicPlayer(_ url: URL, source: String) {
        playbackGeneration += 1
        remoteSeekSerial += 1
        remoteSeekTarget = nil
        nativeEnded = false
        itemStatusObserver = nil
        if let observer = itemEndObserver { NotificationCenter.default.removeObserver(observer) }
        itemEndObserver = nil
        let item = AVPlayerItem(url: url)
        musicItem = item
        playbackURL = source
        if musicPlayer == nil {
            musicPlayer = AVPlayer()
            musicPlayer?.automaticallyWaitsToMinimizeStalling = true
            playerStatusObserver = musicPlayer?.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.publishNowPlaying() }
            }
        }
        musicPlayer?.replaceCurrentItem(with: item)
        if timeObserver == nil, let player = musicPlayer {
            timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
                guard let self = self, self.musicPlayer?.currentItem === self.musicItem else { return }
                self.emitPlaybackState("timeupdate")
            }
        }
        itemEndObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self, weak item] _ in
            guard let self = self, self.musicItem === item else { return }
            if self.repeatCurrentItem {
                self.musicPlayer?.seek(to: .zero) { [weak self] _ in self?.musicPlayer?.play() }
            } else {
                self.nativeEnded = true
                self.emitPlaybackState("ended")
            }
        }
        let generation = playbackGeneration
        itemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] observed, _ in
            DispatchQueue.main.async {
                guard let self = self, self.playbackGeneration == generation, self.musicItem === item else { return }
                if observed.status == .failed {
                    let message = observed.error?.localizedDescription ?? "系统播放器无法读取音频"
                    self.finishPendingPlay(message)
                    self.emitPlaybackState("error", message: message)
                } else if observed.status == .readyToPlay {
                    self.startPreparedMusic()
                }
            }
        }
    }

    private var requestedStartPosition: Double = 0
    private func startPreparedMusic() {
        guard pendingPlayCall != nil, let player = musicPlayer else { return }
        let position = requestedStartPosition
        requestedStartPosition = 0
        let start = { [weak self] in
            guard let self = self else { return }
            player.play()
            player.rate = self.requestedRate
            self.finishPendingPlay()
            self.emitPlaybackState("playing")
        }
        if position > 0.35 {
            player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                DispatchQueue.main.async(execute: start)
            }
        } else { start() }
    }

    @objc func playAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let source = call.getString("url") ?? ""
            let clientSource = call.getString("clientUrl") ?? source
            guard let url = URL(string: source), ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else {
                call.reject("系统播放器不支持此音频地址")
                return
            }
            do { try self.activateSession() }
            catch { call.reject("无法激活 iOS 播放会话"); return }
            self.finishPendingPlay("已切换歌曲")
            self.pendingPlayCall = call
            self.requestedStartPosition = max(0, (call.options["position"] as? NSNumber)?.doubleValue ?? 0)
            if clientSource != self.playbackURL || self.musicItem == nil || self.musicItem?.status == .failed {
                self.prepareMusicPlayer(url, source: clientSource)
            } else if self.musicItem?.status == .readyToPlay {
                let current = self.musicPlayer.map { self.finiteSeconds($0.currentTime()) } ?? 0
                if abs(current - self.requestedStartPosition) < 1 { self.requestedStartPosition = 0 }
                self.nativeEnded = false
                self.startPreparedMusic()
            }
            self.applyNativeAudioSettings(call)
            let generation = self.playbackGeneration
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
                guard let self = self, self.playbackGeneration == generation, self.pendingPlayCall === call else { return }
                self.finishPendingPlay("系统播放器加载超时")
                self.emitPlaybackState("error", message: "系统播放器加载超时")
            }
        }
    }

    @objc func pauseAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.musicPlayer?.pause()
            self.emitPlaybackState("pause")
            call.resolve()
        }
    }

    @objc func seekAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let source = call.getString("url") ?? ""
            guard source == self.playbackURL, let player = self.musicPlayer else { call.resolve(); return }
            let position = max(0, (call.options["position"] as? NSNumber)?.doubleValue ?? 0)
            player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) { _ in
                DispatchQueue.main.async { self.emitPlaybackState("timeupdate"); call.resolve() }
            }
        }
    }

    @objc func setAudioSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.applyNativeAudioSettings(call); call.resolve() }
    }

    @objc func stopAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let source = call.getString("url") ?? ""
            guard source.isEmpty || source == self.playbackURL else { call.resolve(); return }
            self.finishPendingPlay("已停止播放")
            self.musicPlayer?.pause()
            self.musicPlayer?.replaceCurrentItem(with: nil)
            self.musicItem = nil
            self.playbackURL = ""
            self.nativeEnded = false
            self.remoteSeekSerial += 1
            self.remoteSeekTarget = nil
            self.publishNowPlaying()
            call.resolve()
        }
    }

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

    // AVPlayer is the sole decoder. The web UI controls it through the facade;
    // WebKit never starts its own media session or ten-second skip controls.
    private func seekFromSystem(_ requestedPosition: Double) {
        guard let player = musicPlayer, let item = musicItem else { return }
        let nativeDuration = finiteSeconds(item.duration)
        let reportedDuration = nowPlayingState["duration"] as? Double ?? 0
        let duration = nativeDuration > 0 ? nativeDuration : reportedDuration
        let position = duration > 0 ? min(duration, requestedPosition) : requestedPosition
        remoteSeekSerial += 1
        let serial = remoteSeekSerial
        let generation = playbackGeneration
        remoteSeekTarget = position
        publishNowPlaying()
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            DispatchQueue.main.async {
                guard let self = self, self.playbackGeneration == generation, self.remoteSeekSerial == serial else { return }
                self.remoteSeekTarget = nil
                if finished { self.emitPlaybackState("seeked") }
                else { self.publishNowPlaying() }
            }
        }
    }

    private func installTrackCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.skipBackwardCommand.isEnabled = false
        commands.skipForwardCommand.isEnabled = false
        commands.seekBackwardCommand.isEnabled = false
        commands.seekForwardCommand.isEnabled = false
        commands.previousTrackCommand.isEnabled = true
        commands.nextTrackCommand.isEnabled = true
        commands.changePlaybackPositionCommand.isEnabled = true
        commands.playCommand.isEnabled = true
        commands.pauseCommand.isEnabled = true
        guard remoteTargets.isEmpty else { return }
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
        let seek = commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent,
                  positionEvent.positionTime.isFinite, positionEvent.positionTime >= 0 else { return .commandFailed }
            let position = positionEvent.positionTime
            DispatchQueue.main.async { self?.seekFromSystem(position) }
            return .success
        }
        let play = commands.playCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async {
                self?.musicPlayer?.play()
                self?.emitPlaybackState("playing")
            }
            return .success
        }
        let pause = commands.pauseCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async {
                self?.musicPlayer?.pause()
                self?.emitPlaybackState("pause")
            }
            return .success
        }
        remoteTargets = [(commands.previousTrackCommand, previous), (commands.nextTrackCommand, next),
                         (commands.changePlaybackPositionCommand, seek),
                         (commands.playCommand, play), (commands.pauseCommand, pause)]
    }

    private func publishNowPlaying() {
        let nativePlaying = musicPlayer?.timeControlStatus == .playing && !nativeEnded
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlayingState["title"] as? String ?? "Mineradio",
            MPMediaItemPropertyArtist: nowPlayingState["artist"] as? String ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: nativePlaying ? Double(requestedRate) : 0.0
        ]
        let nativeDuration = musicItem.map { finiteSeconds($0.duration) } ?? 0
        let reportedDuration = nowPlayingState["duration"] as? Double ?? 0
        let duration = nativeDuration > 0 ? nativeDuration : reportedDuration
        let position = remoteSeekTarget ?? (musicPlayer.map { finiteSeconds($0.currentTime()) } ?? (nowPlayingState["position"] as? Double ?? 0))
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
            call.resolve(["officialNowPlaying": true])
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
