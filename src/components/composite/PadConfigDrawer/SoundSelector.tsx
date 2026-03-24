import { useLibraryStore } from "@/state/libraryStore";
import type { LayerSelection, SoundInstance } from "@/lib/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface SoundSelectorProps {
  value: LayerSelection;
  onChange: (value: LayerSelection) => void;
}

export function SoundSelector({ value, onChange }: SoundSelectorProps) {
  const sounds = useLibraryStore((s) => s.sounds);
  const tags = useLibraryStore((s) => s.tags);
  const sets = useLibraryStore((s) => s.sets);

  if (value.type === "assigned") {
    const selectedIds = new Set(value.instances.map((i) => i.soundId));

    function toggleSound(soundId: string) {
      if (value.type !== "assigned") return;
      if (selectedIds.has(soundId)) {
        onChange({
          type: "assigned",
          instances: value.instances.filter((i) => i.soundId !== soundId),
        });
      } else {
        const newInstance: SoundInstance = {
          id: crypto.randomUUID(),
          soundId,
          volume: 100,
        };
        onChange({
          type: "assigned",
          instances: [...value.instances, newInstance],
        });
      }
    }

    if (sounds.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          No sounds in library yet.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {sounds.map((sound) => (
          <label
            key={sound.id}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <input
              type="checkbox"
              checked={selectedIds.has(sound.id)}
              onChange={() => toggleSound(sound.id)}
              className="accent-primary"
            />
            {sound.name}
          </label>
        ))}
      </div>
    );
  }

  if (value.type === "tag") {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Select tag</Label>
        <Select
          value={value.tagId}
          onValueChange={(tagId) =>
            onChange({ type: "tag", tagId, defaultVolume: value.defaultVolume })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a tag..." />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // value.type === "set"
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">Select set</Label>
      <Select
        value={value.setId}
        onValueChange={(setId) =>
          onChange({ type: "set", setId, defaultVolume: value.defaultVolume })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose a set..." />
        </SelectTrigger>
        <SelectContent>
          {sets.map((set) => (
            <SelectItem key={set.id} value={set.id}>
              {set.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
