import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryItemPicker } from "./LibraryItemPicker";

const items = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];

function renderPicker(
  overrides: Partial<Parameters<typeof LibraryItemPicker>[0]> = {},
) {
  const onChange = vi.fn();
  const onCreate = vi.fn().mockReturnValue({ id: "new-1" });
  render(
    <LibraryItemPicker
      value={[]}
      onChange={onChange}
      items={items}
      onCreate={onCreate}
      placeholder="Pick something..."
      emptyText="Nothing here."
      {...overrides}
    />,
  );
  return { onChange, onCreate };
}

describe("LibraryItemPicker", () => {
  it("renders the placeholder in the input", () => {
    renderPicker();
    expect(screen.getByPlaceholderText("Pick something...")).toBeInTheDocument();
  });

  it("shows items in the dropdown when the input is clicked", async () => {
    renderPicker();
    await userEvent.click(screen.getByPlaceholderText("Pick something..."));
    expect(await screen.findByRole("option", { name: /alpha/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /beta/i })).toBeInTheDocument();
  });

  it("shows emptyText when items list is empty", async () => {
    renderPicker({ items: [] });
    await userEvent.click(screen.getByPlaceholderText("Pick something..."));
    expect(await screen.findByText("Nothing here.")).toBeInTheDocument();
  });

  it("renders chips for current value", () => {
    renderPicker({ value: ["a"] });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("shows Create option when typing a novel name", async () => {
    renderPicker();
    const input = screen.getByPlaceholderText("Pick something...");
    await userEvent.click(input);
    await userEvent.type(input, "Gamma");
    expect(await screen.findByRole("option", { name: /create "Gamma"/i })).toBeInTheDocument();
  });

  it("does not show Create option when typing an existing name (case-insensitive)", async () => {
    renderPicker();
    const input = screen.getByPlaceholderText("Pick something...");
    await userEvent.click(input);
    await userEvent.type(input, "alpha");
    // The existing "Alpha" item will appear but no Create option
    expect(await screen.findByRole("option", { name: /alpha/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /create/i })).not.toBeInTheDocument();
  });

  it("does not show Create option when input is empty", async () => {
    renderPicker();
    await userEvent.click(screen.getByPlaceholderText("Pick something..."));
    // Don't type anything — popup opens with empty input
    expect(screen.queryByRole("option", { name: /create/i })).not.toBeInTheDocument();
  });

  it("calls onCreate with the typed name when Create is clicked", async () => {
    const { onCreate } = renderPicker();
    const input = screen.getByPlaceholderText("Pick something...");
    await userEvent.click(input);
    await userEvent.type(input, "Gamma");
    const createItem = await screen.findByRole("option", { name: /create "Gamma"/i });
    await act(async () => { fireEvent.click(createItem); });
    expect(onCreate).toHaveBeenCalledWith("Gamma");
  });
});
