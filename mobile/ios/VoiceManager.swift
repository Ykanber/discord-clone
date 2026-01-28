import Foundation
import SocketIO
import WebRTC
// Note: Use mediasoup-client-swift pod
// pod 'Mediasoup-Client'

/**
 * VoiceManager - iOS voice channel management with mediasoup
 *
 * Requirements:
 * 1. Add to Podfile: pod 'Mediasoup-Client'
 * 2. Add to Podfile: pod 'Socket.IO-Client-Swift', '~> 16.0'
 * 3. Enable "Background Modes → Audio" in Xcode capabilities
 * 4. Add to Info.plist: NSMicrophoneUsageDescription
 */
class VoiceManager: NSObject {
    // Socket.IO
    private var socket: SocketIOClient!
    private var manager: SocketManager!

    // mediasoup
    private var device: Device?
    private var sendTransport: SendTransport?
    private var recvTransport: RecvTransport?
    private var producer: Producer?
    private var consumers: [String: Consumer] = [:] // producerId → Consumer

    // WebRTC
    private let factory: RTCPeerConnectionFactory
    private var audioSource: RTCAudioSource?
    private var audioTrack: RTCAudioTrack?

    // Audio session
    private let audioSession = AVAudioSession.sharedInstance()

    // State
    private var currentChannelId: String?
    private var currentUserId: String?

    init(socketURL: String) {
        // Initialize WebRTC factory
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory()

        super.init()

        // Setup Socket.IO
        manager = SocketManager(socketURL: URL(string: socketURL)!, config: [
            .log(false),
            .compress,
            .forceWebsockets(true),
            .reconnects(true),
            .reconnectAttempts(-1), // Infinite
            .reconnectWait(1)
        ])

        socket = manager.defaultSocket
        setupSocketHandlers()
        socket.connect()
    }

    deinit {
        leaveChannel()
        RTCCleanupSSL()
    }

    // MARK: - Public Methods

    func joinChannel(channelId: String, userId: String) async throws {
        currentChannelId = channelId
        currentUserId = userId

        // 1. Configure audio session for VoIP
        try configureAudioSession()

        // 2. Request microphone permission
        try await requestMicrophonePermission()

        // 3. Get microphone access
        try setupAudioTrack()

        // 4. Join channel - server will emit router-rtp-capabilities
        socket.emit("join_voice_channel", [
            "channelId": channelId,
            "userId": userId
        ])

        print("✅ Joining voice channel: \(channelId)")
    }

    func leaveChannel() {
        // Close producer
        producer?.close()
        producer = nil

        // Close consumers
        consumers.values.forEach { $0.close() }
        consumers.removeAll()

        // Close transports
        sendTransport?.close()
        sendTransport = nil
        recvTransport?.close()
        recvTransport = nil

        // Stop audio track
        audioTrack?.isEnabled = false
        audioTrack = nil
        audioSource = nil

        // Notify server
        if let channelId = currentChannelId {
            socket.emit("leave_voice_channel", ["channelId": channelId])
        }

        // Deactivate audio session
        try? audioSession.setActive(false)

        currentChannelId = nil
        currentUserId = nil

        print("👋 Left voice channel")
    }

    func toggleMute() {
        guard let producer = producer else { return }

        if producer.paused {
            producer.resume()
            print("🔊 Unmuted")
        } else {
            producer.pause()
            print("🔇 Muted")
        }
    }

    // MARK: - Private Setup Methods

    private func configureAudioSession() throws {
        try audioSession.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [
                .allowBluetooth,
                .allowBluetoothA2DP,
                .defaultToSpeaker,
                .mixWithOthers
            ]
        )
        try audioSession.setActive(true)

