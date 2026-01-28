# Mobile Implementation Guide

Bu rehber, Discord klonunun iOS ve Android native uygulamaları için sesli kanal implementasyonunu açıklar.

## 📱 Desteklenen Platformlar

- **iOS** - Swift + WebRTC + mediasoup-client-swift
- **Android** - Kotlin + WebRTC + mediasoup-client
- **Web** - React + mediasoup-client ✅ (Ana projede mevcut)

## 🏗️ Mimari

```
Mobile App (iOS/Android)
        ↓
    Socket.IO
        ↓
Node.js Backend (mediasoup SFU)
        ↓
    WebRTC Audio Stream
```

**Önemli:** PeerJS kullanılmıyor! Bunun yerine mediasoup SFU (Selective Forwarding Unit) kullanılmaktadır.

---

## 📦 iOS Kurulum

### 1. Gereksinimler

- Xcode 14+
- iOS 13+
- CocoaPods

### 2. Podfile

```ruby
platform :ios, '13.0'

target 'DiscordClone' do
  use_frameworks!

  # mediasoup client for iOS
  pod 'Mediasoup-Client', '~> 1.0'

  # Socket.IO for signaling
  pod 'Socket.IO-Client-Swift', '~> 16.0'
end
```

Kurulum:
```bash
cd ios
pod install
```

### 3. Info.plist

Mikrof izni için:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Sesli sohbet için mikrofon erişimi gereklidir</string>
```

### 4. Xcode Capabilities

**Background Modes** aktif edin:
- ✅ Audio, AirPlay, and Picture in Picture

### 5. Kullanım

```swift
import UIKit

class VoiceChannelViewController: UIViewController {
    private var voiceManager: VoiceManager!

    override func viewDidLoad() {
        super.viewDidLoad()

        // Initialize voice manager
        voiceManager = VoiceManager(socketURL: "http://your-server:3000")
    }

    @IBAction func joinButtonTapped(_ sender: UIButton) {
        Task {
            do {
                try await voiceManager.joinChannel(
                    channelId: "channel-id",
                    userId: "user-id"
                )
                print("✅ Joined voice channel")
            } catch {
                print("❌ Error:", error)
            }
        }
    }

    @IBAction func muteButtonTapped(_ sender: UIButton) {
        voiceManager.toggleMute()
    }

    @IBAction func leaveButtonTapped(_ sender: UIButton) {
        voiceManager.leaveChannel()
    }
}
```

### 6. VoiceManager.swift

`mobile/ios/VoiceManager.swift` dosyasını projenize ekleyin.

---

## 📦 Android Kurulum

### 1. Gereksinimler

- Android Studio
- Minimum SDK 21 (Android 5.0)
- Target SDK 34

### 2. build.gradle (Module)

```gradle
dependencies {
    // mediasoup client for Android
    implementation 'io.github.crow-misia.mediasoup:mediasoup-client:3.4.0'

    // Socket.IO for signaling
    implementation 'io.socket:socket.io-client:2.1.0'

    // WebRTC
    implementation 'org.webrtc:google-webrtc:1.0.+'

    // Coroutines
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'

    // Standard Android
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
}
```

### 3. AndroidManifest.xml

```xml
<manifest>
    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

    <application
        android:usesCleartextTraffic="true"> <!-- For local development -->
        ...
    </application>
</manifest>
```

### 4. Runtime Permission Request

```kotlin
class VoiceChannelActivity : AppCompatActivity() {
    companion object {
        private const val PERMISSION_REQUEST_CODE = 100
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Request microphone permission
        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                PERMISSION_REQUEST_CODE
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission granted
                initializeVoiceManager()
            }
        }
    }
}
```

### 5. Kullanım

```kotlin
import kotlinx.coroutines.*

class VoiceChannelActivity : AppCompatActivity() {
    private lateinit var voiceManager: VoiceManager
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private fun initializeVoiceManager() {
        voiceManager = VoiceManager(
            context = this,
            socketUrl = "http://your-server:3000"
        )
    }

    private fun joinChannel() {
        scope.launch {
            try {
                voiceManager.joinChannel(
                    channelId = "channel-id",
                    userId = "user-id"
                )
                println("✅ Joined voice channel")
            } catch (e: Exception) {
                println("❌ Error: ${e.message}")
            }
        }
    }

