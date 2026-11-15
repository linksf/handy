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
    expect(updateJob).toHaveBeenCalledWith({ id: job.id, status: "Scheduled" });
  });
  expect(nav).not.toHaveBeenCalled();
});

const batchJobs = [
  {id:'a',title:'Draft A',customerId:'z',date:'2026-10-15',status:'Draft',payStatus:'Unpaid'},
  {id:'b',title:'Draft B',customerId:'a',date:'2026-10-14',status:'Draft',payStatus:'Unpaid'},
  {id:'c',title:'Scheduled C',customerId:'a',date:'2026-10-16',status:'Scheduled',payStatus:'Unpaid'},
];
function batchContext(deleteJobs) {
  return {data:{jobs:batchJobs},nav:vi.fn(),updateJob:vi.fn(),deleteJobs,getCustomer:id=>({name:id==='z'?'Zelda':'Adam'}),jobCost:()=>0,jobRevenue:()=>0};
}
test('selects only filtered drafts, requires confirmation, and retains failed deletions', async()=>{
  const deleteJobs=vi.fn().mockResolvedValue({deleted:['a'],failed:['b']});
  render(<Jobs ctx={batchContext(deleteJobs)}/>);
  fireEvent.click(screen.getByRole('button',{name:'Draft',exact:true}));
  fireEvent.click(screen.getByLabelText('Select all filtered jobs'));
  fireEvent.click(screen.getByRole('button',{name:'Delete selected'}));
  expect(deleteJobs).not.toHaveBeenCalled();
  expect(screen.getByText(/Permanently delete 2 selected jobs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Delete',exact:true}));
  await waitFor(()=>expect(deleteJobs).toHaveBeenCalledWith(['a','b']));
  await waitFor(()=>expect(screen.getByLabelText('Select Draft B')).toBeChecked());
  expect(screen.getByLabelText('Select Draft A')).not.toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('1 could not be deleted');
});
test('sorts by customer and date without mutating source data; switching filters clears selection',()=>{
  render(<Jobs ctx={batchContext(vi.fn())}/>);
  fireEvent.change(screen.getByLabelText('Sort jobs'),{target:{value:'customer-asc'}});
  expect(screen.getAllByRole('checkbox').slice(1).map(n=>n.getAttribute('aria-label'))).toEqual(['Select Draft B','Select Scheduled C','Select Draft A']);
  fireEvent.change(screen.getByLabelText('Sort jobs'),{target:{value:'date-asc'}});
  expect(screen.getAllByRole('checkbox')[1]).toHaveAttribute('aria-label','Select Draft B');
  expect(batchJobs.map(j=>j.id)).toEqual(['a','b','c']);
  fireEvent.click(screen.getByLabelText('Select all filtered jobs'));
  fireEvent.click(screen.getByRole('button',{name:'Draft',exact:true}));
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});
