import { memo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePadDisplayStore } from "@/state/padDisplayStore";
import { usePlaybackStore } from "@/state/playbackStore";

interface Props {
  padId: string;
}

export const PadCoverArt = memo(function PadCoverArt({ padId }: Props) {
  const currentVoice = usePadDisplayStore((s) => s.currentVoice[padId] ?? null);
  const isPlaying = usePlaybackStore((s) => s.playingPadIds.has(padId));

  const lastUrlRef = useRef<string | undefined>(undefined);
  const lastSeqRef = useRef<number | undefined>(undefined);
  // Tracks whether the most recently started voice had cover art. Updated only
  // when a new voice sequence starts — not when the metadata display clears.
  const hasArtRef = useRef<boolean>(false);

  const url = currentVoice?.coverArtDataUrl;
  const seq = currentVoice?.seq;

  // When a new voice sequence starts, snapshot its art state. This ref persists
  // across the metadata auto-advance (currentVoice → null after ~2500ms) so the
  // blurred background stays visible for the full audio duration.
  if (seq !== undefined && seq !== lastSeqRef.current) {
    lastSeqRef.current = seq;
    hasArtRef.current = !!url;
    if (url) lastUrlRef.current = url;
  }

  const displayUrl = lastUrlRef.current;
  const displaySeq = lastSeqRef.current;

  // Stay visible as long as the pad is playing audio AND the current voice had
  // cover art. Fades out when the pad stops or a new voice with no art starts.
  const shouldShow = isPlaying && hasArtRef.current && !!displayUrl;

  return (
    <AnimatePresence>
      {displayUrl && shouldShow && (
        <motion.div
          key={displaySeq}
          className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div
            data-testid="pad-cover-art-bg"
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${displayUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(10px) brightness(0.55)",
              transform: "scale(1.15)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
});
