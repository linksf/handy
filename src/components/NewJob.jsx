import { useRef, useState } from "react";
import { buildJobInvoiceLines, invoiceTotalFromLines } from "../../shared/invoices.js";
import { customerMatches } from "../utils/intake";
import LaborEntriesEditor, { validLaborEntries } from "./LaborEntriesEditor";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import TaskMultiPicker from "./ui/TaskMultiPicker";
import { STATUSES } from "../constants";

const contactFields = { name: "", phone: "", email: "" };
function jobForm(source) {
  return {
    title: source?.title || "", date: "", status: "Draft", jobAddress: source?.address || "",
    notes: source?.description || "", estimate: source?.row.estimate ?? source?.row.initialEstimate?.price ?? "",
    approvedPrice: source?.row.approvedPrice ?? "", price: "", hourlyRate: "", hours: "", laborEntries: [],
    siteContact: source?.row.siteContact || { ...contactFields, name: source?.name || "", phone: source?.phone || "", email: source?.email || "" },
    payer: source?.row.payer || contactFields,
  };
}

function ContactFields({ prefix, value, onChange }) {
  return Object.keys(contactFields).map(field => <Input key={field}
    label={`${prefix} ${field}`} value={value[field]} onChange={text => onChange({ ...value, [field]: text })} />);
}

