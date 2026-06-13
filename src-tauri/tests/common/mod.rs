//! Shared test helpers for integration tests.
//!
//! Provides a minimal fake LLM server that simulates OpenAI-compatible
//! `/v1/chat/completions` responses for testing the translation pipeline.
//!
//! Usage:
//! ```ignore
//! let _server = FakeLlmServer::start(FakeLlmConfig { port: 21460, .. });
//! // Wait for server readiness, then run pipeline with base_url http://127.0.0.1:21460
//! ```

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[derive(Clone)]
pub struct FakeLlmConfig {
    pub port: u16,
    pub delay_ms: u64,
    pub malformed: bool,
    pub rate_limit: bool,
    pub partial_failure: bool,
    pub placeholder_broken: bool,
}

impl Default for FakeLlmConfig {
    fn default() -> Self {
        Self {
            port: 11451,
            delay_ms: 10,
            malformed: false,
            rate_limit: false,
            partial_failure: false,
            placeholder_broken: false,
        }
    }
}

pub struct FakeLlmServer {
    shutdown: Arc<AtomicBool>,
}

fn handle_client(mut stream: TcpStream, config: &FakeLlmConfig) {
    if config.rate_limit {
        let resp = "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if config.delay_ms > 0 {
        thread::sleep(Duration::from_millis(config.delay_ms));
    }

    // Read the full request with retries
    let mut buf = [0u8; 8192];
    let mut n = 0usize;
    for _ in 0..100 {
        match stream.read(&mut buf[n..]) {
            Ok(0) if n == 0 => {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
            Ok(0) => break,
            Ok(len) => {
                n += len;
                if len < 4096 {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(_) => break,
        }
    }

    if n == 0 {
        let fallback = r#"{"choices":[{"message":{"content":"{\"translations\":[]}"}}]}"#;
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            fallback.len(),
            fallback
        );
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    let request_str = String::from_utf8_lossy(&buf[..n]);
    let mut keys: Vec<String> = Vec::new();
    for line in request_str.lines() {
        if let Some(pos) = line.find(r#""key":""#) {
            let after = &line[pos + 7..];
            if let Some(end) = after.find('"') {
                keys.push(after[..end].to_string());
            }
        }
    }
    keys.dedup();

    let items: Vec<String> = if config.malformed {
        vec![]
    } else if config.partial_failure {
        let half = keys.len().max(1) / 2;
        keys.iter()
            .take(half.max(1))
            .map(|k| {
                format!(
                    "{{\"key\": \"{}\", \"text\": \"[FAKE] partial: {}\"}}",
                    k, k
                )
            })
            .collect()
    } else {
        keys.iter()
            .map(|k| {
                if config.placeholder_broken {
                    format!("{{\"key\": \"{}\", \"text\": \"模拟翻译\"}}", k)
                } else {
                    format!(
                        "{{\"key\": \"{}\", \"text\": \"[FAKE] translate: {}\"}}",
                        k, k
                    )
                }
            })
            .collect()
    };

    let inner_json = if config.malformed {
        r#"{"invalid":"bad"}"#.to_string()
    } else {
        format!("{{\"translations\": [{}]}}", items.join(","))
    };

    // Build response using serde_json for proper escaping
    let payload = serde_json::json!({
        "choices": [{
            "message": { "content": inner_json }
        }]
    });
    let body = serde_json::to_string(&payload).unwrap_or_default();

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

impl FakeLlmServer {
    pub fn start(config: FakeLlmConfig) -> Self {
        let shutdown = Arc::new(AtomicBool::new(false));
        let s = Arc::clone(&shutdown);
        let cfg = Arc::new(config);

        thread::spawn(move || {
            let addr = format!("127.0.0.1:{}", cfg.port);
            let listener = match TcpListener::bind(&addr) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Fake LLM bind error: {e}");
                    return;
                }
            };
            listener.set_nonblocking(true).ok();

            for stream in listener.incoming() {
                if s.load(Ordering::Relaxed) {
                    break;
                }
                match stream {
                    Ok(stream) => {
                        let cfg = Arc::clone(&cfg);
                        thread::spawn(move || handle_client(stream, &cfg));
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });

        Self { shutdown }
    }

    pub fn wait_ready(&self, port: u16) {
        for _ in 0..50 {
            if TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    pub fn stop(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

impl Drop for FakeLlmServer {
    fn drop(&mut self) {
        self.stop();
    }
}
