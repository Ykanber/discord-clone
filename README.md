# Discord Klonu 🎮

Modern, gerçek zamanlı mesajlaşma uygulaması - Discord benzeri bir chat platformu.

**🌐 Live Demo:** [Yakında deploy edilecek]

## 🚀 Özellikler

- ✅ Kullanıcı girişi/kayıt sistemi
- ✅ Sunucu oluşturma ve yönetimi
- ✅ **Metin kanalları** - Gerçek zamanlı mesajlaşma (Socket.io)
- ✅ **Sesli kanallar** - WebRTC ile sesli sohbet (PeerJS)
- ✅ **Konuşma göstergesi** - Kimin konuştuğunu görün (yeşil ring)
- ✅ Çevrimiçi kullanıcı listesi
- ✅ Modern ve responsive UI (TailwindCSS)
- ✅ Avatar entegrasyonu (DiceBear API)
- ✅ Sesli kanaldaki kullanıcıları görme

## 🛠️ Teknolojiler

### Backend
- Node.js
- Express.js
- Socket.io (gerçek zamanlı iletişim)
- JSON dosya tabanlı veritabanı

### Frontend
- React 18
- Vite
- TailwindCSS
- Socket.io Client
- Axios
- React Icons

## 📦 Kurulum

### Gereksinimler
- Node.js (v16 veya üzeri)
- npm veya yarn

### Backend Kurulum

1. Server klasörüne gidin ve bağımlılıkları yükleyin:
```bash
cd server
npm install
```

2. Server'ı başlatın:
```bash
npm start
```

Server http://localhost:3000 adresinde çalışacaktır.

### Frontend Kurulum

1. Yeni bir terminal açın ve client klasörüne gidin:
```bash
cd client
npm install
```

2. Frontend'i başlatın:
```bash
npm run dev
```

Frontend http://localhost:5173 adresinde çalışacaktır.

## 🎮 Kullanım

1. Tarayıcınızda http://localhost:5173 adresine gidin
2. Bir kullanıcı adı girin ve giriş yapın
3. Sol taraftan sunucular arasında gezinin veya yeni sunucu oluşturun
4. Kanallar arasında geçiş yapın veya yeni kanal oluşturun
5. Mesaj gönderin ve diğer kullanıcılarla gerçek zamanlı sohbet edin
6. Sağ taraftaki kullanıcı listesinden çevrimiçi kullanıcıları görün

## 📂 Proje Yapısı

```
aitest3/
├── server/                 # Backend
│   ├── index.js           # Express ve Socket.io server
│   ├── data.json          # Veritabanı (JSON)
│   └── package.json
├── client/                # Frontend
│   ├── src/
│   │   ├── components/    # React componentleri
│   │   │   ├── Login.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── ChannelList.jsx
│   │   │   ├── Chat.jsx
│   │   │   └── UserList.jsx
│   │   ├── App.jsx        # Ana uygulama
│   │   └── index.css      # Global stiller
│   └── package.json
└── README.md
```

## 🔧 API Endpoints

### REST API
- `POST /api/auth/login` - Kullanıcı girişi
- `GET /api/servers` - Tüm sunucuları getir
- `POST /api/servers` - Yeni sunucu oluştur
- `POST /api/servers/:serverId/channels` - Yeni kanal oluştur
- `GET /api/servers/:serverId/channels/:channelId/messages` - Mesajları getir

### Socket.io Events
- `user_online` - Kullanıcı çevrimiçi oldu
- `users_update` - Çevrimiçi kullanıcılar güncellendi
- `send_message` - Mesaj gönder
- `new_message` - Yeni mesaj alındı
- `server_created` - Yeni sunucu oluşturuldu
- `channel_created` - Yeni kanal oluşturuldu

## 🎨 UI Özellikleri

- Discord'a benzer modern ve temiz arayüz
- Koyu tema (Dark mode)
- Hover efektleri ve animasyonlar
- Responsive tasarım
- Avatar görselleri
- Çevrimiçi durum göstergesi

## 🚧 Gelecek Geliştirmeler

- [ ] Kullanıcı profil ayarları
- [ ] Özel mesajlaşma (DM)
- [ ] Dosya yükleme ve paylaşma
- [ ] Emoji desteği
- [ ] Kullanıcı rolleri ve izinleri
- [ ] Ses ve görüntülü arama
- [ ] Gerçek veritabanı entegrasyonu (MongoDB/PostgreSQL)
- [ ] Kullanıcı authentication (JWT)

## 📝 Notlar

- Bu proje eğitim amaçlıdır
- Üretim ortamı için ek güvenlik önlemleri alınmalıdır
- Veritabanı olarak JSON dosyası kullanılmaktadır (geliştirme ortamı için)

## 📄 Lisans

Bu proje MIT lisansı altında lisanslanmıştır.
