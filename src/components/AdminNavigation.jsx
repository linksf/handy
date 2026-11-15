import { useEffect, useRef } from "react";
import { adminPathForView } from "../utils/adminRoutes";

const daily = [["dashboard", "Today"], ["calendar", "Calendar"], ["inbox", "Inbox"], ["jobs", "Jobs"], ["customers", "Customers"]];
const secondary = [["reports", "Reports"], ["tasks", "Tasks"], ["tools", "Tools"], ["scheduling", "Availability"]];
const parentViews = { "lead/:id": "inbox", "inquiry/:id": "inbox", "intake/:id": "inbox", leadRecord: "inbox", inquiryRecord: "inbox", leads: "inbox", inquiries: "inbox", "job/:id": "jobs", jobInvoice: "jobs", jobSection: "jobs", visitEditor: "jobs",
  newJob: "jobs", "customer/:id": "customers", newCustomer: "customers", "booking/:id": "scheduling" };

export default function AdminNavigation({ nav, view, focusSearch }) {
  const more = useRef(null);
  const active = parentViews[view] || view;
  useEffect(() => {
    const closeOutside = event => {
      if (!more.current?.contains(event.target)) more.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const link = ([destination, label]) => (
    <a key={destination} href={adminPathForView(destination)} aria-current={active === destination ? "page" : undefined}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        more.current?.removeAttribute("open");
        nav(destination);
      }}>{label}</a>
  );

  return <nav className="admin-destinations" aria-label="Admin">
    <div className="admin-daily-links">{daily.map(link)}<button type="button" onClick={focusSearch}>Search</button></div>
    <details ref={more} className="admin-more" onKeyDown={event => {
      if (event.key === "Escape" && event.currentTarget.open) {
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary").focus();
      }
    }}>
      <summary className={secondary.some(([destination]) => destination === active) ? "admin-more-active" : undefined}>More</summary>
      <div className="admin-more-links">{secondary.map(link)}</div>
    </details>
  </nav>;
}
