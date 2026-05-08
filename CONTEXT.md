# SoundsBored Domain

Pad-based desktop soundboard where users trigger sounds via pads organized into scenes. Supports complex playback rules, mute groups, and web audio import.

## Language

**Sound**
An audio file asset in the global library. Shared across pads and projects.
_Avoid_: audio file, sample, clip, track, asset

**SoundInstance**
A reference to a Sound with usage-specific config (volume, startOffsetMs). Lives inside a Layer under the "assigned" selection type.
_Avoid_: sound reference, sound use, instance

**Layer**
An independent playback unit within a Pad. Has its own selection rules, arrangement, playback mode, and retrigger behavior. All layers in a pad fire simultaneously on trigger.
_Avoid_: track, channel, slot, voice channel

**Pad**
A triggerable button containing one or more Layers. Triggering a pad fires all its layers simultaneously.
_Avoid_: button, sample trigger, sound slot, trigger

**Scene**
A named collection of Pads arranged in a CSS grid. Only one scene is active at a time.
_Avoid_: bank, page, preset, board

**Voice**
A single currently-playing audio source node (AudioBufferSourceNode or HTMLAudioElement). One layer trigger can produce multiple simultaneous voices.
_Avoid_: instance, playback, audio node, sound (for runtime)

**Arrangement**
How multiple sounds in a layer are ordered for playback: simultaneous (all at once), sequential (one after another), or shuffled (random order).

**PlaybackMode**
How a layer behaves over time: one-shot (play once), hold (play while held, stop on release), loop (repeat continuously).

**RetriggerMode**
What happens when a Layer is triggered while already playing: restart, continue, stop, or next.

**LayerSelection**
The rule that determines which sounds a layer draws from: assigned (explicit SoundInstances), tag (sounds matching tags), or set (sounds in a named set).

**MuteGroup**
A named group of pads where only one can play at a time. Triggering any pad in the group stops the others (hi-hat style).
_Avoid_: exclusive group, solo group

**DirectionalMute**
A pad-level list of other pad IDs that are stopped when this pad triggers.
_Avoid_: target mute, linked mute

**GlobalFolder**
A filesystem folder registered in app settings. Sounds within it are auto-discovered into the library on boot.
_Avoid_: watched folder, library folder, sound folder

**BufferCache**
A module-level in-memory Map keyed by Sound.id storing decoded AudioBuffers. One buffer load is shared by all layers/pads referencing the same Sound.
_Avoid_: audio cache, sound cache

**AudioState**
The non-serializable runtime state of the audio engine: active voices, gain nodes, chain queues, progress info. Lives in audioState.ts (not in Zustand).
_Avoid_: playback state (ambiguous with playbackStore)

## Relationships

- A **Sound** is referenced by zero or more **SoundInstances**
- A **SoundInstance** lives inside a **Layer** (assigned selection type only)
- A **Layer** belongs to exactly one **Pad**; all **Layers** in a **Pad** fire simultaneously on trigger
- A **Pad** belongs to exactly one **Scene**
- A **Voice** is the runtime manifestation of a **Layer** playing one **Sound**; multiple **Voices** can exist per **Layer** (simultaneous arrangement)
- A **GlobalFolder** is a source for **Sounds** in the library; a **Sound** stores which folder it came from via `folderId`

## Flagged ambiguities

- "sound" is overloaded — **Sound** means the library asset; **Voice** means the active runtime node. Never use "sound" for a playing instance.
- "playback state" is ambiguous — `playbackStore` (Zustand, reactive UI signals) vs **AudioState** (non-serializable engine Maps). Use the specific term.
- "layer" in UI context sometimes means a visual accordion row; in the domain it always means the playback unit. Prefer the domain meaning.
