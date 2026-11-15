// A disposable in-memory backend for the existing admin screens. Reload to reseed it.
import { fixtures } from "./fixtures";

const rows = new Map();
for (const [name, records] of Object.entries(fixtures)) {
  for (const { id, ...fields } of records) rows.set(`${name}/${id}`, {
    ...fields,
    ...Object.fromEntries(["requestedStart", "requestedEnd"].filter(key => fields[key])
      .map(key => [key, toTimestamp(new Date(fields[key]))])),
  });
}
const listeners = new Set();

function toTimestamp(date) {
  return { seconds: date.getTime() / 1000, toDate: () => new Date(date), toMillis: () => date.getTime() };
}
export const Timestamp = { fromDate: toTimestamp, now: () => toTimestamp(new Date()) };
export const serverTimestamp = Timestamp.now;

function ref(parent, ...segments) {
  const path = [parent.path, ...segments].filter(Boolean).join("/");
  return { path, id: path.split("/").at(-1) };
}
export const collection = ref;
export const doc = ref;
export const where = (field, operator, value) => ({ test: row => {
  if (operator === "==") return row[field] === value;
  throw new Error(`Unsupported preview filter ${operator}`);
} });
export const orderBy = (field, dir = "asc") => ({ sort: (a, b) => {
  const value = row => row[field]?.toMillis?.() ?? row[field];
  return (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * (dir === "desc" ? -1 : 1);
} });
export const limit = count => ({ count });
export const query = (target, ...constraints) => ({ ...target, constraints });

function documentSnapshot(path) {
  return { id: path.split("/").at(-1), exists: () => rows.has(path), data: () => rows.get(path) };
}
function collectionSnapshot({ path, constraints = [] }) {
  let docs = [...rows.keys()].filter(key => key.slice(0, key.lastIndexOf("/")) === path).map(documentSnapshot);
  for (const { test, sort, count } of constraints) {
    if (test) docs = docs.filter(item => test(item.data()));
    if (sort) docs.sort((a, b) => sort(a.data(), b.data()));
    if (count !== undefined) docs = docs.slice(0, count);
  }
  return { docs, empty: !docs.length, size: docs.length };
}

export const getDocs = async target => collectionSnapshot(target);
export const getDoc = async target => documentSnapshot(target.path);
export function onSnapshot(target, next) {
  const send = () => next(target.path.split("/").length % 2 ? collectionSnapshot(target) : documentSnapshot(target.path));
  listeners.add(send);
  queueMicrotask(() => { if (listeners.has(send)) send(); });
  return () => listeners.delete(send);
}

function notify() { queueMicrotask(() => listeners.forEach(send => send())); }
export async function setDoc(target, value, options) {
  rows.set(target.path, options?.merge ? { ...rows.get(target.path), ...value } : value);
  notify();
}
export async function updateDoc(target, value) {
  if (!rows.has(target.path)) throw new Error("Preview record missing");
  return setDoc(target, value, { merge: true });
}
export async function deleteDoc(target) { rows.delete(target.path); notify(); }
export async function addDoc(target, value) {
  const id = crypto.randomUUID();
  await setDoc(doc(target, id), value);
  return { id };
}
export function writeBatch() {
  const writes = [];
  return {
    set: (...args) => writes.push(() => setDoc(...args)),
    update: (...args) => writes.push(() => updateDoc(...args)),
    delete: (...args) => writes.push(() => deleteDoc(...args)),
    commit: async () => Promise.all(writes.map(write => write())),
  };
}
export async function runTransaction(_db, perform) {
  const batch = writeBatch();
  const result = await perform({ ...batch, get: getDoc });
  await batch.commit();
  return result;
}
export const terminate = async () => {};
export const clearIndexedDbPersistence = async () => {};
