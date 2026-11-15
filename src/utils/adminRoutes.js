const VIEW_TO_SEGMENT = {
  inbox: "inbox",
  dashboard: "dashboard",
  customers: "customers",
  jobs: "jobs",
  newCustomer: "customers/new",
  newJob: "jobs/new",
  "customer/:id": "customers",
  "job/:id": "jobs",
  tools: "tools",
  tasks: "tasks",
  scheduling: "scheduling",
  calendar: "calendar",
  inquiries: "inquiries",
  leads: "leads",
  reports: "reports",
};

export function adminPathForView(view, param = null) {
  if (view === "newJob" && param?.source) return `/admin/jobs/new/from/${encodeURIComponent(param.source)}`;
  if (view === "newJob" && param?.customerId) return `/admin/jobs/new/customer/${encodeURIComponent(param.customerId)}`;
  if (view === "intake/:id" && param) return `/admin/inbox/${encodeURIComponent(param)}`;
  if (view === "leadRecord" && param) return `/admin/leads/${encodeURIComponent(param)}/record`;
  if (view === "inquiryRecord" && param) return `/admin/inquiries/${encodeURIComponent(param)}/record`;
  if (view === "visitEditor" && param) return `/admin/jobs/${encodeURIComponent(param[0])}/visits/${encodeURIComponent(param[1])}`;
  if (view === "jobSection" && param) return `/admin/jobs/${encodeURIComponent(param[0])}/review/${encodeURIComponent(param[1])}`;
  if (view === "jobInvoice" && param) {
    const [jobId, invoiceId, action] = param;
    return `/admin/jobs/${encodeURIComponent(jobId)}/invoices/${encodeURIComponent(invoiceId)}${action ? "/" + encodeURIComponent(action) : ""}`;
  }
  if (view === "inquiry/:id" && param) return `/admin/inquiries/${encodeURIComponent(param)}`;
  if (view === "booking/:id" && param) return `/admin/scheduling/requests/${encodeURIComponent(param)}`;
  if (view === "customer/:id" && param) return `/admin/customers/${encodeURIComponent(param)}`;
  if (view === "lead/:id" && param) return `/admin/leads/${encodeURIComponent(param)}`;
  if (view === "job/:id" && param) return `/admin/jobs/${encodeURIComponent(param)}`;
  const seg = VIEW_TO_SEGMENT[view];
  if (!seg) return "/admin/dashboard";
  return `/admin/${seg}`;
}

export function parseAdminPath(pathname) {
  let p = pathname.replace(/\/$/, "") || "/admin";
  if (p === "/admin") return { view: "dashboard", param: null };

  const rest = p.startsWith("/admin/") ? p.slice("/admin/".length) : p.replace(/^\/admin/, "").replace(/^\//, "");
  if (!rest || rest === "dashboard") return { view: "dashboard", param: null };

  const parts = rest.split("/").filter(Boolean);
  const [a, b, c, d, e] = parts;
  const decode = segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  };

  if (a === "customers" && b === "new") return { view: "newCustomer", param: null };
  if (a === "customers" && b) return { view: "customer/:id", param: decode(b) };
  if (a === "customers") return { view: "customers", param: null };

  if (a === "inbox") return { view: b ? "intake/:id" : "inbox", param: b ? decode(b) : null };
  if (a === "jobs" && b === "new" && d && (c === "customer" || c === "from")) {
    return { view: "newJob", param: c === "from" ? { source: decode(d) } : { customerId: decode(d) } };
  }
  if (a === "jobs" && b === "new") return { view: "newJob", param: null };
  if (a === "jobs" && b && c === "visits" && d) return { view: "visitEditor", param: [decode(b), decode(d)] };
  if (a === "jobs" && b && c === "review" && ["expenses","tasks","closeout","changes","parts","callbacks"].includes(d)) return { view: "jobSection", param: [decode(b), d] };
  if (a === "jobs" && b && c === "invoices" && d) return { view: "jobInvoice", param: [decode(b), decode(d), ...(["payment","refund","correction","legacy"].includes(e) ? [e] : [])] };
  if (a === "jobs" && b) return { view: "job/:id", param: decode(b) };
  if (a === "jobs") return { view: "jobs", param: null };

  if (a === "leads" && b && c === "record") return { view: "leadRecord", param: decode(b) };
  if (a === "leads") return {view: b ? "lead/:id" : "leads", param: b ? decode(b) : null};
  if (a === "reports") return {view: "reports", param: null};
  if (a === "tools") return { view: "tools", param: null };
  if (a === "tasks") return { view: "tasks", param: null };
  if (a === "scheduling" && b === "requests" && c) return { view: "booking/:id", param: decode(c) };
  if (a === "scheduling") return { view: "scheduling", param: null };
  if (a === "calendar") return { view: "calendar", param: null };
  if (a === "inquiries" && b && c === "record") return { view: "inquiryRecord", param: decode(b) };
  if (a === "inquiries" && b) return { view: "inquiry/:id", param: decode(b) };
  if (a === "inquiries") return { view: "inquiries", param: null };

  return { view: "dashboard", param: null };
}
