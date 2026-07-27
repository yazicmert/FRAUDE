# Fraude — Chrome Eklentisi

İki işi var:

1. **Bildirimler (masaüstü kapalıyken de):** Fraude sunucusundaki (Supabase)
   KAP/SPK/haber bildirimlerinizi Chrome bildirimi olarak alırsınız — AI önem
   sırasına göre. Masaüstü uygulamasının açık olması **gerekmez**.
2. **Araştırma (masaüstü açıkken):** Gezinirken seçtiğiniz metni, URL'yi veya
   görseli Fraude'deki AI ajanlarına araştırma görevi olarak gönderirsiniz. İş
   bitince Chrome bildirimi gelir; sonuç uygulamadaki **Araştırma** modülünde de
   görünür. Bu özellik köprü üzerinden çalışır (127.0.0.1), yani uygulama açık
   olmalıdır.

## Kurulum (geliştirici modu)

1. Chrome'da `chrome://extensions` adresini açın.
2. Sağ üstten **Geliştirici modu**'nu (Developer mode) açın.
3. **Paketlenmemiş öğe yükle** (Load unpacked) → bu `extension/` klasörünü seçin.

## 1) Bildirim beslemesini bağlama

1. Fraude hesabınızda **besleme anahtarını** bulun:
   - Web: **Hesap** sayfası → *Chrome eklentisi bildirimleri* kartı, veya
   - Uygulama: **Bildirimler** modülü → *Chrome eklentisi* kartı.
2. Anahtarı kopyalayın.
3. Eklentinin **Seçenekler** sayfasında **Besleme anahtarı** alanına yapıştırın,
   **Kaydet** deyin ve **Beslemeyi Test Et** ile doğrulayın.

Artık Chrome açıkken (masaüstü uygulaması kapalı olsa bile) yeni bildirimler
Chrome bildirimi olarak gelir; eklenti simgesine tıklayınca son bildirimler
listelenir.

## 2) Araştırma köprüsünü eşleştirme

1. Fraude'yi açın → **Ayarlar → AI Agents → Chrome Eklentisi Köprüsü**.
2. Oradaki **Port** ve **Token** değerlerini kopyalayın.
3. Eklentinin **Seçenekler** sayfasında port ve token'ı yapıştırın, **Kaydet**
   deyin, **Bağlantıyı Test Et** ile doğrulayın.

## Notlar

- Bildirim beslemesi yalnızca `notify-feed` uç noktasına (Supabase) HTTPS ile
  gider; araştırma istekleri yalnızca `127.0.0.1`'e gider. Başka uzak kod yoktur
  (MV3 uyumlu).
- Token'ları hesabınızdan/uygulamadan yenilerseniz eklentideki değerleri de
  güncelleyin.
- Görseller 4 MB ile sınırlıdır.
