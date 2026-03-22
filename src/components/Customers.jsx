import Card from "./ui/Card";
import Btn from "./ui/Btn";

export default function Customers({ ctx }) {
  const { data, nav } = ctx;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Customers</h2>
        <Btn onClick={() => nav("newCustomer")}>+ New Customer</Btn>
      </div>
      {data.customers.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center" }}>No customers yet.</p></Card>
      ) : (
        data.customers.map(c => (
          <Card key={c.id} style={{ marginBottom: 10, cursor: "pointer" }}>
            <div onClick={() => nav("customer/:id", c.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                <div style={{ fontSize: 13, color: "#718096" }}>{c.phone} · {c.address}</div>
              </div>
              <span style={{ color: "#a0aec0" }}>›</span>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
