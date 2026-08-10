// Şifre yenileme bağlantısının nereye düştüğünden bağımsız olarak yakalanması.
//
// Supabase, e-postadaki bağlantıyı yalnız Redirect URL allowlist'indeki
// adreslere yönlendirir; adres listede değilse jetonu sessizce SITE_URL'e
// (site kökü) bırakır. O durumda /sifre-yenile hiç açılmaz ve kullanıcı yeni
// şifresini belirleyemez. Bu yüzden yolu değil, adresteki jetonu ölçüt alıyoruz.
//
// Ölçüm modül yüklenirken bir kez yapılır: supabase-js jetonu oturuma
// çevirdikten sonra hash'i adresten siler, sonradan bakmak geç kalır.

function detectRecovery(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  // Başarılı takas hash'te gelir (#access_token=…&type=recovery); PKCE
  // yapılandırılırsa sorgu dizesinde olabilir.
  return hash.get('type') === 'recovery' || query.get('type') === 'recovery';
}

export const isRecoveryLink = detectRecovery();
