#!/usr/bin/env node
/**
 * Sets Firebase Auth custom claim { role: "owner" } on a user by email.
 * After running, the user must sign out and sign in again to refresh their ID token.
 *
 * Prerequisites:
 * - firebase-admin (npm install)
 * - Application Default Credentials, e.g.
 *     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   (Firebase console → Project settings → Service accounts → Generate new private key)
 *
 * Usage:
 *   node scripts/setOwnerClaim.mjs owner@example.com
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import admin from "firebase-admin";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/setOwnerClaim.mjs <owner-email>");
  process.exit(1);
}

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : null;
if (!credPath || !existsSync(credPath)) {
  console.error(
    "Set GOOGLE_APPLICATION_CREDENTIALS to the absolute path of your Firebase service account JSON."
  );
  process.exit(1);
}

const sa = JSON.parse(readFileSync(credPath, "utf8"));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
  });
}

const user = await admin.auth().getUserByEmail(email);
await admin.auth().setCustomUserClaims(user.uid, { role: "owner" });
console.log(`Set custom claim role=owner on uid=${user.uid} (${user.email})`);
console.log("Ask this user to sign out and sign in again so the new token is picked up.");
