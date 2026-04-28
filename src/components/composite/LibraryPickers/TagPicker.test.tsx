import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockTag } from "@/test/factories";
import { TagPicker } from "./TagPicker";

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("TagPicker", () => {
  it("renders the tags placeholder", () => {
    render(<TagPicker value={[]} onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText("Search or create tags..."),
    ).toBeInTheDocument();
  });

  it("shows user tags from the library in the dropdown", async () => {
    const tag = createMockTag({ name: "Drums" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tag] });

    render(<TagPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create tags..."));

    expect(
      await screen.findByRole("option", { name: /drums/i }),
    ).toBeInTheDocument();
  });

  it("renders renderItemSuffix in each dropdown item when provided", async () => {
    const tag = createMockTag({ id: "t1", name: "Drums" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [tag] });

    render(
      <TagPicker
        value={[]}
        onChange={vi.fn()}
        renderItemSuffix={(item) => (
          <span data-testid="tag-count">{item.id}-3</span>
        )}
      />
    );
    await userEvent.click(screen.getByPlaceholderText("Search or create tags..."));

    const suffix = await screen.findByTestId("tag-count");
    expect(suffix).toHaveTextContent("t1-3");
  });

  it("renders renderExtraChips content when provided", () => {
    render(
      <TagPicker
        value={[]}
        onChange={vi.fn()}
        renderExtraChips={() => <span data-testid="extra-chip">partial</span>}
      />
    );
    expect(screen.getByTestId("extra-chip")).toBeInTheDocument();
  });

  it("excludes system tags from the dropdown", async () => {
    const systemTag = createMockTag({ name: "system-tag", isSystem: true });
    const userTag = createMockTag({ name: "user-tag" });
    useLibraryStore.setState({ ...initialLibraryState, tags: [systemTag, userTag] });

    render(<TagPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create tags..."));

    expect(
      await screen.findByRole("option", { name: /user-tag/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /system-tag/i }),
    ).not.toBeInTheDocument();
  });
});
