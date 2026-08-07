//! Dayanıklı JSON yazımı için küçük yardımcı.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// JSON'u atomik yazar: önce geçici bir dosyaya yazar, sonra hedefe rename
/// eder. Rename aynı dosya sisteminde atomiktir; böylece yazım sırasında
/// çökme olsa bile hedef dosya ya eski ya yeni tam halidir — asla yarım/bozuk
/// kalmaz. Hand-rolled `fs::write` çağrılarının yerini alır.
pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;

    // Geçici dosya hedefle aynı dizinde olmalı ki rename aynı dosya sisteminde
    // kalsın (atomiklik garantisi). PID + nanos + atomic counter ile adlandırma
    // aynı süreç içindeki eşzamanlı iş parçacıklarının birbirinin geçici
    // dosyasını ezmesini önler.
    let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let tmp = path.with_extension(format!("tmp_{}_{}_{}", std::process::id(), nanos, seq));

    if let Err(error) = std::fs::write(&tmp, json.as_bytes()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
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

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn concurrent_writes_do_not_collide() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("fraude_concurrent_test_{}.json", std::process::id()));
        let path_arc = std::sync::Arc::new(path);

        let mut handles = Vec::new();
        for i in 0..10 {
            let p = path_arc.clone();
            handles.push(std::thread::spawn(move || {
                let data = vec![("TEST", i as f64)];
                write_json_atomic(&p, &data).unwrap();
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert!(path_arc.exists());
        let _ = std::fs::remove_file(&*path_arc);
    }
}
