import { useEffect, useState } from "react";
import ConfirmModal from "./ui/ConfirmModal";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Badge from "./ui/Badge";
import JobStatusSelect from "./ui/JobStatusSelect";
import { STATUSES, payColor, leadBadgeColor, isPreliminaryJob } from "../constants";

export default function Jobs({ ctx }) {
  const { data, nav, getCustomer, jobCost, jobRevenue, updateJob, deleteJobs } = ctx;
  const archivedJobs = ctx.archivedJobs || [];
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("date-desc");
  const [selected, setSelected] = useState(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setSelected(previous => new Set([...previous].filter(id => data.jobs.some(j => j.id === id))));
  }, [data.jobs]);
  const toggle = id => setSelected(previous => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const removeSelected = async () => {
    setConfirming(false);
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteJobs([...selected]);
      setSelected(new Set(result.failed));
      setMessage(result.failed.length ? `${result.deleted.length} deleted. ${result.failed.length} could not be deleted and remain selected. Try again.` : `${result.deleted.length} jobs deleted.`);
    } catch {
      setMessage("Could not delete the selected jobs. Try again.");
    } finally { setBusy(false); }
  };
  const filtered =
    filter === "All" ? data.jobs :
    filter === "Archived" ? archivedJobs :
    filter === "Requests" ? data.jobs.filter(isPreliminaryJob) :
    data.jobs.filter(j => j.status === filter);
  const sorted = [...filtered].sort((a,b) => {
    let comparison;
    if (sort.startsWith("date")) {
      const aDate = Date.parse(a.date), bDate = Date.parse(b.date);
      if (!Number.isFinite(aDate) || !Number.isFinite(bDate)) {
        return Number(Number.isFinite(bDate)) - Number(Number.isFinite(aDate)) || a.id.localeCompare(b.id);
      }
      comparison = aDate - bDate;
    } else {
      const value = j => sort.startsWith("customer") ? getCustomer(j.customerId)?.name || "" : sort.startsWith("title") ? j.title || "" : j.status || "";
      comparison = value(a).localeCompare(value(b), undefined, {numeric:true,sensitivity:"base"});
    }
    return (sort.endsWith("desc") ? -comparison : comparison) || a.id.localeCompare(b.id);
  });
  const allSelected = filtered.length > 0 && filtered.every(j => selected.has(j.id));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Jobs</h2>
        <Btn onClick={() => nav("newJob")}>+ New Job</Btn>
      </div>
      <div className="job-filters" role="group" aria-label="Filter jobs">
        {["All", "Requests", ...STATUSES, "Archived"].map(s => (
          <button
            key={s}
            aria-pressed={filter === s}
            disabled={busy}
            onClick={() => { setFilter(s); setSelected(new Set()); setMessage(""); }}
            style={{ border: "none", borderRadius: 20, padding: "5px 14px", cursor: "pointer", fontSize: 13, fontWeight: filter === s ? 700 : 400, background: filter === s ? "#f9bf3b" : "#bdc3c7", color: filter === s ? "#232323" : "#7f8c8d" }}
          >
            {s}
          </button>
        ))}
      </div>
      {filter !== "Archived" && <div className="jobs-toolbar">
        <label>Sort by <select aria-label="Sort jobs" value={sort} onChange={e => setSort(e.target.value)} style={{padding:8,font:"inherit",maxWidth:"100%"}}>
          <option value="date-desc">Date: newest first</option><option value="date-asc">Date: oldest first</option>
          <option value="customer-asc">Customer: A–Z</option><option value="customer-desc">Customer: Z–A</option>
          <option value="title-asc">Title: A–Z</option><option value="title-desc">Title: Z–A</option>
          <option value="status-asc">Status: A–Z</option>
        </select></label>
        <label style={{display:"flex",alignItems:"center",gap:8,minHeight:44}}><input type="checkbox" aria-label="Select all filtered jobs" disabled={busy || !filtered.length} checked={allSelected} ref={node => {if(node) node.indeterminate = selected.size > 0 && !allSelected;}} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map(j => j.id)))}/>Select all {filtered.length} jobs</label>
        <span>{selected.size} selected</span>
        <Btn small danger disabled={busy || !selected.size} onClick={() => setConfirming(true)}>{busy ? "Deleting…" : "Delete selected"}</Btn>
        {!!selected.size && <Btn small disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</Btn>}
      </div>
      }
      {message && <p role="status">{message}</p>}
      {confirming && <ConfirmModal message={`Permanently delete ${selected.size} selected jobs? This cannot be undone. Customers and calendar events will remain. Selected: ${data.jobs.filter(j => selected.has(j.id)).slice(0,5).map(j => j.title || "Untitled job").join(", ")}${selected.size > 5 ? ", …" : ""}`} onConfirm={removeSelected} onCancel={() => setConfirming(false)}/>}
      {filtered.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No jobs found.</p></Card>
      ) : (
        sorted.map(j => {
          const c = getCustomer(j.customerId);
          return (
            <Card key={j.id} style={{ marginBottom: 10, cursor: "pointer" }}>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                {filter !== "Archived" && <input type="checkbox" aria-label={`Select ${j.title || "job"}`} checked={selected.has(j.id)} disabled={busy} onChange={() => toggle(j.id)} style={{width:20,height:20,flexShrink:0}}/>}
              <div onClick={() => nav("job/:id", j.id)} style={{ display: "flex", flex:1, minWidth:0, gap:8, flexWrap:"wrap", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{j.title}</div>
                  <div style={{ fontSize: 12, color: "#7f8c8d" }}>{c?.name} · {j.date} · Cost: ${jobCost(j).toFixed(2)}</div>
                </div>
                <div className="job-row-controls">
                  <span style={{ fontWeight: 700 }}>${jobRevenue(j).toFixed(2)}</span>
                  <div className="job-row-badges">
                    {isPreliminaryJob(j) && (
                      <Badge text="Lead" color={leadBadgeColor.bg} textColor={leadBadgeColor.tc} />
                    )}
                    {j.payStatus && <Badge text={j.payStatus} {...payColor[j.payStatus]} />}
                  </div>
                  {filter === "Archived" ? <Btn small onClick={event => { event.stopPropagation(); nav("job/:id", j.id); }}>Open archived job</Btn> : <JobStatusSelect job={j} updateJob={updateJob} />}
                </div>
              </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
