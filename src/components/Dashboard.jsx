import Card from "./ui/Card";
import Badge from "./ui/Badge";
import { statusColor } from "../constants";

export default function Dashboard({ ctx }) {
  const { upcomingJobs, totalRevenue, totalCost, data, nav, getCustomer, jobRevenue } = ctx;
  const totalProfit = totalRevenue - totalCost;
  return (
    <div>
      <h2 style={{ marginTop: 0, color: "#232323", fontWeight: 700 }}>Dashboard</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16, marginBottom: 24 }}>
        {[
          ["💰 Revenue",   `$${totalRevenue.toFixed(2)}`, "#d5f5e3", "#27ae60"],
          ["🔧 Costs",     `$${totalCost.toFixed(2)}`,   "#fadbd8", "#c0392b"],
          ["📈 Profit",    `$${totalProfit.toFixed(2)}`,  totalProfit >= 0 ? "#d5f5e3" : "#fadbd8", totalProfit >= 0 ? "#27ae60" : "#c0392b"],
          ["👥 Customers", data.customers.length,          "#d6eaf8", "#2980b9"],
          ["📋 Total Jobs",data.jobs.length,               "#f2f3f4", "#232323"],
        ].map(([l, v, bg, tc]) => (
          <Card key={l} style={{ background: bg, textAlign: "center", border: "none" }}>
            <div style={{ fontSize: 13, color: tc, fontWeight: 600, letterSpacing: "0.02em" }}>{l}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: tc }}>{v}</div>
          </Card>
        ))}
      </div>
      <Card>
        <h3 style={{ marginTop: 0, color: "#232323" }}>Upcoming Jobs</h3>
        {upcomingJobs.length === 0 ? (
          <p style={{ color: "#7f8c8d" }}>No upcoming jobs.</p>
        ) : (
          upcomingJobs.map(j => {
            const c = getCustomer(j.customerId);
            return (
              <div
                key={j.id}
                onClick={() => nav("job/:id", j.id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #bdc3c7", cursor: "pointer" }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{j.title}</div>
                  <div style={{ fontSize: 12, color: "#7f8c8d" }}>{c?.name} · {j.date}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600 }}>${jobRevenue(j).toFixed(2)}</span>
                  <Badge text={j.status} {...statusColor[j.status]} />
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
