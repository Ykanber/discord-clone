import { useState, useEffect, useRef } from 'react';
import { Device } from 'mediasoup-client';
import { FaVolumeMute, FaVolumeUp, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';

function VoiceChannel({ channel, user, socket, onLeave }) {
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [remoteSpeakingUsers, setRemoteSpeakingUsers] = useState(new Set());

  // mediasoup refs
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const producerRef = useRef(null);
  const consumersRef = useRef(new Map()); // producerId → Consumer
  const audioElementsRef = useRef(new Map()); // producerId → HTMLAudioElement

  // Voice activity detection refs
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);

  useEffect(() => {
    if (channel && socket) {
      joinVoiceChannel();
    }

    return () => {
      leaveVoiceChannel();
    };
  }, [channel?.id]);

  useEffect(() => {
    if (!socket) return;

    const handleRouterCapabilities = async ({ rtpCapabilities }) => {
      try {
        // Load device with server's RTP capabilities
        const device = new Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;

        // Create send transport
        await createSendTransport();

        // Produce audio
        await produceAudio();

        setConnected(true);
        console.log('✅ Connected to voice channel');
      } catch (error) {
        console.error('❌ Error loading device:', error);
        alert('Sesli kanala bağlanırken hata oluştu');
      }
    };

    const handleExistingProducers = async ({ producers }) => {
      console.log('📋 Existing producers:', producers);
      for (const { producerId } of producers) {
        await consumeAudio(producerId);
      }
    };

    const handleNewProducer = async ({ producerId, userId }) => {
      console.log('🆕 New producer joined:', producerId, userId);
      await consumeAudio(producerId);
    };

    const handleProducerClosed = ({ producerId }) => {
      console.log('🔌 Producer closed:', producerId);

      // Close consumer
      const consumer = consumersRef.current.get(producerId);
      if (consumer) {
        consumer.close();
        consumersRef.current.delete(producerId);
      }

      // Stop audio element
      const audio = audioElementsRef.current.get(producerId);
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audioElementsRef.current.delete(producerId);
      }
    };

    socket.on('router-rtp-capabilities', handleRouterCapabilities);
    socket.on('existing-producers', handleExistingProducers);
    socket.on('new-producer', handleNewProducer);
    socket.on('producer-closed', handleProducerClosed);
    socket.on('voice_channel_users_update', handleVoiceUsersUpdate);
    socket.on('user_speaking_update', handleRemoteSpeaking);

    return () => {
      socket.off('router-rtp-capabilities', handleRouterCapabilities);
      socket.off('existing-producers', handleExistingProducers);
      socket.off('new-producer', handleNewProducer);
      socket.off('producer-closed', handleProducerClosed);
      socket.off('voice_channel_users_update', handleVoiceUsersUpdate);
      socket.off('user_speaking_update', handleRemoteSpeaking);
    };
  }, [socket, channel?.id]);

  const handleRemoteSpeaking = ({ socketId, speaking }) => {
    setRemoteSpeakingUsers(prev => {
      const newSet = new Set(prev);
      if (speaking) {
        newSet.add(socketId);
      } else {
        newSet.delete(socketId);
      }
      return newSet;
    });
  };

  const joinVoiceChannel = async () => {
    try {
      // 1. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localStreamRef.current = stream;

      // 2. Setup voice activity detection
      setupVoiceActivityDetection(stream);

      // 3. Join voice channel - server will emit router-rtp-capabilities
      socket.emit('join_voice_channel', {
        channelId: channel.id,
        userId: user.id
      });

      console.log('📡 Joining voice channel:', channel.id);

    } catch (error) {
      console.error('❌ Error accessing microphone:', error);
      alert('Mikrofona erişim izni gerekli!');
    }
  };

  const createSendTransport = async () => {
    return new Promise((resolve, reject) => {
      socket.emit('create-transport', {
        channelId: channel.id,
        direction: 'send'
      }, async (response) => {
        if (!response.success) {
          console.error('❌ Failed to create send transport:', response.error);
          return reject(response.error);
        }

        try {
          const transport = deviceRef.current.createSendTransport({
            id: response.id,
            iceParameters: response.iceParameters,
            iceCandidates: response.iceCandidates,
            dtlsParameters: response.dtlsParameters,
          });

          // Handle 'connect' event (triggered by produce())
          transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            socket.emit('connect-transport', {
              transportId: transport.id,
              dtlsParameters
            }, (res) => {
              if (res.success) {
                callback();
              } else {
                errback(new Error(res.error));
              }
            });
          });

          // Handle 'produce' event
          transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            socket.emit('produce', {
              transportId: transport.id,
              kind,
              rtpParameters
            }, (res) => {
              if (res.success) {
                callback({ id: res.producerId });
              } else {
                errback(new Error(res.error));
              }
            });
          });

          sendTransportRef.current = transport;
          console.log('✅ Send transport created');
          resolve();
        } catch (error) {
          console.error('❌ Error creating send transport:', error);
          reject(error);
        }
      });
    });
  };

  const produceAudio = async () => {
    try {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];

      const producer = await sendTransportRef.current.produce({
        track: audioTrack,
        codecOptions: {
          opusStereo: true,
          opusFec: true, // Forward error correction
          opusDtx: true, // Discontinuous transmission
        }
      });

      producerRef.current = producer;

      producer.on('transportclose', () => {
        console.log('🔌 Producer transport closed');
      });

      producer.on('trackended', () => {
        console.log('🎵 Audio track ended');
      });

      console.log('✅ Audio producer created:', producer.id);
    } catch (error) {
      console.error('❌ Error producing audio:', error);
      throw error;
    }
  };

  const createRecvTransport = async () => {
    return new Promise((resolve, reject) => {
      socket.emit('create-transport', {
        channelId: channel.id,
        direction: 'recv'
      }, async (response) => {
        if (!response.success) {
          console.error('❌ Failed to create recv transport:', response.error);
          return reject(response.error);
        }

        try {
          const transport = deviceRef.current.createRecvTransport({
            id: response.id,
            iceParameters: response.iceParameters,
            iceCandidates: response.iceCandidates,
            dtlsParameters: response.dtlsParameters,
          });

          transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            socket.emit('connect-transport', {
              transportId: transport.id,
              dtlsParameters
            }, (res) => {
              if (res.success) {
                callback();
              } else {
                errback(new Error(res.error));
              }
            });
          });

          recvTransportRef.current = transport;
          console.log('✅ Recv transport created');
          resolve();
        } catch (error) {
          console.error('❌ Error creating recv transport:', error);
          reject(error);
        }
      });
    });
  };

  const consumeAudio = async (producerId) => {
    try {
      // Create receive transport if not exists
      if (!recvTransportRef.current) {
        await createRecvTransport();
      }

      return new Promise((resolve, reject) => {
        socket.emit('consume', {
          producerId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
          transportId: recvTransportRef.current.id
        }, async (response) => {
          if (!response.success) {
            console.error('❌ Failed to consume:', response.error);
            return reject(response.error);
          }

          try {
            const consumer = await recvTransportRef.current.consume({
              id: response.consumerId,
              producerId: response.producerId,
              kind: response.kind,
              rtpParameters: response.rtpParameters,
            });

            consumersRef.current.set(producerId, consumer);

            // Play audio
            const stream = new MediaStream([consumer.track]);
            const audio = new Audio();
            audio.srcObject = stream;
            audio.autoplay = true;
            audio.volume = 1.0;

            audioElementsRef.current.set(producerId, audio);

            audio.play().then(() => {
              console.log('🔊 Playing audio from producer:', producerId);
            }).catch(err => {
              console.error('❌ Error playing audio:', err);
            });

            consumer.on('transportclose', () => {
              console.log('🔌 Consumer transport closed');
              consumer.close();
              consumersRef.current.delete(producerId);
            });

            resolve();
          } catch (error) {
            console.error('❌ Error consuming audio:', error);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('❌ Error in consumeAudio:', error);
    }
  };

  const setupVoiceActivityDetection = (stream) => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);

    analyser.smoothingTimeConstant = 0.85;
    analyser.fftSize = 2048;

    microphone.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    let isCurrentlySpeaking = false;
    let silenceStart = 0;
    let speakingStart = 0;
    const SPEAKING_THRESHOLD = 35; // Increased from 20
    const SILENCE_DURATION = 1000; // 1 second of silence to stop
    const SPEAKING_DURATION = 200; // 200ms of sound to start

    const detectVoice = () => {
      if (!analyserRef.current) return;

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Calculate RMS (Root Mean Square) for better accuracy
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const now = Date.now();

      if (rms > SPEAKING_THRESHOLD && !muted) {
        // Sound detected
        if (!isCurrentlySpeaking) {
          if (speakingStart === 0) {
            speakingStart = now;
          } else if (now - speakingStart >= SPEAKING_DURATION) {
            // Started speaking
            isCurrentlySpeaking = true;
            setSpeaking(true);
            socket.emit('user_speaking', { channelId: channel.id, speaking: true });
            console.log('Started speaking, RMS:', rms);
          }
        }
        silenceStart = 0; // Reset silence timer
      } else {
        // Silence or muted
        if (isCurrentlySpeaking) {
          if (silenceStart === 0) {
            silenceStart = now;
          } else if (now - silenceStart >= SILENCE_DURATION) {
            // Stopped speaking
            isCurrentlySpeaking = false;
            setSpeaking(false);
            socket.emit('user_speaking', { channelId: channel.id, speaking: false });
            console.log('Stopped speaking');
          }
        }
        speakingStart = 0; // Reset speaking timer
      }

      requestAnimationFrame(detectVoice);
    };

    detectVoice();
  };

  const leaveVoiceChannel = () => {
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Close producer
    if (producerRef.current) {
      producerRef.current.close();
      producerRef.current = null;
    }

    // Close all consumers
    consumersRef.current.forEach(consumer => {
      consumer.close();
    });
    consumersRef.current.clear();

    // Stop all audio elements
    audioElementsRef.current.forEach(audio => {
      audio.pause();
      audio.srcObject = null;
    });
    audioElementsRef.current.clear();

    // Close transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }

    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }

    // Reset device
    deviceRef.current = null;

    // Notify server
    if (socket && channel) {
      socket.emit('leave_voice_channel', { channelId: channel.id });
    }

    setSpeaking(false);
    setRemoteSpeakingUsers(new Set());
    setConnected(false);
    console.log('👋 Left voice channel');
  };

  const handleVoiceUsersUpdate = ({ channelId, users }) => {
    if (channelId === channel.id) {
      setVoiceUsers(users);
    }
  };

  const toggleMute = () => {
    if (producerRef.current) {
      const willBeMuted = !muted;

      if (willBeMuted) {
        producerRef.current.pause();
        if (speaking) {
          setSpeaking(false);
          socket.emit('user_speaking', { channelId: channel.id, speaking: false });
        }
      } else {
        producerRef.current.resume();
      }

      setMuted(willBeMuted);
      console.log(willBeMuted ? '🔇 Muted' : '🔊 Unmuted');
    }
  };

  const handleDisconnect = () => {
    leaveVoiceChannel();
    if (onLeave) onLeave();
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-800">
      <div className="h-12 px-4 flex items-center border-b border-gray-900 shadow-md">
        <FaVolumeUp className="text-gray-400 mr-2" />
        <h3 className="font-bold">{channel.name}</h3>
        <span className="ml-2 text-sm text-gray-400">
          (Sesli Kanal)
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-8">
            <div className="inline-block p-8 bg-gray-700 rounded-full mb-4">
              <FaVolumeUp className="text-6xl text-green-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Sesli Kanala Bağlandı</h2>
            <p className="text-gray-400">
              {voiceUsers.length} kullanıcı kanalda
            </p>
          </div>

          <div className="mb-8 flex justify-center gap-4 flex-wrap">
            {voiceUsers.map((voiceUser, index) => {
              const isCurrentUser = voiceUser.socketId === socket.id;
              const userSpeaking = isCurrentUser ? speaking : remoteSpeakingUsers.has(voiceUser.socketId);
              return (
                <div key={index} className="flex flex-col items-center">
                  <div className={`relative ${userSpeaking ? 'animate-pulse' : ''}`}>
                    <img
                      src={voiceUser.avatar}
                      alt={voiceUser.username}
                      className={`w-16 h-16 rounded-full mb-2 transition-all ${
                        userSpeaking ? 'ring-4 ring-green-500' : 'border-2 border-gray-600'
                      }`}
                    />
                    {userSpeaking && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-800"></div>
                    )}
                  </div>
                  <span className={`text-sm ${userSpeaking ? 'text-green-400 font-semibold' : ''}`}>
                    {voiceUser.username}
                    {isCurrentUser && ' (Sen)'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full transition-colors ${
                muted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
              }`}
              title={muted ? 'Sesi Aç' : 'Sesi Kapat'}
            >
              {muted ? <FaMicrophoneSlash size={24} /> : <FaMicrophone size={24} />}
            </button>

            <button
              onClick={handleDisconnect}
              className="p-4 bg-red-600 hover:bg-red-700 rounded-full transition-colors"
              title="Bağlantıyı Kes"
            >
              <FaPhoneSlash size={24} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VoiceChannel;
