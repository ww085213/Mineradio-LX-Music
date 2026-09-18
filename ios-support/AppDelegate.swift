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
        CAPPluginMethod(name: "syncAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeWebAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secure", returnType: CAPPluginReturnPromise)
    ]
    private let player = AVPlayer()
    private var state: [String: Any] = [:]
    private var queue: [[String: Any]] = []
    private var owned = false
    private var wantsPlayback = false
    private var receivedAt = Date()
    private var observers: [NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var nextURL: URL?
    private var nextIndex = -1
    private var generation = 0
    private var resolving = false
    private var artwork: MPMediaItemArtwork?
    private var interruptionShouldResume = false
    private var ticker: Any?

    override func load() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.takeOver() })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, self.owned else { return }
            self.webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.resumeForegroundAudio()", completionHandler: nil)
        })
        observers.append(center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] event in
            guard let self = self, self.owned, let item = event.object as? AVPlayerItem, item === self.player.currentItem else { return }
            if self.state["loop"] as? Bool == true { self.player.seek(to: .zero); self.player.play(); return }
            self.advance()
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] event in
            guard let self = self, self.owned, let raw = event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if raw == AVAudioSession.InterruptionType.began.rawValue {
                self.interruptionShouldResume = self.wantsPlayback; self.player.pause()
            } else if self.interruptionShouldResume, let options = event.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
                      AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                try? self.activateSession(); self.player.play()
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] event in
            guard let self = self, self.owned,
                  event.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            self.wantsPlayback = false; self.player.pause(); self.updateNowPlaying()
        })
        ticker = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main) { [weak self] _ in
            if self?.owned == true { self?.updateNowPlaying() }
        }
    }
    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
    }
    @objc func activateAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try self.activateSession(); call.resolve() }
            catch { call.reject("无法激活 iOS 播放会话") }
        }
    }
    @objc func syncAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.owned else { call.resolve(); return }
            let oldURL = self.state["url"] as? String
            let oldIndex = self.state["queueIndex"] as? Int
            self.state = call.options as? [String: Any] ?? [:]
            self.receivedAt = Date()
            if let queue = call.options["queue"] as? [[String: Any]] { self.queue = queue }
            if oldURL != call.getString("url") || oldIndex != call.getInt("queueIndex") {
                self.generation += 1; self.resolving = false; self.nextURL = nil; self.nextIndex = -1; self.artwork = nil
                if let text = call.getString("url"), let url = URL(string: text), ["http", "https"].contains(url.scheme ?? "") {
                    self.player.replaceCurrentItem(with: AVPlayerItem(url: url))
                    self.prepareNext()
                } else { self.player.replaceCurrentItem(with: nil) }
            }
            call.resolve()
        }
    }
    private func takeOver() {
        guard !owned, state["playing"] as? Bool == true, player.currentItem != nil else { return }
        do { try activateSession() } catch { return }
        owned = true; wantsPlayback = true
        webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.enterBackgroundAudio()", completionHandler: nil)
        let rate = state["rate"] as? Double ?? 1
        let time = (state["position"] as? Double ?? 0) + min(2, Date().timeIntervalSince(receivedAt)) * rate
        player.volume = Float(state["volume"] as? Double ?? 1)
        player.seek(to: CMTime(seconds: max(0, time), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            guard let self = self, self.owned, self.wantsPlayback else { return }
            self.player.playImmediately(atRate: Float(rate)); self.updateNowPlaying()
        }
        installRemoteControls(); updateNowPlaying(); loadArtwork(); prepareNext()
    }
    @objc func resumeWebAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.owned else { call.resolve(["owned": false]); return }
            let time = self.player.currentTime().seconds
            let playing = self.wantsPlayback
            self.player.pause(); self.owned = false; self.wantsPlayback = false
            self.removeRemoteControls()
            call.resolve(["owned": true, "position": time.isFinite ? time : 0, "playing": playing, "queueIndex": self.state["queueIndex"] as? Int ?? -1])
        }
    }
    private func prepareNext(completion: (() -> Void)? = nil) {
        guard !resolving, nextURL == nil, queue.count > 1, state["loop"] as? Bool != true else { completion?(); return }
        let index = state["queueIndex"] as? Int ?? -1
        guard index >= 0, index < queue.count else { completion?(); return }
        let mode = state["playMode"] as? String ?? "list"
        let next = ["random", "shuffle"].contains(mode) ? ((index + Int.random(in: 1..<queue.count)) % queue.count) : ((index + 1) % queue.count)
        let song = queue[next]
        guard let source = song["source"] as? String, ["tx", "wy", "kw", "kg", "mg"].contains(source),
              let baseText = state["url"] as? String, let base = URL(string: baseText),
              ["localhost", "127.0.0.1"].contains(base.host ?? ""),
              let endpoint = URL(string: "/api/lx-source/resolve", relativeTo: base) else { completion?(); return }
        resolving = true
        let expected = generation
        var request = URLRequest(url: endpoint, timeoutInterval: 25)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["source": source, "quality": "320k", "musicInfo": song["musicInfo"] ?? [:], "maxResolvers": 3])
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async {
                guard let self = self, self.generation == expected else { return }
                self.resolving = false
                if (response as? HTTPURLResponse)?.statusCode == 200, result?["ok"] as? Bool == true,
                   let text = (result?["proxyUrl"] ?? result?["url"]) as? String, let url = URL(string: text, relativeTo: base) {
                    self.nextURL = url; self.nextIndex = next
                }
                completion?()
            }
        }.resume()
    }
    private func advance() {
        guard owned else { return }
        guard let url = nextURL, nextIndex >= 0, nextIndex < queue.count else {
            wantsPlayback = false; updateNowPlaying()
            return
        }
        let song = queue[nextIndex]
        state["queueIndex"] = nextIndex; state["url"] = url.absoluteString; state["title"] = song["title"]; state["artist"] = song["artist"]; state["cover"] = song["cover"]
        state["duration"] = 0
        nextURL = nil; nextIndex = -1; generation += 1; resolving = false; artwork = nil
        player.replaceCurrentItem(with: AVPlayerItem(url: url)); wantsPlayback = true
        player.playImmediately(atRate: Float(state["rate"] as? Double ?? 1))
        updateNowPlaying(); loadArtwork(); prepareNext()
    }
    private func installRemoteControls() {
        removeRemoteControls()
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ action: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            remoteTargets.append((command, command.addTarget(handler: action)))
        }
        add(center.playCommand) { [weak self] _ in self?.wantsPlayback = true; self?.player.play(); self?.updateNowPlaying(); return .success }
        add(center.pauseCommand) { [weak self] _ in self?.wantsPlayback = false; self?.player.pause(); self?.updateNowPlaying(); return .success }
        add(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self = self else { return .commandFailed }
            self.wantsPlayback.toggle(); if self.wantsPlayback { self.player.play() } else { self.player.pause() }; self.updateNowPlaying(); return .success
        }
        add(center.nextTrackCommand) { [weak self] _ in guard self?.nextURL != nil else { return .noSuchContent }; self?.advance(); return .success }
        add(center.changePlaybackPositionCommand) { [weak self] event in
            guard let position = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.player.seek(to: CMTime(seconds: position.positionTime, preferredTimescale: 600)); return .success
        }
    }
    private func removeRemoteControls() { for (command, target) in remoteTargets { command.removeTarget(target) }; remoteTargets.removeAll() }
    private func updateNowPlaying() {
        guard owned else { return }
        let time = player.currentTime().seconds
        let duration = player.currentItem?.duration.seconds ?? 0
        var info: [String: Any] = [MPMediaItemPropertyTitle: state["title"] as? String ?? "Mineradio", MPMediaItemPropertyArtist: state["artist"] as? String ?? "",
            MPNowPlayingInfoPropertyElapsedPlaybackTime: time.isFinite ? time : 0, MPNowPlayingInfoPropertyPlaybackRate: wantsPlayback ? player.rate : 0]
        if duration.isFinite { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork = artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
    private func loadArtwork() {
        guard let text = state["cover"] as? String, let url = URL(string: text), ["http", "https"].contains(url.scheme ?? "") else { return }
        let expected = generation
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data = data, data.count < 16 * 1024 * 1024, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self = self, expected == self.generation else { return }
                self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }; self.updateNowPlaying()
            }
        }.resume()
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
    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        if let ticker = ticker { player.removeTimeObserver(ticker) }
        removeRemoteControls()
    }
}
