import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

// CORS configuration for production
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173']
  : ['http://localhost:5173'];

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

  // Voice channel events
  socket.on('join_voice_channel', ({ channelId, user, peerId }) => {
    socket.join(channelId);

    if (!voiceChannelUsers.has(channelId)) {
      voiceChannelUsers.set(channelId, new Map());
    }

    // Store user with peerId
    voiceChannelUsers.get(channelId).set(socket.id, {
      ...user,
      socketId: socket.id,
      peerId: peerId || socket.id
    });

    console.log(`User ${user.username} joined voice channel ${channelId}`);
    console.log(`Channel ${channelId} now has ${voiceChannelUsers.get(channelId).size} users`);

    // Notify others in the channel
    socket.to(channelId).emit('user_joined_voice', {
      user: {
        ...user,
        socketId: socket.id,
        peerId: peerId || socket.id
      }
    });

    // Send existing users to the new user
    const existingUsers = Array.from(voiceChannelUsers.get(channelId).values())
      .filter(u => u.socketId !== socket.id);
    socket.emit('existing_voice_users', { users: existingUsers });

    // Broadcast ALL voice channel states to ALL clients
    voiceChannelUsers.forEach((users, chId) => {
      io.emit('voice_channel_users_update', {
        channelId: chId,
        users: Array.from(users.values())
      });
    });
  });

  socket.on('leave_voice_channel', ({ channelId }) => {
    socket.leave(channelId);

    if (voiceChannelUsers.has(channelId)) {
      voiceChannelUsers.get(channelId).delete(socket.id);
      console.log(`User left voice channel ${channelId}`);
      console.log(`Channel ${channelId} now has ${voiceChannelUsers.get(channelId).size} users`);

      if (voiceChannelUsers.get(channelId).size === 0) {
        voiceChannelUsers.delete(channelId);
        console.log(`Channel ${channelId} deleted (empty)`);
      }

      // Broadcast ALL voice channel states to ALL clients
      voiceChannelUsers.forEach((users, chId) => {
        io.emit('voice_channel_users_update', {
          channelId: chId,
          users: Array.from(users.values())
        });
      });

      // Also send empty update for the channel that was deleted
      if (!voiceChannelUsers.has(channelId)) {
        io.emit('voice_channel_users_update', {
          channelId,
          users: []
        });
      }
    }

    socket.to(channelId).emit('user_left_voice', { socketId: socket.id });
  });

  // Voice speaking event
  socket.on('user_speaking', ({ channelId, speaking }) => {
    io.to(channelId).emit('user_speaking_update', {
      socketId: socket.id,
      speaking
    });
  });

  // PeerJS handles signaling itself, no need for WebRTC signaling here

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    onlineUsers.delete(socket.id);
    io.emit('users_update', Array.from(onlineUsers.values()));

    // Remove from all voice channels
    voiceChannelUsers.forEach((users, channelId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        console.log(`User ${socket.id} removed from voice channel ${channelId} (disconnect)`);
        socket.to(channelId).emit('user_left_voice', { socketId: socket.id });

        if (users.size === 0) {
          voiceChannelUsers.delete(channelId);
          console.log(`Channel ${channelId} deleted (empty after disconnect)`);
        }
      }
    });

    // Broadcast ALL voice channel states after disconnect
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
