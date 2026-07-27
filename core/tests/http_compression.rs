//! Paylaşılan HTTP istemcisinin sıkıştırma müzakere ettiğini kanıtlar.
//!
//! Sağlayıcıya gitmek yerine yerel bir dinleyici kullanılır: isteğin kendisi
//! okunup `Accept-Encoding` başlığı doğrulanır ve gzip'lenmiş bir gövde geri
//! verilip saydam çözümün çalıştığı görülür. Böylece test ağa bağımlı değildir
//! ve CI'da da koşar.
//!
//! Neden başlığa bakılıyor: Yahoo HTTP/2 üzerinden `Content-Length` göndermiyor,
//! reqwest de çözdükten sonra `Content-Encoding`'i düşürüyor — yanıt tarafında
//! "sıkıştırıldı mı" sorusunun gözlenebilir bir izi kalmıyor. Tek kesin kanıt
//! isteğin kendisi.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

/// Sıkıştırma denetleyen tek seferlik HTTP sunucusu.
/// Döndürdüğü: (adres, isteğin `Accept-Encoding` değerini taşıyan kanal).
fn spawn_probe(body: Vec<u8>, gzipped: bool) -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("yerel port");
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("bağlantı");
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut accept_encoding = String::new();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("accept-encoding:") {
                accept_encoding = value.trim().to_string();
            }
        }
        let _ = sender.send(accept_encoding);

        let encoding = if gzipped { "Content-Encoding: gzip\r\n" } else { "" };
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{encoding}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(&body);
        let _ = stream.flush();
    });

    (address, receiver)
}

/// `{"ok":true}` gövdesinin gzip'lenmiş hali (sabit; kodlayıcı bağımlılığı yok).
const GZIPPED_OK: &[u8] = &[
    0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff, 0xab, 0x56, 0xca, 0xcf, 0x56, 0xb2,
    0x2a, 0x29, 0x2a, 0x4d, 0xad, 0x05, 0x00, 0x90, 0x5f, 0xd4, 0xa7, 0x0b, 0x00, 0x00, 0x00,
];

#[tokio::test]
async fn shared_client_requests_compression() {
    let (address, requested) = spawn_probe(GZIPPED_OK.to_vec(), true);

    let body = fraude_core::http_client()
        .get(&address)
        .send()
        .await
        .expect("istek")
        .text()
        .await
        .expect("gövde");

    let accept_encoding = requested.recv().expect("istek başlığı");
    assert!(
        accept_encoding.contains("gzip"),
        "paylaşılan istemci Accept-Encoding: gzip göndermeli, gönderdiği: {accept_encoding:?}"
    );
    // Saydam çözüm: gövde gzip baytları değil, düz JSON olarak gelmeli.
    assert_eq!(body, r#"{"ok":true}"#);
}

/// Sıkıştırma kapalı bir istemci karşılaştırma ölçütü: aynı yolun sıkıştırma
/// istemediğini görmek, üstteki testin gerçekten bir şey ölçtüğünü doğrular.
#[tokio::test]
async fn client_without_compression_does_not_ask_for_it() {
    let (address, requested) = spawn_probe(br#"{"ok":true}"#.to_vec(), false);

    let plain = reqwest::Client::builder().no_gzip().no_deflate().build().unwrap();
    let _ = plain.get(&address).send().await.expect("istek").text().await;

    let accept_encoding = requested.recv().expect("istek başlığı");
    assert!(
        !accept_encoding.contains("gzip"),
        "sıkıştırmasız istemci gzip istememeli: {accept_encoding:?}"
    );
}
