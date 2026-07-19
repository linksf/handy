import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import JobDetailsTab from "./JobDetailsTab";

vi.mock("../firebase", () => ({ db: {} }));
vi.mock("../hooks/useMobile", () => ({ useMobile: () => false }));
vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn(() => ({})),
  doc: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn((_query, callback) => {
    callback({ docs: [] });
    return vi.fn();
  }),
  orderBy: vi.fn(),
  query: vi.fn(() => ({})),
  updateDoc: vi.fn(),
  where: vi.fn(),
}));

test("changes status from the Job Details card", async () => {
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
    tasks: [],
    expenses: [],
  };
  const updateJob = vi.fn().mockResolvedValue();

  render(
    <JobDetailsTab
      job={job}
      saveJob={vi.fn()}
      ctx={{
        data: { customers: [] },
        jobRevenue: () => 0,
        updateJob,
      }}
      costBreakdown={{ total: 0 }}
      profit={0}
    />
  );

  fireEvent.change(
    screen.getByRole("combobox", { name: "Status for Repair sink" }),
    { target: { value: "In Progress" } }
  );

  await waitFor(() => {
    expect(updateJob).toHaveBeenCalledWith({ ...job, status: "In Progress" });
  });
});
