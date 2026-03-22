import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import { STATUSES } from "../constants";
import { useMobile } from "../hooks/useMobile";

export default function JobDetailsTab({ job, saveJob, ctx, costBreakdown, profit }) {
  const isMobile = useMobile();
  const cost = costBreakdown.total;
  const { data, jobRevenue } = ctx;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(job);
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));

  const revenue = jobRevenue(job);
  const flatRate = parseFloat(job.price) || 0;
  const hourlyTotal = (parseFloat(job.hourlyRate) || 0) * (parseFloat(job.hours) || 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Revenue", `$${revenue.toFixed(2)}`, "#d6eaf8", "#2980b9"],
          ["Cost", `$${cost.toFixed(2)}`, "#fadbd8", "#c0392b"],
          ["Profit", `$${profit.toFixed(2)}`, profit >= 0 ? "#d5f5e3" : "#fadbd8", profit >= 0 ? "#27ae60" : "#c0392b"],
        ].map(([l, v, bg, tc]) => (
          <Card key={l} style={{ background: bg, textAlign: "center", padding: 14 }}>
            <div style={{ fontSize: 12, color: tc, fontWeight: 600 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tc }}>{v}</div>
          </Card>
        ))}
      </div>
      {editing ? (
        <Card>
          <Input label="Title" value={form.title} onChange={f("title")} />
          <Select label="Customer" value={form.customerId} onChange={f("customerId")} options={data.customers.map(c => ({ value: c.id, label: c.name }))} />
          <Input label="Date" value={form.date} onChange={f("date")} type="date" />
          <Select label="Status" value={form.status} onChange={f("status")} options={STATUSES} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Input label="Flat Rate ($)" value={form.price || ""} onChange={f("price")} type="number" placeholder="0.00" />
            <div /> {/* spacer */}
            <Input label="Hourly Rate ($/hr)" value={form.hourlyRate || ""} onChange={f("hourlyRate")} type="number" placeholder="0.00" />
            <Input label="Hours" value={form.hours || ""} onChange={f("hours")} type="number" placeholder="0" />
          </div>
          {((parseFloat(form.hourlyRate) || 0) > 0 || (parseFloat(form.price) || 0) > 0) && (
            <div style={{ fontSize: 13, color: "#7f8c8d", marginBottom: 12, marginTop: -4 }}>
              Total revenue: <strong>${(
                (parseFloat(form.price) || 0) +
                (parseFloat(form.hourlyRate) || 0) * (parseFloat(form.hours) || 0)
              ).toFixed(2)}</strong>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Notes</div>
            <textarea
              value={form.notes || ""}
              onChange={e => f("notes")(e.target.value)}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Photos (URLs, one per line)</div>
            <textarea
              value={(form.photos || []).join("\n")}
              onChange={e => f("photos")(e.target.value.split("\n").filter(Boolean))}
              rows={2}
              placeholder="https://..."
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={() => { saveJob(form); setEditing(false); }}>Save</Btn>
            <Btn color="#7f8c8d" onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 700 }}>Job Details</span>
            <Btn small onClick={() => setEditing(true)}>Edit</Btn>
          </div>
          {[["Date", job.date], ["Status", job.status]].filter(([, v]) => v).map(([l, v]) => (
            <div key={l} style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{l}:</span>{" "}
              <span style={{ fontSize: 13 }}>{v}</span>
            </div>
          ))}
          {/* Revenue breakdown */}
          {flatRate > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Flat Rate:</span>{" "}
              <span style={{ fontSize: 13 }}>${flatRate.toFixed(2)}</span>
            </div>
          )}
          {hourlyTotal > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Hourly:</span>{" "}
              <span style={{ fontSize: 13 }}>${(parseFloat(job.hourlyRate) || 0).toFixed(2)}/hr × {parseFloat(job.hours) || 0} hrs = ${hourlyTotal.toFixed(2)}</span>
            </div>
          )}
          {job.notes && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Notes:</span>{" "}
              <span style={{ fontSize: 13 }}>{job.notes}</span>
            </div>
          )}
          {job.photos?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Photos:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {job.photos.map((p, i) => (
                  <a key={i} href={p} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2980b9" }}>Photo {i + 1}</a>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
