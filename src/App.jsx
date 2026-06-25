import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "./hooks/useAuth";
import { useMobile } from "./hooks/useMobile";
import SignInScreen from "./components/SignInScreen";
import NavIcon from "./components/ui/NavIcon";
import Dashboard from "./components/Dashboard";
import Customers from "./components/Customers";
import NewCustomer from "./components/NewCustomer";
import CustomerDetail from "./components/CustomerDetail";
import Jobs from "./components/Jobs";
import NewJob from "./components/NewJob";
import JobDetail from "./components/JobDetail";
import ToolsManager from "./components/ToolsManager";
import TasksManager from "./components/TasksManager";
import SchedulingManager from "./components/SchedulingManager";
import CalendarAgenda from "./components/CalendarAgenda";
import NavBadge from "./components/ui/NavBadge";
import { RECOMMENDED_TOOLS } from "./toolCatalog";
import { ALLOWED_GOOGLE_EMAIL } from "./constants";
import { adminPathForView, parseAdminPath } from "./utils/adminRoutes";
import { availabilityOverlapsBooking, findConflictingBooking } from "./utils/bookingConflicts";
import {
  deleteTaskCatalogEntry,
  jobTasksFromBookingRequestAsync,
  syncTaskCatalogEntry,
} from "./utils/taskCatalog";
import { db } from "./firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

function normalizePhoneDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