    private fun toggleMute() {
        voiceManager.toggleMute()
    }

    private fun leaveChannel() {
        voiceManager.leaveChannel()
    }

    override fun onDestroy() {
        super.onDestroy()
        voiceManager.cleanup()
        scope.cancel()
    }
}
```

### 6. VoiceManager.kt

`mobile/android/VoiceManager.kt` dosyasını projenize ekleyin.

---

## 🔧 Özellikler

### Desteklenen

- ✅ Sesli kanal join/leave
- ✅ Gerçek zamanlı ses iletimi (düşük latency)
- ✅ Mute/unmute
- ✅ Otomatik ses yönlendirme (hoparlör/kulaklık/Bluetooth)
- ✅ Echo cancellation, noise suppression
- ✅ Arka plan ses desteği (iOS)
- ✅ Bağlantı kopması durumunda otomatik yeniden bağlanma

### Henüz Desteklenmeyen

- ❌ Konuşma göstergesi (speaking indicator) - Eklenebilir
- ❌ Push-to-talk - Eklenebilir
- ❌ Video streaming - Sadece ses

---

## 🚀 Test

### Web + Mobile Beraber Test

1. **Backend başlat:**
   ```bash
   cd server
   npm install
   npm start
   ```

2. **Web client başlat:**
   ```bash
   cd client
   npm install
   npm run dev
   ```

3. **iOS veya Android app çalıştır**

4. **Aynı kanala join ol:**
   - Web tarayıcıda sesli kanala gir
   - Mobile app'te aynı kanala gir
   - Sesli iletişim başlamalı! 🎉

---

## 🐛 Troubleshooting

### iOS

**Problem:** "Microphone permission denied"
- **Çözüm:** Info.plist'te `NSMicrophoneUsageDescription` eklenmiş mi kontrol et

**Problem:** Ses oynatılmıyor
- **Çözüm:** Background Modes → Audio aktif mi?

**Problem:** "Failed to create transport"
- **Çözüm:** Backend'in çalıştığından ve `ANNOUNCED_IP` doğru ayarlandığından emin ol

### Android

**Problem:** Permission hatası
- **Çözüm:** Runtime permission request doğru yapıldı mı?

**Problem:** "No mediasoup found"
- **Çözüm:** `build.gradle`'da dependency doğru eklendi mi? Sync yap

**Problem:** Bağlantı kurula miyor
- **Çözüm:** `AndroidManifest.xml`'de `usesCleartextTraffic="true"` ekli mi? (Development için)

### Genel

**Problem:** "Cannot consume - incompatible codecs"
- **Çözüm:** Backend ve client'ta Opus codec desteklendiğinden emin ol

**Problem:** Yüksek latency
- **Çözüm:**
  - `ANNOUNCED_IP` sunucunun gerçek public IP'sine ayarlı mı?
  - Firewall UDP portları (40000-49999) açık mı?

---

## 📚 Kaynaklar

- [mediasoup Documentation](https://mediasoup.org/)
- [mediasoup-client-swift](https://github.com/VLprojects/mediasoup-client-swift)
- [mediasoup-client Android](https://github.com/crow-misia/mediasoup-client-android)
- [Socket.IO iOS](https://github.com/socketio/socket.io-client-swift)
- [Socket.IO Android](https://github.com/socketio/socket.io-client-java)

---

## 🎯 Sonraki Adımlar

1. **Konuşma göstergesi ekle** - Voice activity detection
2. **Push-to-talk modu** - Butona basarak konuşma
3. **Kullanıcı ses seviyesi** - Volume indicator
4. **Bağlantı kalitesi göstergesi** - RTT, packet loss
5. **Video desteği** - Screen sharing için

---

## 💡 Notlar

- **Production için:** `ANNOUNCED_IP`'yi sunucunun gerçek public IP'sine değiştir
- **TURN server:** Simetrik NAT arkasındaki kullanıcılar için TURN server gerekebilir
- **Opus codec:** Tüm platformlarda varsayılan olarak desteklenir (48kHz, stereo, FEC)
- **Battery optimization:** Mobile cihazlarda pil tüketimini optimize et

---

Sorular için: [GitHub Issues](https://github.com/your-repo/issues)
