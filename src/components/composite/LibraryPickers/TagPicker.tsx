import { useMemo, type ReactNode } from "react";
import { useLibraryStore } from "@/state/libraryStore";
import { LibraryItemPicker } from "./LibraryItemPicker";

interface TagPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  renderItemSuffix?: (item: { id: string; name: string }) => ReactNode;
}

export function TagPicker({ value, onChange, renderItemSuffix }: TagPickerProps) {
  const tags = useLibraryStore((s) => s.tags);
  const ensureTagExists = useLibraryStore((s) => s.ensureTagExists);
  const userTags = useMemo(() => tags.filter((t) => !t.isSystem), [tags]);

  return (
    <LibraryItemPicker
      value={value}
      onChange={onChange}
      items={userTags}
      onCreate={ensureTagExists}
      placeholder="Search or create tags..."
      emptyText="No tags found."
      renderItemSuffix={renderItemSuffix}
    />
  );
}
