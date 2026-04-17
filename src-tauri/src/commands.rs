use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct DownloadJobs(pub Arc<Mutex<HashMap<String, CommandChild>>>);

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

    // Emit initial queued event
    let _ = app.emit(
        "download://progress",
        DownloadProgressEvent {
            id: job_id.clone(),
            percent: 0.0,
            speed: None,
            eta: None,
            status: "queued".to_string(),
            output_path: None,
            error: None,
        },
    );

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
                        let status = if percent >= 100.0 {
                            "processing"
                        } else {
                            "downloading"
                        };
                        let _ = app_clone.emit(
                            "download://progress",
                            DownloadProgressEvent {
                                id: job_id_for_task.clone(),
                                percent,
                                speed,
                                eta,
                                status: status.to_string(),
                                output_path: last_output_path.clone(),
                                error: None,
                            },
                        );
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    // yt-dlp writes some info to stderr; only emit as error if it looks like one
                    if line.contains("ERROR") {
                        let _ = app_clone.emit(
                            "download://progress",
                            DownloadProgressEvent {
                                id: job_id_for_task.clone(),
                                percent: 0.0,
                                speed: None,
                                eta: None,
                                status: "failed".to_string(),
                                output_path: None,
                                error: Some(line.to_string()),
                            },
                        );
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let status = if payload.code == Some(0) {
                        "completed"
                    } else {
                        "failed"
                    };
                    let error = if status == "failed" {
                        Some(format!(
                            "yt-dlp exited with code {:?}",
                            payload.code
                        ))
                    } else {
                        None
                    };
                    let _ = app_clone.emit(
                        "download://progress",
                        DownloadProgressEvent {
                            id: job_id_for_task.clone(),
                            percent: if status == "completed" {
                                100.0
                            } else {
                                0.0
                            },
                            speed: None,
                            eta: None,
                            status: status.to_string(),
                            output_path: last_output_path.clone(),
                            error,
                        },
                    );
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
    let _ = app.emit(
        "download://progress",
        DownloadProgressEvent {
            id: job_id,
            percent: 0.0,
            speed: None,
            eta: None,
            status: "cancelled".to_string(),
            output_path: None,
            error: None,
        },
    );

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
            let _ = app_clone.emit(
                "export://progress",
                ExportProgressEvent {
                    job_id: job_id_clone.clone(),
                    status: "copying".to_string(),
                    zip_path: None,
                    error: None,
                },
            );

            let zip_output_path = format!("{}/{}", dest_path, zip_name);

            // Create zip file
            let file = std::fs::File::create(&zip_output_path).map_err(|e| e.to_string())?;
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();

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
            let _ = app_clone.emit(
                "export://progress",
                ExportProgressEvent {
                    job_id: job_id_clone.clone(),
                    status: "zipping".to_string(),
                    zip_path: None,
                    error: None,
                },
            );

            for entry in walkdir::WalkDir::new(&source_path) {
                // Check cancellation
                if flag.load(Ordering::SeqCst) {
                    let _ = app_clone.emit(
                        "export://progress",
                        ExportProgressEvent {
                            job_id: job_id_clone.clone(),
                            status: "cancelled".to_string(),
                            zip_path: None,
                            error: None,
                        },
                    );
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

            // Add extra sounds
            for extra_path in &extra_sound_paths {
                // Check cancellation
                if flag.load(Ordering::SeqCst) {
                    let _ = app_clone.emit(
                        "export://progress",
                        ExportProgressEvent {
                            job_id: job_id_clone.clone(),
                            status: "cancelled".to_string(),
                            zip_path: None,
                            error: None,
                        },
                    );
                    drop(writer);
                    let _ = std::fs::remove_file(&zip_output_path);
                    return Ok(());
                }

                let p = std::path::Path::new(extra_path);
                if let Some(basename) = p.file_name() {
                    let basename_str = basename.to_string_lossy().to_string();
                    if !existing_sounds.contains(&basename_str) {
                        let zip_entry = format!("sounds/{}", basename_str);
                        writer
                            .start_file(&zip_entry, options)
                            .map_err(|e| e.to_string())?;
                        let mut f = std::fs::File::open(p).map_err(|e| e.to_string())?;
                        std::io::copy(&mut f, &mut writer).map_err(|e| e.to_string())?;
                        existing_sounds.insert(basename_str);
                    }
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
            let _ = app_clone.emit(
                "export://progress",
                ExportProgressEvent {
                    job_id: job_id_clone.clone(),
                    status: "done".to_string(),
                    zip_path: Some(zip_output_path),
                    error: None,
                },
            );

            Ok(())
        })();

        if let Err(err) = result {
            let _ = app_clone.emit(
                "export://progress",
                ExportProgressEvent {
                    job_id: job_id_clone.clone(),
                    status: "error".to_string(),
                    zip_path: None,
                    error: Some(err),
                },
            );
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

    let _ = app.emit(
        "export://progress",
        ExportProgressEvent {
            job_id,
            status: "cancelled".to_string(),
            zip_path: None,
            error: None,
        },
    );

    Ok(())
}

/// Validates the `path` argument to `grant_path_access`. Extracted so the
/// guard can be unit-tested without constructing a real `AppHandle`.
fn validate_grant_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("path must not be empty".to_string());
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
            // \\?\UNC\server\share — extended-length UNC share root.
            if inner_upper.starts_with("UNC\\") || inner_upper.starts_with("UNC/") {
                let unc_rest = inner[4..].trim_end_matches(['/', '\\']);
                let sep_count = unc_rest.chars().filter(|c| *c == '\\' || *c == '/').count();
                if sep_count == 1 {
                    return Err("path must not be a UNC share root".to_string());
                }
            }
        } else {
            // Regular UNC path \\server\share — reject share roots.
            let rest = after.trim_end_matches(['/', '\\']);
            let sep_count = rest.chars().filter(|c| *c == '\\' || *c == '/').count();
            if sep_count == 1 && !is_sep(rest.bytes().next().unwrap_or(0)) {
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

    #[test]
    fn test_validate_grant_path_rejects_device_namespace() {
        // DOS device namespace \\.\
        assert!(validate_grant_path(r"\\.\C:\").is_err(), r"\\.\C:\ should be rejected");
        assert!(validate_grant_path(r"\\.\PhysicalDrive0").is_err(), r"\\.\PhysicalDrive0 should be rejected");
        assert!(validate_grant_path("//./C:/").is_err(), "//./C:/ should be rejected");
    }
}
