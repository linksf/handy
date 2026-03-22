import { useState, useEffect, useMemo } from "react";
import { useMobile } from "./hooks/useMobile";
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
} from "firebase/firestore";

export default function App() {
  const isMobile = useMobile();
  const [customers, setCustomers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tools, setTools] = useState([]);
  const [taskDefs, setTaskDefs] = useState([]);
  const [view, setView] = useState("dashboard");
  const [viewParam, setViewParam] = useState(null);
  const [toast, setToast] = useState(null);

  // Real-time listeners
  useEffect(() => {
    return onSnapshot(collection(db, "customers"), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "jobs"), (snap) => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "tools"), (snap) => {
      setTools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "tasks"), (snap) => {
      setTaskDefs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const nav = (v, p = null) => { setView(v); setViewParam(p); };

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
    await addDoc(collection(db, "jobs"), { ...j, tasks: [], payStatus: "Unpaid", amountPaid: 0 });
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
    await addDoc(collection(db, "tools"), { name });
    showToast("Tool added!");
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

  // Task definition mutations
  const addTaskDef = async (name) => {
    await addDoc(collection(db, "tasks"), { name, toolIds: [] });
    showToast("Task added!");
  };
  const updateTaskDef = async (t) => {
    const { id, ...rest } = t;
    await updateDoc(doc(db, "tasks", id), rest);
  };
  const deleteTaskDef = async (id) => {
    await deleteDoc(doc(db, "tasks", id));
    showToast("Task deleted.");
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
  };
  const Page = pages[view] || Dashboard;

  const ctx = {
    data, nav, viewParam,
    getCustomer, getJob, jobsForCustomer, jobCost, jobCostBreakdown, jobRevenue, getTool,
    addCustomer, updateCustomer, deleteCustomer,
    addJob, updateJob, deleteJob,
    tools, taskDefs,
    addTool, deleteTool,
    addTaskDef, updateTaskDef, deleteTaskDef,
    upcomingJobs, totalRevenue, totalCost,
    showToast,
  };

  const navItems = [
    ["dashboard", "Dashboard"],
    ["customers", "Customers"],
    ["jobs", "Jobs"],
    ["tasks", "Tasks"],
    ["tools", "Tools"],
  ];

  return (
    <div style={{ fontFamily: "'Futura', 'Trebuchet MS', 'Century Gothic', sans-serif", minHeight: "100vh", background: "#ecf0f1", color: "#232323" }}>
      <nav style={{ background: "#232323", color: "#ecf0f1", padding: "0 12px", display: "flex", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: 17, marginRight: 8, cursor: "pointer", padding: "14px 8px", whiteSpace: "nowrap", color: "#ecf0f1", flexShrink: 0 }} onClick={() => nav("dashboard")}>Omnificology</span>
        <div style={{ display: "flex", flexShrink: 0 }}>
          {navItems.map(([v, l]) => {
            const active = view === v;
            return (
              <button key={v} title={l} onClick={() => nav(v)} style={{ background: active ? "#f9bf3b" : "transparent", border: "none", padding: isMobile ? "12px 10px" : "12px 14px", cursor: "pointer", borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <NavIcon name={v} color={active ? "#232323" : "#ecf0f1"} />
              </button>
            );
          })}
        </div>
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
