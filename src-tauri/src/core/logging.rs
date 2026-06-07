use std::{
    fmt::Write as _,
    fs,
    io,
    path::Path,
    sync::{Once, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use tracing::{error, info};
use tracing_subscriber::{
    fmt::{self, format::Writer, FormatEvent, FormatFields},
    layer::SubscriberExt,
    EnvFilter, Registry,
};

pub mod redact;
use redact::redact_secret;

/// Log formatter: `[unix_seconds] LEVEL message` — compatible with frontend parser.
struct LogFormatter;

impl<S, N> FormatEvent<S, N> for LogFormatter
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &fmt::FmtContext<'_, S, N>,
        writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let level = event.metadata().level();

        let mut buf = String::new();
        write!(&mut buf, "[{secs}] {level} ").ok();

        let buf_writer = Writer::new(&mut buf);
        ctx.format_fields(buf_writer, event)?;
        writeln!(&mut buf)?;

        let mut writer = writer;
        writer.write_str(&buf)
    }
}

/// Once guard to prevent multiple subscriber initialization.
static LOG_INIT: Once = Once::new();

/// Holds the `WorkerGuard` so the non-blocking writer thread lives until
/// process exit. Stored in a `OnceLock` so it is properly dropped (and
/// the background buffer flushed) on normal shutdown, unlike `mem::forget`
/// which would leak the guard and lose tail entries on crash.
static _LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

/// Initialize the tracing-based logging system.
///
/// Creates `<root>/logs/` directory,
/// then sets up a global tracing subscriber with non-blocking file I/O.
///
/// The `WorkerGuard` is held in a `OnceLock` so it is dropped (and the
/// remaining buffer flushed) during normal process shutdown.
pub fn init(root: &Path) -> io::Result<()> {
    let logs_dir = root.join("logs");
    fs::create_dir_all(&logs_dir)?;

    LOG_INIT.call_once(|| {
        let file_appender = tracing_appender::rolling::never(&logs_dir, "main.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

        let subscriber = Registry::default()
            .with(EnvFilter::new("info"))
            .with(
                fmt::Layer::new()
                    .event_format(LogFormatter)
                    .with_writer(non_blocking)
                    .with_ansi(false),
            );

        let _ = tracing::subscriber::set_global_default(subscriber);
        // Store guard for proper drop-on-exit; if somehow initialized twice
        // (which LOG_INIT prevents), the second attempt is silently ignored.
        let _ = _LOG_GUARD.set(guard);
    });

    // Always write startup line regardless of which init won the race
    append_main("程序启动 (tracing)").ok();
    Ok(())
}

/// Log an INFO message to the main log.
pub fn append_main(message: impl AsRef<str>) -> io::Result<()> {
    let msg = redact_secret(message.as_ref());
    info!("{msg}");
    Ok(())
}

/// Log an INFO message tagged with a job_id (visible as structured field).
pub fn append_job(job_id: &str, message: impl AsRef<str>) -> io::Result<()> {
    let msg = redact_secret(message.as_ref());
    info!(job_id = %job_id, "{msg}");
    Ok(())
}

/// Log an ERROR message tagged with a job_id.
pub fn append_error(job_id: &str, message: impl AsRef<str>) -> io::Result<()> {
    let msg = redact_secret(message.as_ref());
    error!(job_id = %job_id, "{msg}");
    Ok(())
}

/// Generate a unique job ID with the given prefix and current millisecond timestamp.
pub fn new_job_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    format!("{prefix}_{millis}")
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
