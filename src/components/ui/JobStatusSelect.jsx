import { useEffect, useRef, useState } from "react";
import { STATUSES, statusColor } from "../../constants";

export default function JobStatusSelect({ job, updateJob }) {
  const initialStatus = job.status || STATUSES[0];
  const [selected, setSelected] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const latestPersistedStatus = useRef(initialStatus);

  useEffect(() => {
    latestPersistedStatus.current = job.status || STATUSES[0];
    setSelected(latestPersistedStatus.current);
    setError("");
  }, [job.status]);

  const options = STATUSES.includes(job.status)
    ? STATUSES
    : [initialStatus, ...STATUSES];
  const colors = statusColor[selected] || { bg: "#ecf0f1", tc: "#232323" };

  const changeStatus = async (event) => {
    event.stopPropagation();
    const nextStatus = event.target.value;
    if (nextStatus === selected) return;

    setSelected(nextStatus);
    setError("");
    setSaving(true);
    try {
      await updateJob({ ...job, status: nextStatus });
    } catch {
      setSelected(latestPersistedStatus.current);
      setError("Could not update job status. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <select
        aria-label={`Status for ${job.title || "job"}`}
        aria-busy={saving}
        value={selected}
        onChange={changeStatus}
        disabled={saving}
        style={{
          border: `1px solid ${colors.tc}`,
          borderRadius: 12,
          padding: "5px 28px 5px 10px",
          minHeight: 36,
          background: colors.bg,
          color: colors.tc,
          fontSize: 13,
          fontWeight: 700,
          cursor: saving ? "wait" : "pointer",
        }}
      >
        {options.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      {error && (
        <div role="alert" style={{ color: "#c0392b", fontSize: 11, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
