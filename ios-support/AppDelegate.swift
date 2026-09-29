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
        CAPPluginMethod(name: "finishWebAudioResume", returnType: CAPPluginReturnPromise),
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
    private var advanceWhenPrepared = false
    private var generation = 0
    private var resolving = false
    private var artwork: MPMediaItemArtwork?
    private var interruptionShouldResume = false
    private var ticker: Any?
    private var backgroundStartNotified = false
    private var foregroundHandoffPending = false
    private var recoveryAttempt = 0
    private var recoveryWorkItem: DispatchWorkItem?
    private var recoveryStartedAt: Date?
    private var lastObservedPlaybackSecond = 0.0
    private var lastObservedProgressAt = Date()

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
        observers.append(center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] event in
            guard let self = self, let item = event.object as? AVPlayerItem, item === self.player.currentItem else { return }
            self.schedulePlaybackRecovery(reason: "failed-to-end", delay: 0.35)
        })
        observers.append(center.addObserver(forName: .AVPlayerItemPlaybackStalled, object: nil, queue: .main) { [weak self] event in
            guard let self = self, let item = event.object as? AVPlayerItem, item === self.player.currentItem else { return }
            self.schedulePlaybackRecovery(reason: "stalled", delay: 3.0)
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
        ticker = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            guard let self = self, self.owned else { return }
            let second = self.player.currentTime().seconds
            if second.isFinite, second > self.lastObservedPlaybackSecond + 0.2 {
                self.lastObservedPlaybackSecond = second
                self.lastObservedProgressAt = Date()
                if self.recoveryAttempt > 0, let started = self.recoveryStartedAt,
                   Date().timeIntervalSince(started) > 15 {
                    self.recoveryAttempt = 0
                    self.recoveryStartedAt = nil
                }
            }
            if self.wantsPlayback, self.player.timeControlStatus == .playing, !self.backgroundStartNotified {
                self.backgroundStartNotified = true
                self.webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.nativeBackgroundAudioDidStart && window.MineradioMobile.nativeBackgroundAudioDidStart()", completionHandler: nil)
            }
            if self.wantsPlayback, self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
               Date().timeIntervalSince(self.lastObservedProgressAt) > 7 {
                self.schedulePlaybackRecovery(reason: "waiting", delay: 0)
            }
            let duration = self.player.currentItem?.duration.seconds ?? 0
            if duration.isFinite, duration > 0, second.isFinite, duration - second < 45 {
                self.prepareNext()
            }
            self.updateNowPlaying()
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
            let oldCover = self.state["cover"] as? String
            // The web side deliberately omits large or unchanged values such as
            // artwork and the lyric timeline. Merge partial snapshots instead of
            // replacing the whole state, otherwise the next timeupdate clears the
            // cover that iOS needs for the lock-screen Now Playing card.
            if let incoming = call.options as? [String: Any] {
                incoming.forEach { self.state[$0.key] = $0.value }
            }
            self.receivedAt = Date()
            if let queue = call.options["queue"] as? [[String: Any]] { self.queue = queue }
            if oldURL != call.getString("url") || oldIndex != call.getInt("queueIndex") {
                self.generation += 1; self.resolving = false; self.nextURL = nil; self.nextIndex = -1; self.advanceWhenPrepared = false
                self.recoveryAttempt = 0; self.recoveryStartedAt = nil; self.cancelPlaybackRecovery()
                // Do not preload AVPlayer while WebAudio owns playback. Two
                // simultaneous requests to the same signed CDN/proxy URL can
                // trigger rate limits and make an otherwise healthy stream fail.
                self.player.pause()
                self.player.replaceCurrentItem(with: nil)
            }
            let newCover = self.state["cover"] as? String
            if oldCover != newCover {
                self.artwork = nil
                self.loadArtwork()
            }
            call.resolve()
        }
    }
    private func takeOver() {
        if owned {
            foregroundHandoffPending = false
            return
        }
        guard state["playing"] as? Bool == true,
              let urlText = state["url"] as? String,
              let url = URL(string: urlText),
              ["http", "https"].contains(url.scheme ?? "") else { return }
        do { try activateSession() } catch { return }
        owned = true; wantsPlayback = true; foregroundHandoffPending = false; backgroundStartNotified = false
        recoveryAttempt = 0; recoveryStartedAt = nil; cancelPlaybackRecovery()
        webView?.evaluateJavaScript("window.MineradioMobile && window.MineradioMobile.enterBackgroundAudio()", completionHandler: nil)
        let rate = state["rate"] as? Double ?? 1
        let time = (state["position"] as? Double ?? 0) + min(2, Date().timeIntervalSince(receivedAt)) * rate
        player.volume = Float(state["volume"] as? Double ?? 1)
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        lastObservedPlaybackSecond = max(0, time); lastObservedProgressAt = Date()
        player.seek(to: CMTime(seconds: max(0, time), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            guard let self = self, self.owned, self.wantsPlayback else { return }
            self.player.playImmediately(atRate: Float(rate)); self.updateNowPlaying()
        }
        installRemoteControls(); updateNowPlaying(); loadArtwork()
    }
    @objc func resumeWebAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.owned else { call.resolve(["owned": false]); return }
            let time = self.player.currentTime().seconds
            let playing = self.wantsPlayback
            // Keep AVPlayer audible until WebAudio has loaded, sought and started.
            // The web side calls finishWebAudioResume only after it is ready, so
            // foregrounding cannot create a silent gap or two unsynchronised players.
            self.foregroundHandoffPending = true
            call.resolve([
                "owned": true,
                "position": time.isFinite ? time : 0,
                "playing": playing,
                "queueIndex": self.state["queueIndex"] as? Int ?? -1,
                "url": self.state["url"] as? String ?? ""
            ])
        }
    }
    @objc func finishWebAudioResume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.owned, self.foregroundHandoffPending else { call.resolve(["released": false]); return }
            self.cancelPlaybackRecovery()
            self.player.pause()
            self.player.replaceCurrentItem(with: nil)
            self.owned = false; self.wantsPlayback = false; self.foregroundHandoffPending = false; self.backgroundStartNotified = false
            self.removeRemoteControls()
            call.resolve(["released": true])
        }
    }

    private func cancelPlaybackRecovery() {
        recoveryWorkItem?.cancel()
        recoveryWorkItem = nil
    }

    private func schedulePlaybackRecovery(reason: String, delay: TimeInterval) {
        guard owned, wantsPlayback, !foregroundHandoffPending, recoveryWorkItem == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.recoveryWorkItem = nil
            guard self.owned, self.wantsPlayback, !self.foregroundHandoffPending else { return }
            if reason == "stalled" || reason == "waiting" {
                let recentlyAdvanced = Date().timeIntervalSince(self.lastObservedProgressAt) < 2.5
                if self.player.timeControlStatus == .playing || recentlyAdvanced { return }
            }
            self.recoverCurrentPlayback()
        }
        recoveryWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, delay), execute: item)
    }

    private func recoverCurrentPlayback() {
        guard recoveryAttempt < 3,
              let text = state["url"] as? String,
              let url = URL(string: text),
              ["http", "https"].contains(url.scheme ?? "") else {
            wantsPlayback = false
            updateNowPlaying()
            return
        }
        recoveryAttempt += 1
        recoveryStartedAt = Date()
        let attempt = recoveryAttempt
        let second = max(0, player.currentTime().seconds.isFinite ? player.currentTime().seconds : lastObservedPlaybackSecond)
        let rate = Float(state["rate"] as? Double ?? 1)
        player.pause()
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.seek(to: CMTime(seconds: second, preferredTimescale: 600), toleranceBefore: CMTime(seconds: 0.15, preferredTimescale: 600), toleranceAfter: CMTime(seconds: 0.15, preferredTimescale: 600)) { [weak self] _ in
            guard let self = self, self.owned, self.wantsPlayback, self.recoveryAttempt == attempt else { return }
            self.lastObservedProgressAt = Date()
            self.player.playImmediately(atRate: rate)
            self.updateNowPlaying()
        }
    }
    private func prepareNext(completion: (() -> Void)? = nil) {
        guard !resolving, nextURL == nil, queue.count > 1, state["loop"] as? Bool != true else { completion?(); return }
        let index = state["queueIndex"] as? Int ?? -1
        guard index >= 0, index < queue.count else { completion?(); return }
        let mode = state["playMode"] as? String ?? "list"
        let next = ["random", "shuffle"].contains(mode) ? ((index + Int.random(in: 1..<queue.count)) % queue.count) : ((index + 1) % queue.count)
        let song = queue[next]
        guard let baseText = state["url"] as? String, let base = URL(string: baseText) else { completion?(); return }
        guard let source = song["source"] as? String, ["tx", "wy", "kw", "kg", "mg"].contains(source),
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
                var prepared = false
                if (response as? HTTPURLResponse)?.statusCode == 200, result?["ok"] as? Bool == true,
                   let text = (result?["proxyUrl"] ?? result?["url"]) as? String, let url = URL(string: text, relativeTo: base) {
                    self.nextURL = url; self.nextIndex = next
                    prepared = true
                }
                if self.advanceWhenPrepared {
                    self.advanceWhenPrepared = false
                    if prepared { self.advance() }
                    else { self.wantsPlayback = false; self.updateNowPlaying() }
                }
                completion?()
            }
        }.resume()
    }
    private func advance() {
        guard owned else { return }
        guard let url = nextURL, nextIndex >= 0, nextIndex < queue.count else {
            if resolving { advanceWhenPrepared = true; return }
            prepareNext { [weak self] in
                guard let self = self else { return }
                if self.nextURL != nil { self.advance() }
                else { self.wantsPlayback = false; self.updateNowPlaying() }
            }
            return
        }
        let song = queue[nextIndex]
        state["queueIndex"] = nextIndex; state["url"] = url.absoluteString; state["title"] = song["title"]; state["artist"] = song["artist"]; state["cover"] = song["cover"]
        state["duration"] = 0
        nextURL = nil; nextIndex = -1; advanceWhenPrepared = false; generation += 1; resolving = false; artwork = nil
        recoveryAttempt = 0; recoveryStartedAt = nil; cancelPlaybackRecovery(); backgroundStartNotified = false
        player.replaceCurrentItem(with: AVPlayerItem(url: url)); wantsPlayback = true
        player.playImmediately(atRate: Float(state["rate"] as? Double ?? 1))
        updateNowPlaying(); loadArtwork()
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
        add(center.nextTrackCommand) { [weak self] _ in self?.advance(); return .success }
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
        if duration.isFinite, duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let map = state["lyricMap"] as? String, !map.isEmpty {
            let rows = map.components(separatedBy: "\n")
            let index = max(0, min(rows.count - 1, Int(floor(max(0, time.isFinite ? time : 0) * 2))))
            if !rows[index].isEmpty { info[MPMediaItemPropertyAlbumTitle] = rows[index] }
        }
        if let artwork = artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
    private func fallbackArtwork() {
        let candidates = ["AppIcon76x76@2x~ipad", "AppIcon60x60@2x", "AppIcon"]
        for name in candidates {
            if let path = Bundle.main.path(forResource: name, ofType: "png"), let image = UIImage(contentsOfFile: path) {
                artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                updateNowPlaying()
                return
            }
        }
    }
    private func loadArtwork(attempt: Int = 0) {
        guard let text = state["cover"] as? String, let url = URL(string: text), ["http", "https"].contains(url.scheme ?? "") else {
            fallbackArtwork()
            return
        }
        let expected = generation
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 15)
        request.setValue("image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let self = self else { return }
            guard (200...299).contains(status), let data = data, !data.isEmpty, data.count < 16 * 1024 * 1024, let image = UIImage(data: data) else {
                DispatchQueue.main.async {
                    guard expected == self.generation, text == self.state["cover"] as? String else { return }
                    if attempt < 1 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.loadArtwork(attempt: attempt + 1) }
                    } else { self.fallbackArtwork() }
                }
                return
            }
            DispatchQueue.main.async {
                guard expected == self.generation, text == self.state["cover"] as? String else { return }
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
