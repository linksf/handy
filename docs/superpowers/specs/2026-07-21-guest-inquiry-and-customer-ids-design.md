# Guest Inquiry, Thumbtack Customer ID Lookup, and Customer ID Overhaul

## Goal

Update the client sign-in / sign-up experience so that:

1. Thumbtack clients claim an open lead by **Thumbtack `customer.customerID`**, not name or phone.
2. Guests can **continue without an account**, choose **Handyman Services** or **Custom Fabrication**, submit a quote-oriented inquiry, then optionally create an account.
3. Customer documents in Firestore use **opaque external-style IDs as the primary key** throughout the app (Thumbtack’s `customerID` when present; otherwise an app-generated opaque ID).

## Current Behavior

- Client sign-in (`ClientSignIn`) supports email/password and Google only.
- Thumbtack lead claim on `/` uses name + phone → `matchLeadInvite` → navigate to `/book/lead/{token}`.
- Invite URLs `/book/lead/{token}` remain a separate entry path.
- Webhook creates `customers` with Firestore auto-IDs and does not persist Thumbtack `customer.customerID`.
- Anonymous users have no Firestore access; there is no guest inquiry path.

## Section 1: Customer IDs

### Primary key

`customers/{id}` where `id` is always an opaque external-style string (digit-heavy, Thumbtack-like), **not** a Firestore auto-ID for new customers.

| Source | Document ID |
|--------|-------------|
| Thumbtack webhook | `customer.customerID` from the payload |
| Manual add, booking, guest inquiry | App-generated opaque ID of the same shape family |

### Webhook

- Create or reuse `customers/{thumbtackCustomerID}` (idempotent on that ID).
- Persist `thumbtackCustomerId` on the customer document (same value as the doc id).
- Persist `thumbtackCustomerId` on `leadInvites` for claim matching.
- Jobs continue to store `customerId` as that Firestore document id.

### App-wide creation

- All **new** customers use this ID scheme via a shared helper (e.g. `generateCustomerId()` for non-Thumbtack sources).
- Existing customers with auto-generated IDs remain valid; no required one-time migration for launch. Optional migration script is a follow-up.

## Section 2: Thumbtack sign-in lookup

### Sign-in UI

- Remove name and phone from the “Have a Thumbtack request?” block.
- Single field: **Thumbtack Customer ID**, with short helper copy (e.g. “Use the Customer ID from your Thumbtack request”).
- Stash the entered ID (session storage) and, after successful email/Google sign-in, call `matchLeadInvite({ thumbtackCustomerId })`.

### Callable `matchLeadInvite`

- Accept `thumbtackCustomerId` (required for this path).
- Find open `leadInvites` where `thumbtackCustomerId` matches and `status == "open"`.
- On unique match: claim invite (`clientUid`, `status: "claimed"`), link `customers` / job booking fields as today, return token for navigation to `ClientLeadFlow`.
- On no match or ambiguity: return a clear client-facing error (“No open request found for that ID”).
- Remove phone/name matching as the primary path for this UI (legacy phone params may be dropped or rejected).

### Alternate entry

- `/book/lead/{token}` remains unchanged as a direct invite entry (no Customer ID form).

## Section 3: Continue as guest + inquiry forms

### Sign-in UI

- Add **Continue as guest** under email/Google auth.
- Guest path does **not** require Firebase Auth to fill or submit the inquiry.

### Flow

1. Choose category: **Handyman Services** or **Custom Fabrication**.
2. Complete the category form (shared core + category extras).
3. Submit via a public Cloud Function callable (or HTTP equivalent) that creates the inquiry server-side.
4. Show thank-you + **optional Create account / Sign in** so they can track later.
5. If they sign up/sign in after submit, optionally attach `clientUid` to the inquiry (best-effort if the inquiry id is still in session).

### Form fields (adjustable later)

**Shared:** name, phone, email, address/area, preferred timing, description, optional photo URLs, optional “how did you find us”.

**Handyman extras:** property type, indoor/outdoor, urgency, rough size/hours estimate, access notes.

**Fabrication extras:** material preferences, dimensions/sketch notes, install vs pickup, finish/style notes, deadline.

### Data model: `inquiries`

New collection (owner read/write; create only via backend):

| Field | Notes |
|-------|--------|
| `category` | `"handyman"` \| `"fabrication"` |
| Contact + form fields | As collected |
| `status` | `"new"` initially; owner may later mark reviewed / converted |
| `customerId` | Generated opaque customer id; preliminary `customers` doc created with same id |
| `clientUid` | Optional; set if guest later signs up and links |
| `createdAt` / `updatedAt` | Server timestamps |

Do **not** auto-create a Draft job from every inquiry. Owner reviews inquiries first (Dashboard banner and/or simple list), similar to preliminary job requests.

### Security

- Clients cannot create `inquiries` from the client SDK.
- Public callable validates required fields, rate-limits or size-limits as practical, writes `customers` + `inquiries` with Admin SDK.
- Anonymous / unauthenticated Firestore rules remain deny for direct collection writes.

## Architecture

```
Sign-in screen
├── Email / Google → existing auth
│     └── optional Thumbtack Customer ID → matchLeadInvite → /book/lead/{token}
├── /book/lead/{token} → ClientLeadFlow (unchanged entry)
└── Continue as guest
      → category → form → submitInquiry callable
      → thank you + optional auth
```

Owner admin surfaces new `inquiries` with `status == "new"` alongside existing lead/booking notifications.

## Error handling

- Invalid/empty Customer ID: client validation before stash/sign-in.
- No matching open invite: callable error with clear message.
- Inquiry submit failure: show retryable error; do not clear the form blindly.
- Duplicate Thumbtack webhook for same customer: reuse customer doc; still dedupe jobs by negotiation/lead id as today.

## Testing

- Webhook creates customer with Thumbtack `customerID` as doc id and sets `thumbtackCustomerId` on invite.
- `matchLeadInvite` matches by `thumbtackCustomerId` only for the new UI path.
- Guest submit creates inquiry + preliminary customer without auth.
- Optional post-submit sign-in can attach `clientUid` when session still holds inquiry id.
- Admin can see new inquiries.

## Out of scope

- Forced account creation for guests.
- Auto Draft job / auto scheduling from guest inquiry.
- Full historical customer ID migration.
- Changing owner Google allowlist or Square flows.
- Differentiating Handyman vs Fabrication beyond form fields and `category` (e.g. separate pricing engines).
