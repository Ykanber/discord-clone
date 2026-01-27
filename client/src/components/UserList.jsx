import { FaCircle } from 'react-icons/fa';

function UserList({ users }) {
  return (
    <div className="w-60 bg-gray-700 p-4">
      <h3 className="font-bold text-sm text-gray-400 uppercase mb-3">
        Çevrimiçi — {users.length}
      </h3>
      <div className="space-y-2">
        {users.map((user, index) => (
          <div key={index} className="flex items-center px-2 py-1 rounded hover:bg-gray-600 cursor-pointer">
            <div className="relative">
              <img
                src={user.avatar}
                alt={user.username}
                className="w-8 h-8 rounded-full"
              />
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-700"></div>
            </div>
            <span className="ml-3 text-sm">{user.username}</span>
          </div>
        ))}
        {users.length === 0 && (
          <p className="text-gray-400 text-sm">Çevrimiçi kullanıcı yok</p>
        )}
      </div>
    </div>
  );
}

export default UserList;
