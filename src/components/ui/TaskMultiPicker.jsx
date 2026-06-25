import { useEffect, useMemo, useRef, useState } from "react";
import { uid } from "../../utils";

/**
 * Text input with filtered dropdown to add tasks; selected tasks shown as removable chips.
 * `options` should be { id, name } only for client-facing pickers (no tool metadata).
 */
export default function TaskMultiPicker({
  label = "Tasks (optional)",
  placeholder = "Type to search tasks…",
  options = [],
  value = [],
  onChange,
  buildItem,
  hint,
  labelStyle,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const sorted = useMemo(
    () => [...options].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [options]
  );

  const selectedIds = useMemo(() => new Set(value.map((t) => t.taskDefId)), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((t) => {
      if (selectedIds.has(t.id)) return false;
      if (!q) return true;
      return (t.name || "").toLowerCase().includes(q);
    });
  }, [sorted, query, selectedIds]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const addTask = (taskDef) => {
    if (!taskDef?.id || selectedIds.has(taskDef.id)) return;
    const item = buildItem
      ? buildItem(taskDef)
      : {
          id: uid(),
          taskDefId: taskDef.id,
          name: taskDef.name,
          toolIds: taskDef.toolIds || [],
          materials: [],
        };
    onChange([...value, item]);
    setQuery("");
    setOpen(false);
  };

  const removeTask = (taskDefId) => {
    onChange(value.filter((t) => t.taskDefId !== taskDefId));
  };

  const defaultLabelStyle = {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 4,
    color: "#7f8c8d",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <div style={{ marginBottom: 12 }} ref={wrapRef}>
      {label && <div style={{ ...defaultLabelStyle, ...labelStyle }}>{label}</div>}

      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {value.map((t) => (
            <span
              key={t.taskDefId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 999,
                background: "#eef2f7",
                fontSize: 13,
                color: "#2c3e50",
              }}
            >
              {t.name}
              <button
                type="button"
                onClick={() => removeTask(t.taskDefId)}
                aria-label={`Remove ${t.name}`}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                  fontSize: 16,
                  color: "#7f8c8d",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "Enter" && filtered.length > 0) {
              e.preventDefault();
              addTask(filtered[0]);
            }
          }}
          placeholder={placeholder}
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1px solid #bdc3c7",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 16,
            color: "#232323",
            outline: "none",
            minHeight: 44,
          }}
        />
        {open && filtered.length > 0 && (
          <ul
            style={{
              position: "absolute",
              zIndex: 20,
              left: 0,
              right: 0,
              top: "100%",
              margin: "4px 0 0",
              padding: 0,
              listStyle: "none",
              background: "#fff",
              border: "1px solid #bdc3c7",
              borderRadius: 6,
              maxHeight: 220,
              overflowY: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          >
            {filtered.slice(0, 40).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTask(t)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 14,
                    fontFamily: "inherit",
                    color: "#232323",
                  }}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && query.trim() && filtered.length === 0 && (
          <div
            style={{
              position: "absolute",
              zIndex: 20,
              left: 0,
              right: 0,
              top: "100%",
              marginTop: 4,
              padding: "10px 12px",
              background: "#fff",
              border: "1px solid #bdc3c7",
              borderRadius: 6,
              fontSize: 13,
              color: "#7f8c8d",
            }}
          >
            No matching tasks
          </div>
        )}
      </div>

      {hint && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#7f8c8d", lineHeight: 1.4 }}>{hint}</p>
      )}
    </div>
  );
}
