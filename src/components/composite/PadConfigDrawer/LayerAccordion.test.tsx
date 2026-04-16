import { forwardRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PadConfigSchema } from "@/lib/schemas";
import type { PadConfigForm } from "@/lib/schemas";
import { LayerAccordion } from "./LayerAccordion";
import { createMockLayer, createMockSoundInstance, createMockSound } from "@/test/factories";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock("motion/react", () => ({
  motion: {
    div: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
      ({ children, ...props }, ref) => <div ref={ref} {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./LayerConfigSection", () => ({
  LayerConfigSection: ({ index }: { index: number }) => (
    <div data-testid={`layer-config-${index}`}>Layer Config {index}</div>
  ),
}));

function makeDefaultValues(layers: PadConfigForm["layers"]): PadConfigForm {
  return {
    name: "Test Pad",
    layers,
  };
}

function Wrapper({ defaultValues }: { defaultValues: PadConfigForm }) {
  const methods = useForm<PadConfigForm>({
    resolver: zodResolver(PadConfigSchema) as Resolver<PadConfigForm>,
    defaultValues,
  });
  return (
    <TooltipProvider>
      <FormProvider {...methods}>
        <form>
          <LayerAccordion />
        </form>
      </FormProvider>
    </TooltipProvider>
  );
}

describe("LayerAccordion", () => {
  beforeEach(() => {
    useLibraryStore.setState({ ...initialLibraryState });
  });
  it("renders a label for each layer", () => {
    const layers = [createMockLayer(), createMockLayer(), createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
    expect(screen.getByText("Layer 1")).toBeInTheDocument();
    expect(screen.getByText("Layer 2")).toBeInTheDocument();
    expect(screen.getByText("Layer 3")).toBeInTheDocument();
  });

  it("renders the Add Layer button", () => {
    const layers = [createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });

  it("adds a new layer when Add Layer is clicked", async () => {
    const user = userEvent.setup();
    const layers = [createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);

    await user.click(screen.getByRole("button", { name: /add layer/i }));

    expect(screen.getByText("Layer 2")).toBeInTheDocument();
  });

  it("disables remove button when only one layer exists", () => {
    const layers = [createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
    const removeBtn = screen.getByRole("button", { name: /remove layer/i });
    expect(removeBtn).toBeDisabled();
  });

  it("enables remove button when multiple layers exist", () => {
    const layers = [createMockLayer(), createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
    const removeBtns = screen.getAllByRole("button", { name: /remove layer/i });
    removeBtns.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it("removes a layer when the remove button is clicked", async () => {
    const user = userEvent.setup();
    const layers = [createMockLayer(), createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);

    expect(screen.getByText("Layer 2")).toBeInTheDocument();

    const removeBtns = screen.getAllByRole("button", { name: /remove layer/i });
    await user.click(removeBtns[1]);

    expect(screen.queryByText("Layer 2")).not.toBeInTheDocument();
    expect(screen.getByText("Layer 1")).toBeInTheDocument();
  });

  it("auto-opens newly added layer", async () => {
    const user = userEvent.setup();
    const layers = [createMockLayer()];
    render(<Wrapper defaultValues={makeDefaultValues(layers)} />);

    await user.click(screen.getByRole("button", { name: /add layer/i }));

    expect(screen.getByText("Layer 2")).toBeInTheDocument();
    expect(screen.getByTestId("layer-config-1")).toBeInTheDocument();
  });

  describe("layer warnings", () => {
    it("shows no warning icon on a clean layer", () => {
      const sound = createMockSound({ id: "s1" });
      useLibraryStore.setState({ sounds: [sound], missingSoundIds: new Set<string>() });
      const inst = createMockSoundInstance({ soundId: "s1" });
      const layers = [createMockLayer({ selection: { type: "assigned", instances: [inst] } })];
      render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
      expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
    });

    it("shows warning icon when layer instances is empty", () => {
      const layers = [createMockLayer({ selection: { type: "assigned", instances: [] } })];
      render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
      // The Alert02Icon renders as an SVG; we verify the tooltip trigger span is present
      expect(document.querySelector(".text-amber-400")).toBeInTheDocument();
    });

    it("shows warning icon when layer has missing sounds", () => {
      const sound = createMockSound({ id: "s-missing", name: "Kick 808" });
      useLibraryStore.setState({
        sounds: [sound],
        missingSoundIds: new Set(["s-missing"]),
      });
      const inst = createMockSoundInstance({ soundId: "s-missing" });
      const layers = [createMockLayer({ selection: { type: "assigned", instances: [inst] } })];
      render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
      expect(document.querySelector(".text-amber-400")).toBeInTheDocument();
    });

    it("does not show warning icon on tag or set layers", () => {
      const layers = [createMockLayer({ selection: { type: "tag", tagIds: ["t1"], matchMode: "any", defaultVolume: 100 } })];
      render(<Wrapper defaultValues={makeDefaultValues(layers)} />);
      expect(document.querySelector(".text-amber-400")).not.toBeInTheDocument();
    });
  });
});
