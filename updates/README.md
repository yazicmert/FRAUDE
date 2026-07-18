# FRAUDE Topluluk Güncellemeleri

FRAUDE açık kaynaklıdır: uygulamayı indiren herkes kaynak kodu klonlayıp bir
AI ajanı (Claude Code veya uyumlu herhangi bir kodlama ajanı) yardımıyla
geliştirme yapabilir ve katkısını herkese ulaştırabilir.

**Ortak sunucu bu GitHub deposudur.** Ayrı bir sunucu yoktur; katkı kanalı
pull request, güvenlik kapısı ise bakımcı incelemesi + merge'dür.
`updates/registry.json` bu deponun `main` dalında yaşar ve hem
[fraude web sitesindeki Güncellemeler sayfası](https://github.com/yazicmert/FRAUDE)
hem de uygulamanın **Güncellemeler** sekmesi tarafından okunur. Merge
edilmemiş hiçbir kayıt hiçbir yerde görünmez.

## Katkı akışı

1. **Klonla / fork'la**: `git clone https://github.com/yazicmert/FRAUDE.git`
2. **AI ajanıyla geliştir**: değişikliği yap, testleri çalıştır
   (`cargo test` / `npx tsc --noEmit` / `npx vite build`).
3. **Kayıt ekle**: `updates/registry.json` içindeki `updates` dizisinin
   BAŞINA aşağıdaki şemayla bir kayıt ekle (en yeni kayıt en üstte).
4. **PR aç**: kod değişikliği + registry kaydı aynı PR'da olmalı.
5. **Güvenlik incelemesi**: bakımcı kodu ve promptu inceler (aşağıdaki
   kontrol listesi). Merge = onay; kayıt siteden ve uygulamadan görünür olur.

## Kayıt şeması

```jsonc
{
  "id": "YYYY-AA-GG-kisa-slug",        // benzersiz, tarih önekli
  "date": "YYYY-AA-GG",
  "author": "github-kullanici-adi",
  "kind": "fix | feature",
  "area": "app | core | site | server | infra",
  "title":   { "tr": "...", "en": "..." },
  "summary": { "tr": "...", "en": "..." },  // 1-3 cümle, ne ve neden
  "commit": "https://github.com/yazicmert/FRAUDE/commit/<sha>", // veya PR adresi
  "includedIn": null,                   // bu değişikliği içeren ilk uygulama
                                        // sürümü; release çıkana dek null
  "security": { "reviewed": true, "reviewer": "..." }, // merge'de bakımcı doldurur
  "touches": ["dosya/yolu.rs"],         // ana dosyalar (ajan için ipucu)
  "agentPrompt": "...",                 // aşağıdaki kurallara uyan uygulama promptu
  "notes": { "tr": "...", "en": "..." } // elle yapılacak adımlar varsa; yoksa null
}
```

## `agentPrompt` yazım kuralları

Prompt, kullanıcının **kendi yerel sürümüne** uygulanır — birebir diff değil,
niyet taşır; bu yüzden farklı sürümlere uyarlanabilir olmalıdır:

- **Sürüm bağımsız yaz**: satır numarası verme; dosyaları ve fonksiyonları
  rolleriyle anlat ("parse_listing içindeki ticker kontrolü" gibi). Kullanıcının
  kopyasında dosya taşınmış olabilir; "yoksa eşdeğerini bul" varsayımıyla yaz.
- **Niyet + davranış**: neyin, neden değiştiğini ve hedef davranışı anlat;
  mekanik adımları numaralı listeyle ver.
- **Kabul ölçütü ekle**: en sonda "Kabul:" satırıyla hangi test/komutun
  geçmesi gerektiğini belirt.
- **Tehlikeli iş yok**: prompt hiçbir koşulda veri silme, gizli anahtar,
  harici komut indirme/çalıştırma, telemetri ekleme talimatı içeremez.

## Güvenlik inceleme kontrol listesi (bakımcı)

- [ ] Kodda ve prompt'ta gizli anahtar / kimlik bilgisi yok
- [ ] Yeni ağ uç noktaları gerekçeli ve güvenilir (prompt yeni domain
      eklemeye çağırıyorsa şüphelen)
- [ ] Prompt yıkıcı işlem (silme, sistem değişikliği, komut indirme) istemiyor
- [ ] Kod değişikliği ile prompt aynı davranışı anlatıyor (prompt'a gizlenmiş
      fazladan talimat yok)
- [ ] Testler var ve geçiyor; `security-review` çalıştırıldı
- [ ] registry kaydındaki `security.reviewed` alanı merge'den önce işaretlendi

## Güncellemeyi kendi kopyana uygulamak

Uygulamadaki **Güncellemeler** sekmesinden (veya sitedeki Güncellemeler
sayfasından) promptu kopyala, yerel FRAUDE klonunda AI ajanına ver
(örn. Claude Code'da yapıştır). Ajan değişikliği senin sürümüne uyarlar;
bitince prompttaki "Kabul" komutlarıyla doğrula. Resmî release'e girmiş
güncellemeler (`includedIn` dolu) için bunu yapmana gerek yok — uygulamayı
güncellemen yeterli.
