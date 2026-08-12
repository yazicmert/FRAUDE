//! Cihaz kimliği: lisans hangi MAKİNEYE bağlı?
//!
//! Eskiden kimlik webview'in localStorage'ında üretilen rastgele bir UUID'ydi.
//! Sorun: her webview deposunun kendi UUID'si olur — geliştirme derlemesi
//! (`~/Library/WebKit/tauri-app`) ile kurulu paket (`com.fraude.terminal`)
//! ayrı depolar kullandığı için AYNI bilgisayar iki cihaz sayılıyor ve
//! max_devices kotasını boşa harcıyordu. Depo silinince de cihaz "yeni"
//! görünüyordu.
//!
//! Buradaki kimlik işletim sisteminin makine kimliğinden türetilir; aynı
//! bilgisayardaki her kurulum aynı değeri verir, farklı bilgisayar farklı.
//!
//! Ham donanım kimliği DIŞARI ÇIKMAZ: SHA-256 ile özetlenir. Sunucuda duran
//! değer makineyi tanımaya yetmeyen opak bir dizedir; amaç "aynı makine mi"
//! sorusunu yanıtlamak, donanımı kaydetmek değil.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::process::Command;

#[derive(Serialize)]
pub struct DeviceIdentity {
    /// Makineden türetilmiş kararlı kimlik (SHA-256 hex). Türetilemezse None:
    /// istemci o zaman eski rastgele UUID davranışını sürdürür.
    pub id: Option<String>,
    /// Cihaz listesinde görünecek ad — "MacIntel" değil, gerçek bilgisayar adı.
    pub name: Option<String>,
}

/// Komutu çalıştırır, çıktısını kırpar; boşsa None döner.
fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Ham makine kimliği (işletim sistemine göre değişir).
fn raw_machine_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        // IOPlatformUUID mantık kartına bağlıdır; kullanıcı hesabından ve
        // uygulama kurulumundan bağımsız olarak sabittir.
        let dump = run("ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"])?;
        let line = dump.lines().find(|l| l.contains("IOPlatformUUID"))?;
        let value = line.split('=').nth(1)?.trim().trim_matches('"').to_string();
        (!value.is_empty()).then_some(value)
    }
    #[cfg(target_os = "windows")]
    {
        // MachineGuid kurulum sırasında üretilir ve yeniden kurulana dek sabittir.
        let dump = run(
            "reg",
            &[
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ],
        )?;
        let line = dump.lines().find(|l| l.contains("MachineGuid"))?;
        let value = line.split_whitespace().last()?.to_string();
        (!value.is_empty()).then_some(value)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(text) = std::fs::read_to_string(path) {
                let value = text.trim().to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
        None
    }
}

/// `system_profiler` çıktısından "Alan: değer" satırını okur.
#[cfg(target_os = "macos")]
fn profiler_field(dump: &str, field: &str) -> Option<String> {
    dump.lines()
        .find(|line| line.trim_start().starts_with(field))
        .and_then(|line| line.split_once(':'))
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Cihaz listesinde görünecek etiket: MODEL + yonga/mimari.
///
/// Amaç kullanıcının satıra bakıp hangi makinesi olduğunu anlaması —
/// "MacBook Pro · Apple M4 Pro", "XPS 15 9520 · Windows x64" gibi. Eskiden
/// `navigator.platform` yazılıyordu; o değer tarayıcılarda donduruldu ve her
/// Mac'te "MacIntel", her Windows'ta "Win32" görünüyordu.
///
/// Hız önemlidir, bu çağrı lisans denetimini bekletir: `system_profiler`
/// yalnız donanım bölümüyle çağrılır (ölçüldü: ~0,3 sn). Başarısız olursa
/// `sysctl` değerlerine düşülür, o da yoksa etiket boş kalır ve istemci
/// eski davranışını sürdürür.
fn device_label() -> Option<String> {
    let (model, hardware) = {
        #[cfg(target_os = "macos")]
        {
            let dump = run("system_profiler", &["SPHardwareDataType"]).unwrap_or_default();
            // "MacBook Pro" — kullanıcının tanıdığı ad. Bulunamazsa model
            // kodu ("Mac16,8") hiç yoktan iyidir.
            let model = profiler_field(&dump, "Model Name")
                .or_else(|| run("sysctl", &["-n", "hw.model"]));
            // "Apple M4 Pro" / Intel'de uzun ticari ad.
            let chip = profiler_field(&dump, "Chip")
                .or_else(|| run("sysctl", &["-n", "machdep.cpu.brand_string"]))
                .map(|cpu| {
                    // Intel'in ticari adı listeyi taşırır; ilk parçalara indirilir.
                    if cpu.starts_with("Apple") {
                        cpu
                    } else {
                        cpu.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
                    }
                });
            (model, chip)
        }
        #[cfg(target_os = "windows")]
        {
            // Üretici model adı ("XPS 15 9520"); BIOS kaydından okunur.
            let model = run(
                "reg",
                &[
                    "query",
                    r"HKLM\HARDWARE\DESCRIPTION\System\BIOS",
                    "/v",
                    "SystemProductName",
                ],
            )
            .and_then(|dump| {
                let line = dump.lines().find(|l| l.contains("SystemProductName"))?;
                let value = line.split("REG_SZ").nth(1)?.trim().to_string();
                (!value.is_empty()).then_some(value)
            });
            let arch = match std::env::var("PROCESSOR_ARCHITECTURE").as_deref() {
                Ok("AMD64") => "x64",
                Ok("ARM64") => "arm64",
                Ok("x86") => "x86",
                _ => "",
            };
            (
                model,
                (!arch.is_empty()).then(|| format!("Windows {arch}")),
            )
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let model = std::fs::read_to_string("/sys/devices/virtual/dmi/id/product_name")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            (
                model,
                run("uname", &["-m"]).map(|arch| format!("Linux {arch}")),
            )
        }
    };

    let label = match (model, hardware) {
        (Some(model), Some(hardware)) if !model.contains(&hardware) => {
            format!("{model} · {hardware}")
        }
        (Some(value), _) | (None, Some(value)) => value,
        (None, None) => return None,
    };
    // Aşırı uzun adlar listeyi bozmasın.
    Some(label.chars().take(60).collect())
}

/// Makine kimliği + bilgisayar adı. Kimlik türetilemezse `id: None` döner ve
/// istemci eski davranışa (rastgele UUID) düşer — lisans akışı durmaz.
#[tauri::command]
pub fn device_identity() -> DeviceIdentity {
    let id = raw_machine_id().map(|raw| {
        let mut hasher = Sha256::new();
        // Alan ayracı: aynı ham değerin başka bir bağlamda üretilen özetiyle
        // karışmasın (uygulamaya özgü tuz).
        hasher.update(b"fraude-device-v1:");
        hasher.update(raw.as_bytes());
        format!("{:x}", hasher.finalize())
    });
    DeviceIdentity {
        id,
        name: device_label(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Aynı makinede iki çağrı aynı kimliği vermeli — kararlılık sözleşmesi
    /// bozulursa lisans her açılışta yeni cihaz sanır ve kotayı tüketir.
    #[test]
    fn identity_is_stable_across_calls() {
        let first = device_identity();
        let second = device_identity();
        assert_eq!(first.id, second.id);
    }

    /// Kimlik üretildiyse ham donanım değeri DEĞİL, 64 haneli özet olmalı.
    #[test]
    fn identity_is_hashed() {
        if let Some(id) = device_identity().id {
            assert_eq!(id.len(), 64, "SHA-256 hex bekleniyor");
            assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
