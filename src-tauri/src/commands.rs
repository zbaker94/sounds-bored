use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct DownloadJobs(pub Arc<Mutex<HashMap<String, CommandChild>>>);

const DOWNLOAD_EVENT: &str = "download://progress";
const EXPORT_EVENT: &str = "export://progress";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub id: String,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl DownloadProgressEvent {
    pub(crate) fn queued(id: &str) -> Self {
        Self {
            id: id.to_string(),
            percent: 0.0,
            speed: None,
            eta: None,
            status: "queued".to_string(),
            output_path: None,
            error: None,
        }
    }

    pub(crate) fn downloading(id: &str, percent: f64, speed: Option<String>, eta: Option<String>, output_path: Option<String>) -> Self {
        Self::in_progress(id, percent, speed, eta, output_path, "downloading")
    }

    pub(crate) fn processing(id: &str, percent: f64, speed: Option<String>, eta: Option<String>, output_path: Option<String>) -> Self {
        Self::in_progress(id, percent, speed, eta, output_path, "processing")
    }

    fn in_progress(id: &str, percent: f64, speed: Option<String>, eta: Option<String>, output_path: Option<String>, status: &str) -> Self {
        Self {
            id: id.to_string(),
            percent,
            speed,
            eta,
            status: status.to_string(),
            output_path,
            error: None,
        }
    }

    pub(crate) fn failed(id: &str, output_path: Option<String>, error: Option<String>) -> Self {
        Self {
            id: id.to_string(),
            percent: 0.0,
            speed: None,
            eta: None,
            status: "failed".to_string(),
            output_path,
            error,
        }
    }

    pub(crate) fn completed(id: &str, output_path: Option<String>) -> Self {
        Self {
            id: id.to_string(),
            percent: 100.0,
            speed: None,
            eta: None,
            status: "completed".to_string(),
            output_path,
            error: None,
        }
    }

    pub(crate) fn cancelled(id: &str) -> Self {
        Self {
            id: id.to_string(),
            percent: 0.0,
            speed: None,
            eta: None,
            status: "cancelled".to_string(),
            output_path: None,
            error: None,
        }
    }
}

/// Parse yt-dlp progress output lines.
/// Matches lines like: "[download]  45.3% of  3.45MiB at  1.23MiB/s ETA 00:02"
fn parse_progress(line: &str) -> Option<(f64, Option<String>, Option<String>)> {
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }

    let percent = line
        .split('%')
        .next()?
        .split_whitespace()
        .last()?
        .parse::<f64>()
        .ok()?;
    if !percent.is_finite() || percent < 0.0 || percent > 100.0 {
        return None;
    }

    let speed = if line.contains(" at ") {
        line.split(" at ")
            .nth(1)
            .and_then(|s| s.split_whitespace().next())
            .filter(|s| *s != "Unknown")
            .map(|s| s.to_string())
    } else {
        None
    };

    let eta = if line.contains("ETA") {
        line.split("ETA")
            .nth(1)
            .and_then(|s| s.split_whitespace().next())
            .filter(|s| *s != "Unknown")
            .map(|s| s.to_string())
    } else {
        None
    };

    Some((percent, speed, eta))
}

/// Returns an error if the path string contains any parent-directory (`..`) traversal
/// segments. Normalizes backslash separators to forward slashes before parsing so the
/// check is consistent regardless of which OS compiles the binary (the app ships on
/// Windows but CI may run on Linux/macOS where `\` is not a separator).
///
/// NOTE: This check rejects literal `..` traversal but does NOT enforce the Tauri
/// `fs:scope` allowlist — absolute paths outside the expected scope are a separate
/// concern tracked in issue #110. The frontend dialog already constrains dest_path to
/// user-chosen directories; Rust-side scope enforcement is deferred until #110
/// introduces a proper scope-expansion mechanism for arbitrary user folders.
fn validate_no_traversal(path: &str, label: &str) -> Result<(), String> {
    // Normalize to forward slashes so Path::components() treats both separators
    // uniformly when compiled on a non-Windows host (e.g., CI).
    let normalized = path.replace('\\', "/");
    for component in std::path::Path::new(&normalized).components() {
        if component == std::path::Component::ParentDir {
            return Err(format!("{} must not contain '..' path segments", label));
        }
    }
    Ok(())
}

/// Returns an error if a bare filename (no directory component) contains path separators,
/// is exactly `.` or `..`, or contains `%` (which yt-dlp interprets as a template
/// placeholder and could redirect output to an unexpected filename).
fn validate_filename(name: &str, label: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err(format!("{} must not be empty", label));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(format!("{} must not contain path separators", label));
    }
    if name == "." || name == ".." {
        return Err(format!("{} must not be '.' or '..'", label));
    }
    if name.contains('%') {
        return Err(format!("{} must not contain '%'", label));
    }
    Ok(())
}

/// The audio extensions the app works with. Used to restrict extra_sound_paths entries
/// to known audio files, preventing arbitrary file exfiltration into export archives.
const ALLOWED_AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a",
];

/// Returns true if `path` has a file extension in `ALLOWED_AUDIO_EXTENSIONS`
/// (case-insensitive). Extracted for testability.
fn is_allowed_audio_extension(path: &str) -> bool {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    ALLOWED_AUDIO_EXTENSIONS.contains(&ext.as_str())
}

/// Parse the final output file path from yt-dlp stdout.
/// Matches lines like:
///   [download] Destination: /path/to/file.webm
///   [ExtractAudio] Destination: /path/to/file.mp3   ← audio extraction
///   [ffmpeg] Destination: /path/to/file.mp3          ← ffmpeg post-processing
fn parse_output_path(line: &str) -> Option<String> {
    for prefix in &["[download]", "[ExtractAudio]", "[ffmpeg]"] {
        if line.contains(prefix) && line.contains("Destination:") {
            return line
                .split("Destination:")
                .nth(1)
                .map(|s| s.trim().trim_matches('"').to_string());
        }
    }
    None
}

