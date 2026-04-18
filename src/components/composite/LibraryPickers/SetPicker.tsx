import { useLibraryStore } from "@/state/libraryStore";
import { LibraryItemPicker } from "./LibraryItemPicker";

interface SetPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

export function SetPicker({ value, onChange }: SetPickerProps) {
  const sets = useLibraryStore((s) => s.sets);
  const addSet = useLibraryStore((s) => s.addSet);

  return (
    <LibraryItemPicker
      value={value}
      onChange={onChange}
      items={sets}
      onCreate={addSet}
      placeholder="Search or create sets..."
      emptyText="No sets found."
    />
  );
}
