const VIEW_TO_SEGMENT = {
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
};

export function adminPathForView(view, param = null) {
  if (view === "customer/:id" && param) return `/admin/customers/${param}`;
  if (view === "job/:id" && param) return `/admin/jobs/${param}`;
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
  const [a, b] = parts;

  if (a === "customers" && b === "new") return { view: "newCustomer", param: null };
  if (a === "customers" && b) return { view: "customer/:id", param: b };
  if (a === "customers") return { view: "customers", param: null };

  if (a === "jobs" && b === "new") return { view: "newJob", param: null };
  if (a === "jobs" && b) return { view: "job/:id", param: b };
  if (a === "jobs") return { view: "jobs", param: null };

  if (a === "tools") return { view: "tools", param: null };
  if (a === "tasks") return { view: "tasks", param: null };
  if (a === "scheduling") return { view: "scheduling", param: null };
  if (a === "calendar") return { view: "calendar", param: null };

  return { view: "dashboard", param: null };
}
