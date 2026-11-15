import { useState } from "react";
import { doc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import InvoicePayments from "./InvoicePayments";
import { pacificDay } from "../utils/adminDates";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import { buildJobInvoiceLines, invoiceTotalFromLines, invoicePaid, jobInvoices, jobCostBreakdown } from "../../shared/invoices.js";

const usd = value => `$${Number(value).toFixed(2)}`;
const emptyItem = {kind:"labor",name:"",hours:"",hourlyRate:"75",amount:"",reimbursable:true};
// Persist IDs alongside the first invoice edit so assignments survive source edits/removal.
function stableSources(job) {
  return {
    laborEntries:(job.laborEntries || []).map((e,i)=>({...e,id:e.id || `legacy-labor-${i}`})),
    expenses:(job.expenses || []).map((e,i)=>({...e,id:e.id || `legacy-expense-${i}`})),
    tasks:(job.tasks || []).map((t,i)=>({...t,id:t.id || `legacy-task-${i}`,materials:(t.materials || []).map((m,j)=>({...m,id:m.id || `legacy-material-${j}`}))})),
  };
}
export default function InvoiceTab({ job: originalJob, saveJob, customer, initialInvoiceId, openCost, initialPaymentAction }) {
  const job = {...originalJob,...stableSources(originalJob)};
  const invoices = jobInvoices(job);
  const [selected,setSelected] = useState(() => initialInvoiceId || [...invoices].reverse().find(row => buildJobInvoiceLines(job, row.id).length)?.id || invoices[0].id);
  const invoice = invoices.find(i=>i.id===selected) || invoices[0];
  const invoiceId = invoice.id;
  const lines = buildJobInvoiceLines(job,invoiceId);
  const allSources = buildJobInvoiceLines(job,undefined,true);
  const total = invoiceTotalFromLines(lines);
  const paid = invoicePaid(job,invoiceId);
  const jobTotal = invoiceTotalFromLines(buildJobInvoiceLines(job));
  const cost = jobCostBreakdown(job).total;
  const [item,setItem] = useState(emptyItem);
  const [editingItemId,setEditingItemId] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [lineChange, setLineChange] = useState(null);
  const [issueReview, setIssueReview] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [paymentAction, setPaymentAction] = useState(initialPaymentAction || "");
  const [paymentsOpen, setPaymentsOpen] = useState(!!initialPaymentAction);
  const versions = (job.issuedInvoices || {})[invoiceId] || [];
  const latest = versions.at(-1);
  const preview = { title: job.title, date: job.date || "", notes: job.notes || "",
    customer: Object.fromEntries(["name","address","phone","email"].map(key => [key, customer?.[key] || ""])),
    name: invoice.name, lines, total, paid };
  const signature = value => JSON.stringify([value.title, value.date, value.notes,
    ...["name","address","phone","email"].map(key => value.customer?.[key]), value.name,
    value.lines.map(row => [row.key, row.name, row.amountCents, row.originalAmountCents, row.comped])]);
  const issued = latest && signature(latest) === signature(preview);
  const [name,setName] = useState("");
  const run = async action => {setBusy(true);setError("");try {await action();}catch(e){setError(e.message || "Changes could not be saved.");}finally{setBusy(false);}};
  const save = updates => {
    const sources = stableSources(originalJob);
    const normalization = Object.fromEntries(Object.entries(sources)
      .filter(([field, rows]) => rows.length && JSON.stringify(originalJob[field]) !== JSON.stringify(rows)));
    return saveJob({ ...normalization, ...updates });
  };
  const approvedOrder = line => job.invoiceItems?.find(row => `item:${row.id}` === line.key)?.changeOrderId;
  const override = (line, updates) => setLineChange({ line, updates });
  const confirmLineChange = () => run(async () => {
    const { line, updates } = lineChange;
    const now = allSources.find(row => row.key === line.key);
    if (JSON.stringify(now) !== JSON.stringify(line)) {
      setLineChange(null);
      throw new Error("This line changed. Review its current values.");
    }
    await save({ invoiceOverrides: { ...job.invoiceOverrides, [line.key]: { ...job.invoiceOverrides?.[line.key], ...updates } } });
    setLineChange(null);
  });
  const issue = () => run(async () => {
    if (issueReview !== signature(preview)) throw new Error("The draft changed. Close this review and inspect the updated invoice.");
    const ref = doc(db, "jobs", job.id);
    const id = crypto.randomUUID();
    await runTransaction(db, async transaction => {
      const current = (await transaction.get(ref)).data();
      if (!current || !jobInvoices(current).some(row => row.id === invoiceId)) throw new Error("Invoice unavailable.");
      const currentLines = buildJobInvoiceLines({ ...current, ...stableSources(current) }, invoiceId);
      const currentPreview = { ...preview, title: current.title, date: current.date || "", notes: current.notes || "",
        name: jobInvoices(current).find(row => row.id === invoiceId).name, lines: currentLines };
      if (signature(currentPreview) !== signature(preview)) throw new Error("Invoice changed. Review the updated preview.");
      const saved = current.issuedInvoices?.[invoiceId] || [];
      if (saved.at(-1) && signature(saved.at(-1)) === signature(preview)) return;
      transaction.update(ref, { issuedInvoices: { ...current.issuedInvoices,
        [invoiceId]: [...saved, { ...preview, paid: invoicePaid(current, invoiceId), id, issuedOn: pacificDay(new Date()) }] } });
    });
    setIssueReview(null);
    setFeedback("Issued version saved.");
  });
  const addInvoice = () => run(async()=>{
    const id = crypto.randomUUID();
    await save({invoices:[...invoices,{id,name:name.trim() || `Invoice ${invoices.length+1}`,amountPaid:0}]});
    setSelected(id);setName("");
  });
  const validItem = item.name.trim() && (item.kind === "labor"
    ? Number.isFinite(Number(item.hours)) && Number(item.hours)>0 && item.hourlyRate!=="" && Number.isFinite(Number(item.hourlyRate)) && Number(item.hourlyRate)>=0
    : item.amount!=="" && Number.isFinite(Number(item.amount)) && Number(item.amount)>=0);
  const addItem = () => run(async()=>{
    if(!validItem)return;
    const updated = {...item,id:editingItemId || crypto.randomUUID(),invoiceId};
    const invoiceItems = editingItemId ? job.invoiceItems.map(i=>i.id===editingItemId?updated:i) : [...(job.invoiceItems || []),updated];
    const overrides = {...job.invoiceOverrides};
    if (editingItemId) overrides[`item:${editingItemId}`] = {...overrides[`item:${editingItemId}`],comped:!!item.comped,invoiceId};
    await save({invoiceItems,invoiceOverrides:overrides});
    setItem(emptyItem);setEditingItemId(null);setFeedback("Invoice item saved.");
  });
  const download = snapshot => run(async()=>{
    const {generateJobInvoicePdf} = await import("../utils/generateJobInvoicePdf");
    await generateJobInvoicePdf({job,customer,invoiceId,snapshot});
  });
  const openPayment = action => {
    setPaymentAction(action);
    setPaymentsOpen(true);
    requestAnimationFrame(() => document.getElementById("invoice-payments")?.scrollIntoView({ block: "start" }));
  };
  return <div className="billing-workspace">
    <section className="billing-header" aria-label="Selected invoice">
      <h3>{invoice.name}</h3>
      <p><strong>{usd(Math.abs(total-paid))} {paid > total ? "credit" : "balance"}</strong> · {usd(paid)} paid · {issued ? "Issued" : latest ? "Changes since issue" : "Draft"}</p>
      <div className="admin-action-row">
        {!issued && <Btn disabled={busy || !lines.length} onClick={() => setIssueReview(signature(preview))}>Review and issue</Btn>}
        {issued && <Btn disabled={busy} onClick={() => download(latest)}>Download issued PDF</Btn>}
        {paid < total && <Btn onClick={() => openPayment("payment")}>Record payment</Btn>}
        <button type="button" className="admin-quiet" onClick={() => openPayment("")}>Payments and corrections</button>
      </div>
      {issueReview && <div className="billing-review">
        <p>Save an issued copy for {customer?.name || "this customer"} totaling {usd(total)}.</p>
        <div className="admin-action-row"><Btn disabled={busy} onClick={issue}>Save issued version</Btn>
          <Btn color="#67757d" onClick={() => setIssueReview(null)}>Cancel issue</Btn></div>
      </div>}
      {feedback && <p role="status">{feedback}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    <Card style={{marginBottom:16}}>
      <h3 style={{marginTop:0}}>Invoices</h3>
      <div className="admin-action-row invoice-choices">{invoices.map(i=><Btn key={i.id} color={i.id===invoiceId?undefined:"#7f8c8d"} disabled={busy} onClick={()=>{setSelected(i.id);setEditingItemId(null);setItem(emptyItem);setError("");setIssueReview(null);setLineChange(null);setPaymentAction("");}}>{i.name} · {usd(invoiceTotalFromLines(buildJobInvoiceLines(job,i.id)))}</Btn>)}</div>
      <Input label="New invoice name" value={name} onChange={setName} placeholder="e.g. Planning, First visit, Final balance" />
      <Btn onClick={addInvoice} disabled={busy}>Create invoice</Btn>
    </Card>
    {paymentsOpen && <InvoicePayments key={`${invoiceId}:${paymentAction}`} jobId={job.id} invoiceId={invoiceId} paid={paid} total={total} initialAction={paymentAction} />}
    <div className="billing-editor-grid">
    <Card style={{marginBottom:16}}>
      <h3 style={{marginTop:0}}>Preview · {invoice.name}</h3>
      <p>{customer?.name} · {job.title}</p>
      <p style={{fontSize:12}}>Invoice ID: {job.id}-{invoiceId}</p>
      {lines.length===0 && <p>No billable items assigned yet. Add an item below or assign an existing job item.</p>}
      {lines.map(line=><div key={line.key} style={{display:"flex",justifyContent:"space-between",gap:16,borderBottom:"1px solid #ddd",padding:"10px 0"}}>
        <span>{line.name}{line.comped && <strong> · Comped</strong>}</span>
        <span style={{textAlign:"right",whiteSpace:"nowrap"}}>{line.comped && <><del>{usd(line.originalAmountCents/100)}</del><br/></>}{usd(line.amountCents/100)}</span>
      </div>)}
      <p><strong>Invoice total: {usd(total)}</strong> · Paid: {usd(paid)} · Balance: {usd(Math.max(0,total-paid))}</p>
      <Btn onClick={() => download()} disabled={busy || !lines.length}>Download current preview</Btn>
    </Card>
    <Card style={{marginBottom:16}}>
      <h3 style={{marginTop:0}}>{editingItemId ? "Edit item on" : "Add item to"} {invoice.name}</h3>
      <label>Item type <select aria-label="Item type" value={item.kind} onChange={e=>setItem({...item,kind:e.target.value})}>
        <option value="labor">Labor hours</option><option value="expense">Expense / materials (actual cost)</option><option value="item">Other charge (no added cost)</option>
      </select></label>
      <Input label="Item description" value={item.name} onChange={v=>setItem({...item,name:v})}/>
      {item.kind==="labor" ? <><Input label="Item hours" type="number" value={item.hours} onChange={v=>setItem({...item,hours:v})}/><Input label="Item hourly rate" type="number" value={item.hourlyRate} onChange={v=>setItem({...item,hourlyRate:v})}/></> : <Input label="Item amount" type="number" value={item.amount} onChange={v=>setItem({...item,amount:v})}/>}
      {item.kind==="expense" && <><Input label="Expense paid date" type="date" value={item.datePaid || ""} onChange={v=>setItem({...item,datePaid:v})}/><label><input type="checkbox" checked={item.reimbursable} onChange={e=>setItem({...item,reimbursable:e.target.checked})}/>Reimbursable by customer</label></>}
      <label style={{display:"block",margin:"12px 0"}}><input type="checkbox" checked={!!item.comped} onChange={e=>setItem({...item,comped:e.target.checked})}/>Comped (show original value and charge $0)</label>
      <div className="admin-action-row">
      <Btn onClick={addItem} disabled={busy || !validItem}>{editingItemId ? "Save invoice item" : "Add invoice item"}</Btn>
      {editingItemId && <Btn disabled={busy} onClick={()=>{setEditingItemId(null);setItem(emptyItem);}}>Cancel item edit</Btn>}
      </div>
    </Card>
    </div>
    {versions.length > 0 && <details className="billing-review"><summary>Issued versions ({versions.length})</summary>
      {[...versions].reverse().map((snapshot, index) => <p key={snapshot.id}>
        <Btn disabled={busy} onClick={() => download(snapshot)}>Download version {versions.length - index} · {snapshot.issuedOn} · {usd(snapshot.total)}</Btn>
      </p>)}
    </details>}
    <Card style={{marginBottom:16}}>
      <h3 style={{marginTop:0}}>Assign and comp job items</h3>
      <p style={{fontSize:13}}>Each item belongs to one invoice. Non-reimbursable expenses appear on the customer invoice when comped. Work timer hours are included in the base Labor item.</p>
      {lineChange && <div className="billing-review" role="status">
        <p>{lineChange.line.name} · {lineChange.updates.invoiceId
          ? `Move ${usd(lineChange.line.amountCents / 100)} from ${invoices.find(row => row.id === lineChange.line.invoiceId)?.name} to ${invoices.find(row => row.id === lineChange.updates.invoiceId)?.name}. Existing payments stay on their invoices.`
          : `Customer charge ${usd(lineChange.line.amountCents / 100)} → ${usd(lineChange.updates.comped ? 0 : lineChange.line.originalAmountCents / 100)}. Original cost stays on the job.`}</p>
        <div className="admin-action-row"><Btn disabled={busy} onClick={confirmLineChange}>Apply line change</Btn>
          <Btn color="#67757d" onClick={() => setLineChange(null)}>Cancel line change</Btn></div>
      </div>}
      {allSources.map(line=><div key={line.key} style={{padding:"12px 0",borderBottom:"1px solid #ddd"}}>
        <div>{line.name} · Original value {usd(line.originalAmountCents/100)}{!line.billable && " · Not billed"}</div>
        {openCost && line.key.startsWith("expense:") && <button type="button" className="admin-quiet" onClick={() =>
          openCost("expenses", `expense-cost-${line.key.slice(8).replace(/^legacy-expense-/, "")}`)}>Open expense</button>}
        {openCost && line.key.startsWith("material:") && <button type="button" className="admin-quiet" onClick={() =>
          openCost("tasks", `task-cost-${line.key.split(":")[1].replace(/^legacy-task-/, "")}`)}>Open task materials</button>}
        {line.key.startsWith("item:") && job.invoiceItems?.some(row => `item:${row.id}` === line.key && row.kind === "expense" && !row.datePaid) && <p>Missing expense date</p>}
        {approvedOrder(line) && <p className="queue-meta">Approved change order</p>}
        <div className="invoice-line-controls">
          <select aria-label={`Invoice for ${line.name}`} value={line.invoiceId} disabled={busy || !!approvedOrder(line)} onChange={e=>override(line,{invoiceId:e.target.value})}>{invoices.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <label><input type="checkbox" aria-label={`Comp ${line.name}`} checked={line.comped} disabled={busy || !!approvedOrder(line)} onChange={e=>override(line,{comped:e.target.checked})}/>Comped</label>
          {line.key.startsWith("item:") && !approvedOrder(line) && <Btn small disabled={busy} onClick={()=>{const entry=job.invoiceItems.find(i=>`item:${i.id}`===line.key);setSelected(line.invoiceId);setItem({...emptyItem,...entry,comped:line.comped});setEditingItemId(entry.id);}}>Edit item</Btn>}
          {line.key.startsWith("item:") && !approvedOrder(line) && <Btn small danger disabled={busy} onClick={()=>run(()=>save({invoiceItems:job.invoiceItems.filter(i=>`item:${i.id}`!==line.key)}))}>Remove item</Btn>}
        </div>
      </div>)}
    </Card>
    <Card style={{marginBottom:16}}>
      <h3 style={{marginTop:0}}>Job totals</h3>
      <p>All invoices: <strong>{usd(jobTotal)}</strong> · Actual costs: <strong>{usd(cost)}</strong> · Profit: <strong>{usd(jobTotal-cost)}</strong></p>
      <p>Paid: {usd(job.amountPaid || 0)} · Balance: {usd(Math.max(0,jobTotal-(Number(job.amountPaid)||0)))}</p>
      <p style={{fontSize:13}}>Comping changes the customer's charge, while the original expense remains a job cost.</p>
    </Card>
  </div>;
}
