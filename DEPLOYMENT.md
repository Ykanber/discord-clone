# Discord Klonu - Deployment Rehberi

## 🚀 Render.com ile Deploy

### 1. GitHub'a Push
```bash
git init
git add .
git commit -m "Initial commit - Discord clone ready for deployment"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/discord-clone.git
git push -u origin main
```

### 2. Render Hesabı
1. https://render.com adresine gidin
2. GitHub ile giriş yapın
3. GitHub repo erişimi verin

### 3. Backend Deploy (Web Service)

**A. New Web Service Oluştur:**
- Dashboard → New → Web Service
- GitHub repo'nuzu seçin
- **Name:** `discord-clone-backend`
- **Root Directory:** `server`
- **Environment:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Plan:** `Free`

**B. Environment Variables Ekle:**
```
PORT=3000
FRONTEND_URL=https://discord-clone-frontend.onrender.com
```
*(FRONTEND_URL'yi frontend deploy edildikten sonra güncelleyin)*

**C. Deploy'u başlat** - 5-10 dakika sürer

### 4. Frontend Deploy (Static Site)

**A. New Static Site Oluştur:**
- Dashboard → New → Static Site
- Aynı GitHub repo'yu seçin
- **Name:** `discord-clone-frontend`
- **Root Directory:** `client`
- **Build Command:** `npm install && npm run build`
- **Publish Directory:** `dist`

**B. Environment Variables Ekle:**
```
VITE_API_URL=https://discord-clone-backend.onrender.com
```
*(Backend URL'ini kendi backend URL'inizle değiştirin)*

**C. Deploy'u başlat** - 5-10 dakika sürer

### 5. Backend Environment Variable Güncelle

Backend deploy edildikten sonra:
1. Backend service → Environment
2. `FRONTEND_URL` değerini frontend URL ile güncelleyin
3. **Manual Deploy** ile yeniden deploy edin

### 6. Test

1. Frontend URL'ini açın: `https://discord-clone-frontend.onrender.com`
2. Kullanıcı adı ile giriş yapın
3. Sunucu ve kanal oluşturun
4. Sesli kanala katılın
5. Arkadaşlarınızı davet edin!

## 📝 URL'ler

Deploy sonrası URL'ler:
- **Frontend:** `https://SIZIN-PROJE-ADI-frontend.onrender.com`
- **Backend:** `https://SIZIN-PROJE-ADI-backend.onrender.com`

## ⚠️ Önemli Notlar

### Ücretsiz Tier Limitleri:
- Web service 15 dakika idle (kullanılmaz) kalırsa uyku moduna geçer
- İlk istek 30-60 saniye sürebilir (cold start)
- 750 saat/ay limit (31 gün = 744 saat - yeterli!)

### Cold Start Sorunu:
Eğer site çok kullanılacaksa:
1. Render'da **Cron Job** oluşturun
2. Her 10 dakikada backend'e ping atın:
   ```
   curl https://discord-clone-backend.onrender.com
   ```

### WebSocket:
- Render WebSocket'i destekler ✅
- Socket.io çalışır ✅
- Sesli chat çalışır ✅

### Database:
- Şu anda JSON dosya kullanıyor
- Veriler her deploy'da sıfırlanır
- Production için MongoDB/PostgreSQL eklenebilir

## 🔄 Güncelleme

Kod değiştirdikten sonra:
```bash
git add .
git commit -m "Update: açıklama"
git push
```

Render otomatik olarak yeni versiyonu deploy eder.

## 🐛 Troubleshooting

### Backend başlamıyor:
- Logs'u kontrol edin: Dashboard → Service → Logs
- Environment variables doğru mu kontrol edin

### Frontend backend'e bağlanmıyor:
- CORS hatası: Backend FRONTEND_URL doğru mu?
- API URL hatası: Frontend VITE_API_URL doğru mu?

### Sesli chat çalışmıyor:
- HTTPS gerekli (Render otomatik sağlar)
- Mikrofon izni verin
- Console'da hata var mı kontrol edin

## 📞 Destek

Sorun yaşarsanız:
1. Render logs'ları kontrol edin
2. Browser console'ı kontrol edin
3. GitHub issues açın
