import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { FaHashtag, FaPaperPlane } from 'react-icons/fa';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function Chat({ server, channel, user, socket }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (server && channel) {
      loadMessages();
    }
  }, [server, channel]);

  useEffect(() => {
    socket.on('new_message', ({ serverId, channelId, message }) => {
      if (server?.id === serverId && channel?.id === channelId) {
        setMessages(prev => [...prev, message]);
      }
    });

    return () => {
      socket.off('new_message');
    };
  }, [server, channel, socket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/servers/${server.id}/channels/${channel.id}/messages`
      );
      setMessages(response.data.messages);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !server || !channel) return;

    socket.emit('send_message', {
      serverId: server.id,
      channelId: channel.id,
      message: newMessage.trim(),
      user
    });

    setNewMessage('');
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' +
           date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  if (!channel) {
    return (
      <div className="flex-1 bg-gray-800 flex items-center justify-center">
        <p className="text-gray-400">Kanal seçin</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-800">
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-gray-900 shadow-md">
        <FaHashtag className="text-gray-400 mr-2" />
        <h3 className="font-bold">{channel.name}</h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <FaHashtag className="text-4xl mb-2" />
            <p className="text-lg font-semibold">#{channel.name} kanalına hoş geldin!</p>
            <p className="text-sm">Bu kanalın başlangıcı.</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="flex hover:bg-gray-700 hover:bg-opacity-30 px-2 py-1 rounded">
              <img
                src={message.user.avatar}
                alt={message.user.username}
                className="w-10 h-10 rounded-full mr-3"
              />
              <div className="flex-1">
                <div className="flex items-baseline">
                  <span className="font-semibold text-white mr-2">
                    {message.user.username}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTime(message.timestamp)}
                  </span>
                </div>
                <p className="text-gray-100 mt-1">{message.content}</p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="p-4">
        <form onSubmit={handleSendMessage} className="flex items-center bg-gray-700 rounded-lg">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={`#${channel.name} kanalına mesaj gönder`}
            className="flex-1 bg-transparent px-4 py-3 focus:outline-none text-white placeholder-gray-400"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="px-4 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FaPaperPlane />
          </button>
        </form>
      </div>
    </div>
  );
}

export default Chat;
