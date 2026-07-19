import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Badge from "./ui/Badge";
import JobStatusSelect from "./ui/JobStatusSelect";
import { STATUSES, payColor } from "../constants";

export default function Jobs({ ctx }) {
  const { data, nav, getCustomer, jobCost, jobRevenue, updateJob } = ctx;
  const [filter, setFilter] = useState("All");
  const filtered = filter === "All" ? data.jobs : data.jobs.filter(j => j.status === filter);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Jobs</h2>
        <Btn onClick={() => nav("newJob")}>+ New Job</Btn>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["All", ...STATUSES].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{ border: "none", borderRadius: 20, padding: "5px 14px", cursor: "pointer", fontSize: 13, fontWeight: filter === s ? 700 : 400, background: filter === s ? "#f9bf3b" : "#bdc3c7", color: filter === s ? "#232323" : "#7f8c8d" }}
          >
            {s}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No jobs found.</p></Card>
      ) : (
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date)).map(j => {
          const c = getCustomer(j.customerId);
          return (
            <Card key={j.id} style={{ marginBottom: 10, cursor: "pointer" }}>
              <div onClick={() => nav("job/:id", j.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{j.title}</div>
                  <div style={{ fontSize: 12, color: "#7f8c8d" }}>{c?.name} · {j.date} · Cost: ${jobCost(j).toFixed(2)}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>${jobRevenue(j).toFixed(2)}</span>
                  <JobStatusSelect job={j} updateJob={updateJob} />
                  <Badge text={j.payStatus} {...payColor[j.payStatus]} />
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
