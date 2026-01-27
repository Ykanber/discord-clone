import { useState } from 'react';
import { FaPlus, FaHashtag } from 'react-icons/fa';

function Sidebar({ servers, selectedServer, onServerSelect, onCreateServer }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [serverName, setServerName] = useState('');

  const handleCreate = () => {
    if (serverName.trim()) {
      onCreateServer(serverName.trim());
      setServerName('');
      setShowCreateModal(false);
    }
  };

  return (
    <div className="w-20 bg-gray-900 flex flex-col items-center py-3 space-y-2">
      {servers.map(server => (
        <button
          key={server.id}
          onClick={() => onServerSelect(server)}
          className={`w-12 h-12 rounded-full flex items-center justify-center font-bold transition-all duration-200 hover:rounded-2xl ${
            selectedServer?.id === server.id
              ? 'bg-indigo-600 rounded-2xl'
              : 'bg-gray-700 hover:bg-indigo-500'
          }`}
          title={server.name}
        >
          {server.name.charAt(0).toUpperCase()}
        </button>
      ))}

      <button
        onClick={() => setShowCreateModal(true)}
        className="w-12 h-12 rounded-full bg-gray-700 hover:bg-green-600 hover:rounded-2xl flex items-center justify-center transition-all duration-200"
        title="Sunucu Ekle"
      >
        <FaPlus />
      </button>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Sunucu Oluştur</h2>
            <input
              type="text"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full px-4 py-2 bg-gray-700 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Sunucu adı..."
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
                  setServerName('');
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

export default Sidebar;
