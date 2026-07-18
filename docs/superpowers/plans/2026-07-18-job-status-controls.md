# Job Status Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediately-saving job-status dropdowns to the Jobs list and Job Details page.

**Architecture:** A focused `JobStatusSelect` component owns optimistic display, pending, and error state while delegating persistence to the existing `updateJob` mutation. The Jobs list and Job Details page reuse that component so status values, colors, and failure behavior remain consistent.

**Tech Stack:** React 18, Firebase/Firestore, Vite 6, Vitest, jsdom, React Testing Library.

## Global Constraints

- Supported values come exclusively from `STATUSES`: `Draft`, `Scheduled`, `In Progress`, `Complete`, and `Cancelled`.
- Selection saves immediately without a confirmation dialog or separate Save button.
- The existing full Job Details edit form remains unchanged.
- No status-transition restrictions or automatic workflow side effects are added.
- No Firestore schema, rules, webhook, or migration changes are required.

---

## File Structure

- Create `src/components/ui/JobStatusSelect.jsx`: reusable status dropdown and async save/error behavior.
- Create `src/components/ui/JobStatusSelect.test.jsx`: component behavior tests.
- Create `src/components/Jobs.test.jsx`: Jobs-list placement and navigation-isolation test.
- Create `src/components/JobDetailsTab.test.jsx`: Job Details placement test.
- Create `src/test/setup.js`: shared DOM test cleanup and matchers.
- Modify `src/components/Jobs.jsx`: replace the static status badge with the dropdown.
- Modify `src/components/JobDetailsTab.jsx`: replace the displayed status text with the dropdown.
- Modify `vite.config.js`: configure Vitest's jsdom environment.
- Modify `package.json` and `package-lock.json`: add the test script and test dependencies.

### Task 1: Reusable Job Status Dropdown

**Files:**
- Create: `src/test/setup.js`
- Create: `src/components/ui/JobStatusSelect.test.jsx`
- Create: `src/components/ui/JobStatusSelect.jsx`
- Modify: `vite.config.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `STATUSES` and `statusColor` from `src/constants.js`.
- Produces: `JobStatusSelect({ job, updateJob })`, where `job` contains at least `id`, `title`, and `status`, and `updateJob(updatedJob)` returns a promise.

- [ ] **Step 1: Install and configure the test runner**

Run:

```bash
npm install --save-dev vitest@^2.1.8 jsdom@^25.0.1 @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.3
```

Add this script to `package.json`:

```json
"test": "vitest run"
```

Add this property inside the Vite configuration object in `vite.config.js`:

```js
test: {
  environment: "jsdom",
  setupFiles: "./src/test/setup.js",
},
```

Create `src/test/setup.js`:

```js
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
```

- [ ] **Step 2: Write the failing component tests**

Create `src/components/ui/JobStatusSelect.test.jsx`:

```jsx
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
    finishSave();
    await waitFor(() => expect(select).not.toBeDisabled());
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
```

- [ ] **Step 3: Run the tests and verify the expected failure**

Run:

```bash
npm test -- src/components/ui/JobStatusSelect.test.jsx
```

Expected: FAIL because `./JobStatusSelect` does not exist.

- [ ] **Step 4: Implement the minimal reusable component**

Create `src/components/ui/JobStatusSelect.jsx`:

```jsx
import { useEffect, useState } from "react";
import { STATUSES, statusColor } from "../../constants";

