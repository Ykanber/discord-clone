import { useState, useEffect } from 'react';
import { FaHashtag, FaChevronDown, FaPlus, FaVolumeUp } from 'react-icons/fa';

function ChannelList({ server, selectedChannel, onChannelSelect, onCreateChannel, socket, voiceChannelUsers, speakingUsers }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState('text');

  const handleCreate = () => {
    if (channelName.trim()) {
      onCreateChannel(channelName.trim(), channelType);
      setChannelName('');
      setChannelType('text');
      setShowCreateModal(false);
    }
  };

  if (!server) {
    return (
      <div className="w-60 bg-gray-700 flex items-center justify-center">
        <p className="text-gray-400">Sunucu seçin</p>
      </div>
    );
  }

  const textChannels = server.channels.filter(ch => ch.type !== 'voice');
  const voiceChannels = server.channels.filter(ch => ch.type === 'voice');

  return (
    <div className="w-60 bg-gray-700 flex flex-col">
      <div className="h-12 px-4 flex items-center justify-between border-b border-gray-900 shadow-md">
        <h2 className="font-bold flex items-center">
          {server.name}
          <FaChevronDown className="ml-2 text-xs" />
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Text Channels */}
        <div className="px-2 py-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold text-gray-400 uppercase">
              Metin Kanalları
            </span>
            <button
              onClick={() => {
                setChannelType('text');
                setShowCreateModal(true);
              }}
              className="text-gray-400 hover:text-white"
              title="Metin Kanalı Ekle"
            >
              <FaPlus className="text-xs" />
            </button>
          </div>

          {textChannels.map(channel => (
            <button
              key={channel.id}
              onClick={() => onChannelSelect(channel)}
              className={`w-full px-2 py-1.5 rounded flex items-center text-gray-400 hover:bg-gray-600 hover:text-white transition-colors ${
                selectedChannel?.id === channel.id ? 'bg-gray-600 text-white' : ''
              }`}
            >
              <FaHashtag className="mr-2 text-sm" />
              <span className="text-sm">{channel.name}</span>
            </button>
          ))}
        </div>

        {/* Voice Channels */}
        <div className="px-2 py-4 border-t border-gray-800">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold text-gray-400 uppercase">
              Sesli Kanallar
            </span>
            <button
              onClick={() => {
                setChannelType('voice');
                setShowCreateModal(true);
              }}
              className="text-gray-400 hover:text-white"
              title="Sesli Kanal Ekle"
            >
              <FaPlus className="text-xs" />
            </button>
          </div>

          {voiceChannels.map(channel => {
            const channelUsers = voiceChannelUsers[channel.id] || [];
            console.log(`Channel ${channel.name} (${channel.id}):`, channelUsers.length, 'users');
            return (
              <div key={channel.id}>
                <button
                  onClick={() => onChannelSelect(channel)}
                  className={`w-full px-2 py-1.5 rounded flex items-center text-gray-400 hover:bg-gray-600 hover:text-white transition-colors ${
                    selectedChannel?.id === channel.id ? 'bg-gray-600 text-white' : ''
                  }`}
                >
                  <FaVolumeUp className="mr-2 text-sm" />
                  <span className="text-sm">{channel.name}</span>
                  {channelUsers.length > 0 && (
                    <span className="ml-auto text-xs text-gray-400">{channelUsers.length}</span>
                  )}
                </button>
                {channelUsers.length > 0 && (
                  <div className="ml-6 mt-1 mb-2 space-y-1">
                    {channelUsers.map((user, index) => {
                      const isSpeaking = speakingUsers.includes(user.socketId);
                      return (
                        <div key={index} className="flex items-center px-2 py-1 text-sm text-gray-300">
                          <div className={`relative ${isSpeaking ? 'animate-pulse' : ''}`}>
                            <img
                              src={user.avatar}
                              alt={user.username}
                              className={`w-6 h-6 rounded-full ${
                                isSpeaking ? 'ring-2 ring-green-500' : ''
                              }`}
                            />
                            {isSpeaking && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-700"></div>
                            )}
                          </div>
                          <span className="ml-2 text-xs truncate">{user.username}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">
              {channelType === 'voice' ? 'Sesli Kanal Oluştur' : 'Metin Kanalı Oluştur'}
            </h2>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Kanal Tipi</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setChannelType('text')}
                  className={`flex-1 py-2 px-4 rounded flex items-center justify-center gap-2 ${
                    channelType === 'text'
                      ? 'bg-indigo-600'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <FaHashtag />
                  Metin
                </button>
                <button
                  onClick={() => setChannelType('voice')}
                  className={`flex-1 py-2 px-4 rounded flex items-center justify-center gap-2 ${
                    channelType === 'voice'
                      ? 'bg-indigo-600'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <FaVolumeUp />
                  Sesli
                </button>
              </div>
            </div>

            <input
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full px-4 py-2 bg-gray-700 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Kanal adı..."
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 py-2 rounded font-medium"
              >
                Oluştur
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setChannelName('');
                  setChannelType('text');
                }}
                className="flex-1 bg-gray-600 hover:bg-gray-700 py-2 rounded font-medium"
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChannelList;
