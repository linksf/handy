import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import TaskMultiPicker from "./ui/TaskMultiPicker";
import { STATUSES } from "../constants";
import { useMobile } from "../hooks/useMobile";

export default function NewJob({ ctx }) {
  const { data, addJob, nav, viewParam, taskDefs } = ctx;
  const isMobile = useMobile();
  const [form, setForm] = useState({
    title: "", customerId: viewParam?.customerId || "", date: "",
    status: "Scheduled", price: "", hourlyRate: "", hours: "", notes: "",
  });
  const [jobTasks, setJobTasks] = useState([]);
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));

  const previewRevenue =
    (parseFloat(form.price) || 0) +
    (parseFloat(form.hourlyRate) || 0) * (parseFloat(form.hours) || 0);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>New Job</h2>
      <Card>
        <Input label="Job Title *" value={form.title} onChange={f("title")} placeholder="e.g. Kitchen faucet repair" />
        <Select
          label="Customer *"
          value={form.customerId}
          onChange={f("customerId")}
          options={[{ value: "", label: "-- Select Customer --" }, ...data.customers.map(c => ({ value: c.id, label: c.name }))]}
        />
        <Input label="Date" value={form.date} onChange={f("date")} type="date" />
        <Select label="Status" value={form.status} onChange={f("status")} options={STATUSES} />

        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#7f8c8d" }}>Revenue</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Input label="Flat Rate ($)" value={form.price} onChange={f("price")} type="number" placeholder="0.00" />
          <div />
          <Input label="Hourly Rate ($/hr)" value={form.hourlyRate} onChange={f("hourlyRate")} type="number" placeholder="0.00" />
          <Input label="Hours" value={form.hours} onChange={f("hours")} type="number" placeholder="0" />
        </div>
        {previewRevenue > 0 && (
          <div style={{ fontSize: 13, color: "#7f8c8d", marginBottom: 12, marginTop: -4 }}>
            Total revenue: <strong>${previewRevenue.toFixed(2)}</strong>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Notes</div>
          <textarea
            value={form.notes}
            onChange={e => f("notes")(e.target.value)}
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
          />
        </div>

        <TaskMultiPicker
          label="Tasks (optional)"
          options={taskDefs}
          value={jobTasks}
          onChange={setJobTasks}
          hint="Search and add tasks from your library. You can add or remove more later on the job."
        />
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => { if (!form.title.trim() || !form.customerId) return; addJob({ ...form, tasks: jobTasks }); }}>Create Job</Btn>
          <Btn color="#7f8c8d" onClick={() => nav("jobs")}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
}
