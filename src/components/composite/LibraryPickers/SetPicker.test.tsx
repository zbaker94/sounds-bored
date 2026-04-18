import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLibraryStore, initialLibraryState } from "@/state/libraryStore";
import { createMockSet } from "@/test/factories";
import { SetPicker } from "./SetPicker";

beforeEach(() => {
  useLibraryStore.setState({ ...initialLibraryState });
});

describe("SetPicker", () => {
  it("renders the sets placeholder", () => {
    render(<SetPicker value={[]} onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText("Search or create sets..."),
    ).toBeInTheDocument();
  });

  it("shows sets from the library in the dropdown", async () => {
    const set = createMockSet({ name: "Intro" });
    useLibraryStore.setState({ ...initialLibraryState, sets: [set] });

    render(<SetPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create sets..."));

    expect(
      await screen.findByRole("option", { name: /intro/i }),
    ).toBeInTheDocument();
  });

  it("shows empty state when library has no sets", async () => {
    render(<SetPicker value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByPlaceholderText("Search or create sets..."));
    expect(await screen.findByText("No sets found.")).toBeInTheDocument();
  });
});
