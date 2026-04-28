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

interface LibraryItemPickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  items: Array<{ id: string; name: string }>;
  onCreate: (name: string) => { id: string };
  placeholder?: string;
  emptyText?: string;
  renderItemSuffix?: (item: { id: string; name: string }) => ReactNode;
}

export function LibraryItemPicker({
  value,
  onChange,
  items,
  onCreate,
  placeholder = "Search...",
  emptyText = "No items found.",
  renderItemSuffix,
}: LibraryItemPickerProps) {
  const [inputValue, setInputValue] = useState("");
  const anchorRef = useComboboxAnchor();

  const trimmedInput = inputValue.trim();
  const inputMatchesExisting = items.some(
    (item) => item.name.toLowerCase() === trimmedInput.toLowerCase(),
  );
  const canCreate = trimmedInput.length > 0 && !inputMatchesExisting;

  function handleValueChange(newIds: string[]) {
    if (newIds.includes("__create__")) {
      if (!trimmedInput) {
        onChange(newIds.filter((id) => id !== "__create__"));
        return;
      }
      const created = onCreate(trimmedInput);
      onChange([...newIds.filter((id) => id !== "__create__"), created.id]);
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
            <ComboboxItem value="__create__">
              Create "{trimmedInput}"
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
