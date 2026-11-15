export const trustedDeviceKey = "handy.offline.trusted-device";
export function offlineEnabled() {
  try { return localStorage.getItem(trustedDeviceKey) === "yes"; }
  catch { return false; }
}
