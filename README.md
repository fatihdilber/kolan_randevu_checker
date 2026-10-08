# Kolan randevu takipçisi

Kolan Şişli → Endokrinoloji → Doç. Dr. Ramazan Çakmak için boş randevu slotu açıldığında **e-posta + Telegram** ile uyarı gönderir. Randevuyu otomatik **almaz**; linke tıklayıp sen alırsın.

GitHub Actions üzerinde 15 dakikada bir çalışır (günde ~96 kez). Aynı slot için tekrar tekrar bildirim göndermez; slot kapanıp yeniden açılırsa tekrar haber verir.

> GitHub cron'u yoğun zamanlarda 5–15 dk gecikebilir veya nadiren bir çalışmayı atlayabilir.

## Kurulum

### 1. Gmail uygulama şifresi
Google hesabında 2 adımlı doğrulama açık olmalı → https://myaccount.google.com/apppasswords → yeni şifre oluştur (16 hane).

### 2. Telegram botu
1. Telegram'da **@BotFather** → `/newbot` → token'ı al.
2. Oluşturduğun bota herhangi bir mesaj yaz.
3. Tarayıcıda `https://api.telegram.org/bot<TOKEN>/getUpdates` aç, `"chat":{"id":123456}` değerini not al.

### 3. GitHub
1. **Public** bir repo oluştur (public repoda Actions ücretsiz ve sınırsızdır; şifreler Secrets'ta saklanır, görünmez).
2. Bu klasörü push et.
3. Repo → Settings → Secrets and variables → Actions → şu 5 secret'ı ekle:

| Secret | Değer |
|---|---|
| `SMTP_USER` | Gmail adresin |
| `SMTP_PASS` | 16 haneli uygulama şifresi |
| `MAIL_TO` | Bildirimin geleceği adres |
| `TELEGRAM_BOT_TOKEN` | BotFather token'ı |
| `TELEGRAM_CHAT_ID` | chat id |

4. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
5. Actions sekmesi → "Kolan randevu kontrolü" → **Run workflow** → `test` kutusunu işaretle. Mail ve Telegram mesajı geliyorsa kurulum tamam.

## Yerelde deneme
```
npm install
node src/check.js                     # sadece kontrol, kanal tanımlı değilse loglar
node src/check.js --mock-available    # sahte boş slot ile bildirim yolunu dener
```
Not: yerel çalıştırma `state.json`'u değiştirir; denemeden sonra sıfırla.

## Ayarlar
Hastane/bölüm/doktor ID'leri `src/check.js` başında sabit olarak tanımlıdır.
