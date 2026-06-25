import { ALLOWED_GOOGLE_EMAIL } from "../constants";
import { getGoogleEmailFromUser, isEmailAllowlisted } from "./allowlistEmail";

/**
 * Same rule as the /admin gate in useAuth: allowlisted Google email or custom claim role "owner".
 */
export async function isOwnerFirebaseUser(user) {
  if (!user) return false;
  const email = getGoogleEmailFromUser(user);
  if (email && isEmailAllowlisted(email, ALLOWED_GOOGLE_EMAIL)) return true;
  try {
    const { claims } = await user.getIdTokenResult(true);
    return claims.role === "owner";
  } catch {
    return false;
  }
}
