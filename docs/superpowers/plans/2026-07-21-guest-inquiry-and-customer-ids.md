# Guest Inquiry and Customer ID Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Thumbtack `customer.customerID` as the Firestore customer primary key, let clients claim leads by that ID, and add a guest inquiry flow with Handyman vs Fabrication forms plus optional post-submit sign-up.

**Architecture:** Opaque customer IDs are generated or taken from Thumbtack and used as `customers/{id}`. Lead matching switches from phone/name to `thumbtackCustomerId` on `leadInvites`. Guests submit through a public callable that creates `customers` + `inquiries` with the Admin SDK; the owner app lists new inquiries.

**Tech Stack:** React 18, Firebase Auth/Firestore/Functions, Vitest, TypeScript Cloud Functions.

## Global Constraints

- Thumbtack customers use `customer.customerID` as the Firestore document ID.
- Non-Thumbtack customers use an app-generated opaque digit-string ID (same shape family), not Firestore auto-IDs.
- Thumbtack sign-in lookup uses Customer ID only (no name/phone fields).
- Guest inquiry requires no auth; create only via Cloud Function; optional sign-up afterward.
- Categories are exactly `handyman` and `fabrication` (UI labels: Handyman Services, Custom Fabrication).
- Do not auto-create Draft jobs from guest inquiries.
- Leave existing auto-ID customers as-is (no required migration).
- `/book/lead/{token}` invite entry remains unchanged.

---

## File Structure

- Create: `shared/` package (`@handy/shared`) — single opaque ID helper for app + Cloud Functions.
- Create: `shared/customerIds.js` (+ types if needed).
- Create: `src/utils/customerIds.test.js` — tests importing `@handy/shared`.
- Wire: root and `functions/package.json` depend on `"@handy/shared": "file:../shared"` (or `file:./shared`) so Functions deploy bundles the linked package.
- Create: `functions/src/submitInquiry.ts` — public callable to create inquiry + customer.
- Create: `src/components/client/ClientGuestInquiry.jsx` — category + forms + thank-you.
- Create: `src/components/client/ClientSignIn.test.jsx` — Thumbtack ID field + guest CTA.
- Create: `src/components/Inquiries.jsx` — owner list of inquiries.
- Modify: `functions/src/thumbtackWebhook.ts` — customer doc id + `thumbtackCustomerId` on invite.
- Modify: `functions/src/leadInvite.ts` — match by `thumbtackCustomerId`.
- Modify: `functions/src/index.ts` — export `submitInquiry`.
- Modify: `src/components/client/ClientSignIn.jsx` — Customer ID field, Continue as guest.
- Modify: `src/components/client/ClientApp.jsx` — guest route, match payload, optional link.
- Modify: `src/App.jsx` — `setDoc` with generated customer ids; inquiries listener + nav.
- Modify: `firestore.rules` — `inquiries` owner-only read/update; no client create.
- Modify: `FIRESTORE_SCHEMA.md` — document customers id scheme + `inquiries`.

### Task 1: Opaque Customer ID Helpers (shared package)

**Files:**
- Create: `shared/package.json` (`name: "@handy/shared"`, `"type": "module"`, `"main": "customerIds.js"`, `"exports": { ".": "./customerIds.js" }`)
- Create: `shared/customerIds.js`
- Create: `src/utils/customerIds.test.js`
- Modify: root `package.json` — add dependency `"@handy/shared": "file:./shared"`
- Modify: `functions/package.json` — add dependency `"@handy/shared": "file:../shared"`
- Run `npm install` in root and `functions/` so the link resolves for Vite and deploy.

**Interfaces:**
- Produces from `@handy/shared`: `generateOpaqueCustomerId(): string` — 18-digit numeric string.
- Produces: `isOpaqueCustomerId(value: unknown): boolean` — true when value is 15–20 digits.

- [ ] **Step 1: Write failing frontend tests**

Create `src/utils/customerIds.test.js`:

```js
import { describe, expect, test } from "vitest";
import { generateOpaqueCustomerId, isOpaqueCustomerId } from "@handy/shared";

describe("customerIds", () => {
  test("generateOpaqueCustomerId returns 18 digits", () => {
    const id = generateOpaqueCustomerId();
    expect(id).toMatch(/^\d{18}$/);
  });

  test("generateOpaqueCustomerId values differ", () => {
    expect(generateOpaqueCustomerId()).not.toBe(generateOpaqueCustomerId());
  });

  test("isOpaqueCustomerId accepts Thumbtack-shaped ids", () => {
    expect(isOpaqueCustomerId("521561969212661774")).toBe(true);
    expect(isOpaqueCustomerId("abc")).toBe(false);
    expect(isOpaqueCustomerId("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (package missing)**

```bash
npm test -- src/utils/customerIds.test.js
```

Expected: FAIL because `@handy/shared` cannot be resolved.

- [ ] **Step 3: Implement shared package and wire dependencies**

Create `shared/customerIds.js`:

```js
export function generateOpaqueCustomerId() {
  let id = "";
  while (id.length < 18) {
    id += Math.floor(Math.random() * 1e15)
      .toString()
      .padStart(15, "0");
  }
  return id.slice(0, 18);
}

