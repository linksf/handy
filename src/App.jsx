import { jobCostBreakdown as invoiceJobCosts, invoiceTotalFromLines, buildJobInvoiceLines } from "../shared/invoices.js";
import { hourlyLaborTotal } from "@handy/shared/finance";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "./hooks/useAuth";
import { useMobile } from "./hooks/useMobile";
import SignInScreen from "./components/SignInScreen";
import AdminNavigation from "./components/AdminNavigation";
import "./components/adminDaily.css";
import IntakeInbox from "./components/IntakeInbox";
import { intakeRows } from "./utils/intake";
import { saveIntakeAction, saveIntakeJob } from "./utils/intakeStore";
import Dashboard from "./components/Dashboard";
import Customers from "./components/Customers";
import {ensureTool} from "./utils/toolCatalogStore";
import {normalizeToolName} from "./utils/toolNames";
import GlobalSearch from "./components/GlobalSearch";
import NewCustomer from "./components/NewCustomer";
import CustomerDetail from "./components/CustomerDetail";
import Jobs from "./components/Jobs";
import NewJob from "./components/NewJob";
import { drainCaptures } from "./utils/captureQueue";
import { closeoutFor } from "./utils/closeout";
import VisitEditor from "./components/VisitEditor";
import JobDetail from "./components/JobDetail";
import ToolsManager from "./components/ToolsManager";
import TasksManager from "./components/TasksManager";
import SchedulingManager from "./components/SchedulingManager";
import CalendarAgenda from "./components/CalendarAgenda";
import Leads from "./components/Leads";
import FinancialReports from "./components/FinancialReports";
import {httpsCallable} from "firebase/functions";
import Inquiries from "./components/Inquiries";

import { RECOMMENDED_TOOLS } from "./toolCatalog";
import { ALLOWED_GOOGLE_EMAIL, APP_NAME } from "./constants";
import { adminPathForView, parseAdminPath } from "./utils/adminRoutes";
import { pacificDay } from "./utils/adminDates";
import { availabilityOverlapsBooking, findConflictingBooking } from "./utils/bookingConflicts";
import {
  deleteTaskCatalogEntry,
  jobTasksFromBookingRequestAsync,
  syncTaskCatalogEntry,
} from "./utils/taskCatalog";
import { db, functions } from "./firebase";
import { generateOpaqueCustomerId } from "@handy/shared";
import {
  collection,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
  orderBy,
  serverTimestamp,
  writeBatch,
  runTransaction,
} from "firebase/firestore";

function normalizePhoneDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

