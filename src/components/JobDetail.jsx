import { useState } from "react";
import Btn from "./ui/Btn";
import FieldCapture from "./FieldCapture";
import JobAccess from "./JobAccess";
import JobChangeOrders from "./JobChangeOrders";
import JobParts from "./JobParts";
import JobCallbacks from "./JobCallbacks";
import JobCloseout from "./JobCloseout";
import JobVisits from "./JobVisits";
import ConfirmModal from "./ui/ConfirmModal";
import Card from "./ui/Card";
import Badge from "./ui/Badge";
import JobDetailsTab from "./JobDetailsTab";
import TasksTab from "./TasksTab";
import ChecklistTab from "./ChecklistTab";
import InvoiceTab from "./InvoiceTab";
import ExpensesTab from "./ExpensesTab";
import { statusColor, payColor } from "../constants";
import { closeoutFor } from "../utils/closeout";

export default function JobDetail({ ctx }) {
  const { viewParam, getJob, getCustomer, updateJob, deleteJob, nav, jobCostBreakdown, jobRevenue } = ctx;
  const [jobId, section, paymentAction] = ["jobInvoice","jobSection"].includes(ctx.view) ? viewParam : [viewParam];
  const invoiceId = ctx.view === "jobInvoice" ? section : undefined;
  const job = getJob(jobId);
  const [tab, setTab] = useState(invoiceId ? "invoice" : section || "details");
  const [confirm, setConfirm] = useState(null);
  if (!job) return <p>Job not found.</p>;
  const customer = getCustomer(job.customerId);
  const costBreakdown = jobCostBreakdown(job);
  const profit = jobRevenue(job) - costBreakdown.total;
  const st = statusColor[job.status] || { bg: "#ecf0f1", tc: "#232323" };
  const paySt = payColor[job.payStatus] || { bg: "#ecf0f1", tc: "#232323" };
  const inviteUrl = job.leadInviteToken
    ? `${window.location.origin}/book/lead/${encodeURIComponent(job.leadInviteToken)}`
    : null;

  const saveJob = (updates) => updateJob({ id: job.id, ...updates });
  const archived = job.status === "Archived";
  const { openVisits, issues } = closeoutFor(job);
  const address = job.jobAddress || customer?.address;
  const contact = { name: job.siteContact?.name || customer?.name, phone: job.siteContact?.phone || customer?.phone,
    email: job.siteContact?.email || customer?.email };
  const jump = id => {
    setTab("details");
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center" }));
  };

  return (
    <div className="field-job">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{job.title}</h2>
          {job.callbackType && <p className="admin-status">{job.callbackType} callback</p>}
          <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer?.name} · {job.date}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Badge text={job.status} color={st.bg} textColor={st.tc} />
          <Badge text={job.payStatus} color={paySt.bg} textColor={paySt.tc} />
        </div>
      </div>
      <div className="field-summary">
        {address && <a href={`https://maps.apple.com/?q=${encodeURIComponent(address)}`}>{address}</a>}
        {contact.name && <span>{contact.name}</span>}
        {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
        {!contact.phone && contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
      </div>
      {job.intakeSource && <button type="button" className="admin-quiet"
        onClick={() => nav("intake/:id", `${job.intakeSource.kind}:${job.intakeSource.id}`)}>Open intake</button>}
      <JobAccess job={job} address={address} />
      {!archived && <JobVisits job={job} ctx={ctx} />}
      <div className="admin-action-row job-tabs" role="group" aria-label="Job sections">
        {[["details", "Details"], ["tasks", "Tasks"], ["checklist", "Packing"], ["expenses", "Expenses"], ["invoice", "Invoice"], ["closeout", "Closeout"], ["changes", "Changes"], ["parts", "Parts"], ["callbacks", "Callbacks"]].map(([key, label]) =>
          <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {tab === "changes" && <JobChangeOrders job={job} ctx={ctx} />}
      {tab === "parts" && <JobParts job={job} ctx={ctx} />}
      {tab === "callbacks" && <JobCallbacks job={job} ctx={ctx} />}
      {tab === "closeout" && <JobCloseout job={job} saveJob={saveJob} ctx={ctx} />}
      {tab === "capture" && <FieldCapture job={job} ctx={ctx} /> }
      {tab === "details" && <JobDetailsTab job={job} saveJob={saveJob} ctx={ctx} costBreakdown={costBreakdown} profit={profit} />}
      {tab === "tasks" && <TasksTab job={job} saveJob={saveJob} ctx={ctx} />}
      {tab === "expenses" && <ExpensesTab job={job} saveJob={saveJob} />}
      {tab === "checklist" && <ChecklistTab job={job} ctx={ctx} saveJob={saveJob} openTasks={() => setTab("tasks")} />}
      {tab === "invoice" && <InvoiceTab openCost={(tab, id) => { setTab(tab); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center" })); }} initialInvoiceId={invoiceId} initialPaymentAction={paymentAction} job={job} saveJob={saveJob} customer={job.payer?.name || job.payer?.email || job.payer?.phone ? { ...job.payer } : customer} costBreakdown={costBreakdown} />}
      <details className="job-overflow">
        <summary>More job actions and records</summary>
        <div className="admin-action-row">
          {job.status === "Complete" && <Btn onClick={() => setConfirm({ label: "Reopen", message: "Reopen this job as In Progress?", onConfirm: () => saveJob({ status: "In Progress" }) })}>Reopen job</Btn>}
          {archived ? <Btn onClick={() => setConfirm({ label: "Restore", message: "Restore the job to its previous status?",
            onConfirm: () => saveJob({ status: job.archivedFromStatus || "Draft", archivedFromStatus: null }) })}>Restore job</Btn>
            : <Btn disabled={!!openVisits.length || !!issues.length && (!job.closeout?.reason || JSON.stringify(issues) !== JSON.stringify(job.closeout.issues))}
              onClick={() => setConfirm({ label: "Archive", message: "Archive this job? You can restore it from Jobs.",
                onConfirm: async () => { await saveJob({ status: "Archived", archivedFromStatus: job.status }); nav("jobs"); } })}>Archive job</Btn>}
        </div>
      {inviteUrl && job.status === "Draft" ? (
        <div
          style={{
            marginBottom: 12,
            padding: "12px 14px",
            background: "#e8daef",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Client setup link</div>
          <div style={{ wordBreak: "break-all", marginBottom: 8 }}>{inviteUrl}</div>
          <Btn
            small
            onClick={() => {
              navigator.clipboard.writeText(inviteUrl);
              ctx.showToast?.("Link copied!");
            }}
          >
            Copy link
          </Btn>
        </div>
      ) : null}
      {job.jobAddress && <p>{job.jobAddress}</p>}
      {(job.siteContact?.name || job.siteContact?.phone || job.siteContact?.email || job.payer?.name || job.payer?.phone || job.payer?.email ||
        job.estimate || job.approvedPrice) && <Card>
        {[["Site contact", job.siteContact], ["Payer", job.payer]].map(([label, contact]) => {
          const text = [contact?.name, contact?.phone, contact?.email].filter(Boolean).join(" · ");
          return text ? <p key={label}><strong>{label}</strong> {text}</p> : null;
        })}
        {job.estimate && <p><strong>Estimate</strong> ${Number(job.estimate).toFixed(2)}</p>}
        {job.approvedPrice && <p><strong>Approved price</strong> ${Number(job.approvedPrice).toFixed(2)}</p>}

      </Card>}
      {job.leadId && <p><Btn small onClick={()=>nav("lead/:id",job.leadId)}>View lead and conversation</Btn></p>}
      {job.calendarSyncStatus === "failed" && <p role="alert">Calendar sync needs attention: {job.calendarSyncError}</p>}
      {job.aiSummary && <Card><h3>Agreed scope</h3><p style={{whiteSpace:"pre-wrap"}}>{job.aiSummary}</p>{(job.aiScopeReview||[]).map(v=><p key={v}>{v}</p>)}</Card>}
      {!!job.aiEquipment?.length && <Card><h3>Equipment notes</h3>{job.aiEquipment.map((e,i)=><div key={i}><h4>{e.make} {e.model}</h4><p>Reported symptoms: {e.symptoms}</p><p>Error codes: {(e.errorCodes||[]).join(", ")||"None reported"}</p><p>Research: {(job.equipmentNotes||[]).find(n=>n.model===e.model)?.status||"pending"}</p>{(job.equipmentNotes||[]).filter(n=>n.model===e.model).map(n=><div key={n.key}><pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{n.text}</pre>{(n.sources||[]).map((r,j)=><p key={j}><a href={r.url} target="_blank" rel="noreferrer">[{j+1}] {r.title}</a></p>)}{n.researchedAt&&<small>Researched {new Date(n.researchedAt).toLocaleDateString()}</small>}{n.searchEntryHtml&&<iframe title="Research search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={n.searchEntryHtml} style={{width:"100%",border:0}}/>}</div>)}</div>)}</Card>}
      </details>
      <div className="field-actions">
        <Btn onClick={() => jump("job-timer")}>Work timer</Btn>
        <Btn onClick={() => { setTab("capture"); }}>Capture</Btn>
        <Btn onClick={() => setTab("expenses")}>Add expense</Btn>
      </div>
      {confirm && <ConfirmModal confirmLabel={confirm.label} message={confirm.message} onConfirm={async () => { try { await confirm.onConfirm(); setConfirm(null); } catch (error) { ctx.showToast(error.message || "Could not update the job."); } }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