export function isOpaqueCustomerId(value) {
  return /^\d{15,20}$/.test(String(value || "").trim());
}
```

Create `shared/package.json` as above. Add file deps to root and functions; run installs. Later tasks import `from "@handy/shared"` (TS may need `allowJs` or a thin `.d.ts` in `shared/customerIds.d.ts`).

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- src/utils/customerIds.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/package.json shared/customerIds.js shared/customerIds.d.ts \
  src/utils/customerIds.test.js package.json package-lock.json \
  functions/package.json functions/package-lock.json
# Stage only shared-package / test hunks if package.json has unrelated edits (git add -p)
git commit -m "feat: add shared opaque customer id package"
```

### Task 2: Webhook Uses Thumbtack Customer ID as Doc ID

**Files:**
- Modify: `functions/src/thumbtackWebhook.ts`
- Test: extend or add `scripts/testThumbtackParse.mjs` / unit tests for extract of customer ID if present; otherwise add `functions`-side test of a small exported helper `resolveThumbtackCustomerDocId(parsed)`.

**Interfaces:**
- Consumes: `parseThumbtackLeadPayload` (extend to expose `thumbtackCustomerId`).
- Produces: customer written at `customers/{thumbtackCustomerId}`; invite includes `thumbtackCustomerId`.

- [ ] **Step 1: Extend parser to return Thumbtack customer ID**

In `parseThumbtackLeadPayload` / `ParsedThumbtackLead`, add:

```ts
thumbtackCustomerId: string; // from customer.customerID / customerID variants
```

Extract with:

```ts
const thumbtackCustomerId = (
  str(customer?.customerID) ||
  str(customer?.customerId) ||
  str(root.customerID) ||
  ""
).trim();
```

- [ ] **Step 2: Write a failing assertion in an existing parse test or new vitest file**

If `scripts/testThumbtackParse.mjs` exists, add a case using `exampleThumbtackWebhook.json` / sample newLead body asserting `thumbtackCustomerId === "521561969212661774"` (or the ID in the fixture you use).

- [ ] **Step 3: Change customer + invite write path**

Replace `const custRef = db.collection("customers").doc();` with:

```ts
if (!parsed.thumbtackCustomerId) {
  throw new Error("missing_thumbtack_customer_id");
}
const custRef = db.collection("customers").doc(parsed.thumbtackCustomerId);
batch.set(custRef, {
  name: parsed.name,
  phone: parsed.phone,
  email: parsed.email,
  address: parsed.address,
  notes: parsed.customerNotes,
  status: "preliminary",
  clientUid: null,
  leadInviteToken: token,
  thumbtackCustomerId: parsed.thumbtackCustomerId,
  createdAt: now,
}, { merge: true });
```

On invite `batch.set`:

```ts
thumbtackCustomerId: parsed.thumbtackCustomerId,
```

Keep job dedupe by `sourceThumbtackLeadId`. Reuse existing customer doc when the same Thumbtack customer returns with a new negotiation.

- [ ] **Step 4: Build functions**

```bash
cd functions && npm run build
```

Expected: `tsc` succeeds.

- [ ] **Step 5: Commit**

```bash
git add functions/src/thumbtackWebhook.ts functions/src/customerIds.ts
# plus any parse test files changed
git commit -m "feat: use Thumbtack customerID as customer doc id"
```

### Task 3: Match Lead by Thumbtack Customer ID + Sign-In UI

**Files:**
- Modify: `functions/src/leadInvite.ts`
- Modify: `src/components/client/ClientSignIn.jsx`
- Modify: `src/components/client/ClientApp.jsx`
- Create: `src/components/client/ClientSignIn.test.jsx`

**Interfaces:**
- Consumes: `matchLeadInvite({ thumbtackCustomerId: string })`
- Produces: `{ found: boolean, token?: string }`

- [ ] **Step 1: Write failing ClientSignIn tests**

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ClientSignIn from "./ClientSignIn";

test("stashes Thumbtack customer id before sign-in", () => {
  const onFindLead = vi.fn();
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      onFindLead={onFindLead}
    />
  );
  fireEvent.change(screen.getByLabelText(/customer id/i), {
    target: { value: "521561969212661774" },
  });
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: "secret1" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(onFindLead).toHaveBeenCalledWith({
    thumbtackCustomerId: "521561969212661774",
  });
});

