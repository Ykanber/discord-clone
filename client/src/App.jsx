import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import ChannelList from './components/ChannelList';
import Chat from './components/Chat';
import VoiceChannel from './components/VoiceChannel';
import UserList from './components/UserList';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const socket = io(API_URL);

function App() {
  const [user, setUser] = useState(null);
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [voiceChannelUsers, setVoiceChannelUsers] = useState({});
  const [speakingUsers, setSpeakingUsers] = useState([]);

  useEffect(() => {
    if (user) {
      socket.emit('user_online', user);
      loadServers();
    }
  }, [user]);

  useEffect(() => {
    socket.on('users_update', (users) => {
      setOnlineUsers(users);
    });

    socket.on('server_created', (server) => {
      setServers(prev => [...prev, server]);
    });

    socket.on('channel_created', ({ serverId, channel }) => {
      setServers(prev => prev.map(s =>
        s.id === serverId
          ? { ...s, channels: [...s.channels, channel] }
          : s
      ));
    });

    socket.on('voice_channel_users_update', ({ channelId, users }) => {
      console.log('Voice channel users update:', channelId, users.length, 'users');
      setVoiceChannelUsers(prev => ({
        ...prev,
        [channelId]: users
      }));
    });

    socket.on('user_speaking_update', ({ socketId, speaking }) => {
      setSpeakingUsers(prev => {
        if (speaking) {
          return prev.includes(socketId) ? prev : [...prev, socketId];
        } else {
          return prev.filter(id => id !== socketId);
        }
      });
    });

    return () => {
      socket.off('users_update');
      socket.off('server_created');
      socket.off('channel_created');
      socket.off('voice_channel_users_update');
      socket.off('user_speaking_update');
    };
  }, []);

  const loadServers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/servers`);
      setServers(response.data.servers);
      if (response.data.servers.length > 0) {
        setSelectedServer(response.data.servers[0]);
        setSelectedChannel(response.data.servers[0].channels[0]);
      }
    } catch (error) {
      console.error('Error loading servers:', error);
    }
  };

  const handleServerSelect = (server) => {
    setSelectedServer(server);
    if (server.channels.length > 0) {
      setSelectedChannel(server.channels[0]);
    }
  };

  const handleChannelSelect = (channel) => {
    setSelectedChannel(channel);
  };

  const handleCreateServer = async (name) => {
    try {
      await axios.post(`${API_URL}/api/servers`, { name });
    } catch (error) {
      console.error('Error creating server:', error);
    }
  };

  const handleCreateChannel = async (name, type = 'text') => {
    if (!selectedServer) return;
    try {
      await axios.post(`${API_URL}/api/servers/${selectedServer.id}/channels`, { name, type });
    } catch (error) {
      console.error('Error creating channel:', error);
    }
  };

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className="flex h-screen bg-gray-800 text-white">
      <Sidebar
        servers={servers}
        selectedServer={selectedServer}
        onServerSelect={handleServerSelect}
        onCreateServer={handleCreateServer}
      />
      <ChannelList
        server={selectedServer}
        selectedChannel={selectedChannel}
        onChannelSelect={handleChannelSelect}
        onCreateChannel={handleCreateChannel}
        socket={socket}
        voiceChannelUsers={voiceChannelUsers}
        speakingUsers={speakingUsers}
      />
      {selectedChannel?.type === 'voice' ? (
        <VoiceChannel
          channel={selectedChannel}
          user={user}
          socket={socket}
          onLeave={() => {
            if (selectedServer?.channels?.length > 0) {
              const firstTextChannel = selectedServer.channels.find(ch => ch.type !== 'voice');
              setSelectedChannel(firstTextChannel || selectedServer.channels[0]);
            }
          }}
        />
      ) : (
        <Chat
          server={selectedServer}
          channel={selectedChannel}
          user={user}
          socket={socket}
        />
      )}
      <UserList users={onlineUsers} />
    </div>
  );
}

export default App;
