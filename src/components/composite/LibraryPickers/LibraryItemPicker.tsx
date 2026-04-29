import { useState, type ReactNode } from "react";
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
  useComboboxAnchor,
} from "@/components/ui/combobox";

// Sentinel value used internally to signal the "create new item" action via the Combobox
// value-change path. Never reaches callers' onChange. Uses the "__" prefix that TagSchema and
// SetSchema both reject at parse time (see schemas.ts `reservedIdPrefix`) as defense-in-depth
// against id collisions. The component also guards at runtime via the items.some() check below.
const CREATE_SENTINEL = "__create__";

interface LibraryItemPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  items: Array<{ id: string; name: string }>;
  onCreate: (name: string) => { id: string };
  placeholder?: string;
  emptyText?: string;
  renderItemSuffix?: (item: { id: string; name: string }) => ReactNode;
  renderExtraChips?: () => ReactNode;
}

export function LibraryItemPicker({
  value,
  onChange,
  items,
  onCreate,
  placeholder = "Search...",
  emptyText = "No items found.",
  renderItemSuffix,
  renderExtraChips,
}: LibraryItemPickerProps) {
  const [inputValue, setInputValue] = useState("");
  const anchorRef = useComboboxAnchor();

  const trimmedInput = inputValue.trim();
  const inputMatchesExisting = items.some(
    (item) => item.name.toLowerCase() === trimmedInput.toLowerCase(),
  );
  const canCreate = trimmedInput.length > 0 && !inputMatchesExisting;

  function handleValueChange(newIds: string[]) {
    if (
      newIds.includes(CREATE_SENTINEL) &&
      !items.some((i) => i.id === CREATE_SENTINEL)
    ) {
      if (!trimmedInput) {
        onChange(newIds.filter((id) => id !== CREATE_SENTINEL));
        return;
      }
      const created = onCreate(trimmedInput);
      onChange([...newIds.filter((id) => id !== CREATE_SENTINEL), created.id]);
      return;
    }
    onChange(newIds);
  }

  return (
    <Combobox
      value={value}
      onValueChange={handleValueChange}
      onInputValueChange={(val) => setInputValue(val)}
      items={items}
      multiple
    >
      <ComboboxChips ref={anchorRef}>
        {value.map((id) => {
          const item = items.find((i) => i.id === id);
          return item ? <ComboboxChip key={id}>{item.name}</ComboboxChip> : null;
        })}
        {renderExtraChips?.()}
        <ComboboxChipsInput placeholder={placeholder} />
      </ComboboxChips>
      <ComboboxContent anchor={anchorRef}>
        <ComboboxList>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxCollection>
            {(item) => (
              <ComboboxItem key={item.id} value={item.id}>
                <span className="flex-1">{item.name}</span>
                {renderItemSuffix?.(item)}
              </ComboboxItem>
            )}
          </ComboboxCollection>
          {canCreate && (
            <ComboboxItem value={CREATE_SENTINEL}>
              Create "{trimmedInput}"
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