export default function App() {
  const { user, loading: authLoading, signInWithGoogle, signOut, authNotice, blockedFirebaseUser } = useAuth();
  const isMobile = useMobile();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const searchInput = useRef(null);
  const content = useRef(null);
  const focusContent = useRef(false);
  const [intake, setIntake] = useState({});
  const [intakeError, setIntakeError] = useState(false);
  const [intakeReady, setIntakeReady] = useState(false);
  const [leads, setLeads] = useState([]);
  const [leadReadError, setLeadReadError] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [archivedJobs, setArchivedJobs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tools, setTools] = useState([]);
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [taskDefs, setTaskDefs] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [bookingRequests, setBookingRequests] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [view, setView] = useState(() => parseAdminPath(window.location.pathname).view);
  const [viewParam, setViewParam] = useState(() => parseAdminPath(window.location.pathname).param);
  const [toast, setToast] = useState(null);

  // Real-time listeners (only while signed in — matches Firestore rules)
  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.status !== "archived"));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "jobs"), (snap) => {
      const records = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setJobs(records.filter(job => job.status !== "Archived"));
      setArchivedJobs(records.filter(job => job.status === "Archived"));
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setToolsLoaded(false);
      return;
    }
    return onSnapshot(collection(db, "tools"), (snap) => {
      setTools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setToolsLoaded(true);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "tasks"), (snap) => {
      setTaskDefs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  /** Backfill client-visible task names for templates created before taskCatalog existed. */
  const catalogSyncedRef = useRef(false);
  useEffect(() => {
    if (!user || !taskDefs.length || catalogSyncedRef.current) return;
    catalogSyncedRef.current = true;
    Promise.all(
      taskDefs.map((t) => syncTaskCatalogEntry(db, t.id, t.name))
    ).catch((err) => console.warn("taskCatalog sync", err));
  }, [user, taskDefs]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "availability"), orderBy("start", "asc"));
    return onSnapshot(q, (snap) => {
      setAvailability(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "bookingRequests"), orderBy("requestedStart", "desc"));
    return onSnapshot(q, (snap) => {
      setBookingRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "inquiries"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setInquiries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "leads"), snap => {
      setLeadReadError(false);
      setLeads(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }, error => {
      console.error("Admin leads subscription", error);
      setLeadReadError(true);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "adminIntake"), snap => {
      setIntakeError(false);
      setIntakeReady(true);
      setIntake(Object.fromEntries(snap.docs.map(d => [d.id, d.data()])));
    }, error => {
      console.error("Admin intake subscription", error);
      setIntakeError(true);
    });
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return;
    const sync = () => drainCaptures(user.uid).catch(error => console.warn("Capture sync queue", error));
    void sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [user?.uid]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountMenuOpen]);

  const nav = (destination, param = null) => {
    const path = adminPathForView(destination, param);
    if (window.location.pathname === path) {
      window.scrollTo(0, 0);
      content.current?.focus();
      return;
    }
    window.history.pushState({}, "", path);
    const parsed = parseAdminPath(path);
    focusContent.current = true;
    setView(parsed.view);
    setViewParam(parsed.param);
  };

  useEffect(() => {
    const onPop = () => {
      focusContent.current = true;
      const parsed = parseAdminPath(window.location.pathname);
      setView(parsed.view);
      setViewParam(parsed.param);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!user) return;
    const parsed = parseAdminPath(window.location.pathname);
    if (window.location.pathname === "/admin") {
      window.history.replaceState({}, "", adminPathForView("dashboard"));
    }
    setView(parsed.view);
    setViewParam(parsed.param);
  }, [user]);

  useEffect(() => {
    if (!focusContent.current) return;
    focusContent.current = false;
    window.scrollTo(0, 0);
    content.current?.focus();
  }, [view, viewParam]);

  // Derived
  const data = { customers, jobs };
  const getCustomer = (id) => customers.find(c => c.id === id);
  const getJob = (id) => jobs.find(j => j.id === id) || archivedJobs.find(j => j.id === id);
  const jobsForCustomer = (cid) => jobs.filter(j => j.customerId === cid);
  const getTool = (id) => tools.find(t => t.id === id);

  // Cost breakdown — materials + expenses, split by reimbursable
  const jobCostBreakdown = invoiceJobCosts;
  const jobCost = job => jobCostBreakdown(job).total;
  const jobRevenue = job => invoiceTotalFromLines(buildJobInvoiceLines(job));

  const closeAvailabilityForRange = async (startMs, endMs) => {
    const toClose = availability.filter(
      (row) => row.status === "open" && availabilityOverlapsBooking(row, startMs, endMs)
    );
    if (toClose.length === 0) return 0;
    const batch = writeBatch(db);
    for (const row of toClose) {
      batch.update(doc(db, "availability", row.id), {
        status: "closed",
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return toClose.length;
  };

  // Customer mutations
  const addCustomer = async (c) => {
    await setDoc(doc(db, "customers", generateOpaqueCustomerId()), c);
    showToast("Customer added!");
    nav("customers");
  };
  const updateCustomer = async (c) => {
    const { id, ...rest } = c;
    await updateDoc(doc(db, "customers", id), rest);
    showToast("Customer updated!");
  };
  const deleteCustomer = async (id) => {
    await deleteDoc(doc(db, "customers", id));
    const q = query(collection(db, "jobs"), where("customerId", "==", id));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    showToast("Customer deleted.");
    nav("customers");
  };

  // Job mutations
  const updateJob = async (j) => {
    const { id, ...rest } = j;
    const ref = doc(db, "jobs", id);
    const audited = ["customerId", "jobAddress", "siteContact", "payer", "estimate", "approvedPrice", "price", "date", "status", "expenses", "hourlyRate", "hours", "laborEntries", "tasks", "invoices", "invoiceItems", "invoiceOverrides", "closeout", "finalVisit", "archivedFromStatus"];
    if (audited.some(field => field in rest)) {
      await runTransaction(db, async transaction => {
        const before = (await transaction.get(ref)).data();
        if (!before) throw new Error("This job is no longer available.");
        if (rest.status === "Archived") {
          const { issues, openVisits } = closeoutFor(before);
          if (openVisits.length || (issues.length && (!before.closeout?.reason ||
            JSON.stringify(issues) !== JSON.stringify(before.closeout.issues)))) {
            throw new Error("Review current closeout items before archiving.");
          }
        }
        if (rest.finalVisit && closeoutFor(before).openVisits.length) throw new Error("Finish open visits first.");
        if (rest.closeout) {
          const { issues, openVisits } = closeoutFor(before);
          if (openVisits.length || JSON.stringify(issues) !== JSON.stringify(rest.closeout.issues) ||
            (issues.length && !rest.closeout.reason?.trim())) throw new Error("Closeout changed. Review the remaining items.");
        }
        const changes = audited.filter(field => field in rest && JSON.stringify(before[field]) !== JSON.stringify(rest[field]));
        transaction.update(ref, rest);
        if (changes.length) transaction.set(doc(ref, "adminHistory", crypto.randomUUID()), {
          at: serverTimestamp(), previous: Object.fromEntries(changes.map(field => [field, before[field] ?? null])),
          current: Object.fromEntries(changes.map(field => [field, rest[field] ?? null])),
        });
      });
    } else await updateDoc(ref, rest);
    showToast("Job saved!");
  };
  const deleteJob = async (id) => {
    await deleteDoc(doc(db, "jobs", id));
    showToast("Job deleted.");
    nav("jobs");
  };

  const deleteJobs = async (ids) => {
    const deleted = [];
    const uniqueIds = [...new Set(ids)];
    for (let i = 0; i < uniqueIds.length; i += 400) {
      const chunk = uniqueIds.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach(id => batch.delete(doc(db, "jobs", id)));
      try {
        await batch.commit();
        deleted.push(...chunk);
      } catch {
        return { deleted, failed: uniqueIds.slice(i) };
      }
    }
    showToast(`${deleted.length} jobs deleted.`);
    return { deleted, failed: [] };
  };

  // Tool mutations
  const addTool = async (name) => {
    const result = await ensureTool(db, name);
    showToast(result.created ? "Tool added!" : "That tool is already listed.");
  };
  const addToolsBulk = async (items, options = {}) => {
    const unique = new Map();
    for (const item of items || []) {
      const key = normalizeToolName(item?.name);
      if (key && !unique.has(key)) unique.set(key, item);
    }
    const results = await Promise.all([...unique.values()].map(t => ensureTool(db, t.name, t.category)));
    const added = results.filter(r => r.created).length;
    if (!options.silent) showToast(added ? `Added ${added} tool${added === 1 ? "" : "s"}!` : "No new tools to add. Already listed.");
    return added;
  };
  const updateTool = async (tool) => {
    const { id, ...rest } = tool;
    await updateDoc(doc(db, "tools", id), rest);
    showToast("Tool updated!");
  };
  const deleteTool = async (id) => {
    await deleteDoc(doc(db, "tools", id));
    // Remove this tool from all task definitions that reference it
    const affected = taskDefs.filter(t => (t.toolIds || []).includes(id));
    await Promise.all(affected.map(t =>
      updateDoc(doc(db, "tasks", t.id), { toolIds: t.toolIds.filter(tid => tid !== id) })
    ));
    showToast("Tool deleted.");
  };

  const seededToolDefaultsByUid = useRef({});
  useEffect(() => {
    if (!user || !toolsLoaded) return;
    const normalizedEmail = String(user.email || "").trim().toLowerCase();
    const adminEmail = String(ALLOWED_GOOGLE_EMAIL || "").trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail !== adminEmail) return;
    if (seededToolDefaultsByUid.current[user.uid]) return;
    if (tools.length > 0) {
      seededToolDefaultsByUid.current[user.uid] = true;
      return;
    }
    seededToolDefaultsByUid.current[user.uid] = true;
    (async () => {
      const inserted = await addToolsBulk(RECOMMENDED_TOOLS, { silent: true });
      if (inserted > 0) {
        showToast("Starter tools added.");
      }
    })();
  }, [user, toolsLoaded, tools.length]);

  // Task definition mutations
  const addTaskDef = async (name) => {
    const ref = await addDoc(collection(db, "tasks"), { name, toolIds: [] });
    await syncTaskCatalogEntry(db, ref.id, name);
    showToast("Task added!");
  };
  const updateTaskDef = async (t) => {
    const { id, ...rest } = t;
    await updateDoc(doc(db, "tasks", id), rest);
    if (rest.name != null) await syncTaskCatalogEntry(db, id, rest.name);
  };
  const deleteTaskDef = async (id) => {
    await deleteDoc(doc(db, "tasks", id));
    await deleteTaskCatalogEntry(db, id);
    showToast("Task deleted.");
  };

  /** Customer + job + link on booking request. Returns job id or null. */
  const createJobFromBookingRequest = async (request, { navigate = true } = {}) => {
    if (!request?.id) return null;
    if (request.linkedJobId) {
      if (navigate) {
        showToast("Already linked to a job.");
        nav("job/:id", request.linkedJobId);
      }
      return request.linkedJobId;
    }
    if (request.status === "declined") {
      showToast("Cannot create a job from a declined request.");
      return null;
    }
    const reqStart = request.requestedStart?.toMillis?.() || 0;
    const reqEnd = request.requestedEnd?.toMillis?.() || 0;
    const conflict = findConflictingBooking(bookingRequests, reqStart, reqEnd, { excludeId: request.id });
    if (conflict) {
      showToast("Another booking overlaps this time. Decline or resolve it first.");
      return null;
    }
    if (request.sourceThumbtackLeadId) {
      try {
        const result = await httpsCallable(functions, "approveLeadBooking")({requestId: request.id});
        await closeAvailabilityForRange(reqStart, reqEnd);
        showToast("Job scheduled. Calendar synchronization is queued.");
        if (navigate) nav("job/:id", result.data.jobId);
        return result.data.jobId;
      } catch (e) { showToast(e.message || "Unable to approve booking."); return null; }
    }
    const nPhone = normalizePhoneDigits(request.phone);
    let customerId = null;
    const draftJobId = (request.draftJobId || "").trim();
    const draftJob = draftJobId ? jobs.find((j) => j.id === draftJobId) : null;

    if (draftJob) {
      customerId = draftJob.customerId;
      const start = request.requestedStart?.toDate?.() || new Date();
      const dateStr = pacificDay(start);
      const bookingTasks = await jobTasksFromBookingRequestAsync(db, request);
      const mergedNotes = [draftJob.notes, (request.notes || "").trim()]
        .filter(Boolean)
        .join("\n\n");
      await updateDoc(doc(db, "jobs", draftJob.id), {
        title: (request.title || draftJob.title || "").trim() || "Booking",
        date: dateStr,
        status: "Scheduled",
        notes: mergedNotes,
        tasks: bookingTasks.length > 0 ? bookingTasks : (draftJob.tasks || []),
        sourceBookingRequestId: request.id,
        bookingClientUid: request.clientUid || "",
      });
      if (customerId) {
        const custPatch = {
          status: "active",
          clientUid: request.clientUid || null,
        };
        const cn = (request.clientName || "").trim();
        const cp = (request.phone || "").trim();
        const ca = (request.location || "").trim();
        if (cn) custPatch.name = cn;
        if (cp) custPatch.phone = cp;
        if (ca) custPatch.address = ca;
        await updateDoc(doc(db, "customers", customerId), custPatch);
      }
      await updateDoc(doc(db, "bookingRequests", request.id), {
        linkedJobId: draftJob.id,
        status: "approved",
        updatedAt: serverTimestamp(),
      });
      const closed = await closeAvailabilityForRange(reqStart, reqEnd);
      showToast(
        closed > 0
          ? `Draft job scheduled; ${closed} slot${closed === 1 ? "" : "s"} closed.`
          : "Draft job scheduled from Thumbtack lead."
      );
      if (navigate) nav("job/:id", draftJob.id);
      return draftJob.id;
    }

    if (nPhone.length >= 10) {
      const match = customers.find((c) => normalizePhoneDigits(c.phone) === nPhone);
      if (match) customerId = match.id;
    }
    const displayName = (request.clientName || "").trim() || "Client";
    if (!customerId) {
      customerId = generateOpaqueCustomerId();
      await setDoc(doc(db, "customers", customerId), {
        name: displayName,
        phone: (request.phone || "").trim(),
        email: "",
        address: (request.location || "").trim(),
        notes: ["From booking request", request.id, request.clientUid ? `uid ${request.clientUid}` : ""]
          .filter(Boolean)
          .join(" · "),
      });
    }
    const start = request.requestedStart?.toDate?.() || new Date();
    const dateStr = pacificDay(start);
    const bookingTasks = await jobTasksFromBookingRequestAsync(db, request);
    const jobRef = await addDoc(collection(db, "jobs"), {
      title: (request.title || "").trim() || "Booking",
      customerId,
      date: dateStr,
      status: "Scheduled",
      price: "",
      hourlyRate: "",
      hours: "",
      notes: (request.notes || "").trim(),
      tasks: bookingTasks,
      payStatus: "Unpaid",
      amountPaid: 0,
      sourceBookingRequestId: request.id,
      bookingClientUid: request.clientUid || "",
    });
    await updateDoc(doc(db, "bookingRequests", request.id), {
      linkedJobId: jobRef.id,
      status: "approved",
      updatedAt: serverTimestamp(),
    });
    const closed = await closeAvailabilityForRange(reqStart, reqEnd);
    const taskNote =
      bookingTasks.length > 0 ? ` ${bookingTasks.length} task${bookingTasks.length === 1 ? "" : "s"} added.` : "";
    showToast(
      closed > 0
        ? `Job created; ${closed} slot${closed === 1 ? "" : "s"} closed.${taskNote}`
        : `Job created from booking.${taskNote}`
    );
    if (navigate) nav("job/:id", jobRef.id);
    return jobRef.id;
  };

  const approveBookingRequest = async (request) => {
    if (!request?.id) return false;
    if (request.linkedJobId) return true;
    const jobId = await createJobFromBookingRequest(request, { navigate: false });
    return !!jobId;
  };

  const markInquiryReviewed = async (id) => {
    await updateDoc(doc(db, "inquiries", id), {
      status: "reviewed",
      updatedAt: serverTimestamp(),
    });
    showToast("Inquiry marked reviewed.");
  };

  const pages = {
    dashboard: Dashboard,
    inbox: IntakeInbox,
    "intake/:id": IntakeInbox,
    leadRecord: Leads,
    inquiryRecord: Inquiries,
    customers: Customers,
    jobs: Jobs,
    newCustomer: NewCustomer,
    newJob: NewJob,
    "customer/:id": CustomerDetail,
    "job/:id": JobDetail,
    jobInvoice: JobDetail,
    jobSection: JobDetail,
    visitEditor: VisitEditor,
    tools: ToolsManager,
    tasks: TasksManager,
    scheduling: SchedulingManager,
    calendar: CalendarAgenda,
    inquiries: Inquiries,
    "inquiry/:id": IntakeInbox,
    "booking/:id": SchedulingManager,
    leads: Leads,
    "lead/:id": IntakeInbox,
    reports: FinancialReports,
  };
  const Page = pages[view] || Dashboard;

  const sourceParam = view === "lead/:id" ? `lead:${viewParam}` : view === "inquiry/:id" ? `inquiry:${viewParam}` : viewParam;
  const ctx = {
    intake, intakeReady, archivedJobs, captureOwner: user?.uid,
    intakeRows: intakeRows({ leads, inquiries, jobs, customers, intake }),
    applyIntake: (...args) => saveIntakeAction(db, ...args),
    saveQuickJob: values => saveIntakeJob(db, values),
    data, nav, viewParam: sourceParam, view, leads,
    getCustomer, getJob, jobsForCustomer, jobCost, jobCostBreakdown, jobRevenue, getTool,
    addCustomer, updateCustomer, deleteCustomer,
    updateJob, deleteJob, deleteJobs,
    tools, taskDefs,
    addTool, addToolsBulk, updateTool, deleteTool,
    addTaskDef, updateTaskDef, deleteTaskDef,
    availability, bookingRequests, customers, inquiries,
    markInquiryReviewed,
    createJobFromBookingRequest,
    approveBookingRequest,
    showToast,
  };

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ecf0f1",
          fontFamily: "'Futura', 'Trebuchet MS', 'Century Gothic', sans-serif",
          color: "#232323",
          fontSize: 15,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <SignInScreen
        onSignIn={signInWithGoogle}
        notice={authNotice}
        blockedFirebaseUser={blockedFirebaseUser}
        onSignOut={signOut}
      />
    );
  }

  const accountMenuDropdown = accountMenuOpen && (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: "100%",
        marginTop: 8,
        minWidth: 220,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 3000,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #ecf0f1", maxWidth: 280 }}>
        <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 4 }}>Signed in</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#232323", wordBreak: "break-word" }}>
          {user.displayName || user.email || "—"}
        </div>
        {user.email && user.displayName && (
          <div style={{ fontSize: 12, color: "#555", marginTop: 6, wordBreak: "break-all" }}>{user.email}</div>
        )}
      </div>
      <button type="button" className="admin-quiet" onClick={() => {
        setAccountMenuOpen(false);
        const settings = document.getElementById("handy-device-settings");
        if (settings) { settings.open = true; settings.scrollIntoView({ block: "start" }); settings.querySelector("summary")?.focus(); }
      }}>Install and device settings</button>
      <button
        type="button"
        onClick={() => {
          setAccountMenuOpen(false);
          signOut();
        }}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          border: "none",
          background: "#fff",
          fontSize: 14,
          fontWeight: 600,
          color: "#c0392b",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Sign out
      </button>
    </div>
  );

  const accountButton = (
    <button
      type="button"
      aria-label={accountMenuOpen ? "Close account menu" : "Open account menu"}
      aria-expanded={accountMenuOpen}
      onClick={() => setAccountMenuOpen((o) => !o)}
      style={{
        background: "#f9bf3b",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 5,
        padding: "0 12px",
        fontWeight: 700,
        height: 44,
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      Account
    </button>
  );

  return (
    <div className="handy-admin" style={{ fontFamily: "'Futura', 'Trebuchet MS', 'Century Gothic', sans-serif", minHeight: "100vh", background: "#ecf0f1", color: "#232323" }}>
      <header className="admin-header">
        <div className="admin-header-inner">
          <a className="admin-brand" href="/admin/dashboard" onClick={event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            nav("dashboard");
          }}>{APP_NAME}</a>
          <AdminNavigation view={view} nav={nav} focusSearch={() => searchInput.current?.focus()} />
          <div ref={accountMenuRef} className="admin-account">
            {accountButton}
            {accountMenuDropdown}
          </div>
        </div>
      </header>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: isMobile ? "16px 12px" : "24px 16px" }}>
        <GlobalSearch customers={customers} jobs={jobs} leads={leads} inquiries={inquiries} nav={nav}
          locationKey={window.location.pathname} inputRef={searchInput} />
        <main ref={content} tabIndex={-1} aria-label="Page content">
          {intakeError && <p role="alert">Inbox changes could not be loaded. Reload to retry.</p>}
          {leadReadError && <p role="alert">Leads could not be refreshed. Reload to retry.</p>}
          <Page key={window.location.pathname} ctx={ctx} />
        </main>
      </div>
      {toast && (
        <div role="status" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#232323", color: "#ecf0f1", padding: "10px 24px", borderRadius: 8, fontSize: 14, zIndex: 999, whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