        print("✅ Audio session configured")
    }

    private func requestMicrophonePermission() async throws {
        let granted = await audioSession.requestRecordPermission()

        guard granted else {
            throw NSError(domain: "VoiceManager", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Microphone permission denied"
            ])
        }

        print("✅ Microphone permission granted")
    }

    private func setupAudioTrack() throws {
        // Create audio constraints
        let constraints = RTCMediaConstraints(mandatoryConstraints: [
            "googEchoCancellation": "true",
            "googAutoGainControl": "true",
            "googNoiseSuppression": "true",
            "googHighpassFilter": "true"
        ], optionalConstraints: nil)

        // Create audio source and track
        audioSource = factory.audioSource(with: constraints)
        audioTrack = factory.audioTrack(with: audioSource!, trackId: "audio0")

        print("✅ Audio track created")
    }

    // MARK: - Socket.IO Handlers

    private func setupSocketHandlers() {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            print("✅ Socket connected")
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            print("⚠️ Socket disconnected")
        }

        socket.on("router-rtp-capabilities") { [weak self] data, ack in
            guard let self = self,
                  let json = data[0] as? [String: Any],
                  let rtpCapabilities = json["rtpCapabilities"] as? [String: Any] else { return }

            Task {
                do {
                    try await self.handleRouterCapabilities(rtpCapabilities)
                } catch {
                    print("❌ Error handling router capabilities:", error)
                }
            }
        }

        socket.on("existing-producers") { [weak self] data, ack in
            guard let self = self,
                  let json = data[0] as? [String: Any],
                  let producers = json["producers"] as? [[String: String]] else { return }

            Task {
                for producer in producers {
                    if let producerId = producer["producerId"] {
                        try? await self.consumeAudio(producerId: producerId)
                    }
                }
            }
        }

        socket.on("new-producer") { [weak self] data, ack in
            guard let self = self,
                  let json = data[0] as? [String: String],
                  let producerId = json["producerId"] else { return }

            Task {
                try? await self.consumeAudio(producerId: producerId)
            }
        }

        socket.on("producer-closed") { [weak self] data, ack in
            guard let self = self,
                  let json = data[0] as? [String: String],
                  let producerId = json["producerId"] else { return }

            if let consumer = self.consumers[producerId] {
                consumer.close()
                self.consumers.removeValue(forKey: producerId)
                print("🔌 Producer closed:", producerId)
            }
        }
    }

    private func handleRouterCapabilities(_ rtpCapabilities: [String: Any]) async throws {
        // 1. Create device
        device = Device()

        // Convert to JSON string
        let jsonData = try JSONSerialization.data(withJSONObject: rtpCapabilities)
        let rtpCapabilitiesString = String(data: jsonData, encoding: .utf8)!

        try device?.load(routerRtpCapabilities: rtpCapabilitiesString)
        print("✅ Device loaded")

        // 2. Create send transport
        try await createSendTransport()

        // 3. Produce audio
        try await produceAudio()
    }

    // MARK: - Transport Methods

    private func createSendTransport() async throws {
        guard let channelId = currentChannelId else { return }

        let response = try await emitAsync("create-transport", [
            "channelId": channelId,
            "direction": "send"
        ])

        guard response["success"] as? Bool == true else {
            throw NSError(domain: "VoiceManager", code: 2, userInfo: [
                NSLocalizedDescriptionKey: response["error"] as? String ?? "Transport creation failed"
            ])
        }

        // Extract transport parameters
        let id = response["id"] as! String
        let iceParameters = response["iceParameters"] as! [String: Any]
        let iceCandidates = response["iceCandidates"] as! [[String: Any]]
        let dtlsParameters = response["dtlsParameters"] as! [String: Any]

        // Convert to JSON strings
        let iceParamsString = try jsonString(from: iceParameters)
        let iceCandidatesString = try jsonString(from: iceCandidates)
        let dtlsParamsString = try jsonString(from: dtlsParameters)

        // Create transport
        sendTransport = try device?.createSendTransport(
            id: id,
            iceParameters: iceParamsString,
            iceCandidates: iceCandidatesString,
            dtlsParameters: dtlsParamsString,
            iceServers: nil,
            proprietaryConstraints: nil,
            appData: nil
        )

        // Set delegate for transport events
        sendTransport?.delegate = self

        print("✅ Send transport created")
    }

    private func createRecvTransport() async throws {
        guard let channelId = currentChannelId else { return }

        let response = try await emitAsync("create-transport", [
            "channelId": channelId,
            "direction": "recv"
        ])

        guard response["success"] as? Bool == true else {
            throw NSError(domain: "VoiceManager", code: 2, userInfo: [
                NSLocalizedDescriptionKey: response["error"] as? String ?? "Transport creation failed"
            ])
        }

        // Extract and convert parameters (same as send transport)
        let id = response["id"] as! String
        let iceParameters = try jsonString(from: response["iceParameters"] as! [String: Any])
        let iceCandidates = try jsonString(from: response["iceCandidates"] as! [[String: Any]])
        let dtlsParameters = try jsonString(from: response["dtlsParameters"] as! [String: Any])

        recvTransport = try device?.createRecvTransport(
            id: id,
            iceParameters: iceParameters,
            iceCandidates: iceCandidates,
            dtlsParameters: dtlsParameters,
            iceServers: nil,
            proprietaryConstraints: nil,
            appData: nil
        )

        recvTransport?.delegate = self

        print("✅ Recv transport created")
    }

    // MARK: - Produce/Consume Methods

    private func produceAudio() async throws {
        guard let transport = sendTransport,
              let track = audioTrack else { return }

        // Codec options for Opus
        let codecOptions = """
        {
            "opusStereo": true,
            "opusFec": true,
            "opusDtx": true
        }
        """

        producer = try transport.produce(
            track: track,
            encodings: nil,
            codecOptions: codecOptions,
            codec: nil,
            appData: nil
        )

        print("✅ Audio producer created:", producer?.id ?? "")
    }

    private func consumeAudio(producerId: String) async throws {
        // Create recv transport if not exists
        if recvTransport == nil {
            try await createRecvTransport()
        }

        guard let transport = recvTransport,
              let rtpCapabilities = device?.rtpCapabilities else { return }

        let response = try await emitAsync("consume", [
            "producerId": producerId,
            "rtpCapabilities": rtpCapabilities,
            "transportId": transport.id
        ])

        guard response["success"] as? Bool == true else { return }

        let consumerId = response["consumerId"] as! String
        let kind = response["kind"] as! String
        let rtpParameters = try jsonString(from: response["rtpParameters"] as! [String: Any])

        let consumer = try transport.consume(
            id: consumerId,
            producerId: producerId,
            kind: kind,
            rtpParameters: rtpParameters,
            appData: nil
        )

        consumers[producerId] = consumer

        // Audio plays automatically via AVAudioSession
        print("✅ Consuming audio from producer:", producerId)
    }

    // MARK: - Helpers

    private func emitAsync(_ event: String, _ items: [String: Any]) async throws -> [String: Any] {
        return try await withCheckedThrowingContinuation { continuation in
            socket.emitWithAck(event, items).timingOut(after: 5) { data in
                if let response = data[0] as? [String: Any] {
                    continuation.resume(returning: response)
                } else {
                    continuation.resume(throwing: NSError(domain: "Socket", code: 3, userInfo: nil))
                }
            }
        }
    }

    private func jsonString(from object: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object)
        return String(data: data, encoding: .utf8)!
    }
}

