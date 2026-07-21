import Card from "./ui/Card";
import Badge from "./ui/Badge";
import Btn from "./ui/Btn";
import { statusColor } from "../constants";

function formatTs(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Dashboard({ ctx }) {
  const {
    upcomingJobs,
    totalRevenue,
    totalCost,
    data,
    nav,
    getCustomer,
    jobRevenue,
    pendingBookingCount,
    pendingBookings,
    inquiries = [],
    newInquiryCount = 0,
  } = ctx;
  const totalProfit = totalRevenue - totalCost;
  return (
    <div>
      <h2 style={{ marginTop: 0, color: "#232323", fontWeight: 700 }}>Dashboard</h2>

      {newInquiryCount > 0 && (
        <Card
          style={{
            marginBottom: 20,
            background: "#eef6ff",
            border: "2px solid #2980b9",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#232323" }}>
                {newInquiryCount} new inquir{newInquiryCount === 1 ? "y" : "ies"}
              </div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                Review guest project requests and follow up with prospective customers.
              </div>
            </div>
            <Btn onClick={() => nav("inquiries")}>Review inquiries</Btn>
          </div>
          {inquiries.filter((inquiry) => inquiry.status === "new").slice(0, 3).map((inquiry) => (
            <div
              key={inquiry.id}
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid #cfe1f5",
                fontSize: 13,
                color: "#555",
              }}
            >
              <strong style={{ color: "#232323" }}>{inquiry.name || "Unnamed inquiry"}</strong>
              {" · "}
              {inquiry.category === "fabrication" ? "Custom Fabrication" : "Handyman Services"}
            </div>
          ))}
          {newInquiryCount > 3 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#7f8c8d" }}>
              +{newInquiryCount - 3} more
            </div>
          )}
        </Card>
      )}

      {pendingBookingCount > 0 && (
        <div role="button" tabIndex={0} onClick={() => nav("scheduling")} onKeyDown={(e) => e.key === "Enter" && nav("scheduling")} style={{ cursor: "pointer" }}>
        <Card
          style={{
            marginBottom: 20,
            background: "#fffef5",
            border: "2px solid #f9bf3b",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#232323" }}>
                {pendingBookingCount} pending booking{pendingBookingCount === 1 ? "" : "s"}
              </div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                Review and approve client requests on the Schedule page.
              </div>
            </div>
            <Btn onClick={(e) => { e.stopPropagation(); nav("scheduling"); }}>Review</Btn>
          </div>
          {pendingBookings.slice(0, 3).map((r) => (
            <div
              key={r.id}
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid #f0e6c8",
                fontSize: 13,
                color: "#555",
              }}
            >
              <strong style={{ color: "#232323" }}>{r.title}</strong>
              {" · "}
              {formatTs(r.requestedStart)}
            </div>
          ))}
          {pendingBookingCount > 3 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#7f8c8d" }}>
              +{pendingBookingCount - 3} more
            </div>
          )}
        </Card>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16, marginBottom: 24 }}>
        {[
          ["Revenue", `$${totalRevenue.toFixed(2)}`, "#d5f5e3", "#27ae60"],
          ["Costs", `$${totalCost.toFixed(2)}`, "#fadbd8", "#c0392b"],
          ["Profit", `$${totalProfit.toFixed(2)}`, totalProfit >= 0 ? "#d5f5e3" : "#fadbd8", totalProfit >= 0 ? "#27ae60" : "#c0392b"],
          ["Customers", data.customers.length, "#d6eaf8", "#2980b9"],
          ["Total Jobs", data.jobs.length, "#f2f3f4", "#232323"],
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
            const st = statusColor[j.status] || { bg: "#ecf0f1", tc: "#232323" };
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
                  <Badge text={j.status} color={st.bg} textColor={st.tc} />
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
