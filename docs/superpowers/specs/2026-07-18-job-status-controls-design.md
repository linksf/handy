# Job Status Controls Design

## Goal

Allow the owner to change a job's status quickly from both the Jobs list and the Job Details page. A selected status is saved immediately and confirmed through the app's existing toast notification.

## Current Behavior

Job statuses are stored in `jobs.status` and use the values defined by `STATUSES`:

- Draft
- Scheduled
- In Progress
- Complete
- Cancelled

The status can currently be changed only by opening a job, entering the full Job Details edit form, selecting a status, and saving the whole form.

## User Experience

A compact status dropdown will be shown:

1. In every card on the Jobs list, replacing the static status badge.
2. On the Job Details card, beside the displayed Status value.

The dropdown initially shows the job's current status. Selecting another status immediately saves the new value. The control is disabled while the save is in progress, preventing overlapping updates.

On success, the existing `updateJob` behavior displays the "Job saved!" toast. The Firestore snapshot updates the job everywhere in the application.

On failure, the dropdown returns to the last persisted status and becomes usable again. The failure is surfaced to the user rather than leaving the control displaying an unsaved value.

Changing status from a Jobs-list card must not trigger the card's navigation to Job Details.

## Architecture

Create a reusable `JobStatusSelect` UI component. Its public inputs are:

- `job`: supplies the job ID and current status.
- `updateJob`: persists the updated job.
- Optional styling or compact presentation inputs only if required by the two placements.

The component owns only temporary UI state: the displayed selection and whether a save is in progress. Firestore persistence remains in the existing `App.updateJob` mutation so status changes follow the same authorization and toast behavior as other job updates.

The existing status field in the full Job Details edit form remains available and unchanged.

## Data Flow

1. The owner selects a value from `STATUSES`.
2. The component optimistically displays that value and disables itself.
3. It calls `updateJob({ ...job, status: nextStatus })`.
4. On success, the real-time Firestore listener supplies the persisted job state and the existing success toast appears.
5. On failure, the component restores `job.status`, displays an error, and re-enables itself.

No Firestore schema, security-rule, webhook, or migration changes are required.

## Error Handling

- Ignore selection of the already-current status.
- Disable the dropdown during persistence.
- Restore the persisted status if persistence fails.
- Surface a concise failure message.
- Treat an unknown existing status defensively by displaying it until the owner chooses a supported value.

## Testing

Tests will verify:

- All values from `STATUSES` are offered.
- Selecting a different status invokes the update callback with the job and new status.
- Selecting the existing status does not write.
- The control is disabled while an update is pending.
- A rejected update restores the persisted status and reports failure.
- Interaction in a Jobs-list card does not navigate to Job Details.

The project build and lint diagnostics for edited files will also be run.

## Out of Scope

- Status-transition restrictions or workflow rules.
- Confirmation dialogs for specific statuses.
- Automatic side effects such as stopping work sessions, changing payment status, or notifying clients.
- A status-change audit history.
