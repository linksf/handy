import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Dashboard from "./Dashboard";

test("shows a new inquiries banner that navigates to inquiries", () => {
  const nav = vi.fn();
  render(
    <Dashboard
      ctx={{
        upcomingJobs: [],
        totalRevenue: 0,
        totalCost: 0,
        data: { customers: [], jobs: [] },
        nav,
        getCustomer: () => null,
        jobRevenue: () => 0,
        pendingBookingCount: 0,
        pendingBookings: [],
        inquiries: [{ id: "inquiry-1", name: "Jamie", category: "handyman", status: "new" }],
        newInquiryCount: 1,
      }}
    />
  );

  expect(screen.getByText("1 new inquiry")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review inquiries" }));
  expect(nav).toHaveBeenCalledWith("inquiries");
});