test("shows continue as guest", () => {
  const onContinueAsGuest = vi.fn();
  render(
    <ClientSignIn
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      onContinueAsGuest={onContinueAsGuest}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));
  expect(onContinueAsGuest).toHaveBeenCalled();
});
```

Note: add `aria-label` or proper `label` association on the Customer ID `Input` if needed for queries.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- src/components/client/ClientSignIn.test.jsx
```

- [ ] **Step 3: Rewrite `matchLeadInvite`**

```ts
export const matchLeadInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const thumbtackCustomerId = String(request.data?.thumbtackCustomerId || "").trim();
  if (!/^\d{15,20}$/.test(thumbtackCustomerId)) {
    throw new HttpsError("invalid-argument", "Enter a valid Thumbtack Customer ID.");
  }
  // ... init admin ...
  const snap = await db.collection("leadInvites")
    .where("thumbtackCustomerId", "==", thumbtackCustomerId)
    .where("status", "==", "open")
    .limit(5)
    .get();
  if (snap.empty) return { found: false };
  if (snap.size > 1) {
    throw new HttpsError(
      "failed-precondition",
      "Multiple open requests match that Customer ID. Use the link from your message or contact us.",
    );
  }
  // claim invite + link customer/job as today; log thumbtackCustomerId
  return { found: true, token: snap.docs[0].id };
});
```

Add composite index in `firestore.indexes.json` if deploy requires `thumbtackCustomerId` + `status`.

- [ ] **Step 4: Update ClientSignIn + ClientApp**

- Replace name/phone UI with Customer ID input; stash `{ thumbtackCustomerId }`.
- In `ClientApp` match effect, call `matchLead({ thumbtackCustomerId: payload.thumbtackCustomerId })`.
- Show a toast/error when `found: false` (surface `console` alone is insufficient — set a small error banner or `alert` with “No open request found for that ID”).
- Add `onContinueAsGuest` prop and button (wired in Task 5 if route not ready yet; for this task, prop may be optional no-op until Task 5).

- [ ] **Step 5: Run tests + functions build**

```bash
npm test -- src/components/client/ClientSignIn.test.jsx
cd functions && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add functions/src/leadInvite.ts firestore.indexes.json \
  src/components/client/ClientSignIn.jsx src/components/client/ClientApp.jsx \
  src/components/client/ClientSignIn.test.jsx
git commit -m "feat: claim Thumbtack leads by customer ID"
```

### Task 4: `submitInquiry` Callable + Rules

