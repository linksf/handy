import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";

export default function NewCustomer({ ctx }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>New Customer</h2>
      <Card>
        <Input label="Name *" value={form.name} onChange={f("name")} />
        <Input label="Phone" value={form.phone} onChange={f("phone")} />
        <Input label="Email" value={form.email} onChange={f("email")} type="email" />
        <Input label="Address" value={form.address} onChange={f("address")} />
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Notes</div>
          <textarea
            value={form.notes}
            onChange={e => f("notes")(e.target.value)}
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => { if (!form.name.trim()) return; ctx.addCustomer(form); }}>Save Customer</Btn>
          <Btn color="#7f8c8d" onClick={() => ctx.nav("customers")}>Cancel</Btn>
        </div>
      </Card>
    </div>
  );
}
