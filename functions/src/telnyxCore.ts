import {createPublicKey, verify} from "crypto";

export function verifyTelnyx(raw: Buffer, timestamp: string, signature: string, publicKey: string, now = Date.now()): boolean {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  try {
    const key = publicKey.includes("BEGIN PUBLIC KEY") ? createPublicKey(publicKey) : createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "base64")]),
      format: "der", type: "spki",
    });
    return key.asymmetricKeyType === "ed25519" && verify(null, Buffer.concat([Buffer.from(`${timestamp}|`), raw]), key, Buffer.from(signature, "base64"));
  } catch { return false; }
}

export interface SmsEvent {
  id: string; event_type: string; occurred_at: string;
  payload: {id: string; text?: string; from?: {phone_number?: string}; to?: {phone_number?: string; status?: string}[]; [key: string]: unknown};
}
export function parseSmsEvent(raw: Buffer): SmsEvent {
  const event = JSON.parse(raw.toString("utf8"))?.data;
  if (!event || typeof event.id !== "string" || !/^[\w-]{1,128}$/.test(event.id) ||
    typeof event.event_type !== "string" || event.event_type.length > 100 ||
    !Number.isFinite(Date.parse(event.occurred_at)) || typeof event.payload?.id !== "string" ||
    !/^[\w-]{1,128}$/.test(event.payload.id)) throw new Error("invalid_event");
  if (event.event_type === "message.received" && (typeof event.payload.text !== "string" ||
    !/^\+[1-9]\d{6,14}$/.test(event.payload.from?.phone_number || "") ||
    !Array.isArray(event.payload.to) || !event.payload.to.length)) throw new Error("invalid_sms");
  return event;
}
