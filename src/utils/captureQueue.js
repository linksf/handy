import { db } from "../firebase";
import { syncCapture } from "./captureStore";

const changed = "handy-capture-changed";
let connection;
const draining = new Map();
function storage() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open("handy-capture", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("entries", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { connection = null; throw error; });
  return connection;
}
async function requestStore(mode, operation) {
  const store = await storage();
  return new Promise((resolve, reject) => {
    const transaction = store.transaction("entries", mode);
    const request = operation(transaction.objectStore("entries"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || new Error("Local capture could not be saved."));
    transaction.onerror = () => reject(transaction.error || request.error);
  });
}
export async function readCaptures(owner) {
  return (await requestStore("readonly", store => store.getAll())).filter(entry => entry.owner === owner)
    .sort((a, b) => a.createdAt - b.createdAt);
}
export async function putCapture(entry) {
  await requestStore("readwrite", store => store.put(entry));
  window.dispatchEvent(new Event(changed));
}
export async function removeCapture(id) {
  await requestStore("readwrite", store => store.delete(id));
  window.dispatchEvent(new Event(changed));
}
export function watchCaptures(callback) {
  window.addEventListener(changed, callback);
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener(changed, callback);
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
export function drainCaptures(owner) {
  if (!owner || !navigator.onLine) return Promise.resolve();
  if (draining.has(owner)) return draining.get(owner);
  const run = (async () => {
    const attempted = new Set();
    while (navigator.onLine) {
      const entry = (await readCaptures(owner)).find(row => !attempted.has(row.id) && ["queued", "failed"].includes(row.state));
      if (!entry) break;
      attempted.add(entry.id);
      try {
        const result = await syncCapture(db, entry);
        if (result.state === "synced") {
          const { photo, text, base, current, ...metadata } = entry;
          await putCapture({ ...metadata, state: "synced", error: null });
        } else await putCapture({ ...entry, ...result });
      } catch (error) {
        await putCapture({ ...entry, state: "failed", error: error.message || "Could not sync." });
      }
    }
  })().finally(() => draining.delete(owner));
  draining.set(owner, run);
  return run;
}
