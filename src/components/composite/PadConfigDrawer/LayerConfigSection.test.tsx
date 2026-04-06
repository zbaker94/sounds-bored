import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
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
    const infoButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.tabIndex === -1 && btn.getAttribute("data-slot") === "tooltip-trigger",
    );
    await userEvent.hover(infoButtons[0]);
    const matches = await screen.findAllByText("Determines which sounds this layer can use when the pad is triggered.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Arrangement info tooltip on hover", async () => {
    render(<Wrapper />);
    const infoButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.tabIndex === -1 && btn.getAttribute("data-slot") === "tooltip-trigger",
    );
    await userEvent.hover(infoButtons[1]);
    const matches = await screen.findAllByText("Controls whether eligible sounds play all at once, or one at a time in order or at random.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Playback Mode info tooltip on hover", async () => {
    render(<Wrapper />);
    const infoButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.tabIndex === -1 && btn.getAttribute("data-slot") === "tooltip-trigger",
    );
    await userEvent.hover(infoButtons[2]);
    const matches = await screen.findAllByText("Controls how long the sound plays after the pad is triggered.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Retrigger Mode info tooltip on hover", async () => {
    render(<Wrapper />);
    const infoButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.tabIndex === -1 && btn.getAttribute("data-slot") === "tooltip-trigger",
    );
    await userEvent.hover(infoButtons[3]);
    const matches = await screen.findAllByText("Controls what happens when the pad is triggered while this layer is already playing.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Mode info tooltip when arrangement is sequential", async () => {
    render(<Wrapper values={makeValues({ arrangement: "sequential" })} />);
    const infoButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.tabIndex === -1 && btn.getAttribute("data-slot") === "tooltip-trigger",
    );
    await userEvent.hover(infoButtons[2]);
    const matches = await screen.findAllByText("Controls whether the whole sequence chains automatically, or each trigger advances one step at a time.");
    expect(matches.length).toBeGreaterThan(0);
  });

  // ─── Tab tooltip tests ───────────────────────────────────────────────────

  it("shows Assigned tab tooltip on hover", async () => {
    render(<Wrapper />);
    const tab = screen.getByRole("tab", { name: /assigned/i });
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.hover(tab.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);
    const matches = await screen.findAllByText("Pick specific sounds from your library.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Simultaneous tab tooltip on hover", async () => {
    render(<Wrapper />);
    const tab = screen.getByRole("tab", { name: /simultaneous/i });
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.hover(tab.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);
    const matches = await screen.findAllByText("All sounds start at the same time.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows One-shot tab tooltip on hover", async () => {
    render(<Wrapper />);
    const tab = screen.getByRole("tab", { name: /one-shot/i });
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.hover(tab.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);
    const matches = await screen.findAllByText("The sound plays once from start to finish, then stops.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Restart retrigger tab tooltip on hover", async () => {
    render(<Wrapper />);
    const tab = screen.getByRole("tab", { name: /restart/i });
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.hover(tab.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);
    const matches = await screen.findAllByText("Stops the current sound and starts it again from the beginning.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Continuous tab tooltip on hover (sequential arrangement)", async () => {
    render(<Wrapper values={makeValues({ arrangement: "sequential" })} />);
    const tab = screen.getByRole("tab", { name: /continuous/i });
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.hover(tab.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);
    const matches = await screen.findAllByText(/The full sequence plays through automatically/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows Cycle tab tooltip on hover (sequential arrangement)", async () => {
    render(<Wrapper values={makeValues({ arrangement: "sequential" })} />);
    const tab = screen.getByRole("tab", { name: /cycle/i });
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.hover(tab.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);
    const matches = await screen.findAllByText(/Each trigger plays one sound, advancing/);
    expect(matches.length).toBeGreaterThan(0);
  });

  // ─── Arrangement helper text tests ────────────────────────────────────────

  it("shows arrangement helper for simultaneous with no assigned sounds", () => {
    render(<Wrapper />);
    // 0 instances assigned + simultaneous → no helper (instanceCount < 1)
    expect(screen.queryByText(/play together on each trigger/)).not.toBeInTheDocument();
  });

  it("shows arrangement helper for simultaneous with 1 assigned sound", () => {
    render(<Wrapper values={makeValues({
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    })} />);
    expect(screen.getByText("The assigned sound plays on each trigger.")).toBeInTheDocument();
  });

  it("shows arrangement helper for simultaneous with 3 assigned sounds", () => {
    render(<Wrapper values={makeValues({
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
        { id: "i3", soundId: "s3", volume: 100 },
      ] },
    })} />);
    expect(screen.getByText("All 3 assigned sounds play together on each trigger.")).toBeInTheDocument();
  });

  it("shows arrangement helper for simultaneous with tag selection", () => {
    render(<Wrapper values={makeValues({
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
    })} />);
    expect(screen.getByText("All matched sounds play together at trigger time.")).toBeInTheDocument();
  });

  it("shows arrangement helper for sequential with 1 assigned sound", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    })} />);
    expect(screen.getByText("Only one sound assigned — arrangement has no effect with a single sound.")).toBeInTheDocument();
  });

  it("shows arrangement helper for sequential + 2 assigned + continuous", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: false,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ] },
    })} />);
    expect(screen.getByText(/All 2 sounds chain automatically/)).toBeInTheDocument();
  });

  it("shows arrangement helper for sequential + 2 assigned + cycle", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: true,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ] },
    })} />);
    expect(screen.getByText("Each trigger plays the next sound in order.")).toBeInTheDocument();
  });

  it("shows arrangement helper for shuffled + 3 assigned + continuous", () => {
    render(<Wrapper values={makeValues({
      arrangement: "shuffled",
      cycleMode: false,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
        { id: "i3", soundId: "s3", volume: 100 },
      ] },
    })} />);
    expect(screen.getByText(/All 3 sounds chain automatically.*random order/)).toBeInTheDocument();
  });

  it("shows arrangement helper for shuffled + 2 assigned + cycle", () => {
    render(<Wrapper values={makeValues({
      arrangement: "shuffled",
      cycleMode: true,
      selection: { type: "assigned", instances: [
        { id: "i1", soundId: "s1", volume: 100 },
        { id: "i2", soundId: "s2", volume: 100 },
      ] },
    })} />);
    expect(screen.getByText("Each trigger plays a random sound from the 2 assigned.")).toBeInTheDocument();
  });

  it("shows arrangement helper for sequential + tag + cycle", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: true,
      selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 },
    })} />);
    expect(screen.getByText("Each trigger plays the next sound from the matched pool.")).toBeInTheDocument();
  });

  it("shows arrangement helper for shuffled + set + continuous", () => {
    render(<Wrapper values={makeValues({
      arrangement: "shuffled",
      cycleMode: false,
      selection: { type: "set", setId: "s1", defaultVolume: 100 },
    })} />);
    expect(screen.getByText("All matched sounds chain automatically on each trigger.")).toBeInTheDocument();
  });

  // ─── Cycle mode helper text tests ─────────────────────────────────────────

  it("shows cycle mode helper for sequential + continuous + one-shot", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: false,
      playbackMode: "one-shot",
    })} />);
    expect(screen.getByText(/The full sequence plays through once and stops/)).toBeInTheDocument();
  });

  it("shows cycle mode helper for sequential + continuous + loop", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: false,
      playbackMode: "loop",
    })} />);
    expect(screen.getByText(/The sequence loops indefinitely/)).toBeInTheDocument();
  });

  it("shows cycle mode helper for sequential + cycle + one-shot", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "one-shot",
    })} />);
    expect(screen.getByText(/Each trigger plays the next sound in order. After the last/)).toBeInTheDocument();
  });

  it("shows cycle mode helper for sequential + cycle + loop", () => {
    render(<Wrapper values={makeValues({
      arrangement: "sequential",
      cycleMode: true,
      playbackMode: "loop",
    })} />);
    expect(screen.getByText(/Each trigger advances to the next sound, which then loops/)).toBeInTheDocument();
  });

  it("shows cycle mode helper for shuffled + continuous + one-shot", () => {
    render(<Wrapper values={makeValues({
      arrangement: "shuffled",
      cycleMode: false,
      playbackMode: "one-shot",
    })} />);
    expect(screen.getByText(/A new random order is played through once/)).toBeInTheDocument();
  });

  it("shows cycle mode helper for shuffled + cycle + loop", () => {
    render(<Wrapper values={makeValues({
      arrangement: "shuffled",
      cycleMode: true,
      playbackMode: "loop",
    })} />);
    expect(screen.getByText(/Each trigger plays a random sound, which loops until/)).toBeInTheDocument();
  });

  // ─── Playback mode helper text tests ──────────────────────────────────────

  it("shows playback helper for one-shot + restart", () => {
    render(<Wrapper values={makeValues({
      playbackMode: "one-shot",
      retriggerMode: "restart",
    })} />);
    expect(screen.getByText(/Plays once. Triggering while it's playing restarts/)).toBeInTheDocument();
  });

  it("shows playback helper for one-shot + continue", () => {
    render(<Wrapper values={makeValues({
      playbackMode: "one-shot",
      retriggerMode: "continue",
    })} />);
    expect(screen.getByText(/Plays once. Triggering while it's playing is ignored/)).toBeInTheDocument();
  });

  it("shows playback helper for one-shot + stop", () => {
    render(<Wrapper values={makeValues({
      playbackMode: "one-shot",
      retriggerMode: "stop",
    })} />);
    expect(screen.getByText(/Plays once. Triggering while it's playing stops it/)).toBeInTheDocument();
  });

  it("shows playback helper for hold", () => {
    render(<Wrapper values={makeValues({
      playbackMode: "hold",
      retriggerMode: "restart",
    })} />);
    expect(screen.getByText("Plays while the pad is held. Releasing the pad stops the sound.")).toBeInTheDocument();
  });

  it("shows playback helper for loop + stop", () => {
    render(<Wrapper values={makeValues({
      playbackMode: "loop",
      retriggerMode: "stop",
    })} />);
    expect(screen.getByText(/Loops continuously. Triggering again stops it/)).toBeInTheDocument();
  });

  it("shows playback helper for loop + continue", () => {
    render(<Wrapper values={makeValues({
      playbackMode: "loop",
      retriggerMode: "continue",
    })} />);
    expect(screen.getByText(/Loops continuously. Retriggering while looping has no effect/)).toBeInTheDocument();
  });

  // ─── Retrigger mode helper text tests ─────────────────────────────────────

  it("shows retrigger helper for restart + one-shot", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "restart",
      playbackMode: "one-shot",
    })} />);
    expect(screen.getByText(/Each retrigger stops the current sound and plays it/)).toBeInTheDocument();
  });

  it("shows retrigger helper for restart + hold", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "restart",
      playbackMode: "hold",
    })} />);
    expect(screen.getByText("Re-pressing the pad while held stops and restarts the sound.")).toBeInTheDocument();
  });

  it("shows retrigger helper for continue + loop", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "continue",
      playbackMode: "loop",
    })} />);
    expect(screen.getByText("Once looping, subsequent triggers have no effect.")).toBeInTheDocument();
  });

  it("shows retrigger helper for stop + loop", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "stop",
      playbackMode: "loop",
    })} />);
    expect(screen.getByText(/Triggering while looping stops the loop/)).toBeInTheDocument();
  });

  it("shows retrigger helper for next + sequential + continuous", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "next",
      arrangement: "sequential",
      cycleMode: false,
    })} />);
    expect(screen.getByText("Triggering while playing skips to the next queued sound in the chain.")).toBeInTheDocument();
  });

  it("shows retrigger helper for next + sequential + cycle", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "next",
      arrangement: "sequential",
      cycleMode: true,
    })} />);
    expect(screen.getByText("Triggering while playing advances the cycle cursor to the next sound.")).toBeInTheDocument();
  });

  it("shows retrigger helper for next + shuffled + continuous", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "next",
      arrangement: "shuffled",
      cycleMode: false,
    })} />);
    expect(screen.getByText("Triggering while playing skips to the next randomly-ordered sound in the chain.")).toBeInTheDocument();
  });

  it("shows retrigger helper for next + shuffled + cycle", () => {
    render(<Wrapper values={makeValues({
      retriggerMode: "next",
      arrangement: "shuffled",
      cycleMode: true,
    })} />);
    expect(screen.getByText("Triggering while playing advances to the next random position in the cycle.")).toBeInTheDocument();
  });
});
