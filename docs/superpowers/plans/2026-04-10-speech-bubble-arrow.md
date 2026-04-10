# Speech Bubble Arrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comic speech bubble-style triangle arrow to `PopoverContent` that points at the source element, used in `PadLiveControlPopover`.

**Architecture:** Two stacked `PopoverPrimitive.Arrow` SVG elements (outer = border color, inner = bg color) render inside `PopoverContent` when `showArrow` is passed. Radix auto-positions the arrow on the correct edge. `PadLiveControlPopover` opts in via the `showArrow` prop with `sideOffset={10}`.

**Tech Stack:** Radix UI (`radix-ui` package — `PopoverPrimitive.Arrow`), Tailwind 4, React 19, TypeScript strict.

---

### Task 1: Add `showArrow` prop to `PopoverContent`

**Files:**
- Modify: `src/components/ui/popover.tsx`

The test file for `PadLiveControlPopover` fully mocks `@/components/ui/popover`, so there are no unit tests to write for this change — it is purely visual. The verification step is a TypeScript compile check + running the existing test suite.

- [ ] **Step 1: Update `PopoverContent` in `src/components/ui/popover.tsx`**

Replace the existing `PopoverContent` function (lines 18–38) with this version that accepts and uses `showArrow`:

```tsx
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  showArrow = false,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  showArrow?: boolean;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/5 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {props.children}
        {showArrow && (
          <>
            <PopoverPrimitive.Arrow width={14} height={8} className="fill-foreground/10" />
            <PopoverPrimitive.Arrow width={12} height={7} className="fill-popover" />
          </>
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
```

Note: `PopoverPrimitive.Content` currently spreads `{...props}` which includes `children`. Since we now render children explicitly before the arrows, remove the implicit spread of children. The `...props` spread still works because React will use the explicit `{props.children}` and the `...props` spread won't double-render children — but to be safe and explicit, destructure `children` out:

```tsx
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  showArrow = false,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  showArrow?: boolean;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-4 rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/5 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showArrow && (
          <>
            <PopoverPrimitive.Arrow width={14} height={8} className="fill-foreground/10" />
            <PopoverPrimitive.Arrow width={12} height={7} className="fill-popover" />
          </>
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (success). If errors appear, fix them before continuing.

- [ ] **Step 3: Run existing tests**

```bash
npm run test:run
```

Expected: all tests pass. The `PadLiveControlPopover` tests mock `@/components/ui/popover` entirely, so they are unaffected by this change.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat: add showArrow prop to PopoverContent"
```

---

### Task 2: Use `showArrow` in `PadLiveControlPopover`

**Files:**
- Modify: `src/components/composite/SceneView/PadLiveControlPopover.tsx:421`

- [ ] **Step 1: Update the desktop `PopoverContent` call**

In `PadLiveControlPopover.tsx`, find the `<PopoverContent>` in the desktop branch (around line 421):

```tsx
// Before
<PopoverContent className="w-72" side="top" sideOffset={8}>
```

Change it to:

```tsx
// After
<PopoverContent className="w-72" side="top" sideOffset={10} showArrow>
```

The `sideOffset` increase from `8` to `10` gives the arrow room to breathe between the panel and the pad button.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (success).

- [ ] **Step 3: Run existing tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/composite/SceneView/PadLiveControlPopover.tsx
git commit -m "feat: add speech bubble arrow to PadLiveControlPopover"
```
