import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { STATUSES } from "../../constants";
import JobStatusSelect from "./JobStatusSelect";

const job = {
  id: "job-1",
  title: "Repair sink",
  status: "Draft",
  customerId: "customer-1",
};

describe("JobStatusSelect", () => {
  test("offers every supported status", () => {
    render(<JobStatusSelect job={job} updateJob={vi.fn()} />);

    const options = screen.getAllByRole("option").map((option) => option.value);
    expect(options).toEqual(STATUSES);
  });

  test("immediately saves a different status", async () => {
    const updateJob = vi.fn().mockResolvedValue();
    render(<JobStatusSelect job={job} updateJob={updateJob} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Scheduled" },
    });

    await waitFor(() => {
      expect(updateJob).toHaveBeenCalledWith({ ...job, status: "Scheduled" });
    });
  });

  test("can restore the persisted status before its prop snapshot catches up", async () => {
    const updateJob = vi.fn().mockResolvedValue();
    render(<JobStatusSelect job={job} updateJob={updateJob} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "Scheduled" } });
    await waitFor(() => expect(select).not.toBeDisabled());

    fireEvent.change(select, { target: { value: "Draft" } });

    await waitFor(() => {
      expect(updateJob).toHaveBeenLastCalledWith({ ...job, status: "Draft" });
    });
    expect(updateJob).toHaveBeenCalledTimes(2);
  });

  test("resyncs to a successful external status update", () => {
    const { rerender } = render(
      <JobStatusSelect job={job} updateJob={vi.fn()} />
    );

    rerender(
      <JobStatusSelect
        job={{ ...job, status: "Scheduled" }}
        updateJob={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox")).toHaveValue("Scheduled");
  });

  test("does not save the current status", () => {
    const updateJob = vi.fn();
    render(<JobStatusSelect job={job} updateJob={updateJob} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Draft" },
    });

    expect(updateJob).not.toHaveBeenCalled();
  });

  test("disables the dropdown while saving", async () => {
    let finishSave;
    const updateJob = vi.fn(
      () => new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    render(<JobStatusSelect job={job} updateJob={updateJob} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "In Progress" } });

    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("aria-busy", "true");
    finishSave();
    await waitFor(() => {
      expect(select).not.toBeDisabled();
      expect(select).toHaveAttribute("aria-busy", "false");
    });
  });

  test("restores persisted status and reports a rejected save", async () => {
    const updateJob = vi.fn().mockRejectedValue(new Error("offline"));
    render(<JobStatusSelect job={job} updateJob={updateJob} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "Complete" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update job status. Try again."
    );
    expect(select).toHaveValue("Draft");
    expect(select).not.toBeDisabled();
  });

  test("clears a stale save error when persisted status changes", async () => {
    const updateJob = vi.fn().mockRejectedValue(new Error("offline"));
    const { rerender } = render(
      <JobStatusSelect job={job} updateJob={updateJob} />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Complete" },
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    rerender(
      <JobStatusSelect
        job={{ ...job, status: "Scheduled" }}
        updateJob={updateJob}
      />
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("Scheduled");
  });

  test("allows retrying after a rejected save", async () => {
    const updateJob = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce();
    render(<JobStatusSelect job={job} updateJob={updateJob} />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "Complete" } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "Complete" } });

    await waitFor(() => expect(select).not.toBeDisabled());
    expect(updateJob).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("displays an unknown persisted status until it is changed", () => {
    render(
      <JobStatusSelect
        job={{ ...job, status: "Legacy" }}
        updateJob={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox")).toHaveValue("Legacy");
    expect(screen.getByRole("option", { name: "Legacy" })).toBeInTheDocument();
  });
});
