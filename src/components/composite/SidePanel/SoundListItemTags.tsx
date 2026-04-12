import { memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { LockIcon } from "@hugeicons/core-free-icons";
import type { Tag } from "@/lib/schemas";

interface SoundListItemTagsProps {
  soundTagIds: string[];
  allTags: Tag[];
}

export const SoundListItemTags = memo(function SoundListItemTags({
  soundTagIds,
  allTags,
}: SoundListItemTagsProps) {
  const soundTags = useMemo(
    () => allTags.filter((t) => soundTagIds.includes(t.id)),
    [allTags, soundTagIds],
  );
  const systemTags = useMemo(
    () => soundTags.filter((t) => t.isSystem),
    [soundTags],
  );
  const userTags = useMemo(
    () => soundTags.filter((t) => !t.isSystem),
    [soundTags],
  );
  if (soundTagIds.length === 0) return null;
  if (soundTags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {systemTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-0.5 rounded-full bg-white/10 text-white/50 border border-white/20 drop-shadow-[0_2px_0px_rgba(255,255,255,0.05)] px-1.5 py-0 text-[10px] leading-4"
        >
          <HugeiconsIcon icon={LockIcon} size={8} />
          {tag.name}
        </span>
      ))}
      {userTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full bg-primary text-primary-foreground border border-primary-accent drop-shadow-[0_2px_0px_var(--color-primary-accent)] px-1.5 py-0 text-[10px] leading-4"
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
});
