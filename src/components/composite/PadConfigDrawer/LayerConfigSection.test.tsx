import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PadConfigSchema } from "@/lib/schemas";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { LayerConfigSection } from "./LayerConfigSection";
import type { PadConfigForm } from "@/lib/schemas";

const defaultValues: PadConfigForm = {
  name: "",
  layer: {
    selection: { type: "assigned", instances: [] },
    arrangement: "simultaneous",
    playbackMode: "one-shot",
    retriggerMode: "restart",
    volume: 100,
  },
};

function Wrapper({ onSubmit = () => {} }: { onSubmit?: (data: PadConfigForm) => void }) {
  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema),
    defaultValues,
  });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        <LayerConfigSection />
      </form>
    </FormProvider>
  );
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
    expect(screen.getByText(/retrigger/i)).toBeInTheDocument();
  });

  it("renders the volume slider", () => {
    render(<Wrapper />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("switching to tag type shows tag selector", async () => {
    useLibraryStore.setState({ sounds: [], tags: [{ id: "t1", name: "Percussion", color: "#ffffff" }], sets: [], isDirty: false });
    render(<Wrapper />);
    await userEvent.click(screen.getByRole("tab", { name: /tag/i }));
    expect(screen.getByText(/select tag/i)).toBeInTheDocument();
  });

  it("switching to set type shows set selector", async () => {
    useLibraryStore.setState({ sounds: [], tags: [], sets: [{ id: "s1", name: "My Drums" }], isDirty: false });
    render(<Wrapper />);
    await userEvent.click(screen.getByRole("tab", { name: /set/i }));
    expect(screen.getByText(/select set/i)).toBeInTheDocument();
  });
});
