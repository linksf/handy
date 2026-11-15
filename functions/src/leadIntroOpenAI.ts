/* eslint-disable require-jsdoc, valid-jsdoc, max-len */
import * as admin from "firebase-admin";
import {defineSecret, defineString} from "firebase-functions/params";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {INTRO_INSTRUCTIONS, generateIntro, processInitialIntro, validateIntroFacts} from "./leadIntro";
import {CalendarApi, workspaceAccessToken} from "./leadAutomationGoogle";
import {CALENDAR_ID, Row} from "./leadIntroCore";
import {hash, TIME_ZONE} from "./leadAutomationCore";
const apiKey = defineSecret("LEAD_INTRO_OPENAI_API_KEY");
const oauth = defineSecret("LEAD_AUTOMATION_GOOGLE_OAUTH");
const model = defineString("LEAD_INTRO_OPENAI_MODEL", {default: "gpt-6.1-sol"});
export const OPENAI_INTRO_FIELD = "initialResponseOpenAI";
export const OPENAI_INTRO_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["acknowledgment", "quoteRequested", "quoteEvidence", "durationMinutes", "constraints", "review"],
  properties: {
    acknowledgment: {type: "string"}, quoteRequested: {type: "boolean"}, quoteEvidence: {type: "string"}, durationMinutes: {type: "integer"},
    constraints: {type: "array", items: {type: "object", additionalProperties: false, required: ["start", "end", "evidence"], properties: {start: {type: "string"}, end: {type: "string"}, evidence: {type: "string"}}}},
    review: {type: "array", items: {type: "string"}},
  },
};
export function openAIIntroBody(modelName: string, lead: Row, receivedAt: string): Row {
  if (!/^[a-z0-9.-]+$/.test(modelName)) throw new Error("openai_model_invalid");
  return {model: modelName, instructions: INTRO_INSTRUCTIONS, input: JSON.stringify({lead, receivedAt, timeZone: TIME_ZONE}),
    text: {format: {type: "json_schema", name: "initial_lead_facts", strict: true, schema: OPENAI_INTRO_SCHEMA}},
    reasoning: {effort: "low"}, max_output_tokens: 8192, store: false};
}
export function parseOpenAIIntro(response: Row, lead: Row): Row {
  if (response.status !== "completed") throw new Error("openai_response_incomplete");
  const content = (response.output || []).filter((v: Row) => v.type === "message").flatMap((v: Row) => v.content || []);
  if (content.some((v: Row) => v.type === "refusal")) throw new Error("openai_response_refused");
  const text = content.filter((v: Row) => v.type === "output_text").map((v: Row) => v.text || "").join("");
  if (!text) throw new Error("openai_response_empty");
  return validateIntroFacts(JSON.parse(text), lead);
}
export async function extractOpenAIIntroFacts(key: string, modelName: string, lead: Row, receivedAt: string, request?: (body: Row) => Promise<Row>): Promise<{facts: Row; provenance: Row}> {
  const body = openAIIntroBody(modelName, lead, receivedAt);
  let response: Row;
  if (request) response = await request(body);
  else {
    if (!key.trim()) throw new Error("openai_key_missing");
    const r = await fetch("https://api.openai.com/v1/responses", {method: "POST", headers: {"Authorization": `Bearer ${key}`, "Content-Type": "application/json"}, body: JSON.stringify(body), signal: AbortSignal.timeout(90000)});
    if (!r.ok) {
      const error = await r.json().catch(() => ({})) as Row;
      const code = typeof error.error?.code === "string" && /^[a-z0-9_]{1,80}$/.test(error.error.code) ? `_${error.error.code}` : "";
      // Error messages can echo inputs; retain only allowlisted status/code.
      throw new Error(`openai_http_${r.status}${code}`);
    }
    response = await r.json() as Row;
  }
  return {facts: parseOpenAIIntro(response, lead), provenance: {provider: "openai", model: response.model || modelName, requestedModel: modelName, responseId: response.id || null, usage: response.usage || null, promptHash: hash(INTRO_INSTRUCTIONS)}};
}
export async function generateOpenAIIntro(key: string, modelName: string, lead: Row, receivedAt: string, now: number, calendar: (start: string, end: string) => Promise<Row[]>, request?: (body: Row) => Promise<Row>): Promise<Row> {
  let provenance: Row = {};
  const result = await generateIntro(lead, receivedAt, now, {calendar, analyze: async () => {
    const extraction = await extractOpenAIIntroFacts(key, modelName, lead, receivedAt, request);
    provenance = extraction.provenance;
    return extraction.facts;
  }});
  return {...result, ...provenance};
}
export const draftThumbtackInitialResponseOpenAI = onDocumentCreated({document: "thumbtackConversations/{threadId}/events/{eventId}", secrets: [apiKey, oauth], retry: true, timeoutSeconds: 300, maxInstances: 3}, async (event) => {
  if (event.params.eventId !== "initial-lead" || event.data?.get("kind") !== "lead") return;
  if (!admin.apps.length) admin.initializeApp();
  await processInitialIntro(admin.firestore(), event.params.threadId, event.data.data(), {generate: async (lead, receivedAt) => generateOpenAIIntro(apiKey.value(), model.value(), lead, receivedAt, Date.now(),
    async (start, end) => new CalendarApi(await workspaceAccessToken(oauth.value()), CALENDAR_ID).list(start, end))}, Date.now(), OPENAI_INTRO_FIELD);
});
