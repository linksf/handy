/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import {acceptClarification} from "./leadNotifications";
import {TIME_ZONE} from "./leadAutomationCore";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const botToken = defineSecret("LEAD_TELEGRAM_BOT_TOKEN");
export async function telegramCall(token: string, method: string, body: Row): Promise<Row> {
  // Network exceptions may include URLs containing the bot token. Never propagate them.
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), signal: AbortSignal.timeout(25000)});
  } catch {
    throw new Error("telegram_delivery_unknown");
  }
  let value;
  try {
    value = await response.json() as Row;
  } catch {
    throw new Error("telegram_delivery_unknown");
  }
  if (!response.ok || !value.ok) throw new Error(`telegram_http_${Number(value.error_code || response.status)}`);
  return value.result;
}
export function ownerUpdate(update: Row, config: Row): boolean {
  const message = update.callback_query?.message || update.message;
  const from = update.callback_query?.from || update.message?.from;
  return message?.chat?.type === "private" && String(message.chat.id) === String(config.chatId) && String(from?.id) === String(config.ownerId) && !from?.is_bot;
}
export function clarificationId(update: Row): string | null {
  const callback = /^q:([a-f0-9]{24}):(am|pm|ask)$/.exec(update.callback_query?.data || "");
  if (callback) return callback[1];
  const reply = /Reference: ([a-f0-9]{24})\b/.exec(update.message?.reply_to_message?.text || "");
  return reply?.[1] || null;
}
export async function handleTelegramUpdate(db: admin.firestore.Firestore, call: (method: string, body: Row) => Promise<Row>, update: Row, config: Row): Promise<void> {
  if (!ownerUpdate(update, config)) return;
  const id = clarificationId(update);
  let text = "Reply directly to a scheduling question to clarify it. Booking alerts and questions will appear here automatically.";
  if (id) {
    const action = String(update.callback_query?.data || "").split(":")[2];
    if (action === "ask") {
      text = "Please confirm the missing detail with the client, then reply to my question here. I haven’t sent the client a message or changed the booking.";
    } else {
      const answer = action === "am" ? "The time in the question is AM." : action === "pm" ? "The time in the question is PM." : String(update.message?.text || "");
      text = await acceptClarification(db, id, answer, Number(update.update_id));
    }
  }
  if (update.callback_query?.id) await call("answerCallbackQuery", {callback_query_id: update.callback_query.id, text: "Received"}).catch(() => ({}));
  await call("sendMessage", {chat_id: config.chatId, text});
}
export const processLeadTelegram = onSchedule({schedule: "every 1 minutes", timeZone: TIME_ZONE, timeoutSeconds: 120, maxInstances: 1, concurrency: 1, secrets: [botToken], retryCount: 0}, async () => {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore(); const state = db.doc("leadAutomationState/telegram"); const owner = randomUUID();
  const config = await db.runTransaction(async (tx) => {
    const s = await tx.get(state);
    if (!s.get("enabled") || !s.get("chatId") || !s.get("ownerId") || Number(s.get("leaseUntil") || 0) > Date.now()) return null;
    tx.update(state, {owner, leaseUntil: Date.now() + 180000}); return s.data();
  });
  if (!config) return;
  const deadline = Date.now() + 80000;
  const call = (method: string, body: Row): Promise<Row> => telegramCall(botToken.value(), method, body);
  try {
    const updates = await call("getUpdates", {offset: Number(config.offset || 0), timeout: 0, limit: 30, allowed_updates: ["message", "callback_query"]}) as unknown as Row[];
    for (const update of updates) {
      if (Date.now() > deadline) break;
      await handleTelegramUpdate(db, call, update, config);
      await state.update({offset: Number(update.update_id) + 1});
    }
    const pending = await db.collection("leadNotifications").where("status", "==", "pending").limit(10).get();
    for (const item of pending.docs) {
      if (Date.now() > deadline) break;
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(item.ref); const d = fresh.data();
        if (!d || d.status !== "pending") return null;
        const thread = await tx.get(db.doc(`thumbtackConversations/${d.threadId}`));
        if (d.kind === "clarification" && (!thread.exists || Number(thread.get("version")) !== Number(d.version))) {
          tx.update(item.ref, {status: "superseded"}); return null;
        }
        tx.update(item.ref, {status: "sending", attemptedAt: admin.firestore.FieldValue.serverTimestamp()}); return d;
      });
      if (!claimed) continue;
      const keyboard = claimed.ampm ? {inline_keyboard: [[{text: "AM", callback_data: `q:${item.id}:am`}, {text: "PM", callback_data: `q:${item.id}:pm`}], [{text: "I'll ask the client", callback_data: `q:${item.id}:ask`}]]} : undefined;
      try {
        const sent = await call("sendMessage", {chat_id: config.chatId, text: `${String(claimed.text).slice(0, 3800)}\n\nReference: ${item.id}`, link_preview_options: {is_disabled: true}, ...(keyboard ? {reply_markup: keyboard} : {})});
        await item.ref.update({status: "sent", telegramMessageId: sent.message_id, sentAt: admin.firestore.FieldValue.serverTimestamp()});
      } catch (e) {
        const code = e instanceof Error ? e.message : "telegram_delivery_unknown";
        // A rate-limit rejection is a definite non-send and can safely retry.
        await item.ref.update({status: code === "telegram_http_429" ? "pending" : "delivery_unknown", lastError: code});
        if (code === "telegram_http_429") break;
      }
    }
    const failures = await db.collection("leadNotifications").where("status", "in", ["sending", "delivery_unknown"]).get();
    await state.update({lastError: failures.empty ? null : "telegram_alert_delivery_unconfirmed", lastRunAt: admin.firestore.FieldValue.serverTimestamp()});
  } catch (e) {
    const code = e instanceof Error && /^telegram_[a-z0-9_]+$/.test(e.message) ? e.message : "telegram_processing_failed";
    await state.update({lastError: code});
  } finally {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(state); if (s.get("owner") === owner) tx.update(state, {leaseUntil: 0});
    });
  }
});
