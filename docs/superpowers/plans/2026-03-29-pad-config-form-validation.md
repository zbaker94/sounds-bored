# Pad Config Form Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block pad config form submission when no sounds are assigned/selected, and display inline error messages for each selection type.

**Architecture:** Tighten `LayerSelectionSchema` in `schemas.ts` to reject empty sound selections, then surface those errors in `LayerConfigSection` using the same `text-sm text-destructive` pattern already used for `errors.name`. Uses react-hook-form `mode: "onSubmit"` (default) — errors only appear after a submit attempt.

**Tech Stack:** React Hook Form v7 + Zod 4 + zodResolver, Vitest + Testing Library

---

### Task 1: Write failing tests for selection validation errors

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx`

These three tests will fail until Tasks 2 and 3 are done. Writing them first gives us a concrete target.

- [ ] **Step 1: Add three new tests to LayerConfigSection.test.tsx**

Add these inside the existing `describe("LayerConfigSection", ...)` block, after the existing tests:

```tsx
it("shows error when assigned with no sounds selected and form is submitted", async () => {
  useLibraryStore.setState({
    sounds: [{ id: "s1", name: "Kick", tags: [], sets: [], missing: false }],
    tags: [],
    sets: [],
    isDirty: false,
  });
  render(<Wrapper />);

  await userEvent.click(screen.getByRole("button", { name: /submit/i }));

  expect(await screen.findByText(/at least one sound is required/i)).toBeInTheDocument();
});

it("shows error when tag type has no tag selected and form is submitted", async () => {
  useLibraryStore.setState({
    sounds: [],
    tags: [{ id: "t1", name: "Percussion", color: "#ffffff" }],
    sets: [],
    isDirty: false,
  });
  render(<Wrapper />);

  await userEvent.click(screen.getByRole("tab", { name: /tag/i }));
  await userEvent.click(screen.getByRole("button", { name: /submit/i }));

  expect(await screen.findByText(/a tag must be selected/i)).toBeInTheDocument();
});

it("shows error when set type has no set selected and form is submitted", async () => {
  useLibraryStore.setState({
    sounds: [],
    tags: [],
    sets: [{ id: "s1", name: "My Drums" }],
    isDirty: false,
  });
  render(<Wrapper />);

  await userEvent.click(screen.getByRole("tab", { name: /set/i }));
  await userEvent.click(screen.getByRole("button", { name: /submit/i }));

  expect(await screen.findByText(/a set must be selected/i)).toBeInTheDocument();
});
```

Also update the `Wrapper` component at the top of the file to add a submit button (the form already has `handleSubmit` but needs something to trigger it in tests):

```tsx
function Wrapper({ onSubmit = () => {} }: { onSubmit?: (data: PadConfigForm) => void }) {
  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues,
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        <LayerConfigSection />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npm run test:run -- LayerConfigSection
```

Expected: the three new tests fail. Existing tests still pass. If existing tests fail, investigate before continuing.

---

### Task 2: Tighten LayerSelectionSchema

**Files:**
- Modify: `src/lib/schemas.ts:79-94`

- [ ] **Step 1: Update the three discriminated union variants in LayerSelectionSchema**

Find this block (lines ~79-94):

```ts
export const LayerSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema),
  }),
  z.object({
    type: z.literal("tag"),
    tagId: z.string(),
    defaultVolume: z.number(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string(),
    defaultVolume: z.number(),
  }),
]);
```

Replace it with:

```ts
export const LayerSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    instances: z.array(SoundInstanceSchema).min(1, "At least one sound is required"),
  }),
  z.object({
    type: z.literal("tag"),
    tagId: z.string().min(1, "A tag must be selected"),
    defaultVolume: z.number(),
  }),
  z.object({
    type: z.literal("set"),
    setId: z.string().min(1, "A set must be selected"),
    defaultVolume: z.number(),
  }),
]);
```

- [ ] **Step 2: Run the test suite to check the schema change alone**

```bash
npm run test:run -- LayerConfigSection
```

Expected: the three new validation tests still fail (no error UI yet), but no regression in existing tests. If existing tests break, the schema change affected something unexpected — investigate before continuing.

---

### Task 3: Display selection errors in LayerConfigSection

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/LayerConfigSection.tsx`

- [ ] **Step 1: Add error display to LayerConfigSection**

Update the top of `LayerConfigSection` to pull `errors` from the form context:

```tsx
export function LayerConfigSection() {
  const { control, watch, setValue, formState: { errors } } = useFormContext<PadConfigForm>();
  const selectionType = watch("layer.selection.type");

  // Cast needed: TypeScript can't narrow discriminated union error shapes
  const selectionErrors = errors.layer?.selection as Record<string, { message?: string }> | undefined;

  function handleSelectionTypeChange(type: LayerSelection["type"]) {
    setValue("layer.selection", SELECTION_TYPE_DEFAULTS[type], { shouldValidate: true });
  }
  // ... rest unchanged
```