**Files:**
- Create: `functions/src/submitInquiry.ts`
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`
- Modify: `FIRESTORE_SCHEMA.md`

**Interfaces:**
- Produces: `submitInquiry` callable accepting:

```ts
{
  category: "handyman" | "fabrication";
  name: string;
  phone: string;
  email: string;
  address: string;
  preferredTiming: string;
  description: string;
  photoUrls?: string[];
  howFoundUs?: string;
  // handyman
  propertyType?: string;
  indoorOutdoor?: string;
  urgency?: string;
  estimatedHours?: string;
  accessNotes?: string;
  // fabrication
  materials?: string;
  dimensionsNotes?: string;
  installOrPickup?: string;
  finishNotes?: string;
  deadline?: string;
}
```

Returns `{ ok: true, inquiryId: string, customerId: string }`.

- [ ] **Step 1: Implement callable with validation**

```ts
export const submitInquiry = onCall({ invoker: "public" }, async (request) => {
  const data = request.data || {};
  const category = String(data.category || "");
  if (category !== "handyman" && category !== "fabrication") {
    throw new HttpsError("invalid-argument", "Choose a valid category.");
  }
  const name = String(data.name || "").trim();
  const description = String(data.description || "").trim();
  if (!name || !description) {
    throw new HttpsError("invalid-argument", "Name and description are required.");
  }
  // init admin, generateOpaqueCustomerId(), batch set customer + inquiry
});
```

Customer payload: `status: "preliminary"`, contact fields, `source: "guest_inquiry"`, `createdAt`.

Inquiry payload: category, all submitted fields, `status: "new"`, `customerId`, `clientUid: request.auth?.uid || null`, timestamps.

- [ ] **Step 2: Firestore rules**

```
match /inquiries/{docId} {
  allow read, update, delete: if isOwner();
  allow create: if false;
}
```

- [ ] **Step 3: Export from `index.ts` and update schema doc**

- [ ] **Step 4: Build functions**

```bash
cd functions && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add functions/src/submitInquiry.ts functions/src/index.ts firestore.rules FIRESTORE_SCHEMA.md
git commit -m "feat: add public guest inquiry callable"
```

### Task 5: Guest Inquiry Client UI

**Files:**
- Create: `src/components/client/ClientGuestInquiry.jsx`
- Create: `src/components/client/ClientGuestInquiry.test.jsx`
- Modify: `src/components/client/ClientApp.jsx`
- Modify: `src/components/client/ClientSignIn.jsx` (wire guest button)

**Interfaces:**
- Route kind: `{ kind: "guest" }` at path `/inquire` (or `/guest`).
- After submit, store `{ inquiryId, customerId }` in `sessionStorage.pendingInquiryLink`.
- After optional auth, if pending link exists, call a small callable or owner-only is wrong — add `linkInquiryToClient` callable that sets `clientUid` when `request.auth.uid` present and inquiry exists, **or** update via callable only.

Prefer adding to Task 4's file:

```ts
export const linkInquiryToClient = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const inquiryId = String(request.data?.inquiryId || "").trim();
  // verify inquiry exists; set clientUid; optionally customers/{id}.clientUid
  return { ok: true };
});
```

- [ ] **Step 1: Write failing UI tests for category step and required fields**

Test that choosing Handyman shows handyman-specific labels; Fabrication shows fabrication labels; submit without description shows validation error.

- [ ] **Step 2: Implement `ClientGuestInquiry`**

Steps: category → form → submitting → thank-you with Sign in / Create account buttons that navigate back to `ClientSignIn` while keeping `pendingInquiryLink`.

Use `httpsCallable(functions, "submitInquiry")`.

- [ ] **Step 3: Wire routing in `ClientApp`**

- `parseClientRoute`: `/inquire` → `{ kind: "guest" }`.
- Unauthenticated: if guest route, render `ClientGuestInquiry`; else `ClientSignIn` with `onContinueAsGuest` → push `/inquire`.
- After auth, if `pendingInquiryLink`, call `linkInquiryToClient`.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/components/client/ClientGuestInquiry.test.jsx src/components/client/ClientSignIn.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/client/ClientGuestInquiry.jsx \
  src/components/client/ClientGuestInquiry.test.jsx \
  src/components/client/ClientApp.jsx \
  src/components/client/ClientSignIn.jsx \
  functions/src/submitInquiry.ts functions/src/index.ts
git commit -m "feat: add guest inquiry client flow"
```

### Task 6: Owner App — Inquiries + Customer Creates Use Opaque IDs

**Files:**
- Create: `src/components/Inquiries.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/Dashboard.jsx`
- Modify: `src/utils/adminRoutes.js` (if needed for nav path)

**Interfaces:**
- `addCustomer` uses `setDoc(doc(db, "customers", generateOpaqueCustomerId()), data)` instead of `addDoc`.
- Booking path that creates customers likewise uses opaque ids.
- `ctx.inquiries`, `newInquiryCount`, Dashboard banner, nav item or Jobs-adjacent list.

- [ ] **Step 1: Switch customer creation to opaque IDs**

```js
import { setDoc, doc } from "firebase/firestore";
import { generateOpaqueCustomerId } from "./utils/customerIds";

const addCustomer = async (c) => {
  const id = generateOpaqueCustomerId();
  await setDoc(doc(db, "customers", id), c);
  showToast("Customer added!");
  nav("customers");
};
```

Update `createJobFromBookingRequest` customer create similarly.

- [ ] **Step 2: Listen to `inquiries`**

```js
onSnapshot(collection(db, "inquiries"), (snap) => {
  setInquiries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});
```

- [ ] **Step 3: Dashboard banner + Inquiries page**

Banner when `status === "new"` count > 0. Page lists category, name, description snippet, status; click opens detail card with full fields; button to mark `status: "reviewed"` via `updateDoc`.

- [ ] **Step 4: Run full verification**

```bash
npm test
npm run build
cd functions && npm run build
```

Expected: all tests PASS; both builds succeed.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/Dashboard.jsx src/components/Inquiries.jsx \
  src/utils/adminRoutes.js src/components/NewCustomer.jsx
git commit -m "feat: surface guest inquiries and opaque customer ids"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Thumbtack customerID as doc id | 2 |
| Generated opaque ids for other customers | 1, 6 |
| `thumbtackCustomerId` on leadInvites | 2 |
| Sign-in Customer ID lookup | 3 |
| Remove name/phone lookup UI | 3 |
| Continue as guest | 5 |
| Category Handyman / Fabrication | 5 |
| Shared + category form fields | 5 |
| Public callable create inquiry | 4 |
| Optional post-submit account link | 5 |
| Owner sees inquiries | 6 |
| No auto Draft job | 4, 6 |
| Invite URL unchanged | 3 (no change to lead path) |
| No historical migration | — out of scope |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-guest-inquiry-and-customer-ids.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
