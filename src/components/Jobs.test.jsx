import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Jobs from "./Jobs";

test("changes status from the Jobs list without navigating", async () => {
  const job = {
    id: "job-1",
    title: "Repair sink",
    customerId: "customer-1",
    date: "2026-07-18",
    status: "Draft",
    payStatus: "Unpaid",
    price: "",
    hourlyRate: "",
    hours: "",
  };
  const nav = vi.fn();
  const updateJob = vi.fn().mockResolvedValue();
  render(
    <Jobs
      ctx={{
        data: { jobs: [job] },
        nav,
        updateJob,
        getCustomer: () => ({ id: "customer-1", name: "Client" }),
        jobCost: () => 0,
        jobRevenue: () => 0,
      }}
    />
  );

  const select = screen.getByRole("combobox", { name: "Status for Repair sink" });
  fireEvent.click(select);
  expect(nav).not.toHaveBeenCalled();

  fireEvent.change(select, { target: { value: "Scheduled" } });
  await waitFor(() => {
    expect(updateJob).toHaveBeenCalledWith({ ...job, status: "Scheduled" });
  });
  expect(nav).not.toHaveBeenCalled();
});
