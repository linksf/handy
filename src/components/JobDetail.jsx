import { useState } from "react";
import Btn from "./ui/Btn";
import NavIcon from "./ui/NavIcon";
import ConfirmModal from "./ui/ConfirmModal";
import Badge from "./ui/Badge";
import JobDetailsTab from "./JobDetailsTab";
import TasksTab from "./TasksTab";
import ChecklistTab from "./ChecklistTab";
import InvoiceTab from "./InvoiceTab";
import ExpensesTab from "./ExpensesTab";
import { statusColor, payColor } from "../constants";

export default function JobDetail({ ctx }) {
  const { viewParam, getJob, getCustomer, updateJob, deleteJob, nav, jobCost, jobCostBreakdown, jobRevenue } = ctx;
  const job = getJob(viewParam);
  const [tab, setTab] = useState("details");
  const [confirm, setConfirm] = useState(null);
  if (!job) return <p>Job not found.</p>;
  const customer = getCustomer(job.customerId);
  const costBreakdown = jobCostBreakdown(job);
  const profit = jobRevenue(job) - costBreakdown.total;

  const saveJob = (updates) => updateJob({ ...job, ...updates });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{job.title}</h2>
          <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer?.name} · {job.date}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Badge text={job.status} {...statusColor[job.status]} />
          <Badge text={job.payStatus} {...payColor[job.payStatus]} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center" }}>
        {[["details", "📋"], ["tasks", null], ["expenses", "💸"], ["checklist", "📦"], ["invoice", "🧾"]].map(([t, emoji]) => {
          const active = tab === t;
          return (
            <button
              key={t}
              title={t.charAt(0).toUpperCase() + t.slice(1)}
              onClick={() => setTab(t)}
              style={{ border: "none", borderRadius: 20, padding: "8px 14px", cursor: "pointer", fontSize: 18, lineHeight: 1, background: active ? "#f9bf3b" : "#bdc3c7", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {emoji
                ? emoji
                : <NavIcon name="tasks" size={20} color={active ? "#232323" : "#7f8c8d"} />
              }
            </button>
          );
        })}
        <Btn small danger onClick={() => setConfirm({ message: "Delete this job?", onConfirm: () => deleteJob(job.id) })} style={{ marginLeft: "auto" }}>Delete</Btn>
      </div>

      {tab === "details" && <JobDetailsTab job={job} saveJob={saveJob} ctx={ctx} costBreakdown={costBreakdown} profit={profit} />}
      {tab === "tasks" && <TasksTab job={job} saveJob={saveJob} ctx={ctx} />}
      {tab === "expenses" && <ExpensesTab job={job} saveJob={saveJob} />}
      {tab === "checklist" && <ChecklistTab job={job} ctx={ctx} />}
      {tab === "invoice" && <InvoiceTab job={job} saveJob={saveJob} customer={customer} costBreakdown={costBreakdown} jobRevenue={jobRevenue} />}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
