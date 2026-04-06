# Manual Test: yt-dlp audio download

**Feature area:** `src/lib/ytdlp.ts`, `src/lib/audio/streamingCache.ts`, `src/components/composite/DownloadManager/`  
**Risk area:** Any change to the yt-dlp sidecar integration, download queue, or streaming cache

---

## Prerequisites

- Internet connection available.
- A valid media URL (YouTube, SoundCloud, etc. supported by yt-dlp).
- yt-dlp sidecar binary present in the Tauri app bundle.

---

## Test A: Basic download — adds to library on completion

1. Open the Download dialog (toolbar or menu).
2. Paste a valid media URL.
3. Click **Download**.

**Expected:**
- A download item appears in the Download Manager with a progress bar.
- Progress percentage and estimated time update in real time.
- On completion, a success toast appears.
- The downloaded audio file appears in the sound library automatically.
- The file is placed in the configured download folder.

---

## Test B: Stream-while-downloading playback

1. Start a download of a longer audio file (>30 seconds).
2. While the download is in progress (e.g., at 20%), assign the downloading sound to a pad and trigger it.

**Expected:**
- Audio begins playing from the partial download (streaming from the local temp file).
- Playback does not wait for the full download to complete.
- When the download finishes, playback seamlessly transitions to reading the completed file (no audible gap or interruption).

---

## Test C: Cancel an in-progress download

1. Start a download.
2. While in progress, click the **Cancel** button on the download item.

**Expected:**
- Download stops.
- The item shows a "Cancelled" status.
- No partial file is left in the download folder (or it is cleaned up).
- The sound is **not** added to the library.

---

## Test D: Download a URL that is invalid or unsupported

1. Enter a URL that is not a valid media source (e.g., a plain webpage URL).
2. Click Download.

**Expected:**
- An error toast appears with a meaningful message (not a raw yt-dlp error dump).
- The download item shows a failed/error state.
- No file is created. No library entry is added.

---

## Test E: Network interruption during download

1. Start a download.
2. Disconnect from the internet mid-download (disable Wi-Fi or network adapter).

**Expected:**
- The download pauses or fails gracefully.
- An error state is shown on the download item.
- Reconnecting and retrying (if a retry button exists) resumes or restarts the download.
- No orphaned temp files remain after a failed download is dismissed.

---

## Test F: Download respects configured download folder

1. Open Settings and change the **Download Folder** to a custom path.
2. Download a file.

**Expected:**
- The downloaded file is placed in the custom folder, not a hardcoded default.
- The sound's `filePath` in the library is relative to the project folder / resolves correctly.