export default function JobStatusSelect({ job, updateJob }) {
  const initialStatus = job.status || STATUSES[0];
  const [selected, setSelected] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelected(job.status || STATUSES[0]);
  }, [job.status]);

  const options = STATUSES.includes(job.status)
    ? STATUSES
    : [initialStatus, ...STATUSES];
  const colors = statusColor[selected] || { bg: "#ecf0f1", tc: "#232323" };

  const changeStatus = async (event) => {
    event.stopPropagation();
    const nextStatus = event.target.value;
    if (nextStatus === job.status) return;

    setSelected(nextStatus);
    setError("");
    setSaving(true);
    try {
      await updateJob({ ...job, status: nextStatus });
    } catch {
      setSelected(job.status || STATUSES[0]);
      setError("Could not update job status. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <select
        aria-label={`Status for ${job.title || "job"}`}
        value={selected}
        onChange={changeStatus}
        disabled={saving}
        style={{
          border: `1px solid ${colors.tc}`,
          borderRadius: 12,
          padding: "5px 28px 5px 10px",
          minHeight: 36,
          background: colors.bg,
          color: colors.tc,
          fontSize: 13,
          fontWeight: 700,
          cursor: saving ? "wait" : "pointer",
        }}
      >
        {options.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {error && (
        <div role="alert" style={{ color: "#c0392b", fontSize: 11, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
npm test -- src/components/ui/JobStatusSelect.test.jsx
```

Expected: six tests PASS.

- [ ] **Step 6: Commit the reusable control**

Because `package.json` and `package-lock.json` already contain unrelated uncommitted work, stage only the test-runner hunks from those two files:

```bash
git add -p package.json package-lock.json
git add vite.config.js src/test/setup.js src/components/ui/JobStatusSelect.jsx src/components/ui/JobStatusSelect.test.jsx
git diff --cached --check
git diff --cached
git commit -m "feat: add reusable job status selector"
```

Expected: the staged diff contains the test script/dependencies and Task 1 files only; it does not include the existing Firebase deploy-script changes.

### Task 2: Add Status Controls to Jobs List and Job Details

**Files:**
- Create: `src/components/Jobs.test.jsx`
- Create: `src/components/JobDetailsTab.test.jsx`
- Modify: `src/components/Jobs.jsx`
- Modify: `src/components/JobDetailsTab.jsx`

**Interfaces:**
- Consumes: `JobStatusSelect({ job, updateJob })` from Task 1.
- Uses: existing `ctx.updateJob(job)` promise-returning mutation.
- Produces: immediate status controls in both approved locations.

- [ ] **Step 1: Write the failing Jobs-list integration test**

Create `src/components/Jobs.test.jsx`:

```jsx
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
```

- [ ] **Step 2: Write the failing Job Details integration test**

Create `src/components/JobDetailsTab.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import JobDetailsTab from "./JobDetailsTab";

vi.mock("../firebase", () => ({ db: {} }));
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
```

- [ ] **Step 3: Run both integration tests and verify they fail**

Run:

```bash
npm test -- src/components/Jobs.test.jsx src/components/JobDetailsTab.test.jsx
```

Expected: FAIL because neither page renders `JobStatusSelect`.

- [ ] **Step 4: Integrate the dropdown into the Jobs list**

In `src/components/Jobs.jsx`, import the component:

```jsx
import JobStatusSelect from "./ui/JobStatusSelect";
```

Read `updateJob` from context:

```jsx
const { data, nav, getCustomer, jobCost, jobRevenue, updateJob } = ctx;
```

Replace:

```jsx
<Badge text={j.status} {...statusColor[j.status]} />
```

with:

```jsx
<JobStatusSelect job={j} updateJob={updateJob} />
```

Remove `statusColor` from the constants import. Keep `Badge` because payment and lead badges still use it.

- [ ] **Step 5: Integrate the dropdown into Job Details**

In `src/components/JobDetailsTab.jsx`, import:

```jsx
import JobStatusSelect from "./ui/JobStatusSelect";
```

Read `updateJob` from context:

```jsx
const { data, jobRevenue, updateJob } = ctx;
```

Replace the generic Date/Status mapping with explicit fields so only Status receives a dropdown:

```jsx
{job.date && (
  <div style={{ marginBottom: 6 }}>
    <span style={{ fontWeight: 600, fontSize: 13 }}>Date:</span>{" "}
    <span style={{ fontSize: 13 }}>{job.date}</span>
  </div>
)}
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
  <span style={{ fontWeight: 600, fontSize: 13 }}>Status:</span>
  <JobStatusSelect job={job} updateJob={updateJob} />
</div>
```

Keep the existing `<Select label="Status" ... />` inside the full edit form unchanged.

- [ ] **Step 6: Run the focused tests and verify they pass**

Run:

```bash
npm test -- src/components/ui/JobStatusSelect.test.jsx src/components/Jobs.test.jsx src/components/JobDetailsTab.test.jsx
```

Expected: eight tests PASS.

- [ ] **Step 7: Run project verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests PASS and Vite reports `✓ built`.

Check IDE diagnostics for:

- `src/components/ui/JobStatusSelect.jsx`
- `src/components/ui/JobStatusSelect.test.jsx`
- `src/components/Jobs.jsx`
- `src/components/Jobs.test.jsx`
- `src/components/JobDetailsTab.jsx`
- `src/components/JobDetailsTab.test.jsx`
- `vite.config.js`

Expected: no newly introduced diagnostics.

- [ ] **Step 8: Commit the integrations**

```bash
git add src/components/Jobs.jsx src/components/Jobs.test.jsx src/components/JobDetailsTab.jsx src/components/JobDetailsTab.test.jsx
git commit -m "feat: allow quick job status changes"
```
