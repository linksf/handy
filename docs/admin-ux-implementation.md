# Handy Admin UX implementation

The installable app, offline shell and Web Push setup are documented in [Handy on a device](pwa.md).

## Session 6 · Capture tools and full workflow verification

Status — Implemented in the workspace. This is the last numbered roadmap session. Owner acceptance and any live rollout are separate.

### Preview and acceptance

Open **Repair laundry room wall** in the [desktop preview](http://127.0.0.1:5174/admin/jobs/extras) or [phone preview](http://10.0.0.187:5175/admin/jobs/extras) on the Mac’s Wi-Fi. Choose **Capture**. Keep the app open while disconnecting. Reloading the isolated preview reseeds the backend. The browser queue is stored separately.

1. **Receipt split.** Choose **Use sample receipt**. Review the editable merchant, date and $72.50 total. Allocate $40 to **Repair laundry room wall** with **Reimbursable allocation 1** checked. Add a split of $32.50 to **Repair side gate** as shop supplies. Choose **Review split → Save receipt split**. Each job's Expenses shows its own amount. **View receipt** shows the shared receipt. A mismatch in the sum is rejected.
2. **Offline work.** Open Capture first, then turn off the connection. Enter a note, select a photo, and enter actual time from **November 14, 2026, 8:00 to 9:05 a.m. Pacific**. Use the three **Save … to queue** actions. Each shows queued. Reconnect. Each should show synced, and the timer shows **65 actual minutes and 60 billable**. For a conflicting note, review both versions and choose to keep the saved text, use the queued text, or append it.
3. **Voice draft.** Expand **Voice to draft** and choose **Use sample dictation**. Change the proposal from two brackets to three. **Use draft in capture** places the edited text in the note editor. **Save note to queue** applies it. For a microphone test, use the loopback desktop preview or a secure origin.
4. **Lead to payment and cancellation.** In **Inbox**, open **Avery Chen**, create a draft job with the verified **Juniper Lane** customer and a reason, and schedule an assessment. Add and issue a **$100** invoice, then record **$100 paid**. Cancel the assessment with a reason and retry its calendar sync. Record a **$25 refund** as a separate ledger action. The invoice shows **$75 net paid and $25 balance**, the cancelled visit remains visible, and the issued copy remains available.

### Verification and boundaries

- Receipt save writes all allocations atomically, using one receipt ID and stable expense IDs. A reimbursable allocation uses the normal invoice-line logic. The saved receipt keeps reviewed values and the proposed extraction for reference.
- Offline capture queues are per owner and per browser in IndexedDB. The app drains the queue on reconnection while open. Notes compare the original and remote text, and every capture has an idempotent server marker or work-session ID. This workflow supports capture in an open job. An offline cold start and cross-device draft transfer remain unverified.
- Vertex AI is reused for optional receipt extraction and audio transcription. The preview returns synthetic proposals. The owner reviews and edits both before saving. Live model availability, Vertex permissions, photo/audio formats, and physical iPhone microphone behavior remain open. The LAN preview uses HTTP, where microphone capture may be unavailable. Audio upload and the synthetic dictation are available there.
- Desktop and 390-pixel Chrome verification covered offline note conflict and append, photo recovery, time rounding, receipt split, edited dictation, and lead through payment and cancellation with partial refund. Automated regressions verify retry deduplication and prior finance/lead workflows. Physical device, VoiceOver, production Firestore rules, real provider callbacks and calendar writes require separate verification. No production deployment or live transaction was performed.

## Session 5 · Scope, access, parts, and callbacks

Status — Implemented in the workspace. Accepted before Session 6.

### Preview and acceptance

Open **Repair laundry room wall** in the [desktop preview](http://127.0.0.1:5174/admin/jobs/extras) or the [phone preview](http://10.0.0.187:5175/admin/jobs/extras) on the Mac’s Wi-Fi. Keep the tab open because reloading resets the synthetic records.

1. Open **Changes**. Save **Concealed blocking** with revised scope, an extra **$125**, and a wall photo. The order shows **Approval pending** and the photo opens from the job. Select **Record approval**, enter Jordan Lee, the approval date and method, and what Jordan approved. Save with **Invoice 1** selected. **Open linked invoice** shows the base $250 plus one $125 approved change. The invoice does not include private photos or access notes.
2. Open **Parts**, add **Mounting bracket** from any vendor, set **Backordered**, select the **Return visit**, and enter expected and return dates. Set **Remind on** to today. Select **Postpone visit → Confirm postponement**. The visit moves to **deferred** in Handy. **Retry calendar sync** marks the old calendar slot free in the preview. **Today → Needs a decision → Review parts** opens the reminder. Use **Reschedule visit** when the part is ready.
3. On the phone, expand **Arrival and access · Private**. The default record shows driveway parking, side-door entry, alternate contact and last-mile notes. Open Maps, copy details, or select a visit to edit its own instructions.
4. Open **Callbacks** and choose **Warranty → Create callback**. The callback is a linked, unpriced draft with a $0 invoice. Open **Callbacks → Open original job** and verify the original invoice still totals $375. The **New billable work** choice creates a separate draft for pricing.

### Implementation and verification boundaries

- Change-order photos are resized to JPEG and stored in owner-only records, up to three per order. The approval records who agreed, when, how, and the evidence entered by the owner. Approval atomically adds an invoice draft line. Issued snapshots remain available. The preview does not send a request for approval.
- Access defaults and visit-specific cards have owner-only reads and writes. Copy uses the saved record. Maps receives the service address. Existing job photo links and material descriptions can follow a callback as reference data. Original charges and material costs remain on the original job.
- Part reminders appear on the dashboard when due in Pacific time. A postponement retains the original time and marks the job visit deferred. For a visit already synced to Google Calendar, retrying sync marks that event postponed and transparent. Rescheduling uses the same event identity. The original booking and customer communication history are preserved.
- Chrome verified photo upload and retrieval, approval and invoice totals, reminder and postponement, access edits, and warranty linkage at desktop and phone widths. Clipboard behavior used a browser test stub. Live Firestore rules and Calendar changes were not exercised. No deployment, messages or live transactions were performed.

## Session 4 · Invoicing, payments, reports, and closeout

Status — Implemented in the workspace. Accepted before Session 5.

### Preview and acceptance

Open **Repair kitchen cabinets** in the [desktop preview](http://127.0.0.1:5174/admin/jobs/billing/invoices/primary) or [phone preview](http://10.0.0.187:5175/admin/jobs/billing/invoices/primary) on the Mac's Wi-Fi. Keep the same tab open. Reloading resets fixture writes.

1. Create **Deposit** and add an **Other charge** called **Deposit installment** for $100. **Review and issue → Save issued version**. Download the issued PDF. Issuing saves a version locally in Handy and does not send it.
2. Create **Final**. In **Assign and comp job items**, move both the $300 flat-rate line and **Return visit tune-up** to Final. Apply each change after reviewing it. Comp the $60 tune-up and apply. Final totals $300, and the underlying $40 hardware expense remains recorded.
3. Issue Final. Choose **Record payment**, enter $120, review and confirm. The balance becomes $180. In **Payments**, choose **Record refund**, record $20, and confirm. Final now has $100 net paid and a $200 balance.
4. Select **Invoice 1 → Payments and corrections → Correct payment date**. Select the existing $80 payment, enter January 2, 2020, and give a reason. Confirm that its amount and balance stay unchanged. Expand Payment history to see the correction. Invoice 1 has an $80 credit because the original flat-rate line was moved. Existing money stays on its original invoice.
5. Open **Closeout → Review expenses**. Use today's Pacific date for **Cabinet hardware** and save. Open **More → Reports**, with the current week selected. Collected is $100, expenses $40, net cash $60, and outstanding balances include $100 Deposit, $200 Final and balances from the other synthetic jobs. The $80 appears in January 2020 and the undated expense gap clears.
6. Open the cabinet job's **Closeout** again. Confirm job completion, final visit, issued states, and balances display independently. Enter a reason for the open balance and **Close with reason**. Use **More job actions and records → Archive job**, then **Jobs → Archived → Open archived job → More job actions and records → Restore job**.

### Implementation and verification boundaries

- The selected invoice leads with balance, issue state, and payment actions. Existing splits and invoice-specific payments are reused. Comping preserves original value and cost. Issued versions retain the contact, title, notes, lines, and paid amount at issue. Previously issued external PDFs cannot be reconstructed unless they were saved.
- Payment, refund, existing-date correction, and legacy dating are separate operations. The ledger previews cash and balance effects. Date corrections retain prior dates and reasons. Refunds record refunds already made. No payment provider is invoked by these controls.
- Reports link outstanding balances, undated payments and costs, and fee gaps to the associated correction view. Balances are summed by invoice so overpayment on one does not offset another. Archived jobs retain accounting history. An invoice snapshot and closeout exception are owner records and do not send a customer notice.
- Closeout displays job, visit, invoice and payment status independently. Exceptions retain the issues and reason. Archive keeps the job and prior status, and requires active visits to be resolved first.
- Preview payments and reports run against synthetic in-memory records. Live authorization, Firestore rules, legacy production inventory, Square callbacks, and report email delivery require separate verification. No production deployment or transaction was performed.

## Session 3 · Scheduling, field work, and safe editing

Status — Implemented in the workspace. Accepted before Session 4.

### Preview and acceptance

Open **Repair side gate** from [desktop](http://127.0.0.1:5174/admin/jobs/gate) or [phone on the Mac's Wi-Fi](http://10.0.0.187:5175/admin/jobs/gate). Use the preview commands below to restart the servers. Keep the tab open during the script so fixture writes persist.

1. Choose **Schedule visit**, keep **Assessment**, and set July 10, 2099 at 9:00 a.m. Pacific. Inspect the proposed duration, travel buffer and affected record, then choose **Save visit → Back to job**. Calendar shows synced.
2. Add a **Return visit** on July 11 at 11:00 a.m. Pacific. The fixture simulates a Calendar outage on the first sync of each new return visit. Choose **Back to job → Retry calendar sync**. It changes to synced. Choose **Edit Return visit**, move it to July 12 at 1:00 p.m., and save. The assessment stays on July 10. **Mark communicated** records that you told the customer separately. Editing the time clears that marker.
3. Choose **Work timer → Start timer → Correct time**. Enter November 14, 2026 at 8:00 a.m. through 9:20 a.m. Pacific, add a correction reason, and save. The preview shows 80 minutes actual and 60 billable. Use Billable hours override to choose a different amount before saving. You can also add an actual or billable-only manual session.
4. Choose **Packing**, select the return visit, and add **Stud finder**, quantity **2**. Switch back to the assessment to verify it has a separate packing list. **Add a job task** opens the task tab, where you can enter a one-off or use a catalog task.
5. Choose **Add expense**, enter **38.50**, name it **Fasteners**, and check **Reimbursable by customer**. Save, open **Invoice**, and choose **Open expense** beside the source item. It returns to the corresponding recorded cost. The expense date defaults to today in Pacific time.
6. Choose **Capture notes**, edit notes, switch tabs, and reopen Capture to recover the draft. Save or discard it. **More job actions and records** holds Archive and the completed-job Reopen action.

### Implementation and verification boundaries

- The same Pacific-time editor is available from a linked lead/inbox item, the job and Calendar. New visits retain a prior date-only commitment, and owner changes are recorded per visit. Local conflict checks include timed jobs and pending/approved requests. Date-only legacy jobs cannot supply an exact conflict window. Duration and travel defaults are editable heuristics. Calendar sync checks the external calendar, uses stable event IDs, and keeps the original booking request. Intentional overlaps require a reason.
- The preview simulates provider success and failure. Live OAuth, calendar scopes, conflicts against real calendar events, and handoff of existing Thumbtack-managed calendar/travel events remain to be verified before production rollout. Travel is used in conflict checks and stored on the visit. Separate travel events for owner-created visits remain a follow-up.
- Work sessions and their effect on base invoice labor hours save together, with actual and billable time kept separately. The existing 30-minute round-down remains the default. Existing billable-only entries are editable. Corrections preserve previous values and reasons.
- The mobile job starts with address/contact and visit actions and keeps timer, capture and expense shortcuts in reach. Capture uses existing notes and photo links, with browser-local recovery for job detail fields. Receipt/photo uploads, cross-device offline capture, and conflict resolution remain Session 6. Archive recovery and closeout policy remain Session 4.
- Nothing was deployed. No production booking, communication, charge, or refund was exercised.

## Session 2 · Intake, replies, customers, and quick job creation

Status — Implemented in the workspace on November 14, 2026. Accepted before Session 3.

### Preview and acceptance

Open [desktop Inbox](http://127.0.0.1:5174/admin/inbox) or [phone Inbox on the Mac's Wi-Fi](http://10.0.0.187:5175/admin/inbox). The preview commands below apply. Fixture writes last until the page is reloaded.

1. Open **Avery Chen** in **Next reply**. The latest message says the mirror weighs 40 pounds, the first draft is editable, and **Alternate draft** starts collapsed. Change the draft to “Hi Avery, please send a photo of the wall.” Choose **Copy reply** and paste into a local note to check it. **Mark sent** records that you already sent it externally and moves it to **Waiting**.
2. Select **Create or link job**. The form shows both Avery profiles. Choose **Avery Chen · 19 Juniper Lane** in place of the old Linden Way profile. Enter a reason such as “Confirmed the Juniper Lane address.” Select **Create job**. The draft opens with its source link. Use **Open intake → Intake history** to see the chosen-link reason and previous customer.
3. Go to **Inbox → Robin Shah → Create or link job**. Choose **Keep separate · new customer**, use **Build a maple display stand** as the title, and leave the date and pricing blank. Expand **Address, site contact, payer and notes**. Keep **37 Laurel Way**, set the site contact to **Robin Shah (tenant)**, and set the payer to **Morgan Shaw (landlord)** with `morgan@example.test`. Create the job. The job shows distinct contacts and a Draft status. Its invoice totals $0.00. There is no booking.
4. Open the Robin source again. **Snooze** moves it to Snoozed through the selected Pacific date. **Unsnooze** restores Ready to book. **Resolve** moves it to Resolved, where **Reopen** restores it. **View source record** opens the original inquiry.
5. Use **Jobs → + New Job** for manual creation, or create from a customer's page to preselect that customer. Choose **Prefill from a prior job** when that customer has jobs. The copied fields remain editable and the source job is named.

### What shipped and boundaries

- Inbox groups guest inquiries, Thumbtack leads, and preliminary jobs by next action. The older lead and inquiry pages remain accessible from Inbox and the original records remain accessible on each intake item.
- Latest captured messages and the editable first draft precede other details. Alternate drafts and history are collapsible. Existing Thumbtack intake and draft generation still operate through their original entry points. Copying and marking sent are separate, and Mark sent appends the exact text and latest visible message identity to owner history.
- Customer matching uses linked identity, exact normalized email, or normalized phone. Possible matches include available addresses and recent jobs. Owners can pick another record or enter a separate contact. The transaction creates or links the job and records the reason and prior identifiers. Corrections on jobs with booking or billing history remain in their respective workflows.
- Quick Job defaults to an unpriced Draft. Entering a date suggests Scheduled and the owner can override status. Estimate and approved price are independent from billable lines. Site contact, payer, service address, pricing and notes are editable in the job. A payer, if entered, is the contact used by the admin invoice PDF.
- Owner workflow state and history use the new owner-only Firestore paths in the schema. Later Thumbtack promotion reuses a manually linked job and customer. The isolated preview verifies frontend writes with fixtures, and the Functions regression verifies promotion against an in-memory Firestore stand-in. Authenticated Firestore rules, provider-backed intake, automation, and booking interactions still require verification with a configured environment and authorization. Preview writes reset on reload. Physical iPhone clipboard behavior is an owner check.

## Session 1 · Dashboard, navigation, and search

Status — Implemented in the workspace on November 14, 2026. Accepted before Session 2. The Session 1 lead and inquiry detail links now open their inbox detail.

### Preview

From the Handy workspace, run `npm run preview:admin` and open [the desktop preview](http://127.0.0.1:5174/admin/dashboard). To test from a phone on the same Wi-Fi, run `HANDY_PREVIEW_HOST=<Mac Wi-Fi IP> npm run preview:admin:phone` and open that IP on port 5175 at `/admin/dashboard`. The phone command serves a static synthetic build from a temporary directory. The two commands use separate ports and browser storage. At handoff the phone preview is running at [10.0.0.187:5175](http://10.0.0.187:5175/admin/dashboard).

Both previews use the current admin components with a disposable, in-memory backend. Reload to restore edited fixture records. Dashboard defer/dismiss and recent search persist in the current browser. Clear the site's storage to reset them. Callable providers are disabled. Production files, customer communications, and provider data are outside the preview.

### What shipped

- **Today, Upcoming, and Overdue** use Pacific calendar dates. Only dated, open commitments qualify. Upcoming starts tomorrow. Today includes all open commitments on the current Pacific date, even if their start time has passed. Scheduled and in-progress legacy jobs can use their saved date. Multi-visit jobs use their individual open visits. Pending requests are decisions and are labeled as pending in Calendar.
- **Needs reply and Needs a decision** show intake received today or in the six prior Pacific calendar days. Older or undated intake, migrated leads flagged as historical, and past booking requests appear in the collapsed Historical backlog. Age is based on receipt, so older active threads can still appear in backlog. Canonical leads suppress duplicate preliminary job rows.
- **Money due** links directly to the affected invoice, including invoice splits. It uses the existing line totals and invoice-level payments. The current app has no universal issued/due-date record, so an open balance on completed work is the default collection cue. Where an invoice has an explicit due date, it controls eligibility.
- **Queue actions** open the relevant job, lead, inquiry, booking, or invoice. Overlapping pending/approved booking requests are flagged. Defer hides an intake row until the next Pacific day. Dismiss hides that revision of a row. Undo restores it immediately, and Restore remains available under Deferred and dismissed. These controls affect the dashboard only and store their state in the browser.
- **Global search** indexes jobs, customers, leads, and guest inquiries. Results show type, status, and available address. Search supports arrow keys, Enter, Escape, and Cmd/Ctrl+K. Recent matches are the last six opened results, resolved against the current records.
- **Navigation** uses labeled daily destinations and a More menu for Reports, Tasks, Tools, and Availability. Dashboard, agenda, booking review, and search share button, status, and focus styling. Selected destinations use colored, underlined text. On phones, navigation and action groups use aligned grids with 44-pixel touch targets. The visual follow-up covered dashboard, agenda, jobs, job actions, invoice controls, booking review and availability at 320, 375, 390 and 430 CSS pixels.

### Acceptance script

Start each step from **Today** and repeat at desktop and phone widths.

1. Under **Today**, open **Install closet shelves**. The job shows the 10:00 a.m. Pacific installation at 24 Alder Lane.
2. Under **Overdue**, choose **Review job** for **Repair side gate**. The job shows In Progress and a date three Pacific calendar days earlier.
3. Under **Needs reply**, select **Review reply** for **Avery Chen**. The lead opens with a draft that asks for the mirror dimensions and wall type.
4. Under **Needs a decision**, open **Install stair handrail**. The selected booking shows the overlap with **Older window-trim request**.
5. Under **Money due**, open **Adjust cabinet hinges**. Invoice 1 shows $225.00 total, $100.00 paid, and $125.00 balance.
6. Select **Search**, enter **19 Juniper Lane**, and use ↓ then Enter on desktop or tap the Lead result on phone. Avery Chen's lead opens. Focus the empty search again to see Avery under **Recent matches**.
7. On Today, choose **Dismiss** beside Avery Chen. The row leaves Needs reply and the count drops. Choose **Undo** and verify the row and count return. To check persistence, use **Defer**, reload, expand **Deferred and dismissed**, and choose **Restore**.
8. Expand **Upcoming** and verify that **Mount laundry shelf** appears. Expand **Historical backlog** and verify that **Casey Moore** and **Replace closet track** appear there. Open **More** to find Reports, Tasks, Tools, and Availability.
9. Optional disposable write check. Open **Robin Shah** under Needs reply, choose **Mark reviewed**, and return to Today. Robin leaves the queue. Reload to restore the fixture.

### Verification and follow-up

The previous guest inquiry handoff is `.superpowers/sdd/task-6-report.md`. Its direct inquiry flow and opaque customer identifiers were the starting point. The assessment's November 13 live observations were treated as historical.

The root test suite and production build passed. Chrome verification covered 1365 CSS pixels and 390 CSS pixels with an Asia/Tokyo browser time zone, including fixture review writes, direct links, keyboard search, address search, dismiss/undo, persistence, and a network allowlist limited to the preview origin. The phone-width script passed against both the loopback and LAN builds. The build retains the existing large-chunk warning.

Still to verify with authorization and the corresponding environment are authenticated reads against the live owner dataset, provider-backed booking/calendar, Thumbtack/Telnyx, and payment paths. This session uses the current frontend status and follow-up fields. Fresh message-level triage for old threads belongs to Session 2. Visit edits, provider conflict checks and retries belong to Session 3. Physical-phone touch, zoom, and VoiceOver are owner acceptance checks. Browser-local dashboard preferences do not synchronize between devices.

## Assessment recommendation tracker

- **Rank 1 / workflow 01 — Start the day and find work.** Session 1 implemented actionable date and intake queues, historical separation, address and lead search, keyboard/recent matches, and direct actions.
- **Rank 2 — Safe changes.** Session 1 implemented labeled navigation and reversible queue visibility. Sessions 2–4 cover draft recovery, save/error status, material change history and previews, and reversible archive as the relevant writes are revised.
- **Rank 3 / workflows 02–04 — Triage, scheduling, and quick creation.** Session 1 implemented navigation to existing records, a Pacific agenda cutoff, and request overlap visibility. Session 2 implemented the unified inbox, reply editor, comparison collapse, manual reply workflow, matching and conversion, quick job creation, pricing stages, and separate payer/site contact/address. Live-provider verification remains open. Session 3 implemented the shared visit editor, editable duration/travel defaults, overlap review, affected-record preview, multiple visits, sync state/retry, and communication status. Live calibration and provider verification remain open.
- **Rank 4 / workflows 05–06 and 09 — Field work and costs.** Session 3 implemented mobile field actions, labeled job tabs, timer capture and rounding, manual correction and reopen, archive placement, one-off tasks and packing, and fast expenses with billing links. Equipment return tracking belongs with parts/deferred work in Session 5.
- **Rank 5 / workflow 07 — Invoice, collect, and correct.** Session 1 added direct invoice entry from Money due. Session 4 implemented selected invoice emphasis, adjacent preview and line editing, issued versions, split and comp safeguards, separate payment/refund/date corrections, impact preview, and reconciliation.
- **Rank 6 / workflow 08 — Close out and reconcile.** Session 4 implemented independent visit/job/invoice/payment states, missing-data and balance links, exception reasons, reversible archive, and period/legacy reconciliation.
- **Rank 7 / workflow 09 — Visual controls and mobile use.** Session 1 implemented labeled daily navigation, grouped management destinations, and shared controls on touched screens. Wider job, save-state, and field-action changes follow their workflow sessions. Physical-device and assistive-technology checks remain open.
- **Bonus 1, 2, 3 and 6.** Session 5 implemented approved change orders, private arrival and access, parts and deferred work, and warranty/callback jobs. Live Calendar and security rules verification remain open.
- **Bonus 4, 5 and 7.** Session 6 implemented receipt extraction and splits, offline capture with sync/conflict recovery, and voice-to-draft review. Live extraction and physical-device checks remain open.
- **Evidence and acceptance.** The Session 1 script covers daily discovery, the booking conflict, search, and undo. Workflow timing comparisons and full standard, split, refund/cancellation, and missing-detail scenarios belong to the relevant later sessions. Session 6 completed the full synthetic lead-to-payment, cancellation/refund, and capture workflows in desktop and phone-width Chrome. Physical device and live provider verification remain open.
