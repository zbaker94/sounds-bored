import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PadConfigSchema } from "@/lib/schemas";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { LayerConfigSection } from "./LayerConfigSection";
import type { PadConfigForm } from "@/lib/schemas";

const defaultValues: PadConfigForm = {
  name: "",
  layers: [
    {
      id: "layer-1",
      selection: { type: "assigned", instances: [] },
      arrangement: "simultaneous",
      cycleMode: false,
      playbackMode: "one-shot",
      retriggerMode: "restart",
      volume: 100,
    },
  ],
};

function Wrapper({
  index = 0,
  onSubmit = () => {},
  values,
}: {
  index?: number;
  onSubmit?: (data: PadConfigForm) => void;
  values?: PadConfigForm;
}) {
  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema) as Resolver<PadConfigForm>,
    defaultValues: values ?? defaultValues,
  });
  return (
    <TooltipProvider>
      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(onSubmit)}>
          <LayerConfigSection index={index} />
          <button type="submit">Submit</button>
        </form>
      </FormProvider>
    </TooltipProvider>
  );
}

function makeValues(overrides: Partial<PadConfigForm["layers"][0]>): PadConfigForm {
  return {
    name: "",
    layers: [{ ...defaultValues.layers[0], ...overrides }],
  };
}

describe("LayerConfigSection", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
  });

  async function hoverInfoButtonAndAssert(index: number, expectedText: string | RegExp) {
    const infoButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.tabIndex === -1 && btn.getAttribute("data-slot") === "tooltip-trigger",
    );
    await userEvent.hover(infoButtons[index]);
    const matches = await screen.findAllByText(expectedText);
    expect(matches.length).toBeGreaterThan(0);
  }

  async function hoverTabTooltipAndAssert(tabName: RegExp, expectedText: string | RegExp) {
    const tab = screen.getByRole("tab", { name: tabName });
    await userEvent.hover(within(tab).getByText(tabName));
    const matches = await screen.findAllByText(expectedText);
    expect(matches.length).toBeGreaterThan(0);
  }

  function renderWithLayer(overrides: Partial<PadConfigForm["layers"][0]>) {
    render(<Wrapper values={makeValues(overrides)} />);
  }

  function expectTextInDocument(text: string | RegExp) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }

  it("renders the selection type toggle with all three options", () => {
    render(<Wrapper />);
    expect(screen.getByRole("tab", { name: /assigned/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tag/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /set/i })).toBeInTheDocument();
  });

  it("renders the arrangement control", () => {
    render(<Wrapper />);
    expect(screen.getByText(/arrangement/i)).toBeInTheDocument();
  });

  it("renders the playback mode control", () => {
    render(<Wrapper />);
    expect(screen.getByText(/playback/i)).toBeInTheDocument();
  });

  it("renders the retrigger mode control", () => {
    render(<Wrapper />);
    expect(screen.getByText("Retrigger Mode")).toBeInTheDocument();
  });

  it("renders the volume slider", () => {
    render(<Wrapper />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("switching to tag type shows tag selector combobox", async () => {
    useLibraryStore.setState({ sounds: [], tags: [{ id: "t1", name: "Percussion", color: "#ffffff" }], sets: [], isDirty: false });
    render(<Wrapper />);
    await userEvent.click(screen.getByRole("tab", { name: /tag/i }));
    expect(screen.getByPlaceholderText(/search.*tags/i)).toBeInTheDocument();
  });

  it("switching to set type shows set selector combobox", async () => {
    useLibraryStore.setState({ sounds: [], tags: [], sets: [{ id: "s1", name: "My Drums" }], isDirty: false });
    render(<Wrapper />);
    await userEvent.click(screen.getByRole("tab", { name: /set/i }));
    expect(screen.getByPlaceholderText(/search sets/i)).toBeInTheDocument();
  });

  it("shows error when assigned with no sounds selected and form is submitted", async () => {
    useLibraryStore.setState({
      sounds: [{ id: "s1", name: "Kick", tags: [], sets: [] }],
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

    expect(await screen.findByText(/at least one tag is required/i)).toBeInTheDocument();
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

  // ─── Info icon tooltip tests ──────────────────────────────────────────────

  it("shows Sound Selection info tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverInfoButtonAndAssert(0, "Determines which sounds this layer can use when the pad is triggered.");
  });

  it("shows Arrangement info tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverInfoButtonAndAssert(1, "Controls whether eligible sounds play all at once, or one at a time in order or at random.");
  });

  it("shows Playback Mode info tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverInfoButtonAndAssert(2, "Controls how long the sound plays after the pad is triggered.");
  });

  it("shows Retrigger Mode info tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverInfoButtonAndAssert(3, "Controls what happens when the pad is triggered while this layer is already playing.");
  });

  it("shows Mode info tooltip when arrangement is sequential", async () => {
    renderWithLayer({ arrangement: "sequential" });
    await hoverInfoButtonAndAssert(2, "Controls whether the whole sequence chains automatically, or each trigger advances one step at a time.");
  });

  // ─── Tab tooltip tests ───────────────────────────────────────────────────

  it("shows Assigned tab tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverTabTooltipAndAssert(/assigned/i, "Pick specific sounds from your library.");
  });

  it("shows Simultaneous tab tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverTabTooltipAndAssert(/simultaneous/i, "All sounds start at the same time.");
  });

  it("shows One-shot tab tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverTabTooltipAndAssert(/one-shot/i, "The sound plays once from start to finish, then stops.");
  });

  it("shows Restart retrigger tab tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverTabTooltipAndAssert(/restart/i, "Stops the current sound and starts it again from the beginning.");
  });

  it("shows Continuous tab tooltip on hover (sequential arrangement)", async () => {
    renderWithLayer({ arrangement: "sequential" });
    await hoverTabTooltipAndAssert(/continuous/i, /The full sequence plays through automatically/);
  });

  it("shows Cycle tab tooltip on hover (sequential arrangement)", async () => {
    renderWithLayer({ arrangement: "sequential" });
    await hoverTabTooltipAndAssert(/cycle/i, /Each trigger plays one sound, advancing/);
  });

  // ─── Arrangement helper text tests ────────────────────────────────────────

  it("shows arrangement helper for simultaneous with no assigned sounds", () => {
    render(<Wrapper />);
    // 0 instances assigned + simultaneous → no helper (instanceCount < 1)
    expect(screen.queryByText(/play together on each trigger/)).not.toBeInTheDocument();
  });

  it("shows arrangement helper for simultaneous with 1 assigned sound", () => {
    renderWithLayer({
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    });
    expectTextInDocument("The assigned sound plays on each trigger.");
  });

  it("shows arrangement helper for simultaneous with 3 assigned sounds", () => {
    renderWithLayer({
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
        { id: "i3", soundId: "s3", volume: 100 },
      ] },
    });
    expectTextInDocument("All 3 assigned sounds play together on each trigger.");
  });

  it("shows arrangement helper for simultaneous with tag selection", () => {
    renderWithLayer({
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
    });
    expectTextInDocument("All matched sounds play together at trigger time.");
  });

  it("shows arrangement helper for sequential with 1 assigned sound", () => {
    renderWithLayer({
      arrangement: "sequential",
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    });
    expectTextInDocument("Only one sound assigned — arrangement has no effect with a single sound.");
  });

  it("shows arrangement helper for sequential + 2 assigned + continuous", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: false,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ] },
    });
    expectTextInDocument(/All 2 sounds chain automatically/);
  });

  it("shows arrangement helper for sequential + 2 assigned + cycle", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: true,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ] },
    });
    expectTextInDocument("Each trigger plays the next sound in order.");
  });

  it("shows arrangement helper for shuffled + 3 assigned + continuous", () => {
    renderWithLayer({
      arrangement: "shuffled",
      cycleMode: false,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
        { id: "i3", soundId: "s3", volume: 100 },
      ] },
    });
    expectTextInDocument(/All 3 sounds chain automatically.*random order/);
  });

  it("shows arrangement helper for shuffled + 2 assigned + cycle", () => {
    renderWithLayer({
      arrangement: "shuffled",
      cycleMode: true,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ] },
    });
    expectTextInDocument("Each trigger plays a random sound from the 2 assigned.");
  });

  it("shows arrangement helper for sequential + tag + cycle", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: true,
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
    });
    expectTextInDocument("Each trigger plays the next sound from the matched pool.");
  });

  it("shows arrangement helper for shuffled + set + continuous", () => {
    renderWithLayer({
      arrangement: "shuffled",
      cycleMode: false,
      selection: { type: "set", setId: "s1", defaultVolume: 100 },
    });
    expectTextInDocument("All matched sounds chain automatically on each trigger.");
  });

  // ─── Cycle mode helper text tests ─────────────────────────────────────────

  it("shows cycle mode helper for sequential + continuous + one-shot", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: false,
      playbackMode: "one-shot",
    });
    expectTextInDocument(/The full sequence plays through once and stops/);
  });

  it("shows cycle mode helper for sequential + continuous + loop", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: false,
      playbackMode: "loop",
    });
    expectTextInDocument(/The sequence loops indefinitely/);
  });

  it("shows cycle mode helper for sequential + cycle + one-shot", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "one-shot",
    });
    expectTextInDocument(/Each trigger plays the next sound in order. After the last/);
  });

  it("shows cycle mode helper for sequential + cycle + loop", () => {
    renderWithLayer({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "loop",
    });
    expectTextInDocument(/Each trigger advances to the next sound, which then loops/);
  });

  it("shows cycle mode helper for shuffled + continuous + one-shot", () => {
    renderWithLayer({
      arrangement: "shuffled",
      cycleMode: false,
      playbackMode: "one-shot",
    });
    expectTextInDocument(/A new random order is played through once/);
  });

  it("shows cycle mode helper for shuffled + cycle + loop", () => {
    renderWithLayer({
      arrangement: "shuffled",
      cycleMode: true,
      playbackMode: "loop",
    });
    expectTextInDocument(/Each trigger plays a random sound, which loops until/);
  });

  // ─── Playback mode helper text tests ──────────────────────────────────────

  it("shows playback helper for one-shot + restart", () => {
    renderWithLayer({
      playbackMode: "one-shot",
      retriggerMode: "restart",
    });
    expectTextInDocument(/Plays once. Triggering while it's playing restarts/);
  });

  it("shows playback helper for one-shot + continue", () => {
    renderWithLayer({
      playbackMode: "one-shot",
      retriggerMode: "continue",
    });
    expectTextInDocument(/Plays once. Triggering while it's playing is ignored/);
  });

  it("shows playback helper for one-shot + stop", () => {
    renderWithLayer({
      playbackMode: "one-shot",
      retriggerMode: "stop",
    });
    expectTextInDocument(/Plays once. Triggering while it's playing stops it/);
  });

  it("shows playback helper for hold", () => {
    renderWithLayer({
      playbackMode: "hold",
      retriggerMode: "restart",
    });
    expectTextInDocument("Plays while the pad is held. Releasing the pad stops the sound.");
  });

  it("shows playback helper for loop + stop", () => {
    renderWithLayer({
      playbackMode: "loop",
      retriggerMode: "stop",
    });
    expectTextInDocument(/Loops continuously. Triggering again stops it/);
  });

  it("shows playback helper for loop + continue", () => {
    renderWithLayer({
      playbackMode: "loop",
      retriggerMode: "continue",
    });
    expectTextInDocument(/Loops continuously. Retriggering while looping has no effect/);
  });

  // ─── Retrigger mode helper text tests ─────────────────────────────────────

  it("shows retrigger helper for restart + one-shot", () => {
    renderWithLayer({
      retriggerMode: "restart",
      playbackMode: "one-shot",
    });
    expectTextInDocument(/Each retrigger stops the current sound and plays it/);
  });

  it("shows retrigger helper for restart + hold", () => {
    renderWithLayer({
      retriggerMode: "restart",
      playbackMode: "hold",
    });
    expectTextInDocument("Re-pressing the pad while held stops and restarts the sound.");
  });

  it("shows retrigger helper for continue + loop", () => {
    renderWithLayer({
      retriggerMode: "continue",
      playbackMode: "loop",
    });
    expectTextInDocument("Once looping, subsequent triggers have no effect.");
  });

  it("shows retrigger helper for stop + loop", () => {
    renderWithLayer({
      retriggerMode: "stop",
      playbackMode: "loop",
    });
    expectTextInDocument(/Triggering while looping stops the loop/);
  });

  it("shows retrigger helper for next + sequential + continuous", () => {
    renderWithLayer({
      retriggerMode: "next",
      arrangement: "sequential",
      cycleMode: false,
    });
    expectTextInDocument("Triggering while playing skips to the next queued sound in the chain.");
  });

  it("shows retrigger helper for next + sequential + cycle", () => {
    renderWithLayer({
      retriggerMode: "next",
      arrangement: "sequential",
      cycleMode: true,
    });
    expectTextInDocument("Triggering while playing advances the cycle cursor to the next sound.");
  });

  it("shows retrigger helper for next + shuffled + continuous", () => {
    renderWithLayer({
      retriggerMode: "next",
      arrangement: "shuffled",
      cycleMode: false,
    });
    expectTextInDocument("Triggering while playing skips to the next randomly-ordered sound in the chain.");
  });

  it("shows retrigger helper for next + shuffled + cycle", () => {
    renderWithLayer({
      retriggerMode: "next",
      arrangement: "shuffled",
      cycleMode: true,
    });
    expectTextInDocument("Triggering while playing advances to the next random position in the cycle.");
  });
});
