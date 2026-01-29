import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import VoiceManager from './voiceManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

// CORS configuration for production
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5000']
  : ['http://localhost:5000'];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

const DATA_FILE = join(__dirname, 'data.json');

// Helper functions
const readData = () => {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (error) {
    return { users: [], servers: [] };
  }
};

const writeData = (data) => {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// REST API Routes
app.post('/api/auth/login', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  const data = readData();
  let user = data.users.find(u => u.username === username);

  if (!user) {
    user = {
      id: uuidv4(),
      username,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
    writeData(data);
  }

  res.json({ user });
});

app.get('/api/servers', (req, res) => {
  const data = readData();
  res.json({ servers: data.servers });
});

app.post('/api/servers', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Server name required' });
  }

  const data = readData();
  const newServer = {
    id: uuidv4(),
    name,
    channels: [
      {
        id: uuidv4(),
        name: 'genel',
        messages: []
      }
    ],
    createdAt: new Date().toISOString()
  };

  data.servers.push(newServer);
  writeData(data);

  io.emit('server_created', newServer);
  res.json({ server: newServer });
});

app.post('/api/servers/:serverId/channels', (req, res) => {
  const { serverId } = req.params;
  const { name, type } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Channel name required' });
  }

  const data = readData();
  const server = data.servers.find(s => s.id === serverId);

  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const newChannel = {
    id: uuidv4(),
    name,
    type: type || 'text', // 'text' or 'voice'
    messages: [],
    createdAt: new Date().toISOString()
  };

  server.channels.push(newChannel);
  writeData(data);

  io.emit('channel_created', { serverId, channel: newChannel });
  res.json({ channel: newChannel });
});

app.get('/api/servers/:serverId/channels/:channelId/messages', (req, res) => {
  const { serverId, channelId } = req.params;
  const data = readData();

  const server = data.servers.find(s => s.id === serverId);
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const channel = server.channels.find(c => c.id === channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  res.json({ messages: channel.messages });
});

// Socket.IO
const onlineUsers = new Map();
const voiceChannelUsers = new Map(); // Track users in voice channels

// Initialize Voice Manager
const voiceManager = new VoiceManager();
voiceManager.init().catch(err => {
  console.error('Failed to initialize VoiceManager:', err);
  process.exit(1);
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user_online', (user) => {
    onlineUsers.set(socket.id, user);
    io.emit('users_update', Array.from(onlineUsers.values()));

    // Send current voice channel states to the newly connected user
    console.log('Sending current voice channel states to new user:', socket.id);
    voiceChannelUsers.forEach((users, channelId) => {
      socket.emit('voice_channel_users_update', {
        channelId,
        users: Array.from(users.values())
      });
      console.log(`  - Channel ${channelId}: ${users.size} users`);
    });
  });

  socket.on('send_message', ({ serverId, channelId, message, user }) => {
    const data = readData();
    const server = data.servers.find(s => s.id === serverId);

    if (server) {
      const channel = server.channels.find(c => c.id === channelId);

      if (channel) {
        const newMessage = {
          id: uuidv4(),
          content: message,
          user: {
            id: user.id,
            username: user.username,
            avatar: user.avatar
          },
          timestamp: new Date().toISOString()
        };

        channel.messages.push(newMessage);
        writeData(data);

        io.emit('new_message', { serverId, channelId, message: newMessage });
      }
    }
  });

  // Voice channel events - mediasoup integration
  socket.on('join_voice_channel', async ({ channelId, userId }) => {
    socket.join(channelId);

    // Track user in channel (for UI)
    if (!voiceChannelUsers.has(channelId)) {
      voiceChannelUsers.set(channelId, new Map());
    }

    // Get user info from onlineUsers
    const user = onlineUsers.get(socket.id);
    if (user) {
      voiceChannelUsers.get(channelId).set(socket.id, {
        ...user,
        socketId: socket.id
      });

      // Broadcast voice channel users update to ALL clients
      voiceChannelUsers.forEach((users, chId) => {
        io.emit('voice_channel_users_update', {
          channelId: chId,
          users: Array.from(users.values())
        });
      });
    }

    // Initialize mediasoup session
    await voiceManager.handleJoinChannel(socket, { channelId, userId });
  });

  // Create WebRTC transport
  socket.on('create-transport', async ({ channelId, direction }, callback) => {
    try {
      const params = await voiceManager.createTransport(socket, { channelId, direction });
      callback({ success: true, ...params });
    } catch (error) {
      console.error('Error creating transport:', error);
      callback({ success: false, error: error.message });
    }
  });

  // Connect transport
  socket.on('connect-transport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      await voiceManager.connectTransport(socket, { transportId, dtlsParameters });
      callback({ success: true });
    } catch (error) {
      console.error('Error connecting transport:', error);
      callback({ success: false, error: error.message });
    }
  });

  // Produce media (audio)
  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      const { producerId } = await voiceManager.produce(socket, { transportId, kind, rtpParameters });
      callback({ success: true, producerId });
    } catch (error) {
      console.error('Error producing:', error);
      callback({ success: false, error: error.message });
    }
  });

  // Consume media (audio)
  socket.on('consume', async ({ producerId, rtpCapabilities, transportId }, callback) => {
    try {
      const params = await voiceManager.consume(socket, { producerId, rtpCapabilities, transportId });
      callback({ success: true, ...params });
    } catch (error) {
      console.error('Error consuming:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('leave_voice_channel', async ({ channelId }) => {
    socket.leave(channelId);

    // Update UI state
    if (voiceChannelUsers.has(channelId)) {
      voiceChannelUsers.get(channelId).delete(socket.id);
      console.log(`User left voice channel ${channelId}`);

      if (voiceChannelUsers.get(channelId).size === 0) {
        voiceChannelUsers.delete(channelId);
        console.log(`Channel ${channelId} deleted (empty)`);
      }

      // Broadcast voice channel users update
      voiceChannelUsers.forEach((users, chId) => {
        io.emit('voice_channel_users_update', {
          channelId: chId,
          users: Array.from(users.values())
        });
      });

      if (!voiceChannelUsers.has(channelId)) {
        io.emit('voice_channel_users_update', {
          channelId,
          users: []
        });
      }
    }

    // Cleanup mediasoup resources
    await voiceManager.handleLeave(socket);
  });

  // Voice speaking event (for UI indicator)
  socket.on('user_speaking', ({ channelId, speaking }) => {
    io.to(channelId).emit('user_speaking_update', {
      socketId: socket.id,
      speaking
    });
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    onlineUsers.delete(socket.id);
    io.emit('users_update', Array.from(onlineUsers.values()));

    // Cleanup mediasoup resources
    await voiceManager.handleLeave(socket);

    // Remove from all voice channels (UI state)
    voiceChannelUsers.forEach((users, channelId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        console.log(`User ${socket.id} removed from voice channel ${channelId} (disconnect)`);

        if (users.size === 0) {
          voiceChannelUsers.delete(channelId);
          console.log(`Channel ${channelId} deleted (empty after disconnect)`);
        }
      }
    });

    // Broadcast voice channel states after disconnect
    voiceChannelUsers.forEach((users, chId) => {
      io.emit('voice_channel_users_update', {
        channelId: chId,
        users: Array.from(users.values())
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
