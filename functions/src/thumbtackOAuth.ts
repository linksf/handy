import {createHash, randomBytes} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {defineJsonSecret} from "firebase-functions/params";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {OAuth2Client} from "google-auth-library";
import {isOwnerAuth} from "./ownerAuth";

const credentials = defineJsonSecret("THUMBTACK_OAUTH_CLIENT");
const redirectUri = "https://handy.omnificology.com/oauth/thumbtack/callback";
const stateLifetimeMs = 10 * 60 * 1000;
const readScopes = /^supply::[a-z][a-z0-9_.-]*\.read$/;

function oauthClient() {
  const config = credentials.value();
  if (!config || !["staging", "production"].includes(config.environment) ||
      typeof config.clientId !== "string" || !config.clientId.trim() ||
      typeof config.clientSecret !== "string" || !config.clientSecret.trim() ||
      !Array.isArray(config.scopes) || config.scopes.length === 0 ||
      !config.scopes.every((scope: unknown) => typeof scope === "string" && readScopes.test(scope))) {
    throw new HttpsError("failed-precondition", "Thumbtack OAuth credentials and approved read scopes are required.");
  }
  const origin = config.environment === "staging" ?
    "https://staging-auth.thumbtack.com" : "https://auth.thumbtack.com";
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri,
    endpoints: {oauth2AuthBaseUrl: origin + "/oauth2/auth", oauth2TokenUrl: origin + "/oauth2/token"},
  });
  return {
    client,
    environment: config.environment as string,
    clientId: config.clientId as string,
    scope: [...new Set<string>(config.scopes), "offline_access"],
  };
}

export const connectThumbtack = onCall({secrets: [credentials], timeoutSeconds: 30}, async (request) => {
  if (!request.auth || !isOwnerAuth(request.auth)) {
    throw new HttpsError("permission-denied", "Owner access required.");
  }

  const {uid} = request.auth;
  const {client, environment, clientId, scope} = oauthClient();
  if (!getApps().length) initializeApp();
  const db = getFirestore();
  const pending = db.collection("thumbtackOAuthPending").doc(uid);
  const connection = db.collection("thumbtackOAuthConnections").doc(environment)
    .collection("owners").doc(uid);

  if (request.data?.action === "start") {
    const state = randomBytes(32).toString("hex");
    await pending.set({stateHash: hashState(state), clientId, environment, expiresAt: Date.now() + stateLifetimeMs});
    const url = new URL(client.generateAuthUrl({response_type: "code", scope, state}));
    url.searchParams.set("audience", "urn:partner-api");
    return {url: url.toString()};
  }

  const {state, code} = request.data ?? {};
  if (request.data?.action !== "finish" || typeof state !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) || typeof code !== "string" || !code || code.length > 4096) {
    throw new HttpsError("invalid-argument", "Start a new Thumbtack connection.");
  }

  await db.runTransaction(async (transaction) => {
    const record = (await transaction.get(pending)).data();
    if (!record || record.expiresAt <= Date.now() || record.stateHash !== hashState(state) ||
        record.environment !== environment || record.clientId !== clientId) {
      throw new HttpsError("failed-precondition", "This Thumbtack connection attempt has expired. Start again.");
    }
    transaction.delete(pending);
  });

  try {
    const {tokens} = await client.getToken({code, redirect_uri: redirectUri});
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      throw new Error("Incomplete token response");
    }
    await connection.set({
      clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date,
      grantedScope: tokens.scope ?? null,
      connectedAt: Date.now(),
    });
  } catch {
    throw new HttpsError("failed-precondition", "Could not complete Thumbtack authorization. Start a new connection.");
  }
  return {environment};
});

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
