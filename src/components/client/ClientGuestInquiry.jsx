import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import Btn from "../ui/Btn";
import Input from "../ui/Input";
import { functions } from "../../firebase";
import { clientFont, colors, pageWrap, sectionTitle } from "./clientTheme";

const sharedFields = [
  ["name", "Name", "text"],
  ["phone", "Phone", "tel"],
  ["email", "Email", "email"],
  ["address", "Address or area", "text"],
  ["preferredTiming", "Preferred timing", "text"],
  ["howFoundUs", "How did you find us? (optional)", "text"],
];

const categoryFields = {
  handyman: [
    ["propertyType", "Property type"],
    ["indoorOutdoor", "Indoor or outdoor"],
    ["urgency", "Urgency"],
    ["estimatedHours", "Rough size or hours estimate"],
    ["accessNotes", "Access notes"],
  ],
  fabrication: [
    ["materials", "Material preferences"],
    ["dimensionsNotes", "Dimensions or sketch notes"],
    ["installOrPickup", "Install or pickup"],
    ["finishNotes", "Finish or style notes"],
    ["deadline", "Deadline"],
  ],
};

const initialForm = Object.fromEntries(
  [...sharedFields, ...categoryFields.handyman, ...categoryFields.fabrication]
    .map(([name]) => [name, ""]),
);

export default function ClientGuestInquiry({
  submitInquiry: submitInquiryProp,
  onSignIn,
  onCreateAccount,
}) {
  const [category, setCategory] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [description, setDescription] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const update = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!description.trim()) {
      setError("Please describe what you need.");
      return;
    }
    if (!form.name.trim()) {
      setError("Please enter your name.");
      return;
    }

    setSubmitting(true);
    try {
      const callable = submitInquiryProp || httpsCallable(functions, "submitInquiry");
      const result = await callable({
        category,
        ...form,
        description: description.trim(),
        photoUrls: photoUrls
          .split(/[\n,]/)
          .map((url) => url.trim())
          .filter(Boolean),
      });
      const data = result?.data || result;
      if (!data?.inquiryId || !data?.customerId) {
        throw new Error("The inquiry was submitted without a tracking reference.");
      }
      sessionStorage.setItem(
        "pendingInquiryLink",
        JSON.stringify({
          inquiryId: data.inquiryId,
          customerId: data.customerId,
        }),
      );
      setSubmitted(true);
    } catch (err) {
      console.error("Guest inquiry submission failed:", err);
      setError(err?.message || "We couldn't submit your inquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Page>
        <section style={cardStyle}>
          <p style={{ color: colors.success, fontWeight: 700, margin: "0 0 8px" }}>
            Inquiry received
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: 26 }}>Thank you!</h1>
          <p style={bodyCopyStyle}>
            We&apos;ll review your request and follow up using the contact details you provided.
            Create an account or sign in if you&apos;d like this inquiry linked to your profile.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
            <Btn onClick={onCreateAccount}>Create account</Btn>
            <Btn color={colors.nav} onClick={onSignIn}>Sign in</Btn>
          </div>
        </section>
      </Page>
    );
  }

  if (!category) {
    return (
      <Page>
        <section style={cardStyle}>
          <p style={eyebrowStyle}>Request a quote</p>
          <h1 style={{ margin: "0 0 8px", fontSize: 26 }}>What can we help with?</h1>
          <p style={bodyCopyStyle}>Choose the service that best fits your project.</p>
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            <CategoryButton
              title="Handyman Services"
              detail="Repairs, installations, maintenance, and improvements"
              onClick={() => setCategory("handyman")}
            />
            <CategoryButton
              title="Custom Fabrication"
              detail="Made-to-order metalwork, builds, and installation"
              onClick={() => setCategory("fabrication")}
            />
          </div>
        </section>
      </Page>
    );
  }

  const categoryLabel = category === "handyman"
    ? "Handyman Services"
    : "Custom Fabrication";

  return (
    <Page>
      <form style={cardStyle} onSubmit={handleSubmit}>
        <button
          type="button"
          onClick={() => {
            setCategory(null);
            setError(null);
          }}
          style={backButtonStyle}
        >
          ← Change service
        </button>
        <p style={eyebrowStyle}>{categoryLabel}</p>
        <h1 style={{ margin: "0 0 20px", fontSize: 26 }}>Tell us about your project</h1>

        <h2 style={sectionTitle}>Contact details</h2>
        {sharedFields.map(([name, label, type]) => (
          <Input
            key={name}
            name={name}
            label={label}
            type={type}
            value={form[name]}
            onChange={(value) => update(name, value)}
          />
        ))}

        <h2 style={{ ...sectionTitle, marginTop: 24 }}>Project details</h2>
        {categoryFields[category].map(([name, label]) => (
          <Input
            key={name}
            name={name}
            label={label}
            value={form[name]}
            onChange={(value) => update(name, value)}
          />
        ))}
        <TextArea
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Describe the work, goals, and anything we should know."
        />
        <TextArea
          label="Photo URLs (optional)"
          value={photoUrls}
          onChange={setPhotoUrls}
          placeholder="Paste one link per line."
        />

        {error && <p role="alert" style={errorStyle}>{error}</p>}
        <Btn type="submit" disabled={submitting} style={{ width: "100%", marginTop: 8 }}>
          {submitting ? "Submitting…" : "Submit inquiry"}
        </Btn>
      </form>
    </Page>
  );
}

function Page({ children }) {
  return (
    <main style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: clientFont }}>
      <div style={{ ...pageWrap, paddingTop: 40 }}>{children}</div>
    </main>
  );
}

function CategoryButton({ title, detail, onClick }) {
  return (
    <button type="button" onClick={onClick} style={categoryButtonStyle}>
      <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
      <span style={{ color: colors.muted, fontSize: 13, lineHeight: 1.45 }}>{detail}</span>
    </button>
  );
}

function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={fieldLabelStyle}>{label}</span>
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        style={textAreaStyle}
      />
    </label>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: "28px 24px",
  boxShadow: "0 8px 24px rgba(35,35,35,0.12)",
};

const eyebrowStyle = {
  margin: "0 0 6px",
  color: colors.muted,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const bodyCopyStyle = {
  margin: 0,
  color: "#555",
  fontSize: 14,
  lineHeight: 1.55,
};

const categoryButtonStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 5,
  width: "100%",
  padding: "18px",
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  background: colors.accentSoft,
  color: colors.text,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};

const fieldLabelStyle = {
  display: "block",
  marginBottom: 4,
  color: colors.muted,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const textAreaStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: "10px 12px",
  fontFamily: "inherit",
  fontSize: 16,
  color: colors.text,
  resize: "vertical",
};

const errorStyle = {
  margin: "12px 0",
  color: colors.danger,
  fontSize: 13,
  lineHeight: 1.45,
};

const backButtonStyle = {
  border: "none",
  background: "transparent",
  color: "#2980b9",
  padding: "0 0 16px",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
