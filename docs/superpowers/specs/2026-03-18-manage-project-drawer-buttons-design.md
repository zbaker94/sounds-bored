# Manage Project Drawer — Button Styling Design

**Date:** 2026-03-18
**Status:** Approved
**File:** `src/components/composite/SidePanel/ManageProjectDrawer.tsx`

---

## Overview

Style the "Add Sounds" and "Manage Sounds" buttons inside the existing `ManageProjectDrawer` top-sliding drawer. Buttons should be large, square, icon-only, whitish with a black outline and solid drop shadow, turning yellow on hover, with downward tooltips. Also wire up the `ctrl+m` / `cmd+m` hotkey to open/close the drawer.

---

## Component Architecture

### `DrawerActionButton` (local to `ManageProjectDrawer.tsx`)

A small private component bundling tooltip + button + icon. `onClick` is included in the interface for future use but not called — all instances pass no `onClick` in this implementation.

```typescript
import { IconSvgElement } from "@hugeicons/react"; // confirmed valid named export

interface DrawerActionButtonProps {
  icon: IconSvgElement;
  label: string;
  onClick?: () => void;
}
```

Structure:
```
Tooltip
  TooltipTrigger (asChild)
    Button (variant="outline", className=<see styling>)
      HugeiconsIcon (icon={icon}, size={32})
  TooltipContent (side="bottom")
    {label}
```

No `TooltipProvider` needed inside this component — a global `TooltipProvider` already wraps the app (confirmed by other components like `EditSection.tsx` using `Tooltip` without a local provider).

---

## Button Styling

Applied via `className` on `<Button variant="outline">`:

| Property | Value | Note |
|---|---|---|
| Shape | `aspect-square h-full` | Fills cross-axis height of the flex container |
| Corners | `rounded-2xl` | Large rounded corners |
| Border | `border-2 border-black` | Solid black outline |
| Background | `bg-white` | White default (dark mode out of scope) |
| Drop shadow | `drop-shadow-[0_5px_0px_rgba(0,0,0,1)]` | Matches app-wide shadow pattern |
| Hover bg | `hover:bg-yellow-400!` | `!` overrides CVA `outline` variant's `hover:bg-input/50` |
| Hover text | `hover:text-black!` | `!` overrides CVA `outline` variant's `hover:text-foreground` |
| Icon size | `size={32}` on `HugeiconsIcon` | Large icon |

The flex chain that makes `h-full` work:
- `DrawerContent` → already has base class `flex flex-col` (from `drawer.tsx`) + `h-72` fixed height
- Content `div` → `flex-1 flex-row items-stretch` (gives a definite height, stretches children)
- `Button` → `h-full` fills the stretched cross-axis

---

## Drawer Layout

The `DrawerContent` instance **does not need a className change** — its base classes already include `flex flex-col`, and `h-72` is already set. No modifications.

The content container changes from:
```tsx
<div className="p-4 flex flex-row items-start justify-start gap-4">
```
to:
```tsx
<div className="flex-1 flex flex-row items-stretch gap-4 p-4 overflow-x-auto">
```

The `DrawerHeader` is unchanged — preserve the existing `<h1 className="text-lg font-semibold">Manage Project</h1>` inside it.

---

## Hotkey & Controlled Mode

```typescript
const [isOpen, setIsOpen] = useState(false);
const open = useCallback(() => setIsOpen(true), []);
const close = useCallback(() => setIsOpen(false), []);

// preventDefault stops browser's default ctrl+m behavior (e.g. "Minimize" on some platforms)
useHotkeys("ctrl+m,meta+m", isOpen ? close : open, { preventDefault: true }, [isOpen]);
```

`<Drawer>` becomes controlled:
```tsx
<Drawer direction="top" open={isOpen} onOpenChange={setIsOpen}>
```

`onOpenChange={setIsOpen}` is required so that clicking the overlay or pressing Escape closes the drawer.

**Trigger button:** `<DrawerTrigger>` is removed. The existing trigger button (already inside `ManageProjectDrawer.tsx`) becomes a plain button with `onClick={open}` — preserve its existing styling:

```tsx
<Button
  onClick={open}
  variant="default"
  size="icon"
  className="size-11 md:size-9"
>
  <HugeiconsIcon icon={FolderMusicIcon} />
</Button>
```

---

## Drawer Action Buttons

| Button | Icon | Tooltip text |
|---|---|---|
| Add Sounds | `MusicNote01Icon` from `@hugeicons/core-free-icons` | "Add Sounds" |
| Manage Sounds | `ListMusicIcon` from `@hugeicons/core-free-icons` | "Manage Sounds" |

No `onClick` handlers on either button.

---

## Files Changed

Only `src/components/composite/SidePanel/ManageProjectDrawer.tsx` — full rewrite.

---

## Out of Scope

- Button functionality (future phases)
- Dark mode styling for these buttons
- Changes to `button.tsx`, `drawer.tsx`, or any other shared component
