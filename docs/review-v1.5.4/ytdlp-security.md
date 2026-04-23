# Group: yt-dlp Invocation Security Issues

## Relationship

Both findings are security vulnerabilities in how the yt-dlp sidecar is invoked in `commands.rs`. SEC-2 allows arbitrary shell command execution via a hostile user config file (`--exec`), and SEC-4 allows format-string injection via an unsanitized `download_folder_path`. Both are fixed by hardening the args array passed to the yt-dlp sidecar at the same call site.

---

## Findings

---

**[SEC-2] yt-dlp sidecar inherits user config — potential RCE via hostile config file**
`src-tauri/src/commands.rs:260–273`

yt-dlp is invoked without `--ignore-config`, so it reads user config from `%APPDATA%/yt-dlp/config` (Windows) or `~/.config/yt-dlp/config`. yt-dlp supports `--exec "shell command"`, which executes after every download. A config file containing `--exec "powershell -e ..."` would execute arbitrary commands the first time a user triggers a download. An attacker with prior write access to the profile config dir (a weaker precondition than full user compromise) achieves code execution.

**Fix:** Add `--ignore-config` (and `--no-plugins`) to the `start_download` args array.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| SEC-4 | Security | `commands.rs:244` | `download_folder_path` interpolated into yt-dlp template without `%` rejection |

> **Audit note (2026-04-23):** Both findings confirmed valid. `commands.rs:260–273` shows the yt-dlp args array with no `--ignore-config` or `--no-plugins`. Line 244 shows `format!("{}/{}.%(ext)s", download_folder_path, output_name)` with no `%` rejection. Fixes are straightforward: add the two flags to the args array, and add a pre-flight check rejecting paths containing `%`.
