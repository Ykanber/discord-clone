package com.example.discordclone

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import androidx.core.app.ActivityCompat
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.mediasoup.droid.*
import org.webrtc.*

/**
 * VoiceManager - Android voice channel management with mediasoup
 *
 * Requirements:
 * 1. Add to build.gradle: implementation 'io.github.crow-misia.mediasoup:mediasoup-client:3.x.x'
 * 2. Add to build.gradle: implementation 'io.socket:socket.io-client:2.1.0'
 * 3. Add to AndroidManifest.xml: <uses-permission android:name="android.permission.RECORD_AUDIO"/>
 * 4. Add to AndroidManifest.xml: <uses-permission android:name="android.permission.INTERNET"/>
 * 5. Request RECORD_AUDIO permission at runtime
 */
class VoiceManager(
    private val context: Context,
    private val socketUrl: String
) {
    // Socket.IO
    private lateinit var socket: Socket

    // mediasoup
    private var device: Device? = null
    private var sendTransport: SendTransport? = null
    private var recvTransport: RecvTransport? = null
    private var producer: Producer? = null
    private val consumers = mutableMapOf<String, Consumer>() // producerId → Consumer

    // WebRTC
    private val peerConnectionFactory: PeerConnectionFactory
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null

    // Audio manager
    private val audioManager: AudioManager

    // State
    private var currentChannelId: String? = null
    private var currentUserId: String? = null

    // Coroutines
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    init {
        // Initialize WebRTC
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions()
        )

        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            .createPeerConnectionFactory()

        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

        // Setup Socket.IO
        setupSocket()
    }

    // MARK: - Public Methods

    suspend fun joinChannel(channelId: String, userId: String) {
        currentChannelId = channelId
        currentUserId = userId

        // 1. Check microphone permission
        if (!hasPermission()) {
            throw SecurityException("Microphone permission not granted")
        }

        // 2. Configure audio for VoIP
        configureAudio()

        // 3. Setup audio track
        setupAudioTrack()

        // 4. Join channel - server will emit router-rtp-capabilities
        socket.emit("join_voice_channel", JSONObject().apply {
            put("channelId", channelId)
            put("userId", userId)
        })

        println("✅ Joining voice channel: $channelId")
    }

    fun leaveChannel() {
        // Close producer
        producer?.close()
        producer = null

        // Close consumers
        consumers.values.forEach { it.close() }
        consumers.clear()

        // Close transports
        sendTransport?.close()
        sendTransport = null
        recvTransport?.close()
        recvTransport = null

        // Stop audio track
        audioTrack?.setEnabled(false)
        audioTrack?.dispose()
        audioTrack = null
        audioSource?.dispose()
        audioSource = null

        // Notify server
        currentChannelId?.let { channelId ->
            socket.emit("leave_voice_channel", JSONObject().apply {
                put("channelId", channelId)
            })
        }

        // Reset audio mode
        audioManager.mode = AudioManager.MODE_NORMAL

        currentChannelId = null
        currentUserId = null

        println("👋 Left voice channel")
    }

    fun toggleMute() {
        producer?.let { p ->
            if (p.isPaused()) {
                p.resume()
                println("🔊 Unmuted")
            } else {
                p.pause()
                println("🔇 Muted")
            }
        }
    }

    fun cleanup() {
        leaveChannel()
        scope.cancel()
        socket.disconnect()
        peerConnectionFactory.dispose()
    }

    // MARK: - Private Setup Methods

    private fun hasPermission(): Boolean {
        return ActivityCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun configureAudio() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager.isSpeakerphoneOn = true

        println("✅ Audio configured for VoIP")
    }

    private fun setupAudioTrack() {
        // Create audio constraints
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googHighpassFilter", "true"))
        }

        // Create audio source and track
        audioSource = peerConnectionFactory.createAudioSource(constraints)
        audioTrack = peerConnectionFactory.createAudioTrack("audio0", audioSource)

        println("✅ Audio track created")
    }

    // MARK: - Socket.IO Setup

    private fun setupSocket() {
        val opts = IO.Options().apply {
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 1000
            forceNew = true
            transports = arrayOf("websocket")
        }

        socket = IO.socket(socketUrl, opts)

        socket.on(Socket.EVENT_CONNECT) {
            println("✅ Socket connected")
        }

        socket.on(Socket.EVENT_DISCONNECT) {
            println("⚠️ Socket disconnected")
        }

        socket.on("router-rtp-capabilities") { args ->
            scope.launch {
                try {
                    val data = args[0] as JSONObject
                    val rtpCapabilities = data.getJSONObject("rtpCapabilities")
                    handleRouterCapabilities(rtpCapabilities)
                } catch (e: Exception) {
                    println("❌ Error handling router capabilities: ${e.message}")
                }
            }
        }

        socket.on("existing-producers") { args ->
            scope.launch {
                try {
                    val data = args[0] as JSONObject
                    val producers = data.getJSONArray("producers")

                    for (i in 0 until producers.length()) {
                        val producer = producers.getJSONObject(i)
                        val producerId = producer.getString("producerId")
                        consumeAudio(producerId)
                    }
                } catch (e: Exception) {
                    println("❌ Error handling existing producers: ${e.message}")
                }
            }
        }

        socket.on("new-producer") { args ->
            scope.launch {
                try {
                    val data = args[0] as JSONObject
                    val producerId = data.getString("producerId")
                    consumeAudio(producerId)
                } catch (e: Exception) {
                    println("❌ Error handling new producer: ${e.message}")
                }
            }
        }

        socket.on("producer-closed") { args ->
            try {
                val data = args[0] as JSONObject
                val producerId = data.getString("producerId")

                consumers[producerId]?.let { consumer ->
                    consumer.close()
                    consumers.remove(producerId)
                    println("🔌 Producer closed: $producerId")
                }
            } catch (e: Exception) {
                println("❌ Error handling producer closed: ${e.message}")
            }
        }

        socket.connect()
    }

    private suspend fun handleRouterCapabilities(rtpCapabilities: JSONObject) {
        // 1. Create device
        device = Device()
        device?.load(rtpCapabilities.toString())
        println("✅ Device loaded")

        // 2. Create send transport
        createSendTransport()

        // 3. Produce audio
        produceAudio()
    }

    // MARK: - Transport Methods

    private suspend fun createSendTransport() = suspendCancellableCoroutine<Unit> { cont ->
        val channelId = currentChannelId ?: return@suspendCancellableCoroutine

        socket.emit("create-transport", JSONObject().apply {
            put("channelId", channelId)
            put("direction", "send")
        }) { args ->
            try {
                val response = args[0] as JSONObject

                if (response.getBoolean("success")) {
                    val id = response.getString("id")
                    val iceParameters = response.getString("iceParameters")
                    val iceCandidates = response.getString("iceCandidates")
                    val dtlsParameters = response.getString("dtlsParameters")

                    // Create transport listener
                    val listener = object : SendTransport.Listener {
                        override fun onConnect(
                            transport: Transport,
                            dtlsParameters: String
                        ): String? {
                            scope.launch {
                                emitAsync("connect-transport", JSONObject().apply {
                                    put("transportId", transport.id)
                                    put("dtlsParameters", JSONObject(dtlsParameters))
                                })
                            }
                            return null
                        }

                        override fun onConnectionStateChange(
                            transport: Transport,
                            connectionState: String
                        ) {
                            println("🔄 Transport connection state: $connectionState")
                        }

                        override fun onProduce(
                            transport: Transport,
                            kind: String,
                            rtpParameters: String,
                            appData: String
                        ): String {
                            var producerId = ""
                            runBlocking {
                                val response = emitAsync("produce", JSONObject().apply {
                                    put("transportId", transport.id)
                                    put("kind", kind)
                                    put("rtpParameters", JSONObject(rtpParameters))
                                })
                                producerId = response.getString("producerId")
                            }
                            return producerId
                        }
                    }

                    sendTransport = device?.createSendTransport(
                        listener,
                        id,
                        iceParameters,
                        iceCandidates,
                        dtlsParameters
                    )

                    println("✅ Send transport created")
                    cont.resume(Unit) {}
                } else {
                    cont.resumeWithException(
                        Exception(response.getString("error"))
                    )
                }
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }
    }

    private suspend fun createRecvTransport() = suspendCancellableCoroutine<Unit> { cont ->
        val channelId = currentChannelId ?: return@suspendCancellableCoroutine

        socket.emit("create-transport", JSONObject().apply {
            put("channelId", channelId)
            put("direction", "recv")
        }) { args ->
            try {
                val response = args[0] as JSONObject

                if (response.getBoolean("success")) {
                    val id = response.getString("id")
                    val iceParameters = response.getString("iceParameters")
                    val iceCandidates = response.getString("iceCandidates")
                    val dtlsParameters = response.getString("dtlsParameters")

                    val listener = object : RecvTransport.Listener {
                        override fun onConnect(
                            transport: Transport,
                            dtlsParameters: String
                        ): String? {
                            scope.launch {
                                emitAsync("connect-transport", JSONObject().apply {
                                    put("transportId", transport.id)
                                    put("dtlsParameters", JSONObject(dtlsParameters))
                                })
                            }
                            return null
                        }

                        override fun onConnectionStateChange(
                            transport: Transport,
                            connectionState: String
                        ) {
                            println("🔄 Recv transport state: $connectionState")
                        }
                    }

                    recvTransport = device?.createRecvTransport(
                        listener,
                        id,
                        iceParameters,
                        iceCandidates,
                        dtlsParameters
                    )

                    println("✅ Recv transport created")
                    cont.resume(Unit) {}
                } else {
                    cont.resumeWithException(
                        Exception(response.getString("error"))
                    )
                }
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }
    }

    // MARK: - Produce/Consume Methods

    private suspend fun produceAudio() {
        val transport = sendTransport ?: return
        val track = audioTrack ?: return

        // Codec options for Opus
        val codecOptions = JSONObject().apply {
            put("opusStereo", true)
            put("opusFec", true)
            put("opusDtx", true)
        }

        producer = transport.produce(
            Producer.Listener { /* optional */ },
            track,
            null, // encodings
            codecOptions.toString()
        )

        println("✅ Audio producer created: ${producer?.id}")
    }

    private suspend fun consumeAudio(producerId: String) {
        // Create recv transport if not exists
        if (recvTransport == null) {
            createRecvTransport()
        }

        val transport = recvTransport ?: return
        val rtpCapabilities = device?.rtpCapabilities ?: return

        val response = emitAsync("consume", JSONObject().apply {
            put("producerId", producerId)
            put("rtpCapabilities", JSONObject(rtpCapabilities))
            put("transportId", transport.id)
        })

        if (response.getBoolean("success")) {
            val consumerId = response.getString("consumerId")
            val kind = response.getString("kind")
            val rtpParameters = response.getString("rtpParameters")

            val consumer = transport.consume(
                Consumer.Listener { /* optional */ },
                consumerId,
                producerId,
                kind,
                rtpParameters,
                "{}" // appData
            )

            consumers[producerId] = consumer

            // Audio plays automatically via AudioManager
            println("✅ Consuming audio from producer: $producerId")
        }
    }

    // MARK: - Helpers

    private suspend fun emitAsync(event: String, data: JSONObject): JSONObject =
        suspendCancellableCoroutine { cont ->
            socket.emit(event, data) { args ->
                try {
                    val response = args[0] as JSONObject
                    cont.resume(response) {}
                } catch (e: Exception) {
                    cont.resumeWithException(e)
                }
            }
        }
}