#[tauri::command]
pub fn start_download(
    app: AppHandle,
    jobs: State<'_, DownloadJobs>,
    url: String,
    output_name: String,
    download_folder_path: String,
    job_id: String,
) -> Result<(), String> {

    // Defense-in-depth: reject non-http/https schemes before passing to yt-dlp.
    // Trim whitespace and lowercase the scheme portion for case-insensitive matching,
    // then use the trimmed form for all downstream work.
    let url = url.trim().to_string();
    let url_lower = url.to_ascii_lowercase();
    if !url_lower.starts_with("http://") && !url_lower.starts_with("https://") {
        return Err("URL must use http:// or https://".to_string());
    }

    // Validate output_name: must not contain path separators or be a traversal token.
    validate_filename(&output_name, "output_name")?;

    // Validate download_folder_path: must not contain traversal segments.
    validate_no_traversal(&download_folder_path, "download_folder_path")?;

    // Reject '%' in download_folder_path — yt-dlp interprets '%' as a template
    // placeholder directive; a path containing '%' would redirect output to an
    // unexpected location.
    if download_folder_path.contains('%') {
        return Err("download_folder_path must not contain '%'".to_string());
    }

    // Emit initial queued event
    let _ = app.emit(DOWNLOAD_EVENT, DownloadProgressEvent::queued(&job_id));

    // Build output template
    let output_template = format!("{}/{}.%(ext)s", download_folder_path, output_name);

    // Resolve the directory containing our bundled ffmpeg sidecar so yt-dlp
    // can find it without relying on the system PATH.
    let ffmpeg_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or_else(|| "Cannot resolve executable directory".to_string())?
        .to_string_lossy()
        .to_string();

    // Spawn yt-dlp sidecar
    let (mut rx, child) = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            // SEC-2: isolate the sidecar from user/system yt-dlp config files and
            // plugin directories. Without these flags, a hostile config containing
            // `--exec "shell command"` would achieve arbitrary command execution.
            // These MUST appear early, before any URL or output args.
            "--ignore-config",
            "--no-plugins",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-thumbnail",
            "--embed-metadata",
            "--ffmpeg-location", &ffmpeg_dir,
            "--output",
            &output_template,
            "--progress",
            "--newline",
            "--no-playlist",
            &url,
        ])
        .spawn()
        .map_err(|e| e.to_string())?;

    // Store child process for cancellation
    {
        let mut map = jobs.0.lock().map_err(|e| e.to_string())?;
        map.insert(job_id.clone(), child);
    }

    // Spawn async task to monitor output and emit progress events
    let app_clone = app.clone();
    let job_id_for_task = job_id.clone();
    let download_jobs_map = jobs.0.clone();

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        let mut last_output_path: Option<String> = None;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);

                    // Check for output path
                    if let Some(path) = parse_output_path(&line) {
                        last_output_path = Some(path);
                    }

                    // Check for progress
                    if let Some((percent, speed, eta)) = parse_progress(&line) {
                        let event = if percent >= 100.0 {
                            DownloadProgressEvent::processing(&job_id_for_task, percent, speed, eta, last_output_path.clone())
                        } else {
                            DownloadProgressEvent::downloading(&job_id_for_task, percent, speed, eta, last_output_path.clone())
                        };
                        let _ = app_clone.emit(DOWNLOAD_EVENT, event);
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    // yt-dlp writes some info to stderr; only emit as error if it looks like one
                    if line.contains("ERROR") {
                        let _ = app_clone.emit(
                            DOWNLOAD_EVENT,
                            DownloadProgressEvent::failed(&job_id_for_task, None, Some(line.to_string())),
                        );
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let event = if payload.code == Some(0) {
                        DownloadProgressEvent::completed(&job_id_for_task, last_output_path.clone())
                    } else {
                        DownloadProgressEvent::failed(
                            &job_id_for_task,
                            last_output_path.clone(),
                            Some(format!("yt-dlp exited with code {:?}", payload.code)),
                        )
                    };
                    let _ = app_clone.emit(DOWNLOAD_EVENT, event);
                    break;
                }
                _ => {}
            }
        }

        // Clean up: remove the job entry so the map does not grow unbounded.
        // cancel_download may have already removed it (kill + remove); that is safe —
        // HashMap::remove on a missing key is a no-op.
        if let Ok(mut map) = download_jobs_map.lock() {
            map.remove(&job_id_for_task);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_download(
    app: AppHandle,
    jobs: State<'_, DownloadJobs>,
    job_id: String,
) -> Result<(), String> {
    // Remove and kill the child process
    if let Some(child) = jobs.0.lock().map_err(|e| e.to_string())?.remove(&job_id) {
        child.kill().map_err(|e| e.to_string())?;
    }

    // Emit cancelled event
    let _ = app.emit(DOWNLOAD_EVENT, DownloadProgressEvent::cancelled(&job_id));

    Ok(())
}

pub struct ExportJobs(pub Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressEvent {
    pub job_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zip_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ExportProgressEvent {
    pub(crate) fn copying(job_id: &str) -> Self {
        Self {
            job_id: job_id.to_string(),
            status: "copying".to_string(),
            zip_path: None,
            error: None,
        }
    }

    pub(crate) fn zipping(job_id: &str) -> Self {
        Self {
            job_id: job_id.to_string(),
            status: "zipping".to_string(),
            zip_path: None,
            error: None,
        }
    }

    pub(crate) fn cancelled(job_id: &str) -> Self {
        Self {
            job_id: job_id.to_string(),
            status: "cancelled".to_string(),
            zip_path: None,
            error: None,
        }
    }

    pub(crate) fn done(job_id: &str, zip_path: String) -> Self {
        Self {
            job_id: job_id.to_string(),
            status: "done".to_string(),
            zip_path: Some(zip_path),
            error: None,
        }
    }

    pub(crate) fn error(job_id: &str, error: String) -> Self {
        Self {
            job_id: job_id.to_string(),
            status: "error".to_string(),
            zip_path: None,
            error: Some(error),
        }
    }
}

#[tauri::command]
pub fn export_project(
    app: AppHandle,
    export_jobs: State<'_, ExportJobs>,
    source_path: String,
    extra_sound_paths: Vec<String>,
    dest_path: String,
    zip_name: String,
    sound_map_json: String,
    job_id: String,
) -> Result<(), String> {
    // Validate zip_name: must not contain path separators or be a traversal token.
    validate_filename(&zip_name, "zip_name")?;

    // Validate paths for traversal: dest_path, source_path, and each extra_sound_paths
    // entry must not contain '..' components. This prevents a caller from writing the
    // zip outside the intended destination or reading arbitrary files into the archive.
    validate_no_traversal(&dest_path, "dest_path")?;
    validate_no_traversal(&source_path, "source_path")?;

    // SEC-1: Close the TOCTOU window between symlink validation and File::open by
    // pre-opening a File handle immediately after each extra_sound_paths entry
    // passes validation. The handle references the inode, not the path, so an
    // attacker cannot swap the file for a symlink after this point. Carries
    // (basename, File) into the async task below.
    let mut extra_sound_handles: Vec<(String, std::fs::File)> =
        Vec::with_capacity(extra_sound_paths.len());
    for (i, extra) in extra_sound_paths.iter().enumerate() {
        validate_no_traversal(extra, &format!("extra_sound_paths[{}]", i))?;
        // Defense-in-depth: restrict entries to known audio extensions to prevent
        // arbitrary file exfiltration (e.g., credentials, SSH keys) into the archive.
        if !is_allowed_audio_extension(extra) {
            return Err(format!(
                "extra_sound_paths[{}] must be an audio file (.wav, .mp3, .ogg, .flac, .aiff, .m4a)",
                i
            ));
        }
        // Reject symlinks: File::open follows symlinks transparently, so a symlink
        // with an audio extension could still exfiltrate arbitrary file contents.
        let meta = std::fs::symlink_metadata(extra)
            .map_err(|e| format!("extra_sound_paths[{}]: {}", i, e))?;
        if !meta.file_type().is_file() {
            return Err(format!("extra_sound_paths[{}] must be a regular file", i));
        }
        // Open the file immediately — within the same validation step — to pin the
        // inode. Any later path swap (symlink or otherwise) cannot affect this handle.
        // O_NOFOLLOW is not portable to Windows, so rely on the preceding
        // symlink_metadata check plus immediate open to minimize the race window.
        let basename = std::path::Path::new(extra)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| format!("extra_sound_paths[{}] has no file name", i))?;
        let file = std::fs::File::open(extra)
            .map_err(|e| format!("extra_sound_paths[{}]: {}", i, e))?;
        extra_sound_handles.push((basename, file));
    }

    // Insert cancellation flag
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = export_jobs.0.lock().map_err(|e| e.to_string())?;
        map.insert(job_id.clone(), cancel_flag.clone());
    }

    let app_clone = app.clone();
    let job_id_clone = job_id.clone();
    let flag = cancel_flag;
    let export_jobs_map = export_jobs.0.clone();

    tauri::async_runtime::spawn(async move {
        let result: Result<(), String> = (|| {
            // Emit copying status
            let _ = app_clone.emit(EXPORT_EVENT, ExportProgressEvent::copying(&job_id_clone));

            let zip_output_path = format!("{}/{}", dest_path, zip_name);

            // Create zip file
            let file = std::fs::File::create(&zip_output_path).map_err(|e| e.to_string())?;
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);

            // Collect existing sound basenames from source_path/sounds/
            let sounds_dir = format!("{}/sounds", source_path);
            let mut existing_sounds = std::collections::HashSet::new();
            if std::path::Path::new(&sounds_dir).is_dir() {
                if let Ok(entries) = std::fs::read_dir(&sounds_dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.path().file_name() {
                            existing_sounds.insert(name.to_string_lossy().to_string());
                        }
                    }
                }
            }

            // Walk source_path
            let _ = app_clone.emit(EXPORT_EVENT, ExportProgressEvent::zipping(&job_id_clone));

            // SEC-3: WalkDir defaults to follow_links=false for descendants, but
            // if source_path ITSELF is a symlink, walkdir walks the link target.
            // The per-entry is_symlink() check only catches descendants — not the root.
            // Reject symlink roots explicitly to prevent a crafted project folder
            // symlink from exfiltrating the target's contents.
            let source_meta = std::fs::symlink_metadata(&source_path)
                .map_err(|e| e.to_string())?;
            if source_meta.file_type().is_symlink() {
                return Err("Project folder is a symlink — export rejected".to_string());
            }

            for entry in walkdir::WalkDir::new(&source_path) {
                // Check cancellation
                if flag.load(Ordering::SeqCst) {
                    let _ = app_clone.emit(EXPORT_EVENT, ExportProgressEvent::cancelled(&job_id_clone));
                    drop(writer);
                    let _ = std::fs::remove_file(&zip_output_path);
                    return Ok(());
                }

                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();

                // Skip directories and symlinks. walkdir does not follow symlinks by
                // default (follow_links = false), but File::open does — skipping here
                // prevents a crafted project folder from exfiltrating targets of symlinks.
                let ft = entry.file_type();
                if ft.is_dir() || ft.is_symlink() {
                    continue;
                }

                let relative_path = path
                    .strip_prefix(&source_path)
                    .map_err(|e| e.to_string())?;

                // Zip-slip defense: strip_prefix guarantees no leading '..' given a
                // validated source_path, but check explicitly in case of future refactor.
                if relative_path.components().any(|c| {
                    matches!(c, std::path::Component::ParentDir)
                }) {
                    return Err(format!(
                        "refusing to archive entry with '..' component: {:?}",
                        relative_path
                    ));
                }

                let entry_name = relative_path
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join("/");

                let entry_name = entry_name.trim_start_matches('/').to_string();

                writer
                    .start_file(&entry_name, options)
                    .map_err(|e| e.to_string())?;

                let mut source_file = std::fs::File::open(path).map_err(|e| e.to_string())?;
                std::io::copy(&mut source_file, &mut writer).map_err(|e| e.to_string())?;
            }

            // Add extra sounds.
            // SEC-1: use the pre-opened File handles from the validation step instead of
            // re-opening by path. This closes the TOCTOU window where an attacker could
            // replace a validated file with a symlink after symlink_metadata passed but
            // before File::open was called inside this async task.
            for (basename_str, mut f) in extra_sound_handles.into_iter() {
                // Check cancellation
                if flag.load(Ordering::SeqCst) {
                    let _ = app_clone.emit(EXPORT_EVENT, ExportProgressEvent::cancelled(&job_id_clone));
                    drop(writer);
                    let _ = std::fs::remove_file(&zip_output_path);
                    return Ok(());
                }

                if !existing_sounds.contains(&basename_str) {
                    let zip_entry = format!("sounds/{}", basename_str);
                    writer
                        .start_file(&zip_entry, options)
                        .map_err(|e| e.to_string())?;
                    std::io::copy(&mut f, &mut writer).map_err(|e| e.to_string())?;
                    existing_sounds.insert(basename_str);
                }
            }

            // Write sound-map.json
            writer
                .start_file("sound-map.json", options)
                .map_err(|e| e.to_string())?;
            use std::io::Write;
            writer
                .write_all(sound_map_json.as_bytes())
                .map_err(|e| e.to_string())?;

            // Finish zip
            writer.finish().map_err(|e| e.to_string())?;

            // Emit done
            let _ = app_clone.emit(EXPORT_EVENT, ExportProgressEvent::done(&job_id_clone, zip_output_path));

            Ok(())
        })();

        if let Err(err) = result {
            let _ = app_clone.emit(EXPORT_EVENT, ExportProgressEvent::error(&job_id_clone, err));
            // Try to clean up partial zip
            let zip_output_path = format!("{}/{}", dest_path, zip_name);
            let _ = std::fs::remove_file(&zip_output_path);
        }

        // Clean up: remove the job entry so the map does not grow unbounded.
        // cancel_export may have already removed it (set flag + remove); that is safe —
        // HashMap::remove on a missing key is a no-op.
        if let Ok(mut map) = export_jobs_map.lock() {
            map.remove(&job_id_clone);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_export(
    app: AppHandle,
    export_jobs: State<'_, ExportJobs>,
    job_id: String,
) -> Result<(), String> {
    if let Some(flag) = export_jobs.0.lock().map_err(|e| e.to_string())?.remove(&job_id) {
        flag.store(true, Ordering::SeqCst);
    }

    let _ = app.emit(EXPORT_EVENT, ExportProgressEvent::cancelled(&job_id));

    Ok(())
}

/// Validates the `path` argument to `grant_path_access`. Extracted so the
/// guard can be unit-tested without constructing a real `AppHandle`.
fn validate_grant_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("path must not be empty".to_string());
    }
    // Null bytes and ASCII control characters (0x00–0x1F, 0x7F DEL) — never present in
    // legitimate dialog-returned paths. Mirrors isRootPath in src/lib/scope.ts.
    if path.bytes().any(|b| b.is_ascii_control()) {
        return Err("path must not contain null bytes or control characters".to_string());
    }
    // Unicode line/paragraph separators (U+2028, U+2029), BIDI controls
    // (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), and BOM (U+FEFF) —
    // never present in legitimate dialog-returned paths. Mirrors isRootPath in src/lib/scope.ts.
    if path.chars().any(|c| matches!(c,
        '\u{200E}' | '\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2028}' | '\u{2029}'
        | '\u{2066}'..='\u{2069}'
        | '\u{FEFF}'
    )) {
        return Err("path must not contain Unicode separator, BIDI, or BOM characters".to_string());
    }
    if path.split(['/', '\\']).any(|c| c == "..") {
        return Err("path must not contain traversal sequences".to_string());
    }
    // Reject filesystem roots (Unix "/" and Windows drive roots like "C:" or "C:\").
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Err("path must not be a filesystem root".to_string());
    }
    let bytes = trimmed.as_bytes();
    if bytes.len() == 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return Err("path must not be a drive root".to_string());
    }
    // Reject Windows UNC-family paths (\\... or //...).
    let is_unc_prefix = path.starts_with("\\\\") || path.starts_with("//");
    if is_unc_prefix {
        let after = &path[2..];
        let first = after.bytes().next().unwrap_or(0);
        let second = after.bytes().nth(1).unwrap_or(0);
        let is_sep = |b: u8| b == b'\\' || b == b'/';
        if first == b'.' && is_sep(second) {
            // DOS device namespace \\. — block all forms.
            return Err("device namespace paths are not allowed".to_string());
        }
        if first == b'?' && is_sep(second) {
            // Extended-length prefix \\?\ — check inner path.
            let inner = after[2..].trim_end_matches(['/', '\\']);
            if inner.is_empty() {
                return Err("path must not be an extended-length root".to_string());
            }
            let inner_bytes = inner.as_bytes();
            // \\?\C: or \\?\C:\ — extended-length drive root.
            if inner_bytes.len() == 2 && inner_bytes[1] == b':' && inner_bytes[0].is_ascii_alphabetic() {
                return Err("path must not be a drive root".to_string());
            }
            let inner_upper = inner.to_uppercase();
            // \\?\GLOBALROOT — device namespace root (require separator or end for precision).
            if inner_upper == "GLOBALROOT"
                || inner_upper.starts_with("GLOBALROOT\\")
                || inner_upper.starts_with("GLOBALROOT/")
            {
                return Err("device namespace paths are not allowed".to_string());
            }
            // \\?\Volume{GUID} — device volume root, equivalent to a drive root on Windows.
            // Allow subfolders (e.g. \\?\Volume{GUID}\music) but reject the root itself.
            // Use inner (not inner_upper) for the brace search: to_uppercase() may shift byte
            // offsets for non-ASCII chars, but '{' and '}' are ASCII-stable so this is safe.
            if inner_upper.starts_with("VOLUME{") {
                let after = inner
                    .find('}')
                    .map(|i| inner[i + 1..].trim_start_matches(['/', '\\']));
                // after == None means no closing '}' — treat as root-level device path and reject.
                if after.map_or(true, |s| s.is_empty()) {
                    return Err("path must not be a volume root".to_string());
                }
            }
            // \\?\UNC\server\share — extended-length UNC share root.
            if inner_upper.starts_with("UNC\\") || inner_upper.starts_with("UNC/") {
                let unc_rest = inner[4..].trim_end_matches(['/', '\\']);
                let segment_count = unc_rest
                    .split(|c: char| c == '\\' || c == '/')
                    .filter(|s| !s.is_empty())
                    .count();
                if segment_count <= 2 {
                    return Err("path must not be a UNC share root".to_string());
                }
            }
            // Allowlist catch-all: only permit drive-letter subfolders, UNC subfolders,
            // or Volume GUID subfolders under \\?\. Reject everything else (HarddiskVolumeN,
            // PhysicalDriveN, BootPartition, PIPE, MAILSLOT, etc.).
            let is_drive_subfolder = inner_bytes.len() >= 3
                && inner_bytes[0].is_ascii_alphabetic()
                && inner_bytes[1] == b':'
                && (inner_bytes[2] == b'\\' || inner_bytes[2] == b'/');
            // Require non-empty server, non-empty share, and a non-empty subfolder segment
            // under \\?\UNC\. This is self-sufficient (does not rely on the segment_count <= 2
            // early-return above) and mirrors the TS regex: /^UNC[/\\][^/\\]+[/\\][^/\\]+[/\\]/i
            // NOTE: This check intentionally uses positional (non-filtered) segment iteration,
            // unlike the segment_count check above. Empty segments (from doubled separators like
            // \\?\UNC\\server\share) produce an empty `server` or `share` here, so `is_unc_subfolder`
            // is false, and the catch-all below rejects the path. Do NOT change this to filter
            // empty segments — it is load-bearing defense for doubled-separator UNC subfolder paths.
            let is_unc_subfolder = (inner_upper.starts_with("UNC\\") || inner_upper.starts_with("UNC/")) && {
                let rest = &inner[4..]; // skip "UNC\" or "UNC/"
                let mut segs = rest.split(|c: char| c == '\\' || c == '/');
                let server = segs.next().unwrap_or("");
                let share  = segs.next().unwrap_or("");
                let sub    = segs.next().unwrap_or("");
                !server.is_empty() && !share.is_empty() && !sub.is_empty()
            };
            // Require non-empty GUID and a separator immediately after '}', matching the TS regex.
            let is_volume_subfolder = inner_upper.starts_with("VOLUME{")
                && inner.find('}').map_or(false, |i| {
                    i > 7  // at least one char between '{' and '}'
                        && inner.as_bytes().get(i + 1).map_or(false, |&b| b == b'\\' || b == b'/')
                        && !inner[i + 2..].trim_start_matches(['/', '\\']).is_empty()
                });
            if !is_drive_subfolder && !is_unc_subfolder && !is_volume_subfolder {
                return Err("extended-length device namespace paths are not allowed".to_string());
            }
        } else {
            // Regular UNC path \\server\share — reject share roots.
            let rest = after.trim_end_matches(['/', '\\']);
            let segment_count = rest
                .split(|c: char| c == '\\' || c == '/')
                .filter(|s| !s.is_empty())
                .count();
            if segment_count <= 2 {
                return Err("path must not be a UNC share root".to_string());
            }
        }
    }
    // Reject relative paths; only absolute paths produced by native dialogs are valid.
    if !std::path::Path::new(path).is_absolute() {
        return Err("path must be absolute".to_string());
    }
    Ok(())
}

