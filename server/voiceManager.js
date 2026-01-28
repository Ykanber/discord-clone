import mediasoup from 'mediasoup';

/**
 * VoiceManager - Manages mediasoup SFU for voice channels
 * Handles Workers, Routers, Transports, Producers, and Consumers
 */
class VoiceManager {
  constructor() {
    this.worker = null;
    this.routers = new Map(); // channelId → Router
    this.transports = new Map(); // transportId → Transport
    this.producers = new Map(); // producerId → { userId, channelId, kind }
    this.consumers = new Map(); // consumerId → Consumer
    this.userSessions = new Map(); // socketId → { userId, channelId, transports[], producers[], consumers[] }
  }

  /**
   * Initialize mediasoup worker
   */
  async init() {
    try {
      // Create mediasoup worker (handles actual media routing in C++)
      this.worker = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000'),
        rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '49999'),
      });

      this.worker.on('died', () => {
        console.error('❌ mediasoup worker died, exiting');
        process.exit(1);
      });

      console.log('✅ mediasoup worker created, PID:', this.worker.pid);
    } catch (error) {
      console.error('❌ Failed to create mediasoup worker:', error);
      throw error;
    }
  }

  /**
   * Get or create a router for a voice channel
   * Each channel has its own router for isolation
   */
  async getOrCreateRouter(channelId) {
    if (!this.routers.has(channelId)) {
      const router = await this.worker.createRouter({
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            parameters: {
              useinbandfec: 1, // Forward error correction for packet loss
              stereo: 1,
            }
          }
        ]
      });

      this.routers.set(channelId, router);
      console.log(`✅ Created router for channel: ${channelId}`);
    }

    return this.routers.get(channelId);
  }

  /**
   * Handle user joining a voice channel
   */
  async handleJoinChannel(socket, { channelId, userId }) {
    try {
      const router = await this.getOrCreateRouter(channelId);

      // Create user session
      this.userSessions.set(socket.id, {
        userId,
        channelId,
        transports: [],
        producers: [],
        consumers: []
      });

      // Send router RTP capabilities to client (required for WebRTC negotiation)
      socket.emit('router-rtp-capabilities', {
        rtpCapabilities: router.rtpCapabilities
      });

      // Notify about existing producers in channel
      const existingProducers = Array.from(this.producers.entries())
        .filter(([_, p]) => p.channelId === channelId)
        .map(([producerId, p]) => ({ producerId, userId: p.userId }));

      socket.emit('existing-producers', { producers: existingProducers });

      console.log(`✅ User ${userId} joined voice channel ${channelId}`);
    } catch (error) {
      console.error('❌ Error handling join channel:', error);
      socket.emit('error', { message: 'Failed to join channel' });
    }
  }

  /**
   * Create a WebRTC transport for client
   * @param {string} direction - 'send' for client→server, 'recv' for server→client
   */
  async createTransport(socket, { channelId, direction }) {
    try {
      const router = await this.getOrCreateRouter(channelId);
      const session = this.userSessions.get(socket.id);

      if (!session) {
        throw new Error('No session found');
      }

      // Get announced IP from environment or use localhost
      const announcedIp = process.env.ANNOUNCED_IP || '127.0.0.1';

      // Create WebRTC transport
      const transport = await router.createWebRtcTransport({
        listenIps: [
          {
            ip: '0.0.0.0',
            announcedIp: announcedIp
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      this.transports.set(transport.id, transport);
      session.transports.push(transport.id);

      // Handle transport close
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });

      transport.on('close', () => {
        console.log(`🔌 Transport closed: ${transport.id}`);
      });

      console.log(`✅ Created ${direction} transport: ${transport.id}`);

      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    } catch (error) {
      console.error('❌ Error creating transport:', error);
      throw error;
    }
  }

  /**
   * Connect transport with DTLS parameters from client
   */
  async connectTransport(socket, { transportId, dtlsParameters }) {
    try {
      const transport = this.transports.get(transportId);

      if (!transport) {
        throw new Error('Transport not found');
      }

      await transport.connect({ dtlsParameters });
      console.log(`✅ Transport connected: ${transportId}`);
    } catch (error) {
      console.error('❌ Error connecting transport:', error);
      throw error;
    }
  }

  /**
   * Create a producer (audio stream from client)
   */
  async produce(socket, { transportId, kind, rtpParameters }) {
    try {
      const transport = this.transports.get(transportId);
      const session = this.userSessions.get(socket.id);

      if (!transport) {
        throw new Error('Transport not found');
      }

      if (!session) {
        throw new Error('Session not found');
      }

      // Create producer
      const producer = await transport.produce({ kind, rtpParameters });

      // Store producer info
      this.producers.set(producer.id, {
        userId: session.userId,
        channelId: session.channelId,
        kind
      });

      session.producers.push(producer.id);

      // Notify others in the channel about new audio source
      socket.to(session.channelId).emit('new-producer', {
        producerId: producer.id,
        userId: session.userId
      });

      // Handle producer close
      producer.on('transportclose', () => {
        console.log(`🔌 Producer transport closed: ${producer.id}`);
        producer.close();
        this.producers.delete(producer.id);
      });

      console.log(`✅ Created producer: ${producer.id} (${kind}) for user ${session.userId}`);

      return { producerId: producer.id };
    } catch (error) {
      console.error('❌ Error creating producer:', error);
      throw error;
    }
  }

  /**
   * Create a consumer (receive audio from another client)
   */
  async consume(socket, { producerId, rtpCapabilities, transportId }) {
    try {
      const producerInfo = this.producers.get(producerId);

      if (!producerInfo) {
        throw new Error('Producer not found');
      }

      const router = this.routers.get(producerInfo.channelId);
      const transport = this.transports.get(transportId);
      const session = this.userSessions.get(socket.id);

      if (!router || !transport || !session) {
        throw new Error('Router, transport, or session not found');
      }

      // Check if client can consume this producer
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error('Cannot consume - incompatible codecs');
      }

      // Create consumer
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false, // Start receiving immediately
      });

      this.consumers.set(consumer.id, consumer);
      session.consumers.push(consumer.id);

      // Handle consumer close
      consumer.on('transportclose', () => {
        console.log(`🔌 Consumer transport closed: ${consumer.id}`);
        consumer.close();
        this.consumers.delete(consumer.id);
      });

      consumer.on('producerclose', () => {
        console.log(`🔌 Producer closed for consumer: ${consumer.id}`);
        socket.emit('producer-closed', { producerId });
        consumer.close();
        this.consumers.delete(consumer.id);
      });

      console.log(`✅ Created consumer: ${consumer.id} for producer ${producerId}`);

      return {
        consumerId: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
    } catch (error) {
      console.error('❌ Error creating consumer:', error);
      throw error;
    }
  }

  /**
   * Handle user leaving voice channel or disconnecting
   */
  async handleLeave(socket) {
    try {
      const session = this.userSessions.get(socket.id);

      if (!session) {
        return;
      }

      console.log(`👋 User ${session.userId} leaving channel ${session.channelId}`);

      // Close all producers and notify others
      session.producers.forEach(producerId => {
        const producerInfo = this.producers.get(producerId);
        if (producerInfo) {
          socket.to(session.channelId).emit('producer-closed', { producerId });
          this.producers.delete(producerId);
        }
      });

      // Close all consumers
      session.consumers.forEach(consumerId => {
        const consumer = this.consumers.get(consumerId);
        if (consumer) {
          consumer.close();
          this.consumers.delete(consumerId);
        }
      });

      // Close all transports
      session.transports.forEach(transportId => {
        const transport = this.transports.get(transportId);
        if (transport) {
          transport.close();
          this.transports.delete(transportId);
        }
      });

      // Remove session
      this.userSessions.delete(socket.id);

      // Cleanup empty routers (optional optimization)
      const channelHasUsers = Array.from(this.userSessions.values())
        .some(s => s.channelId === session.channelId);

      if (!channelHasUsers && this.routers.has(session.channelId)) {
        const router = this.routers.get(session.channelId);
        router.close();
        this.routers.delete(session.channelId);
        console.log(`🧹 Cleaned up empty router for channel: ${session.channelId}`);
      }

      console.log(`✅ User ${session.userId} cleanup complete`);
    } catch (error) {
      console.error('❌ Error handling leave:', error);
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats() {
    return {
      routers: this.routers.size,
      transports: this.transports.size,
      producers: this.producers.size,
      consumers: this.consumers.size,
      sessions: this.userSessions.size,
      workerPid: this.worker?.pid
    };
  }
}

export default VoiceManager;
