# Group: Download Active-Status Centralization

## Relationship

Both findings are about the same gap: `ACTIVE_STATUSES` was introduced to centralize the "is this job active?" check, but it was not applied consistently. REUSE-1 is the most direct miss — `loadDownloadHistory` in `downloads.ts` still uses an inline triple-OR that ACTIVE_STATUSES was specifically created to replace. REUSE-9 is the same pattern at the component level: `DownloadStatusButton` and `DownloadManager` each independently filter active jobs instead of using a shared `selectActiveJobs` selector. Both are fixed by fully committing to the centralized constant/selector.

---

## Findings

---

**[REUSE-1] `ACTIVE_STATUSES` constant not applied in `loadDownloadHistory`**
`src/lib/downloads.ts:24`

`loadDownloadHistory` uses an inline triple-OR (`job.status === "queued" || job.status === "downloading" || job.status === "processing"`) even though `ACTIVE_STATUSES` was introduced in this PR specifically to centralize this check. `DownloadItem`, `DownloadManager`, and `DownloadStatusButton` were migrated; this site was missed.

**Fix:** Import `ACTIVE_STATUSES` from `downloadStore` and replace the inline check with `ACTIVE_STATUSES.has(job.status)`.

---

| # | Dim | Location | Title |
|---|-----|----------|-------|
| REUSE-9 | Reuse | `DownloadStatusButton.tsx:15–25`, `DownloadManager.tsx:11–14` | Both components independently filter active jobs — extract `selectActiveJobs` selector to `downloadStore.ts` |

> **Audit note (2026-04-23):** REUSE-1 confirmed valid — `downloads.ts:24` still uses the inline triple-OR. Fix as proposed. REUSE-9 confirmed valid pending review of the two component files, but the pattern is consistent with the finding.
