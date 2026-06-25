import { colors } from "./clientTheme";

/**
 * Horizontal step indicator for multi-step flows.
 * @param {{ id: string; label: string }[]} steps
 * @param {string} currentId
 */
export default function ClientStepper({ steps, currentId }) {
  const idx = steps.findIndex((s) => s.id === currentId);

  return (
    <nav aria-label="Progress" style={{ marginBottom: 20 }}>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          gap: 0,
          alignItems: "flex-start",
        }}
      >
        {steps.map((step, i) => {
          const done = i < idx;
          const active = i === idx;
          const dotColor = done || active ? colors.accent : colors.border;
          return (
            <li
              key={step.id}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
                minWidth: 0,
              }}
            >
              {i > 0 ? (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 14,
                    right: "50%",
                    width: "100%",
                    height: 2,
                    background: i <= idx ? colors.accent : colors.border,
                    zIndex: 0,
                  }}
                />
              ) : null}
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: dotColor,
                  color: active || done ? colors.text : colors.mmuted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  zIndex: 1,
                  border: active ? `2px solid ${colors.text}` : "none",
                  boxSizing: "border-box",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  color: active ? colors.text : colors.mmuted,
                  textAlign: "center",
                  lineHeight: 1.2,
                  padding: "0 4px",
                }}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