function QuickJob({ ctx, source }) {
  const { data, taskDefs, nav, viewParam } = ctx;
  const matches = source ? customerMatches(source, data.customers) : [];
  const [choice, setChoice] = useState(source ? source.state.customerId || "" : viewParam?.customerId || "");
  const [contact, setContact] = useState({ name: source?.name || "", phone: source?.phone || "", email: source?.email || "" });
  const [form, setForm] = useState(() => jobForm(source));
  const [tasks, setTasks] = useState([]);
  const [mode, setMode] = useState(source?.jobId ? "link" : "create");
  const [existingJobId, setExistingJobId] = useState(source?.jobId || "");
  const [prefillLabel, setPrefillLabel] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const jobId = useRef(null);
  const saving = useRef(false);
  const f = key => value => setForm(previous => ({ ...previous, [key]: value }));
  const priorJobs = data.jobs.filter(job => job.customerId === choice);
  const selectedJob = data.jobs.find(job => job.id === existingJobId);
  const canEditJob = mode === "create" || (source?.kind === "job" && source.id === existingJobId);
  const changingCustomer = choice && [source?.customerId, selectedJob?.customerId].some(id => id && choice !== id);
  const matchingDecision = source && (matches.length > 1 || changingCustomer);
  const customer = choice === "separate" ? contact : { id: choice };
  const submit = async event => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setError("");
    setBusy(true);
    try {
      jobId.current ??= crypto.randomUUID();
      const id = await ctx.saveQuickJob({
        source, customer, existingJobId: mode === "link" ? existingJobId : null,
        form: { ...form, title: form.title.trim() }, tasks, newJobId: jobId.current, reason: reason.trim(),
      });
      nav("job/:id", id);
    } catch (err) { setError(err.message || "Could not save this job."); }
    finally { setBusy(false); saving.current = false; }
  };
  const invalid = !choice || (mode === "create" && !!source?.jobId) || (choice === "separate" && !contact.name.trim())
    || (canEditJob && (!form.title.trim() || !validLaborEntries(form.laborEntries)))
    || (mode === "link" && !existingJobId) || (matchingDecision && !reason.trim());

  return <div className="quick-job">
    <header className="daily-heading"><h1>{source ? "Create or link job" : "Quick job"}</h1>
      {source && <p>Prefilled from {source.label.toLowerCase()} · {source.name || source.title}</p>}
    </header>
    <Card><form onSubmit={submit}>
      {source && <Select label="Job action" value={mode} onChange={setMode} options={[
        ...(source.jobId ? [] : [{ value: "create", label: "Create new job" }]), { value: "link", label: "Link existing job" },
      ]} />}
      {mode === "link" && <Select label="Existing job" value={existingJobId}
        onChange={id => { setExistingJobId(id); if (!matches.length) setChoice(data.jobs.find(job => job.id === id)?.customerId || ""); }}
        options={[{value: "", label: "Choose a job"}, ...data.jobs.map(job => ({ value: job.id, label: job.title }))]} />}
      {matches.length > 0 && <fieldset>
        <legend>{matches.length > 1 ? "Possible matches · review before linking" : "Possible customer match"}</legend>
        {matches.map(match => <label key={match.id}><input type="radio" name="customer-match" checked={choice === match.id}
          onChange={() => setChoice(match.id)} /> {match.name} · {match.address || match.email || match.phone || "Contact on file"}
          <span className="queue-meta" style={{ display: "block" }}>{data.jobs.filter(job => job.customerId === match.id)
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 2).map(job => job.title).join(" · ")}</span>
        </label>)}
      </fieldset>}
      <Select label="Customer" value={choice} onChange={setChoice} options={[
        {value:"", label:"Choose a customer or keep separate"}, {value:"separate", label:"Keep separate · new customer"},
        ...data.customers.map(row => ({ value: row.id, label: `${row.name}${row.address ? ` · ${row.address}` : ""}` })),
      ]} />
      {choice === "separate" && <ContactFields prefix="Customer" value={contact} onChange={setContact} />}
      {matchingDecision && <Input label="Reason for customer choice" value={reason} onChange={setReason} />}
      {canEditJob && <>
        {priorJobs.length > 0 && <label className="intake-field">Prefill from a prior job
          <select value="" onChange={event => {
            const prior = priorJobs.find(job => job.id === event.target.value);
            if (!prior) return;
            setPrefillLabel(prior.title);
            setForm(previous => ({ ...previous, title: prior.title || previous.title,
              jobAddress: prior.jobAddress || previous.jobAddress, notes: prior.notes || "",
              estimate: prior.estimate ?? "", hourlyRate: prior.hourlyRate ?? "" }));
          }}><option value="">Choose a job to copy details</option>
            {priorJobs.map(job => <option key={job.id} value={job.id}>{job.title} · {job.date || "Undated"}</option>)}
          </select>
        </label>}
        {prefillLabel && <p className="queue-meta">Copied details from {prefillLabel}. Review before saving.</p>}
        <Input label="Job title" value={form.title} onChange={f("title")} />
        {mode === "create" && <Input label="Date (optional)" type="date" value={form.date} onChange={value => {
          setForm(previous => ({ ...previous, date: value, status: previous.status === "Draft" && value ? "Scheduled"
            : previous.status === "Scheduled" && !value ? "Draft" : previous.status }));
        }} />}
        <details><summary>Address, site contact, payer and notes</summary>
          <Input label="Service address" value={form.jobAddress} onChange={f("jobAddress")} />
          <ContactFields prefix="Site contact" value={form.siteContact} onChange={f("siteContact")} />
          <ContactFields prefix="Payer" value={form.payer} onChange={f("payer")} />
          <label className="intake-field">Notes<textarea rows={3} value={form.notes} onChange={event => f("notes")(event.target.value)} /></label>
        </details>
        <details><summary>Pricing{mode === "create" ? ", status and tasks" : ""}</summary>
          <Input label="Estimate ($)" type="number" value={form.estimate} onChange={f("estimate")} />
          <Input label="Approved price ($)" type="number" value={form.approvedPrice} onChange={f("approvedPrice")} />
          {mode === "create" && <>
            <Input label="Invoice flat rate ($)" type="number" value={form.price} onChange={f("price")} />
            <Input label="Invoice hourly rate ($/hr)" type="number" value={form.hourlyRate} onChange={f("hourlyRate")} />
            <Input label="Invoice hours" type="number" value={form.hours} onChange={f("hours")} />
            <LaborEntriesEditor entries={form.laborEntries} onChange={f("laborEntries")} />
            <p>Current invoice total ${invoiceTotalFromLines(buildJobInvoiceLines(form)).toFixed(2)}</p>
            <Select label="Status" value={form.status} onChange={f("status")} options={STATUSES} />
            <TaskMultiPicker label="Tasks (optional)" options={taskDefs} value={tasks} onChange={setTasks} />
          </>}
        </details>
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="admin-action-row">
        <Btn type="submit" disabled={busy || invalid}>{busy ? "Saving…" : mode === "link" ? "Link job" : "Create job"}</Btn>
        <Btn color="#67757d" onClick={() => source ? nav("intake/:id", source.key) : nav("jobs")}>Cancel</Btn>
      </div>
    </form></Card>
  </div>;
}

export default function NewJob({ ctx }) {
  const sourceKey = ctx.viewParam?.source;
  const source = sourceKey && ctx.intakeRows.find(row => row.key === sourceKey);
  if (sourceKey && (!source || !ctx.intakeReady)) return <p role="status">Loading source record…</p>;
  return <QuickJob ctx={ctx} source={source} />;
}
