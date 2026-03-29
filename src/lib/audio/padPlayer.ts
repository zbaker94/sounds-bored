import { ensureResumed } from "./audioContext";
import { loadBuffer } from "./bufferCache";
import { useLibraryStore } from "@/state/libraryStore";
import { usePlaybackStore } from "@/state/playbackStore";
import type { Layer, Pad, Sound } from "@/lib/schemas";

function resolveSounds(layer: Layer, sounds: Sound[]): Sound[] {
  const sel = layer.selection;
  switch (sel.type) {
    case "assigned":
      return sel.instances
        .map((inst) => sounds.find((s) => s.id === inst.soundId))
        .filter((s): s is Sound => !!s && !!s.filePath);
    case "tag":
      return sounds.filter((s) => s.tags.includes(sel.tagId) && !!s.filePath);
    case "set":
      return sounds.filter((s) => s.sets.includes(sel.setId) && !!s.filePath);
  }
}

export async function triggerPad(pad: Pad): Promise<void> {
  const { sounds } = useLibraryStore.getState();
  const store = usePlaybackStore.getState();

  for (const layer of pad.layers) {
    const resolved = resolveSounds(layer, sounds);
    if (resolved.length === 0) continue;

    const isActive = store.isPadActive(pad.id);

    // Apply retrigger logic
    switch (layer.retriggerMode) {
      case "stop":
        if (isActive) {
          store.stopPad(pad.id);
          return;
        }
        break;
      case "continue":
        // Start new voices on top of existing — no stop needed
        break;
      case "restart":
      case "next": // Step 2 will implement proper "next" with sequential index
        store.stopPad(pad.id);
        break;
    }

    // Arrangement: simultaneous (Step 2 adds sequential + shuffled)
    const ctx = await ensureResumed();

    for (const sound of resolved) {
      try {
        const buffer = await loadBuffer(sound);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => store.clearVoice(pad.id, source);
        source.start();
        store.recordVoice(pad.id, source);
      } catch (err) {
        console.error(`[padPlayer] Failed to play "${sound.name}":`, err);
      }
    }
  }
}
