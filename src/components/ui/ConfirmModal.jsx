export default function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 12, padding: 24,
          maxWidth: 320, width: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <p style={{ margin: "0 0 20px", fontSize: 15, color: "#232323", lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{ background: "#ecf0f1", color: "#232323", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: 44 }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{ background: "#c0392b", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", minHeight: 44 }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
