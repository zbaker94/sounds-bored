use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct DownloadJobs(pub Mutex<HashMap<String, CommandChild>>);

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

/// Validates that a zip file name does not contain path traversal characters.
fn validate_zip_name(zip_name: &str) -> Result<(), String> {
    if zip_name.contains('/')
        || zip_name.contains('\\')
        || zip_name.contains("..")
    {
        return Err("Invalid zip name".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn zip_folder(source_path: String, dest_path: String, zip_name: String) -> Result<String, String> {
    validate_zip_name(&zip_name)?;

    let source = std::path::Path::new(&source_path);
    let zip_file_path = std::path::Path::new(&dest_path).join(&zip_name);

    let file = std::fs::File::create(&zip_file_path).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();

    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // Skip directories — zip entries are created implicitly
        if path.is_dir() {
            continue;
        }

        let relative_path = path
            .strip_prefix(source)
            .map_err(|e| e.to_string())?;

        // Use forward slashes for zip entry names (cross-platform compatibility)
        let entry_name = relative_path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");

        writer
            .start_file(&entry_name, options)
            .map_err(|e| e.to_string())?;

        let mut source_file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        std::io::copy(&mut source_file, &mut writer).map_err(|e| e.to_string())?;
    }

    writer.finish().map_err(|e| e.to_string())?;

    Ok(zip_file_path.to_string_lossy().to_string())
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

    #[test]
    fn test_zip_name_rejects_forward_slash() {
        let result = validate_zip_name("../evil.zip");
        assert_eq!(result, Err("Invalid zip name".to_string()));
    }

    #[test]
    fn test_zip_name_rejects_backslash() {
        let result = validate_zip_name("sub\\evil.zip");
        assert_eq!(result, Err("Invalid zip name".to_string()));
    }

    #[test]
    fn test_zip_name_rejects_path_separators() {
        let result = validate_zip_name("path/to/file.zip");
        assert_eq!(result, Err("Invalid zip name".to_string()));

        let result = validate_zip_name("path\\to\\file.zip");
        assert_eq!(result, Err("Invalid zip name".to_string()));

        let result = validate_zip_name("..\\escape.zip");
        assert_eq!(result, Err("Invalid zip name".to_string()));
    }

    #[test]
    fn test_zip_name_accepts_valid_name() {
        let result = validate_zip_name("my-project_export.zip");
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_parse_output_path_no_match() {
        let line = "[download]  45.3% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_output_path(line);
        assert!(result.is_none());
    }
}
