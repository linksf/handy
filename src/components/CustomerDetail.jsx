import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Badge from "./ui/Badge";
import ConfirmModal from "./ui/ConfirmModal";
import { statusColor, payColor } from "../constants";

export default function CustomerDetail({ ctx }) {
  const { viewParam, getCustomer, jobsForCustomer, nav, updateCustomer, deleteCustomer, jobCost, jobRevenue } = ctx;
  const c = getCustomer(viewParam);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(c || {});
  const [confirm, setConfirm] = useState(null);
  if (!c) return <p>Customer not found.</p>;
  const jobs = jobsForCustomer(c.id);
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{c.name}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small onClick={() => setEditing(e => !e)}>{editing ? "Cancel" : "Edit"}</Btn>
          <Btn small danger onClick={() => setConfirm({ message: "Delete customer and all their jobs?", onConfirm: () => deleteCustomer(c.id) })}>Delete</Btn>
        </div>
      </div>
      {editing ? (
        <Card style={{ marginBottom: 16 }}>
          <Input label="Name" value={form.name} onChange={f("name")} />
          <Input label="Phone" value={form.phone} onChange={f("phone")} />
          <Input label="Email" value={form.email} onChange={f("email")} />
          <Input label="Address" value={form.address} onChange={f("address")} />
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Notes</div>
            <textarea
              value={form.notes}
              onChange={e => f("notes")(e.target.value)}
              rows={2}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <Btn onClick={() => { updateCustomer(form); setEditing(false); }}>Save</Btn>
        </Card>
      ) : (
        <Card style={{ marginBottom: 16 }}>
          {[["Phone", c.phone], ["Email", c.email], ["Address", c.address], ["Notes", c.notes]].filter(([, v]) => v).map(([l, v]) => (
            <div key={l} style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{l}:</span>{" "}
              <span style={{ fontSize: 13 }}>{v}</span>
            </div>
          ))}
        </Card>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Job History ({jobs.length})</h3>
        <Btn small onClick={() => nav("newJob", { customerId: c.id })}>+ New Job</Btn>
      </div>
      {jobs.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No jobs yet.</p></Card>
      ) : (
        jobs.sort((a, b) => new Date(b.date) - new Date(a.date)).map(j => (
          <Card key={j.id} style={{ marginBottom: 8, cursor: "pointer" }}>
            <div onClick={() => nav("job/:id", j.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{j.title}</div>
                <div style={{ fontSize: 12, color: "#7f8c8d" }}>{j.date} · Revenue: ${jobRevenue(j).toFixed(2)} · Cost: ${jobCost(j).toFixed(2)}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Badge text={j.status} {...statusColor[j.status]} />
                <Badge text={j.payStatus} {...payColor[j.payStatus]} />
              </div>
            </div>
          </Card>
        ))
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
