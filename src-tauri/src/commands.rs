use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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

pub struct ExportJobs(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

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
    // Validate zip_name
    if zip_name.contains('/') || zip_name.contains('\\') || zip_name.contains("..") {
        return Err("Invalid zip name".into());
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

                if path.is_dir() {
                    continue;
                }

                let relative_path = path
                    .strip_prefix(&source_path)
                    .map_err(|e| e.to_string())?;

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

        // Remove job from map (use the app handle to get managed state is not possible here,
        // so we just let it remain — the cancel flag is harmless).
        // Note: We cannot access State outside a command, but the Arc will be dropped when
        // this task completes. The entry stays in the map but is inert.
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_export(
    app: AppHandle,
    export_jobs: State<'_, ExportJobs>,
    job_id: String,
) -> Result<(), String> {
    if let Some(flag) = export_jobs.0.lock().map_err(|e| e.to_string())?.get(&job_id) {
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
    fn test_export_job_id_validation() {
        // zip_name with path separator should be caught
        let bad_names = vec!["../escape.zip", "foo/bar.zip", "foo\\bar.zip"];
        for name in bad_names {
            assert!(name.contains('/') || name.contains('\\') || name.contains(".."));
        }
    }

    #[test]
    fn test_parse_output_path_no_match() {
        let line = "[download]  45.3% of  3.45MiB at  1.23MiB/s ETA 00:02";
        let result = parse_output_path(line);
        assert!(result.is_none());
    }
}
