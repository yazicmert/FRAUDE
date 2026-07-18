//! Dayanıklı JSON yazımı için küçük yardımcı.

use std::path::Path;

/// JSON'u atomik yazar: önce geçici bir dosyaya yazar, sonra hedefe rename
/// eder. Rename aynı dosya sisteminde atomiktir; böylece yazım sırasında
/// çökme olsa bile hedef dosya ya eski ya yeni tam halidir — asla yarım/bozuk
/// kalmaz. Hand-rolled `fs::write` çağrılarının yerini alır.
pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;

    // Geçici dosya hedefle aynı dizinde olmalı ki rename aynı dosya sisteminde
    // kalsın (atomiklik garantisi). PID ile adlandırma eşzamanlı yazımların
    // birbirinin geçici dosyasını ezmesini önler.
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, json.as_bytes())?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_back_atomically() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("fraude_persist_test_{}.json", std::process::id()));
        let value = vec![("ASELS", 74.2), ("Diğer", 25.8)];
        write_json_atomic(&path, &value).unwrap();

        let read = std::fs::read_to_string(&path).unwrap();
        let parsed: Vec<(String, f64)> = serde_json::from_str(&read).unwrap();
        assert_eq!(parsed[0].0, "ASELS");
        assert!((parsed[0].1 - 74.2).abs() < 1e-9);

        // Geçici dosya artık kalmamalı (rename edilmiş olmalı).
        let tmp = path.with_extension(format!("tmp{}", std::process::id()));
        assert!(!tmp.exists());

        let _ = std::fs::remove_file(&path);
    }
}
