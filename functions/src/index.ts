/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});
export {telnyxWebhook, telnyxWebhookFallback, processTelnyxEvent} from "./telnyxWebhook";

export {thumbtackWebhook} from "./thumbtackWebhook";
export {connectThumbtack} from "./thumbtackOAuth";

export {bookingRequestStatusNotifier} from "./bookingRequestNotifier";
export {matchLeadInvite} from "./leadInvite";
export {submitInquiry, linkInquiryToClient} from "./submitInquiry";
export {
  processThumbtackConversations,
  emailDailyLeadBrief,
} from "./leadAutomation";
export {syncThumbtackContacts} from "./leadContacts";
export {processLeadTelegram} from "./leadTelegram";
export {approveLeadBooking} from "./leadWorkflow";
export {correctJobPaymentDate, recordJobPayment, recordLeadCost, getFinancialReport, emailWeeklyFinancialReport, emailMonthlyFinancialReport} from "./leadFinance";
export {researchJobEquipment} from "./equipmentResearch";
export {reviewLeadCleanup, prepareLeadCleanup} from "./leadMigration";
export {refreshLeadFeeExpense, refreshLeadFacts} from "./leadTriggers";

export {draftThumbtackInitialResponse} from "./leadIntro";
export {draftThumbtackInitialResponseOpenAI} from "./leadIntroOpenAI";
export {emailThumbtackDraftComparison} from "./leadDraftEmail";

export {syncAdminVisit} from "./adminVisit";

export {draftAdminCapture} from "./adminCapture";

export {getDevicePushConfig, registerDevicePush, removeDevicePush, pushNewLead, pushNewInquiry, pushNewBooking} from "./devicePush";
