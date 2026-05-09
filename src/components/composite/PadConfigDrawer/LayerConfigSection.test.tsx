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

  // ─── Tab tooltip smoke tests ─────────────────────────────────────────────

  it("shows Assigned tab tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverTabTooltipAndAssert(/assigned/i, "Pick specific sounds from your library.");
  });

  it("shows Simultaneous tab tooltip on hover", async () => {
    render(<Wrapper />);
    await hoverTabTooltipAndAssert(/simultaneous/i, "All sounds start at the same time.");
  });

  // ─── Helper text smoke tests ──────────────────────────────────────────────

  it("renders arrangement helper text in component", () => {
    renderWithLayer({
      selection: { type: "assigned", instances: [{ id: "i1", soundId: "s1", volume: 100 }] },
    });
    expectTextInDocument("The assigned sound plays on each trigger.");
  });

  it("renders cycle mode helper text in component", () => {
    renderWithLayer({ arrangement: "sequential", cycleMode: false, playbackMode: "one-shot" });
    expectTextInDocument(/The full sequence plays through once and stops/);
  });

  it("hides Mode section when arrangement is simultaneous", () => {
    render(<Wrapper />);
    expect(screen.queryByText("Mode")).not.toBeInTheDocument();
  });

  it("renders playback mode helper text in component", () => {
    renderWithLayer({ playbackMode: "hold", retriggerMode: "restart" });
    expectTextInDocument("Plays while the pad is held. Releasing the pad stops the sound.");
  });

  it("renders retrigger helper text in component", () => {
    renderWithLayer({ retriggerMode: "continue", playbackMode: "loop" });
    expectTextInDocument("Once looping, subsequent triggers have no effect.");
  });
});
