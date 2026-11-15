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
    expect(updateJob).toHaveBeenCalledWith({ id: job.id, status: "In Progress" });
  });
});

test("saves separate complimentary and crew labor rates on an existing job", () => {
  const saveJob = vi.fn();
  render(<JobDetailsTab job={{id:"job-2",title:"Work",status:"Draft",hours:4,hourlyRate:75}}
    saveJob={saveJob} ctx={{data:{customers:[]},jobRevenue:()=>300,updateJob:vi.fn()}}
    costBreakdown={{total:0}} profit={300} />);
  fireEvent.click(screen.getAllByRole("button", {name:"Edit"}).at(-1));
  fireEvent.click(screen.getByRole("button", {name:"Add planning"}));
  fireEvent.change(screen.getByRole("spinbutton", {name:"Labor hours 1"}), {target:{value:"1"}});
  fireEvent.click(screen.getByRole("button", {name:"Add two-person crew"}));
  fireEvent.change(screen.getByRole("spinbutton", {name:"Labor hours 2"}), {target:{value:"2"}});
  fireEvent.click(screen.getByRole("button", {name:"Save"}));
  expect(saveJob).toHaveBeenCalledWith(expect.objectContaining({laborEntries:[
    expect.objectContaining({name:"Planning",hours:"1",hourlyRate:"0"}), expect.objectContaining({name:"Two-person crew",hours:"2",hourlyRate:"100"})
  ]}));
  expect(saveJob.mock.calls[0][0]).not.toHaveProperty("hours");
  expect(saveJob.mock.calls[0][0]).not.toHaveProperty("hourlyRate");
});