export default function App() {
  const { user, loading: authLoading, signInWithGoogle, signOut, authNotice, blockedFirebaseUser } = useAuth();
  const isMobile = useMobile();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [customers, setCustomers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tools, setTools] = useState([]);
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [taskDefs, setTaskDefs] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [bookingRequests, setBookingRequests] = useState([]);
  const [view, setView] = useState(() => parseAdminPath(window.location.pathname).view);
  const [viewParam, setViewParam] = useState(() => parseAdminPath(window.location.pathname).param);
  const [toast, setToast] = useState(null);

  // Real-time listeners (only while signed in — matches Firestore rules)
  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "jobs"), (snap) => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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

  const nav = (v, p = null) => {
    setView(v);
    setViewParam(p);
    const path = adminPathForView(v, p);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  };

  useEffect(() => {
    const onPop = () => {
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

  // Derived
  const data = { customers, jobs };
  const getCustomer = (id) => customers.find(c => c.id === id);
  const getJob = (id) => jobs.find(j => j.id === id);
  const jobsForCustomer = (cid) => jobs.filter(j => j.customerId === cid);
  const getTool = (id) => tools.find(t => t.id === id);

  // Cost breakdown — materials + expenses, split by reimbursable
  const jobCostBreakdown = (job) => {
    let reimbursable = 0, nonReimbursable = 0;
    (job.tasks || []).forEach(t => {
      (t.materials || []).forEach(m => {
        const c = (parseFloat(m.cost) || 0) * (parseFloat(m.qty) || 1);
        if (m.reimbursable) reimbursable += c;
        else nonReimbursable += c;
      });
    });
    (job.expenses || []).forEach(e => {
      const amt = parseFloat(e.amount) || 0;
      if (e.reimbursable) reimbursable += amt;
      else nonReimbursable += amt;
    });
    return { reimbursable, nonReimbursable, total: reimbursable + nonReimbursable };
  };
  const jobCost = (job) => jobCostBreakdown(job).total;

  // Revenue = flat rate + (hourly rate × hours)
  const jobRevenue = (job) =>
    (parseFloat(job.price) || 0) +
    (parseFloat(job.hourlyRate) || 0) * (parseFloat(job.hours) || 0);

  const upcomingJobs = useMemo(() =>
    jobs
      .filter(j => j.status === "Scheduled" || j.status === "In Progress")
      .sort((a, b) => new Date(a.date) - new Date(b.date)),
    [jobs]);

  const totalRevenue = useMemo(() =>
    jobs.filter(j => j.status === "Complete").reduce((s, j) => s + jobRevenue(j), 0),
    [jobs]);

  const totalCost = useMemo(() =>
    jobs.filter(j => j.status === "Complete").reduce((s, j) => s + jobCost(j), 0),
    [jobs]);

  const pendingBookingCount = useMemo(
    () => bookingRequests.filter((r) => r.status === "pending").length,
    [bookingRequests]
  );

  const pendingBookings = useMemo(
    () =>
      bookingRequests
        .filter((r) => r.status === "pending")
        .sort((a, b) => (a.requestedStart?.toMillis?.() || 0) - (b.requestedStart?.toMillis?.() || 0)),
    [bookingRequests]
  );

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
    await addDoc(collection(db, "customers"), c);
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
  const addJob = async (j) => {
    const { tasks: jobTasks, ...rest } = j;
    await addDoc(collection(db, "jobs"), {
      ...rest,
      tasks: Array.isArray(jobTasks) ? jobTasks : [],
      payStatus: "Unpaid",
      amountPaid: 0,
    });
    showToast("Job created!");
    nav("jobs");
  };
  const updateJob = async (j) => {
    const { id, ...rest } = j;
    await updateDoc(doc(db, "jobs", id), rest);
    showToast("Job saved!");
  };
  const deleteJob = async (id) => {
    await deleteDoc(doc(db, "jobs", id));
    showToast("Job deleted.");
    nav("jobs");
  };

  // Tool mutations
  const addTool = async (name) => {
    await addDoc(collection(db, "tools"), { name, category: "" });
    showToast("Tool added!");
  };
  const addToolWithCategory = async (name, category = "") => {
    await addDoc(collection(db, "tools"), { name, category });
  };
  const addToolsBulk = async (items, options = {}) => {
    const { silent = false } = options;
    const normalizedExisting = new Set(
      tools.map((t) => (t.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const uniqueIncoming = [];
    const seenIncoming = new Set();
    (items || []).forEach((item) => {
      const name = (item?.name || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (normalizedExisting.has(key) || seenIncoming.has(key)) return;
      seenIncoming.add(key);
      uniqueIncoming.push({ name, category: (item?.category || "").trim() });
    });
    if (uniqueIncoming.length === 0) {
      if (!silent) showToast("No new tools to add.");
      return 0;
    }
    await Promise.all(uniqueIncoming.map((t) => addToolWithCategory(t.name, t.category)));
    if (!silent) {
      showToast(`Added ${uniqueIncoming.length} tool${uniqueIncoming.length === 1 ? "" : "s"}!`);
    }
    return uniqueIncoming.length;
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
    const nPhone = normalizePhoneDigits(request.phone);
    let customerId = null;
    const draftJobId = (request.draftJobId || "").trim();
    const draftJob = draftJobId ? jobs.find((j) => j.id === draftJobId) : null;

    if (draftJob) {
      customerId = draftJob.customerId;
      const start = request.requestedStart?.toDate?.() || new Date();
      const dateStr = start.toISOString().slice(0, 10);
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
      const ref = await addDoc(collection(db, "customers"), {
        name: displayName,
        phone: (request.phone || "").trim(),
        email: "",
        address: (request.location || "").trim(),
        notes: ["From booking request", request.id, request.clientUid ? `uid ${request.clientUid}` : ""]
          .filter(Boolean)
          .join(" · "),
      });
      customerId = ref.id;
    }
    const start = request.requestedStart?.toDate?.() || new Date();
    const dateStr = start.toISOString().slice(0, 10);
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

  const pages = {
    dashboard: Dashboard,
    customers: Customers,
    jobs: Jobs,
    newCustomer: NewCustomer,
    newJob: NewJob,
    "customer/:id": CustomerDetail,
    "job/:id": JobDetail,
    tools: ToolsManager,
    tasks: TasksManager,
    scheduling: SchedulingManager,
    calendar: CalendarAgenda,
  };
  const Page = pages[view] || Dashboard;

  const ctx = {
    data, nav, viewParam,
    getCustomer, getJob, jobsForCustomer, jobCost, jobCostBreakdown, jobRevenue, getTool,
    addCustomer, updateCustomer, deleteCustomer,
    addJob, updateJob, deleteJob,
    tools, taskDefs,
    addTool, addToolsBulk, updateTool, deleteTool,
    addTaskDef, updateTaskDef, deleteTaskDef,
    upcomingJobs, totalRevenue, totalCost,
    availability, bookingRequests,
    customers,
    pendingBookingCount,
    pendingBookings,
    createJobFromBookingRequest,
    approveBookingRequest,
    showToast,
  };

  const navItems = [
    ["dashboard", "Dashboard"],
    ["calendar", "Calendar"],
    ["customers", "Customers"],
    ["jobs", "Jobs"],
    ["tasks", "Tasks"],
    ["tools", "Tools"],
    ["scheduling", "Schedule"],
  ];

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

  const navIconButtons = (
    <>
      {navItems.map(([v, l]) => {
        const active = view === v;
        const badge = v === "scheduling" ? pendingBookingCount : 0;
        return (
          <button
            key={v}
            title={l}
            aria-label={badge ? `${l} (${badge} pending)` : l}
            type="button"
            onClick={() => nav(v)}
            style={{
              background: active ? "#f9bf3b" : "transparent",
              border: "none",
              padding: isMobile ? "12px 14px" : "12px 14px",
              cursor: "pointer",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              position: "relative",
            }}
          >
            <NavIcon name={v} color={active ? "#232323" : "#ecf0f1"} />
            <NavBadge count={badge} />
          </button>
        );
      })}
    </>
  );

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

  const hamburgerButton = (
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
        width: 44,
        height: 44,
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <span style={{ display: "block", width: 20, height: 3, background: "#232323", borderRadius: 1 }} />
      <span style={{ display: "block", width: 20, height: 3, background: "#232323", borderRadius: 1 }} />
      <span style={{ display: "block", width: 20, height: 3, background: "#232323", borderRadius: 1 }} />
    </button>
  );

  return (
    <div style={{ fontFamily: "'Futura', 'Trebuchet MS', 'Century Gothic', sans-serif", minHeight: "100vh", background: "#ecf0f1", color: "#232323" }}>
      <nav
        style={{
          background: "#232323",
          color: "#ecf0f1",
          padding: isMobile ? "10px 12px" : "0 12px",
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 10 : 8,
          flexWrap: "nowrap",
        }}
      >
        {isMobile ? (
          <>
            <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 10, minHeight: 44 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: "pointer",
                  padding: "6px 0",
                  color: "#ecf0f1",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                onClick={() => nav("dashboard")}
              >
                Handy
              </span>
              <div ref={accountMenuRef} style={{ position: "relative", flexShrink: 0 }}>
                {hamburgerButton}
                {accountMenuDropdown}
              </div>
            </div>
            <div
              className="nav-scroll"
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-evenly",
                overflowX: "auto",
                overflowY: "hidden",
                width: "100%",
                WebkitOverflowScrolling: "touch",
                borderTop: "1px solid rgba(255,255,255,0.2)",
                paddingTop: 8,
                marginTop: 2,
                gap: 0,
              }}
            >
              {navIconButtons}
            </div>
          </>
        ) : (
          <>
            <span
              style={{
                fontWeight: 700,
                fontSize: 17,
                marginRight: 8,
                cursor: "pointer",
                padding: "14px 8px",
                whiteSpace: "nowrap",
                color: "#ecf0f1",
                flexShrink: 0,
              }}
              onClick={() => nav("dashboard")}
            >
              Handy
            </span>
            <div
              className="nav-scroll"
              style={{
                display: "flex",
                flex: 1,
                minWidth: 0,
                alignItems: "center",
                justifyContent: "space-evenly",
                overflowX: "auto",
                overflowY: "hidden",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {navIconButtons}
            </div>
            <div ref={accountMenuRef} style={{ flexShrink: 0, position: "relative", padding: "8px 0" }}>
              {hamburgerButton}
              {accountMenuDropdown}
            </div>
          </>
        )}
      </nav>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: isMobile ? "16px 12px" : "24px 16px" }}>
        <Page ctx={ctx} />
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#232323", color: "#ecf0f1", padding: "10px 24px", borderRadius: 8, fontSize: 14, zIndex: 999, whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
