import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminLocalState } from "../hooks/useAdminLocalState";

const normalize = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const digits = value => String(value ?? "").replace(/\D/g, "");
const resultKey = result => `${result.type}:${result.id}`;
const detail = (...values) => values.filter(Boolean).join(" · ");
const contactFields = row => [row?.name, row?.phone, row?.email, row?.address];
const empty = [];

function indexRecords(customers, jobs, leads, inquiries) {
  const byId = new Map(customers.map(customer => [customer.id, customer]));
  return [
    ...customers.map(c => ({
      id: c.id, type: "Customer", title: c.name || "Unnamed customer", status: c.status || "Active",
      detail: detail(c.address, c.phone, c.email), view: "customer/:id",
      fields: contactFields(c), phones: [c.phone],
    })),
    ...jobs.map(j => {
      const customer = byId.get(j.customerId);
      return {
        id: j.id, type: "Job", title: j.title || "Untitled job", status: j.status, view: "job/:id",
        detail: detail(j.jobAddress || customer?.address, customer?.name, j.date),
        fields: [j.title, j.date, j.status, j.jobAddress, j.notes, j.aiSummary, ...contactFields(customer)],
        phones: [customer?.phone], directAddress: j.jobAddress,
      };
    }),
    ...leads.map(lead => {
      const customer = byId.get(lead.customerId);
      const address = lead.assessment?.address || lead.address;
      return {
        id: lead.id, type: "Lead", title: lead.name || lead.title || "Unnamed lead", status: lead.status,
        detail: detail(lead.name && lead.title, address || customer?.address, lead.phone),
        view: "lead/:id", fields: [...contactFields(lead), address, lead.title, lead.status, ...contactFields(customer)],
        phones: [lead.phone, customer?.phone], directAddress: address,
      };
    }),
    ...inquiries.map(inquiry => ({
      id: inquiry.id, type: "Inquiry", title: inquiry.name || "Guest inquiry", status: inquiry.status,
      detail: detail(inquiry.address, inquiry.category, inquiry.email), view: "inquiry/:id",
      fields: [...contactFields(inquiry), inquiry.description, inquiry.status], phones: [inquiry.phone],
      directAddress: inquiry.address,
    })),
  ];
}

function matchRecords(records, query) {
  const q = normalize(query).trim();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const addressQuery = /^\d+\s+\S/.test(q);
  const score = row => Number(normalize(row.title).startsWith(q)) * 2
    + Number(addressQuery && normalize(row.directAddress).includes(q));
  return records.filter(row => {
    const text = normalize(row.fields.filter(Boolean).join(" "));
    return terms.every(term => text.includes(term) ||
      (/^[\d()+.\-]+$/.test(term) && digits(term).length >= 3 && row.phones.some(phone => digits(phone).includes(digits(term)))));
  }).sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title));
}

export function findSearchResults(customers, jobs, query, leads = [], inquiries = []) {
  return matchRecords(indexRecords(customers, jobs, leads, inquiries), query);
}

export default function GlobalSearch({ customers, jobs, leads = empty, inquiries = empty, nav, locationKey, inputRef }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useAdminLocalState("recent-search", []);
  const root = useRef(null);
  const internalInput = useRef(null);
  const input = inputRef || internalInput;
  const indexed = useMemo(() => indexRecords(customers, jobs, leads, inquiries), [customers, jobs, leads, inquiries]);
  const hasQuery = !!query.trim();
  const results = useMemo(() => {
    if (hasQuery) return matchRecords(indexed, query);
    const byKey = new Map(indexed.map(row => [resultKey(row), row]));
    return recent.map(key => byKey.get(key)).filter(Boolean);
  }, [indexed, hasQuery, query, recent]);
  useEffect(() => { setOpen(false); setQuery(""); setActive(-1); }, [locationKey]);
  useEffect(() => {
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const shortcut = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", shortcut);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", shortcut);
    };
  }, [input]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`handy-search-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const choose = result => {
    const key = resultKey(result);
    setRecent(previous => [key, ...previous.filter(value => value !== key)].slice(0, 6));
    setOpen(false);
    setQuery("");
    setActive(-1);
    nav(result.view, result.id);
  };

  return <div ref={root} className="admin-search" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
  }}>
    <div className="admin-search-field">
      <span aria-hidden="true">⌕</span>
      <input ref={input} role="combobox" aria-label="Search records and addresses" aria-expanded={open}
        aria-controls={open ? "handy-search-results" : undefined} aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `handy-search-${active}` : undefined}
        placeholder="Search jobs, leads, contacts or addresses" value={query}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "Escape") { setOpen(false); setActive(-1); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive(index => results.length ? (index < 0 && step < 0 ? results.length - 1
              : (index + step + results.length) % results.length) : -1);
          }
          if (event.key === "Enter" && open && results.length && !event.nativeEvent.isComposing) {
            event.preventDefault();
            choose(results[active] || results[0]);
          }
        }} />
      {query && <button type="button" className="admin-quiet" aria-label="Clear search"
        onClick={() => { setQuery(""); setOpen(true); setActive(-1); input.current?.focus(); }}>×</button>}
    </div>
    {open && <div className="admin-search-popup">
      <div role="status" className="admin-search-count">{hasQuery
        ? results.length ? `${results.length} matching records` : "No matching records."
        : results.length ? "Recent matches" : "No recent matches."}</div>
      <div id="handy-search-results" role="listbox" aria-label={hasQuery ? "Search results" : "Recent matches"}>
        {results.map((result, index) => (
          <div key={resultKey(result)} id={`handy-search-${index}`} role="option" aria-selected={active === index}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(result)}
            className="admin-search-option">
            <span className="admin-status">{[result.type, result.status].filter(Boolean).join(" · ")}</span>
            <strong>{result.title}</strong>
            {result.detail && <span className="queue-meta">{result.detail}</span>}
          </div>
        ))}
      </div>
    </div>}
  </div>;
}