Then, after the `<Controller>` block for `layer.selection` (just after `<SoundSelector ... />`), add the error display. Find the closing `</div>` of the Sound Selection section and insert before it:

```tsx
{selectionType === "assigned" && selectionErrors?.instances?.message && (
  <p className="text-sm text-destructive">{selectionErrors.instances.message}</p>
)}
{selectionType === "tag" && selectionErrors?.tagId?.message && (
  <p className="text-sm text-destructive">{selectionErrors.tagId.message}</p>
)}
{selectionType === "set" && selectionErrors?.setId?.message && (
  <p className="text-sm text-destructive">{selectionErrors.setId.message}</p>
)}
```

The full Sound Selection section after the change:

```tsx
{/* Selection Type */}
<div className="flex flex-col gap-2">
  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
    Sound Selection
  </Label>
  <Tabs value={selectionType} onValueChange={(v) => handleSelectionTypeChange(v as LayerSelection["type"])}>
    <TabsList className="w-full">
      <TabsTrigger value="assigned" className="flex-1">Assigned</TabsTrigger>
      <TabsTrigger value="tag" className="flex-1">Tag</TabsTrigger>
      <TabsTrigger value="set" className="flex-1">Set</TabsTrigger>
    </TabsList>
  </Tabs>

  <Controller
    control={control}
    name="layer.selection"
    render={({ field }) => (
      <SoundSelector value={field.value} onChange={field.onChange} />
    )}
  />

  {selectionType === "assigned" && selectionErrors?.instances?.message && (
    <p className="text-sm text-destructive">{selectionErrors.instances.message}</p>
  )}
  {selectionType === "tag" && selectionErrors?.tagId?.message && (
    <p className="text-sm text-destructive">{selectionErrors.tagId.message}</p>
  )}
  {selectionType === "set" && selectionErrors?.setId?.message && (
    <p className="text-sm text-destructive">{selectionErrors.setId.message}</p>
  )}
</div>
```

- [ ] **Step 2: Run the LayerConfigSection tests**

```bash
npm run test:run -- LayerConfigSection
```

Expected: all tests pass, including the three new ones.

> **If the "assigned" error test fails:** The zod array `.min()` error may surface at `selectionErrors?.instances?.root?.message` instead of `selectionErrors?.instances?.message` in some RHF versions. If so, update the condition:
> ```tsx
> {selectionType === "assigned" && (selectionErrors?.instances?.message ?? selectionErrors?.instances?.root?.message) && (
>   <p className="text-sm text-destructive">
>     {selectionErrors.instances.message ?? selectionErrors.instances.root?.message}
>   </p>
> )}
> ```

- [ ] **Step 3: Commit**

```bash
git add src/lib/schemas.ts src/components/composite/PadConfigDrawer/LayerConfigSection.tsx src/components/composite/PadConfigDrawer/LayerConfigSection.test.tsx
git commit -m "feat: require sound selection in pad config form"
```

---

### Task 4: Fix the existing PadConfigDrawer submit test

**Files:**
- Modify: `src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx`

The existing test `"calls addPad with form data and closes overlay on valid submit"` submits the form with just a name — no sound selected. With the new schema this now fails validation and the pad is never added.

- [ ] **Step 1: Run PadConfigDrawer tests to confirm the break**

```bash
npm run test:run -- PadConfigDrawer
```

Expected: "calls addPad with form data and closes overlay on valid submit" fails. All other tests pass.

- [ ] **Step 2: Update the test to include a sound selection**

Add `createMockSound` to the imports at the top:

```tsx
import { createMockHistoryEntry, createMockProject, createMockScene, createMockSound } from "@/test/factories";
```

Replace the `"calls addPad with form data and closes overlay on valid submit"` test:

```tsx
it("calls addPad with form data and closes overlay on valid submit", async () => {
  const sound = createMockSound({ id: "sound-1", name: "Kick" });
  useLibraryStore.setState({ sounds: [sound], tags: [], sets: [], isDirty: false });

  renderDrawer("scene-1");
  openDrawer();

  await userEvent.type(screen.getByLabelText(/pad name/i), "Kick");

  // Select the sound in the assigned selector
  const checkbox = await screen.findByRole("checkbox", { name: /kick/i });
  await userEvent.click(checkbox);

  await userEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() => {
    const pads = useProjectStore.getState().project?.scenes[0].pads;
    expect(pads).toHaveLength(1);
    expect(pads![0].name).toBe("Kick");
  });

  expect(useUiStore.getState().isOverlayOpen(OVERLAY_ID.PAD_CONFIG_DRAWER)).toBe(false);
});
```

- [ ] **Step 3: Run all PadConfigDrawer tests**

```bash
npm run test:run -- PadConfigDrawer
```

Expected: all tests pass.

- [ ] **Step 4: Run the full test suite**

```bash
npm run test:run
```

Expected: all tests pass with no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/components/composite/PadConfigDrawer/PadConfigDrawer.test.tsx
git commit -m "test: update pad config submit test to include required sound selection"
```
