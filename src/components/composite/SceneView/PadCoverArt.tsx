import { memo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePadDisplayStore } from "@/state/padDisplayStore";

interface Props {
  padId: string;
}

export const PadCoverArt = memo(function PadCoverArt({ padId }: Props) {
  const currentVoice = usePadDisplayStore((s) => s.currentVoice[padId] ?? null);

  const lastUrlRef = useRef<string | undefined>(undefined);
  const lastSeqRef = useRef<number | undefined>(undefined);

  const url = currentVoice?.coverArtDataUrl;
  const seq = currentVoice?.seq;
  // Preserve last known URL and seq for AnimatePresence exit animation content.
  if (url) lastUrlRef.current = url;
  if (seq !== undefined) lastSeqRef.current = seq;

  const displayUrl = lastUrlRef.current;
  const displaySeq = lastSeqRef.current;

  // Show only when the active voice explicitly has cover art. When the voice
  // clears or transitions to one without art, shouldShow → false and AnimatePresence
  // fades out the element using the preserved displayUrl.
  const shouldShow = currentVoice != null && !!currentVoice.coverArtDataUrl;

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