/// Grants runtime fs-scope access to a user-selected path.
/// Called after every dialog that returns a user-chosen folder or file, so that
/// the broad static $DOCUMENT/**, $DOWNLOAD/**, $DESKTOP/** grants can be removed
/// from capabilities/default.json.
#[tauri::command]
pub fn grant_path_access(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    validate_grant_path(&path)?;
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_progress_valid_line() {
        let line = "[download]  45.3% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_progress(line);
        assert!(result.is_some());
        let (percent, speed, eta) = result.unwrap();
        assert!((percent - 45.3).abs() < 0.01);
        assert_eq!(speed, Some("1.23MiB/s".to_string()));
        assert_eq!(eta, Some("00:02".to_string()));
    }

    #[test]
    fn test_parse_progress_100_percent() {
        let line = "[download] 100% of  3.45MiB in 00:02";
        let result = parse_progress(line);
        assert!(result.is_some());
        let (percent, _, _) = result.unwrap();
        assert!((percent - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_progress_unknown_speed_and_eta() {
        let line = "[download]   0.0% of   53.65MiB at  Unknown B/s ETA Unknown";
        let result = parse_progress(line);
        assert!(result.is_some());
        let (percent, speed, eta) = result.unwrap();
        assert!((percent - 0.0).abs() < 0.01);
        assert_eq!(speed, None);
        assert_eq!(eta, None);
    }

    #[test]
    fn test_parse_progress_no_match() {
        let line = "[ffmpeg] Merging formats into something";
        let result = parse_progress(line);
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_progress_negative_percent() {
        let line = "[download]  -5.0% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_progress(line);
        assert!(result.is_none(), "negative percent should return None");
    }

    #[test]
    fn test_parse_progress_over_100_percent() {
        let line = "[download]  150.0% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_progress(line);
        assert!(result.is_none(), "percent > 100 should return None");
    }

    #[test]
    fn test_parse_progress_boundary_zero() {
        let line = "[download]   0.0% of   53.65MiB at  1.00MiB/s ETA 00:53";
        let result = parse_progress(line);
        assert!(result.is_some());
        let (percent, _, _) = result.unwrap();
        assert!((percent - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_progress_nan() {
        let line = "[download]  NaN% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_progress(line);
        assert!(result.is_none(), "NaN percent should return None");
    }

    #[test]
    fn test_parse_progress_infinity() {
        let line = "[download]  inf% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_progress(line);
        assert!(result.is_none(), "infinite percent should return None");
    }

    #[test]
    fn test_parse_progress_boundary_100_exact() {
        let line = "[download] 100.0% of  3.45MiB in 00:02";
        let result = parse_progress(line);
        assert!(result.is_some());
        assert!((result.unwrap().0 - 100.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_progress_just_over_100() {
        let line = "[download] 100.01% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_progress(line);
        assert!(result.is_none(), "percent just over 100 should return None");
    }

    #[test]
    fn test_parse_output_path_download_destination() {
        let line = "[download] Destination: /tmp/my_song.webm";
        let result = parse_output_path(line);
        assert_eq!(result, Some("/tmp/my_song.webm".to_string()));
    }

    #[test]
    fn test_parse_output_path_extract_audio() {
        let line = "[ExtractAudio] Destination: /tmp/my_song.mp3";
        let result = parse_output_path(line);
        assert_eq!(result, Some("/tmp/my_song.mp3".to_string()));
    }

    #[test]
    fn test_parse_output_path_ffmpeg_destination() {
        let line = "[ffmpeg] Destination: \"/tmp/my_song.mp3\"";
        let result = parse_output_path(line);
        assert_eq!(result, Some("/tmp/my_song.mp3".to_string()));
    }

    // --- validate_filename tests ---

    #[test]
    fn test_validate_filename_rejects_slash() {
        assert!(validate_filename("foo/bar.zip", "zip_name").is_err());
    }

    #[test]
    fn test_validate_filename_rejects_backslash() {
        assert!(validate_filename("foo\\bar.zip", "zip_name").is_err());
    }

    #[test]
    fn test_validate_filename_rejects_dotdot_exact() {
        assert!(validate_filename("..", "zip_name").is_err());
    }

    #[test]
    fn test_validate_filename_rejects_dot_exact() {
        assert!(validate_filename(".", "zip_name").is_err());
    }

    #[test]
    fn test_validate_filename_rejects_empty() {
        assert!(validate_filename("", "zip_name").is_err());
    }

    #[test]
    fn test_validate_filename_allows_double_dot_in_name() {
        // "song..remix.zip" is a legitimate filename and must NOT be rejected.
        assert!(validate_filename("song..remix.zip", "zip_name").is_ok());
    }

    #[test]
    fn test_validate_filename_allows_normal_name() {
        assert!(validate_filename("my-project-export.zip", "zip_name").is_ok());
    }

    #[test]
    fn test_validate_filename_rejects_percent() {
        // '%' is a yt-dlp template placeholder character and must be rejected.
        assert!(validate_filename("foo%(title)s.zip", "output_name").is_err());
        assert!(validate_filename("%s", "output_name").is_err());
    }

    // --- is_allowed_audio_extension tests ---

    #[test]
    fn test_is_allowed_audio_extension_mp3_lowercase() {
        assert!(is_allowed_audio_extension("song.mp3"));
    }

    #[test]
    fn test_is_allowed_audio_extension_mp3_uppercase() {
        assert!(is_allowed_audio_extension("Song.MP3"));
    }

    #[test]
    fn test_is_allowed_audio_extension_wav() {
        assert!(is_allowed_audio_extension("kick.wav"));
    }

    #[test]
    fn test_is_allowed_audio_extension_rejects_txt() {
        assert!(!is_allowed_audio_extension("secret.txt"));
    }

    #[test]
    fn test_is_allowed_audio_extension_rejects_no_extension() {
        assert!(!is_allowed_audio_extension("secret"));
    }

    #[test]
    fn test_is_allowed_audio_extension_rejects_double_extension() {
        // "secret.mp3.exe" → extension is "exe", not "mp3"
        assert!(!is_allowed_audio_extension("secret.mp3.exe"));
    }

    #[test]
    fn test_is_allowed_audio_extension_rejects_exe() {
        assert!(!is_allowed_audio_extension("evil.exe"));
    }

    // --- validate_no_traversal tests ---

    #[test]
    fn test_validate_no_traversal_clean_absolute_path() {
        assert!(validate_no_traversal("C:/Users/user/Documents/project", "path").is_ok());
    }

    #[test]
    fn test_validate_no_traversal_clean_relative_path() {
        assert!(validate_no_traversal("sounds/kick.wav", "path").is_ok());
    }

    #[test]
    fn test_validate_no_traversal_dotdot_start() {
        let result = validate_no_traversal("../etc/passwd", "path");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not contain '..'"));
    }

    #[test]
    fn test_validate_no_traversal_dotdot_middle() {
        let result = validate_no_traversal("/home/user/../../etc/passwd", "dest_path");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_no_traversal_dotdot_only() {
        let result = validate_no_traversal("..", "source_path");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_no_traversal_dotdot_in_name_not_flagged() {
        // "foo..bar" is a valid filename component and must NOT be rejected
        assert!(validate_no_traversal("sounds/foo..bar.wav", "path").is_ok());
    }

    #[test]
    fn test_validate_no_traversal_label_in_error() {
        let result = validate_no_traversal("../evil", "extra_sound_paths[0]");
        assert!(result.unwrap_err().contains("extra_sound_paths[0]"));
    }

    #[test]
    fn test_validate_no_traversal_windows_style_path() {
        assert!(validate_no_traversal("C:\\Users\\user\\Documents", "path").is_ok());
    }

    #[test]
    fn test_validate_no_traversal_windows_dotdot() {
        // Backslash separators are normalized to forward slashes before parsing,
        // so ".." traversal is caught on any host OS including Linux/macOS CI.
        let result = validate_no_traversal("C:\\Users\\user\\..\\..\\Windows\\System32", "path");
        assert!(result.is_err(), "backslash-separated '..' must be rejected on all platforms");
    }

    #[test]
    fn test_validate_no_traversal_accepts_absolute_path_by_design() {
        // Absolute-path scope enforcement is deferred to issue #110.
        // validate_no_traversal intentionally only rejects '..' traversal —
        // absolute paths that happen to point outside the expected scope are a
        // separate concern. This test documents that behavior so a future
        // tightening doesn't happen silently.
        assert!(validate_no_traversal("/etc/passwd", "path").is_ok());
        assert!(validate_no_traversal("C:/Windows/System32/config/SAM", "path").is_ok());
    }

    #[test]
    fn test_parse_output_path_no_match() {
        let line = "[download]  45.3% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_output_path(line);
        assert!(result.is_none());
    }

    // ---- ExportJobs lifecycle tests ----

    #[test]
    fn test_cancel_export_removes_entry_and_sets_flag() {
        // Expected: cancel_export removes the entry from the map AND sets the cancel flag.
        // Before the fix, .get() was used so the entry was never removed.
        let jobs = ExportJobs(Arc::new(Mutex::new(HashMap::new())));
        let flag = Arc::new(AtomicBool::new(false));
        jobs.0.lock().unwrap().insert("job-1".to_string(), flag.clone());

        if let Some(f) = jobs.0.lock().unwrap().remove("job-1") {
            f.store(true, Ordering::SeqCst);
        }

        assert!(flag.load(Ordering::SeqCst), "cancel flag must be set");
        assert!(
            jobs.0.lock().unwrap().is_empty(),
            "entry must be removed from map after cancel"
        );
    }

    #[test]
    fn test_cancel_export_noop_on_missing_job() {
        // Expected: cancelling a non-existent job must not panic.
        let jobs = ExportJobs(Arc::new(Mutex::new(HashMap::new())));
        let result = jobs.0.lock().unwrap().remove("nonexistent");
        assert!(result.is_none(), "remove on missing key must return None");
    }

    #[test]
    fn test_export_jobs_entry_removed_after_task_completes() {
        // Expected: after the async export task finishes (success or error),
        // the job entry must be removed so the map does not grow unbounded.
        let jobs = ExportJobs(Arc::new(Mutex::new(HashMap::new())));
        let flag = Arc::new(AtomicBool::new(false));
        jobs.0.lock().unwrap().insert("job-1".to_string(), flag);

        assert_eq!(jobs.0.lock().unwrap().len(), 1);

        // Simulate the async task cleanup added by this fix
        jobs.0.lock().unwrap().remove("job-1");

        assert!(
            jobs.0.lock().unwrap().is_empty(),
            "entry must be removed from map after task completes"
        );
    }

    #[test]
    fn test_export_jobs_remove_does_not_affect_other_entries() {
        // Expected: removing one job leaves all other jobs untouched.
        let jobs = ExportJobs(Arc::new(Mutex::new(HashMap::new())));
        let flag1 = Arc::new(AtomicBool::new(false));
        let flag2 = Arc::new(AtomicBool::new(false));
        {
            let mut map = jobs.0.lock().unwrap();
            map.insert("job-1".to_string(), flag1);
            map.insert("job-2".to_string(), flag2);
        }

        jobs.0.lock().unwrap().remove("job-1");

        let map = jobs.0.lock().unwrap();
        assert!(!map.contains_key("job-1"), "job-1 must be removed");
        assert!(map.contains_key("job-2"), "job-2 must remain");
    }

    // ---- DownloadJobs lifecycle tests ----
    // Note: CommandChild cannot be constructed in unit tests (requires a live Tauri process).
    // The tests below verify the Arc<Mutex<HashMap>> wrapper contract without needing
    // to insert real CommandChild values.

    #[test]
    fn test_download_jobs_starts_empty() {
        // Expected: a freshly constructed DownloadJobs map is empty.
        let jobs = DownloadJobs(Arc::new(Mutex::new(HashMap::new())));
        assert!(jobs.0.lock().unwrap().is_empty());
    }

    #[test]
    fn test_download_jobs_arc_clone_points_to_same_allocation() {
        // Expected: the Arc clone used by the async task points to the exact same
        // Mutex/HashMap allocation as the one held by the DownloadJobs state.
        // This ensures that download_jobs_map.remove() in the async task affects
        // the same map visible to cancel_download and start_download.
        let jobs = DownloadJobs(Arc::new(Mutex::new(HashMap::new())));
        let clone = jobs.0.clone();
        assert!(
            Arc::ptr_eq(&jobs.0, &clone),
            "Arc clone must point to the same underlying allocation"
        );
    }

    #[test]
    fn test_download_jobs_remove_on_missing_id_is_noop() {
        // Expected: removing a job that was already removed (e.g. via cancel_download
        // before Terminated fires) must not panic — it must return None silently.
        let jobs = DownloadJobs(Arc::new(Mutex::new(HashMap::new())));
        let result = jobs.0.lock().unwrap().remove("never-inserted");
        assert!(result.is_none());
    }

    // ---- grant_path_access tests ----
    // Note: the happy path of grant_path_access requires a real AppHandle with the
    // fs plugin initialized, which cannot be constructed in a unit-test context.
    // Those scenarios are covered by integration tests / manual testing. Only the
    // empty-path guard (extracted into validate_grant_path) is unit-tested here.

    #[test]
    fn test_validate_grant_path_rejects_empty() {
        let result = validate_grant_path("");
        assert!(result.is_err(), "empty path must be rejected");
        assert!(result.unwrap_err().contains("must not be empty"));
    }

    #[test]
    fn test_validate_grant_path_accepts_nonempty() {
        #[cfg(windows)]
        {
            assert!(validate_grant_path("C:/Users/user/Documents/project").is_ok());
            assert!(validate_grant_path("D:\\Projects\\music").is_ok());
        }
        #[cfg(not(windows))]
        {
            assert!(validate_grant_path("/home/user/project").is_ok());
            assert!(validate_grant_path("/Users/user/music").is_ok());
        }
    }

    #[test]
    fn test_validate_grant_path_rejects_traversal() {
        assert!(validate_grant_path("/music/../secret").is_err());
        assert!(validate_grant_path("C:\\Users\\..\\Windows").is_err());
        assert!(validate_grant_path("..").is_err());
    }

    #[test]
    fn test_validate_grant_path_rejects_filesystem_roots() {
        assert!(validate_grant_path("/").is_err());
        assert!(validate_grant_path("C:\\").is_err());
        assert!(validate_grant_path("C:/").is_err());
        assert!(validate_grant_path("C:").is_err());
        assert!(validate_grant_path("D:").is_err());
    }

    #[test]
    fn test_validate_grant_path_rejects_relative_paths() {
        assert!(validate_grant_path("sounds").is_err());
        assert!(validate_grant_path("./data").is_err());
        assert!(validate_grant_path("relative/path").is_err());
    }

    #[test]
    fn test_validate_grant_path_rejects_unc_share_roots() {
        // UNC share root — exactly two path components after \\
        assert!(validate_grant_path(r"\\server\share").is_err(), r"\\server\share should be rejected");
        assert!(validate_grant_path(r"\\server\share\").is_err(), r"\\server\share\ should be rejected");
        // Forward-slash UNC share root
        assert!(validate_grant_path("//server/share").is_err(), "//server/share should be rejected");
        assert!(validate_grant_path("//server/share/").is_err(), "//server/share/ should be rejected");
        // Mixed-separator UNC share root
        assert!(validate_grant_path(r"\\server/share").is_err(), r"\\server/share should be rejected");
        // UNC subfolders must be allowed (Windows-only: is_absolute() requires Windows for these paths)
        #[cfg(windows)]
        {
            assert!(validate_grant_path(r"\\server\share\music").is_ok(), r"\\server\share\music should be allowed");
            assert!(validate_grant_path(r"\\server\share\a\b").is_ok(), r"\\server\share\a\b should be allowed");
            assert!(validate_grant_path("//server/share/music").is_ok(), "//server/share/music should be allowed");
        }
    }

    #[test]
    fn test_validate_grant_path_rejects_extended_length_roots() {
        // Extended-length drive roots
        assert!(validate_grant_path(r"\\?\C:\").is_err(), r"\\?\C:\ should be rejected");
        assert!(validate_grant_path(r"\\?\C:").is_err(), r"\\?\C: should be rejected");
        assert!(validate_grant_path(r"\\?\D:\").is_err(), r"\\?\D:\ should be rejected");
        // Forward-slash and mixed-separator extended-length
        assert!(validate_grant_path(r"\\?/C:\").is_err(), r"\\?/C:\ should be rejected");
        assert!(validate_grant_path(r"//?\C:\").is_err(), r"//?\C:\ should be rejected");
        // Bare extended-length prefix with no inner path
        assert!(validate_grant_path(r"\\?\").is_err(), r"\\?\ (bare prefix) should be rejected");
        // Extended-length UNC share root
        assert!(validate_grant_path(r"\\?\UNC\server\share").is_err(), r"\\?\UNC\server\share should be rejected");
        assert!(validate_grant_path(r"\\?\UNC\server\share\").is_err(), r"\\?\UNC\server\share\ should be rejected");
        // Extended-length GLOBALROOT device namespace
        assert!(validate_grant_path(r"\\?\GLOBALROOT\Device\Volume1").is_err(), "GLOBALROOT paths should be rejected");
        // Extended-length subfolders must be allowed (Windows-only)
        #[cfg(windows)]
        {
            assert!(validate_grant_path(r"\\?\C:\music").is_ok(), r"\\?\C:\music should be allowed");
            assert!(validate_grant_path(r"\\?\UNC\server\share\music").is_ok(), r"\\?\UNC\server\share\music should be allowed");
        }
    }

    // Doubled-separator UNC paths — should be rejected (issue #321)
    #[test]
    fn test_doubled_separator_unc_root_rejected() {
        let err = validate_grant_path("\\\\\\\\server\\share").unwrap_err();
        assert!(err.contains("UNC share root"), "expected UNC share root rejection, got: {err}");
        let err = validate_grant_path("\\\\\\\\server\\\\share").unwrap_err();
        assert!(err.contains("UNC share root"), "expected UNC share root rejection, got: {err}");
    }

    #[test]
    fn test_doubled_separator_extended_unc_root_rejected() {
        let err = validate_grant_path("\\\\?\\UNC\\\\server\\share").unwrap_err();
        assert!(err.contains("UNC share root"), "expected UNC share root rejection, got: {err}");
        let err = validate_grant_path("\\\\?\\UNC\\\\server\\\\share").unwrap_err();
        assert!(err.contains("UNC share root"), "expected UNC share root rejection, got: {err}");
    }

    #[test]
    fn test_validate_grant_path_rejects_device_namespace() {
        // DOS device namespace \\.\
        assert!(validate_grant_path(r"\\.\C:\").is_err(), r"\\.\C:\ should be rejected");
        assert!(validate_grant_path(r"\\.\PhysicalDrive0").is_err(), r"\\.\PhysicalDrive0 should be rejected");
        assert!(validate_grant_path("//./C:/").is_err(), "//./C:/ should be rejected");
    }

    #[test]
    fn test_validate_grant_path_rejects_volume_guid_root() {
        // Assert on the specific error message to confirm the Volume-GUID branch fires,
        // not the pre-existing is_absolute() fallback on non-Windows CI.
        let err = validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB}")
            .unwrap_err();
        assert!(err.contains("volume root"), "expected 'volume root' error, got: {err}");

        let err = validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB}\")
            .unwrap_err();
        assert!(err.contains("volume root"), "expected 'volume root' error for trailing slash, got: {err}");

        let err = validate_grant_path(r"\\?\volume{12345678-1234-1234-1234-1234567890AB}")
            .unwrap_err();
        assert!(err.contains("volume root"), "lowercase volume{{GUID}} must be rejected (case-insensitive), got: {err}");

        // Forward-slash and mixed-separator extended-length prefix variants
        let err = validate_grant_path(r"\\?/Volume{12345678-1234-1234-1234-1234567890AB}")
            .unwrap_err();
        assert!(err.contains("volume root"), r"\\?/Volume{{GUID}} (mixed sep) must be volume root error, got: {err}");
        let err = validate_grant_path(r"//?\Volume{12345678-1234-1234-1234-1234567890AB}")
            .unwrap_err();
        assert!(err.contains("volume root"), r"//?\Volume{{GUID}} (forward-slash prefix) must be volume root error, got: {err}");

        // Malformed: no closing brace — treated as a root-level device path
        let err = validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB")
            .unwrap_err();
        assert!(err.contains("volume root"), "unclosed Volume{{GUID}} must be rejected as volume root, got: {err}");

        // Empty GUID between braces — rejected by the early volume-root check (after `}` is empty).
        let err = validate_grant_path(r"\\?\Volume{}").unwrap_err();
        assert!(
            err.contains("volume root") || err.contains("device namespace"),
            r"\\?\Volume{{}} (empty GUID) must be rejected, got: {err}"
        );

        // No separator after closing brace — must be rejected (not a subfolder).
        let err = validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB}suffix")
            .unwrap_err();
        assert!(
            err.contains("device namespace"),
            r"\\?\Volume{{GUID}}suffix (no sep after '}}') must hit allowlist catch-all, got: {err}"
        );
    }

    #[test]
    #[cfg(windows)]
    fn test_validate_grant_path_allows_volume_guid_subfolder() {
        assert!(
            validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB}\music").is_ok(),
            r"\\?\Volume{{GUID}}\music should be allowed"
        );
        assert!(
            validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB}\a\b").is_ok(),
            r"\\?\Volume{{GUID}}\a\b should be allowed"
        );
        // Forward-slash separator after closing brace
        assert!(
            validate_grant_path(r"\\?\Volume{12345678-1234-1234-1234-1234567890AB}/music").is_ok(),
            r"\\?\Volume{{GUID}}/music (forward slash) should be allowed"
        );
    }

    #[test]
    fn test_validate_grant_path_rejects_extended_length_device_namespace_paths() {
        // Multi-component device-namespace paths: PIPE and MAILSLOT pass through all
        // explicit denylist checks and must be caught by the allowlist catch-all.
        // Assert on "device namespace" to confirm the catch-all fires, not the
        // is_absolute() fallback (which gives a different error on non-Windows).
        let pipe_err = validate_grant_path(r"\\?\PIPE\foo").unwrap_err();
        assert!(
            pipe_err.contains("device namespace"),
            r"\\?\PIPE\foo should be rejected with 'device namespace' error, got: {pipe_err}"
        );
        let mailslot_err = validate_grant_path(r"\\?\MAILSLOT\foo").unwrap_err();
        assert!(
            mailslot_err.contains("device namespace"),
            r"\\?\MAILSLOT\foo should be rejected with 'device namespace' error, got: {mailslot_err}"
        );
        // Malformed UNC with empty segments must be rejected (structural check, not just sep count).
        let empty_server_err = validate_grant_path(r"\\?\UNC\\server\share\folder").unwrap_err();
        assert!(
            empty_server_err.contains("device namespace"),
            r"\\?\UNC\\server (empty server) must be rejected with 'device namespace', got: {empty_server_err}"
        );
        let triple_sep_err = validate_grant_path(r"\\?\UNC\\\server\share\folder").unwrap_err();
        assert!(
            triple_sep_err.contains("device namespace"),
            r"\\?\UNC\\\server (triple sep) must be rejected with 'device namespace', got: {triple_sep_err}"
        );
        let empty_share_err = validate_grant_path(r"\\?\UNC\server\\share\folder").unwrap_err();
        assert!(
            empty_share_err.contains("device namespace"),
            r"\\?\UNC\server\\share (empty share) must be rejected with 'device namespace', got: {empty_share_err}"
        );
        // Multi-level device-namespace paths must also be rejected.
        let deep_pipe_err = validate_grant_path(r"\\?\PIPE\a\b\c").unwrap_err();
        assert!(
            deep_pipe_err.contains("device namespace"),
            r"\\?\PIPE\a\b\c should be rejected with 'device namespace' error, got: {deep_pipe_err}"
        );
        // Forward-slash and mixed-separator prefix variants must also be rejected.
        let fwd_pipe_err = validate_grant_path("//?/PIPE/foo").unwrap_err();
        assert!(fwd_pipe_err.contains("device namespace"), "//?/PIPE/foo (forward-slash prefix) should be rejected");
        assert!(validate_grant_path(r"\\?/PIPE/foo").is_err(), r"\\?/PIPE/foo (mixed-sep prefix) should be rejected");
        assert!(validate_grant_path("//?/HarddiskVolume3").is_err(), "//?/HarddiskVolume3 should be rejected");
        // Unknown arbitrary device name (prove allowlist, not extended denylist).
        let unknown_err = validate_grant_path(r"\\?\UnknownDevice\sub").unwrap_err();
        assert!(
            unknown_err.contains("device namespace"),
            r"\\?\UnknownDevice\sub should be rejected with 'device namespace' error, got: {unknown_err}"
        );
        // Single-component device roots must be rejected on all platforms.
        assert!(validate_grant_path(r"\\?\HarddiskVolume3").is_err(), r"\\?\HarddiskVolume3 should be rejected");
        assert!(validate_grant_path(r"\\?\PhysicalDrive0").is_err(), r"\\?\PhysicalDrive0 should be rejected");
        assert!(validate_grant_path(r"\\?\BootPartition").is_err(), r"\\?\BootPartition should be rejected");
        assert!(validate_grant_path(r"\\?\SystemPartition").is_err(), r"\\?\SystemPartition should be rejected");
        // On Windows (where these paths are absolute), confirm the allowlist specifically rejects them.
        #[cfg(windows)]
        {
            let hd_err = validate_grant_path(r"\\?\HarddiskVolume3").unwrap_err();
            assert!(hd_err.contains("device namespace"), r"\\?\HarddiskVolume3 should hit allowlist, got: {hd_err}");
            let pd_err = validate_grant_path(r"\\?\PhysicalDrive0").unwrap_err();
            assert!(pd_err.contains("device namespace"), r"\\?\PhysicalDrive0 should hit allowlist, got: {pd_err}");
        }
        // Drive and UNC subfolders must still be allowed (Windows-only: is_absolute() check).
        #[cfg(windows)]
        {
            assert!(validate_grant_path(r"\\?\C:\music").is_ok(), r"\\?\C:\music should be allowed");
            assert!(validate_grant_path(r"\\?\C:/music").is_ok(), r"\\?\C:/music (forward-slash inner sep) should be allowed");
            assert!(validate_grant_path(r"\\?\UNC\server\share\folder").is_ok(), r"\\?\UNC\server\share\folder should be allowed");
        }
    }

    #[test]
    fn test_validate_grant_path_rejects_null_bytes_and_control_chars() {
        // Helper: assert the control-char guard fires (not a different validation branch).
        let assert_rejected = |path: &str, label: &str| {
            let err = validate_grant_path(path).unwrap_err();
            assert!(
                err.contains("null bytes or control characters"),
                "{label}: expected control-char rejection, got: {err}"
            );
        };

        // NUL byte (0x00) — the primary null-truncation attack vector
        assert_rejected("/music\x00/evil",  "null byte in middle");
        assert_rejected("\x00/music",       "null byte at start");
        assert_rejected("/music\x00",       "null byte at end");

        // C0 control range 0x01–0x1F (sampled boundary + common attack values)
        assert_rejected("/music\x01folder", "SOH \\x01");
        assert_rejected("/music\x09folder", "TAB \\x09");
        assert_rejected("/music\x0afolder", "LF \\x0A");
        assert_rejected("/music\x0bfolder", "VT \\x0B");
        assert_rejected("/music\x0cfolder", "FF \\x0C");
        assert_rejected("/music\x0dfolder", "CR \\x0D");
        assert_rejected("/music\x1bfolder", "ESC \\x1B — terminal-escape injection");
        assert_rejected("/music\x1ffolder", "US \\x1F");

        // DEL (0x7F) — also a non-printable ASCII control character
        assert_rejected("/music\x7ffolder", "DEL \\x7F");

        // Windows-style paths — control-char guard runs before is_absolute(), so these
        // are correctly rejected on all platforms (not just Windows).
        assert_rejected("C:\\music\x00folder",  "null byte in Windows path");
        assert_rejected("C:\\music\x1ffolder",  "\\x1F in Windows path");

        // Path consisting entirely of control characters
        assert_rejected("\x01\x02\x03", "path of only control chars");

        // Boundary: 0x20 (space) is NOT a control character and must not be rejected
        #[cfg(not(windows))]
        {
            assert!(
                validate_grant_path("/Users/user/My Music/folder").is_ok(),
                "path with spaces (0x20) must not be rejected"
            );
        }
        #[cfg(windows)]
        {
            assert!(
                validate_grant_path("C:\\Users\\user\\My Music\\folder").is_ok(),
                "path with spaces (0x20) must not be rejected"
            );
        }
    }

    #[test]
    fn test_validate_grant_path_rejects_unicode_control_and_bidi_chars() {
        // Helper: assert the Unicode separator/BIDI/BOM guard fires.
        // NOTE: Uses Windows-style paths so the guard runs before the is_absolute() check
        // on all platforms (the Unicode check is ordered before is_absolute in validate_grant_path).
        let assert_rejected = |path: &str, label: &str| {
            let err = validate_grant_path(path).unwrap_err();
            assert!(
                err.contains("Unicode separator") || err.contains("BIDI") || err.contains("BOM"),
                "{label}: expected Unicode/BIDI/BOM rejection, got: {err}"
            );
        };

        // U+2028 LINE SEPARATOR — treated as a line terminator in JavaScript
        assert_rejected("C:\\music\u{2028}folder", "U+2028 LINE SEPARATOR");

        // U+2029 PARAGRAPH SEPARATOR — treated as a line terminator in JavaScript
        assert_rejected("C:\\music\u{2029}folder", "U+2029 PARAGRAPH SEPARATOR");

        // U+200E LEFT-TO-RIGHT MARK
        assert_rejected("C:\\music\u{200E}folder", "U+200E LTR MARK");

        // U+200F RIGHT-TO-LEFT MARK
        assert_rejected("C:\\music\u{200F}folder", "U+200F RTL MARK");

        // BIDI formatting range U+202A–U+202E — test lower bound, interior, and upper bound
        assert_rejected("C:\\music\u{202A}folder", "U+202A LRE (lower bound of BIDI range)");
        assert_rejected("C:\\music\u{202C}folder", "U+202C PDF (interior of BIDI range)");
        assert_rejected("C:\\music\u{202E}folder", "U+202E RLO (upper bound / classic BIDI spoof)");

        // BIDI isolate range U+2066–U+2069 — test lower bound and upper bound
        assert_rejected("C:\\music\u{2066}folder", "U+2066 LRI (lower bound of isolate range)");
        assert_rejected("C:\\music\u{2069}folder", "U+2069 PDI (upper bound of isolate range)");

        // U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
        assert_rejected("C:\\music\u{FEFF}folder", "U+FEFF BOM");

        // Unix-style paths: verify the guard covers all 7 categories on non-Windows
        #[cfg(not(windows))]
        for (ch, label) in [
            ('\u{2028}', "U+2028 (Unix)"), ('\u{2029}', "U+2029 (Unix)"),
            ('\u{200E}', "U+200E (Unix)"), ('\u{200F}', "U+200F (Unix)"),
            ('\u{202E}', "U+202E (Unix)"), ('\u{2066}', "U+2066 (Unix)"),
            ('\u{FEFF}', "U+FEFF (Unix)"),
        ] {
            assert_rejected(&format!("/music{ch}folder"), label);
        }

        // Legitimate paths with high Unicode (accented, CJK) must NOT be rejected.
        // Only testable on non-Windows where forward-slash paths are absolute.
        #[cfg(not(windows))]
        {
            assert!(
                validate_grant_path("/music/caf\u{00E9}/sounds").is_ok(),
                "U+00E9 (é) must be allowed"
            );
            assert!(
                validate_grant_path("/music/\u{4E2D}\u{6587}/sounds").is_ok(),
                "CJK characters must be allowed"
            );
        }
        #[cfg(windows)]
        {
            assert!(
                validate_grant_path("C:\\music\\caf\u{00E9}\\sounds").is_ok(),
                "U+00E9 (é) must be allowed on Windows"
            );
        }
    }
}