// MARK: - Transport Delegate

extension VoiceManager: SendTransportDelegate, RecvTransportDelegate {
    func onConnect(_ transport: Transport!, dtlsParameters: String!) {
        Task {
            do {
                _ = try await emitAsync("connect-transport", [
                    "transportId": transport.id,
                    "dtlsParameters": try! JSONSerialization.jsonObject(
                        with: dtlsParameters.data(using: .utf8)!
                    ) as! [String: Any]
                ])
                print("✅ Transport connected")
            } catch {
                print("❌ Error connecting transport:", error)
            }
        }
    }

    func onConnectionStateChange(_ transport: Transport!, connectionState: TransportConnectionState) {
        print("🔄 Transport connection state:", connectionState.rawValue)
    }

    // SendTransport specific
    func onProduce(_ transport: Transport!, kind: String!, rtpParameters: String!, appData: String!, callback: ((String?) -> Void)!) {
        Task {
            do {
                let response = try await emitAsync("produce", [
                    "transportId": transport.id,
                    "kind": kind!,
                    "rtpParameters": try! JSONSerialization.jsonObject(
                        with: rtpParameters.data(using: .utf8)!
                    ) as! [String: Any]
                ])

                callback(response["producerId"] as? String)
            } catch {
                print("❌ Error producing:", error)
                callback(nil)
            }
        }
    }
}
