import { useState } from "react";
import Badge from "./ui/Badge";
import Btn from "./ui/Btn";
import Card from "./ui/Card";

const fieldLabels = {
  phone: "Phone",
  email: "Email",
  address: "Address",
  preferredTiming: "Preferred timing",
  howFoundUs: "How they found us",
  propertyType: "Property type",
  indoorOutdoor: "Indoor or outdoor",
  urgency: "Urgency",
  estimatedHours: "Estimated size or hours",
  accessNotes: "Access notes",
  materials: "Materials",
  dimensionsNotes: "Dimensions or sketch notes",
  installOrPickup: "Install or pickup",
  finishNotes: "Finish or style notes",
  deadline: "Deadline",
};

const categoryLabel = (category) =>
  category === "fabrication" ? "Custom Fabrication" : "Handyman Services";

export default function Inquiries({ ctx }) {
  const { inquiries = [], markInquiryReviewed } = ctx;
  const [selectedId, setSelectedId] = useState(null);
  const selected = inquiries.find((inquiry) => inquiry.id === selectedId);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Inquiries</h2>
      {inquiries.length === 0 ? (
        <Card><p style={{ color: "#7f8c8d", textAlign: "center" }}>No inquiries yet.</p></Card>
      ) : (
        inquiries.map((inquiry) => (
          <Card key={inquiry.id} style={{ marginBottom: 10, padding: 0, overflow: "hidden" }}>
            <button
              type="button"
              aria-label={`View inquiry from ${inquiry.name || "unknown customer"}`}
              onClick={() => setSelectedId(selectedId === inquiry.id ? null : inquiry.id)}
              style={summaryButtonStyle}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 16 }}>
                  {inquiry.name || "Unnamed inquiry"}
                </span>
                <span style={{ display: "block", marginTop: 3, color: "#555", fontSize: 13 }}>
                  {categoryLabel(inquiry.category)}
                </span>
                <span style={descriptionStyle}>{inquiry.description || "No description provided."}</span>
              </span>
              <Badge
                text={inquiry.status === "new" ? "New" : "Reviewed"}
                color={inquiry.status === "new" ? "#fef3c7" : "#d5f5e3"}
                textColor={inquiry.status === "new" ? "#8a5a00" : "#247443"}
              />
            </button>

            {selected?.id === inquiry.id && (
              <div style={detailStyle}>
                <p style={{ marginTop: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {inquiry.description || "No description provided."}
                </p>
                <div style={detailGridStyle}>
                  {Object.entries(fieldLabels).map(([field, label]) =>
                    inquiry[field] ? (
                      <div key={field}>
                        <div style={labelStyle}>{label}</div>
                        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{inquiry[field]}</div>
                      </div>
                    ) : null
                  )}
                  {inquiry.customerId && (
                    <div>
                      <div style={labelStyle}>Customer ID</div>
                      <div>{inquiry.customerId}</div>
                    </div>
                  )}
                </div>
                {(inquiry.photoUrls || []).length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={labelStyle}>Photos</div>
                    {(inquiry.photoUrls || []).map((url) => (
                      <div key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></div>
                    ))}
                  </div>
                )}
                {inquiry.status === "new" && (
                  <Btn onClick={() => markInquiryReviewed(inquiry.id)} style={{ marginTop: 18 }}>
                    Mark reviewed
                  </Btn>
                )}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

const summaryButtonStyle = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: 16,
  border: "none",
  background: "#fff",
  color: "#232323",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const descriptionStyle = {
  display: "-webkit-box",
  marginTop: 8,
  color: "#7f8c8d",
  fontSize: 13,
  lineHeight: 1.4,
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
};

const detailStyle = {
  padding: 16,
  borderTop: "1px solid #ecf0f1",
  background: "#fafafa",
  fontSize: 14,
};

const detailGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
  gap: 14,
};

const labelStyle = {
  marginBottom: 3,
  color: "#7f8c8d",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};
