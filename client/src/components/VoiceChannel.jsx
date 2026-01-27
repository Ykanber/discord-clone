import { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { FaVolumeMute, FaVolumeUp, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash } from 'react-icons/fa';

function VoiceChannel({ channel, user, socket, onLeave }) {
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [remoteSpeakingUsers, setRemoteSpeakingUsers] = useState(new Set());

  const peerRef = useRef(null);
  const connectionsRef = useRef({});
  const userStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const speakingTimeoutRef = useRef(null);
  const audioElementsRef = useRef({});

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

    socket.on('user_joined_voice', handleUserJoinedVoice);
    socket.on('existing_voice_users', handleExistingUsers);
    socket.on('user_left_voice', handleUserLeftVoice);
    socket.on('voice_channel_users_update', handleVoiceUsersUpdate);
    socket.on('user_speaking_update', handleRemoteSpeaking);

    return () => {
      socket.off('user_joined_voice', handleUserJoinedVoice);
      socket.off('existing_voice_users', handleExistingUsers);
      socket.off('user_left_voice', handleUserLeftVoice);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      userStreamRef.current = stream;

      // Setup voice activity detection
      setupVoiceActivityDetection(stream);

      // Create PeerJS instance with socket.id as peer ID
      const peer = new Peer(socket.id, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        }
      });

      peer.on('open', (id) => {
        console.log('PeerJS ID:', id);
        peerRef.current = peer;

        // Join voice channel
        socket.emit('join_voice_channel', {
          channelId: channel.id,
          user: {
            id: user.id,
            username: user.username,
            avatar: user.avatar
          },
          peerId: id
        });

        setConnected(true);
      });

      // Answer incoming calls
      peer.on('call', (call) => {
        console.log('Receiving call from:', call.peer);
        call.answer(userStreamRef.current);

        call.on('stream', (remoteStream) => {
          console.log('Received stream from:', call.peer);
          playAudio(call.peer, remoteStream);
        });

        connectionsRef.current[call.peer] = call;
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
      });

    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Mikrofona erişim izni gerekli!');
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

  const playAudio = (peerId, stream) => {
    let audio = audioElementsRef.current[peerId];
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.volume = 1.0;
      audioElementsRef.current[peerId] = audio;
    }

    audio.srcObject = stream;
    audio.play().then(() => {
      console.log('Audio playing from:', peerId);
    }).catch(err => {
      console.error('Error playing audio from', peerId, err);
    });
  };

  const leaveVoiceChannel = () => {
    if (userStreamRef.current) {
      userStreamRef.current.getTracks().forEach(track => track.stop());
      userStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
    }

    // Clean up all audio elements
    Object.values(audioElementsRef.current).forEach(audio => {
      if (audio) {
        audio.srcObject = null;
        audio.pause();
      }
    });
    audioElementsRef.current = {};

    // Close all connections
    Object.values(connectionsRef.current).forEach(conn => {
      if (conn) conn.close();
    });
    connectionsRef.current = {};

    // Close peer
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    if (socket && channel) {
      socket.emit('leave_voice_channel', { channelId: channel.id });
    }

    setSpeaking(false);
    setRemoteSpeakingUsers(new Set());
    setConnected(false);
  };

  const handleExistingUsers = ({ users }) => {
    console.log('Existing voice users:', users);
    users.forEach(existingUser => {
      if (existingUser.peerId && existingUser.peerId !== socket.id) {
        callPeer(existingUser.peerId);
      }
    });
  };

  const handleUserJoinedVoice = ({ user: newUser }) => {
    console.log('User joined voice:', newUser);
    if (newUser.peerId && newUser.peerId !== socket.id) {
      // Wait a bit for the new user to be ready
      setTimeout(() => {
        callPeer(newUser.peerId);
      }, 1000);
    }
  };

  const handleUserLeftVoice = ({ socketId }) => {
    console.log('User left voice:', socketId);

    // Close connection
    if (connectionsRef.current[socketId]) {
      connectionsRef.current[socketId].close();
      delete connectionsRef.current[socketId];
    }

    // Clean up audio element
    if (audioElementsRef.current[socketId]) {
      const audio = audioElementsRef.current[socketId];
      audio.srcObject = null;
      delete audioElementsRef.current[socketId];
    }

    // Remove from speaking users
    setRemoteSpeakingUsers(prev => {
      const newSet = new Set(prev);
      newSet.delete(socketId);
      return newSet;
    });
  };

  const callPeer = (peerId) => {
    if (!peerRef.current || !userStreamRef.current) {
      console.log('Not ready to call');
      return;
    }

    console.log('Calling peer:', peerId);
    const call = peerRef.current.call(peerId, userStreamRef.current);

    call.on('stream', (remoteStream) => {
      console.log('Received stream from:', peerId);
      playAudio(peerId, remoteStream);
    });

    call.on('error', (err) => {
      console.error('Call error with', peerId, err);
    });

    connectionsRef.current[peerId] = call;
  };

  const handleVoiceUsersUpdate = ({ channelId, users }) => {
    if (channelId === channel.id) {
      setVoiceUsers(users);
    }
  };

  const toggleMute = () => {
    if (userStreamRef.current) {
      const willBeMuted = !muted;
      userStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !willBeMuted;
      });
      setMuted(willBeMuted);

      if (willBeMuted && speaking) {
        setSpeaking(false);
        socket.emit('user_speaking', { channelId: channel.id, speaking: false });
        if (speakingTimeoutRef.current) {
          clearTimeout(speakingTimeoutRef.current);
        }
      }
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
