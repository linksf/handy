import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import Dashboard from "./Dashboard";

beforeEach(() => window.localStorage?.clear());

test("routes directly to a new inquiry, dismisses it, and restores it with Undo", () => {
  const nav = vi.fn();
  render(<Dashboard ctx={{
    data: { customers: [], jobs: [] },
    nav,
    inquiries: [{ id: "inquiry-1", name: "Jamie", status: "new", createdAt: new Date() }],
  }} />);

  const queue = screen.getByRole("region", { name: /Needs reply/ });
  fireEvent.click(within(queue).getByRole("button", { name: "Review inquiry" }));
  expect(nav).toHaveBeenCalledWith("inquiry/:id", "inquiry-1");
  fireEvent.click(within(queue).getByRole("button", { name: "Dismiss Jamie" }));
  expect(within(queue).queryByText("Jamie")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(within(queue).getByText("Jamie")).toBeInTheDocument();
});
