# Group: Symlink Vulnerabilities in export_project

## Relationship

Both findings are symlink-based path traversal vulnerabilities in `commands.rs`'s `export_project` command. SEC-1 exploits a TOCTOU race between validation and the async `File::open`, while SEC-3 exploits walkdir's behavior when the root `source_path` itself is a symlink. Both allow an attacker to embed sensitive files into the export zip. They share the same fix surface (the `export_project` Rust function) and should be addressed together.

---

## Findings

---

**[SEC-1] TOCTOU: symlink check on extra_sound_paths happens before async File::open**
`src-tauri/src/commands.rs:459–577`

`export_project` validates each path with `symlink_metadata` + `is_file()` synchronously, but the actual `File::open` happens inside `tauri::async_runtime::spawn` after the zip file is already created. An attacker can replace a validated file with a symlink to a sensitive file (e.g., `~/.ssh/id_rsa`) during this window — `File::open` follows symlinks transparently, embedding the target's contents in the export zip. The inline comment acknowledges this attack vector, but the defense has a race window.

**Fix:** Open each file during validation and keep the `File` handles in a `Vec<File>` to pass into the async task. Alternatively, use `O_NOFOLLOW` / `FILE_FLAG_OPEN_REPARSE_POINT` at open time.

---

**[SEC-3] walkdir follows symlinks for the root `source_path` entry**
`src-tauri/src/commands.rs:507–556`

`WalkDir::new(&source_path)` defaults to `follow_links = false` for *descendants*, but if `source_path` itself is a symlink, walkdir walks the link target. The code checks `entry.file_type().is_symlink()` only for descendant entries — not the root. A crafted project folder whose top-level entry is a symlink to `/etc` or `%SystemRoot%` would archive the entire target tree.

**Fix:** Check `symlink_metadata(&source_path)` before walking and reject the request if the root is a symlink. Optionally also `fs::canonicalize` and verify the canonical path matches the user's selection.

> **Audit note (2026-04-23):** Both findings confirmed valid. SEC-3 root check is absent — `WalkDir::new(&source_path)` at line 507 has no prior `symlink_metadata` check on `source_path` itself. SEC-1 race is present — `symlink_metadata` check on `extra_sound_paths` (lines 459–464) happens before `tauri::async_runtime::spawn`. **Preferred fix for SEC-1:** pre-open `File` handles during validation and pass them into the async task (avoids the TOCTOU window without platform-specific flags). `O_NOFOLLOW` is not supported on Windows.
