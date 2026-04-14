// src/lib/audio/audioEvents.ts
//
// Lightweight error bus that lets the audio engine report playback errors
// without importing UI-layer dependencies (toast, Zustand stores, etc.).
//
// Usage:
//   Audio engine  → emitAudioError(err, { soundName, isMissingFile })
//   UI bootstrap  → setAudioErrorHandler((err, ctx) => { toast.error(...) })

export type AudioErrorContext = {
  /** Human-readable sound name, if available (for display in error messages). */
  soundName?: string;
  /** True when the underlying error is a MissingFileError (file not found on disk). */
  isMissingFile?: boolean;
};

export type AudioErrorHandler = (err: unknown, context: AudioErrorContext) => void;

let _handler: AudioErrorHandler | null = null;

/**
 * Register the UI-layer error handler. Call once at app startup.
 * Only one handler is supported — subsequent calls replace the previous one.
 */
export function setAudioErrorHandler(handler: AudioErrorHandler): void {
  _handler = handler;
}

/**
 * Emit an audio error to the registered handler.
 * No-op if no handler has been registered yet (logs a warning in development so
 * silent drops are diagnosable — normally the handler is set before any audio
 * trigger is possible because `useAudioErrorHandler` mounts with `MainPageInner`).
 */
export function emitAudioError(err: unknown, context: AudioErrorContext = {}): void {
  if (_handler) {
    _handler(err, context);
  } else if (import.meta.env.DEV) {
    console.warn("[audioEvents] emitAudioError called before handler was registered:", err, context);
  }
}
