const MESSAGES = {
  "auth/invalid-phone-number": "Enter a valid phone number (US: 10 digits, or include +country code).",
  "auth/missing-phone-number": "Enter your phone number.",
  "auth/invalid-verification-code": "That code is incorrect. Check the text message and try again.",
  "auth/code-expired": "That code expired. Send a new code and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/captcha-check-failed": "Security check failed. Refresh the page and try again.",
  "auth/quota-exceeded": "SMS limit reached. Try again later or use email sign-in.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/operation-not-allowed": "Phone sign-in is not enabled for this app yet.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/timeout":
    "Sending the code timed out. Check the security checkbox below, then try again—or use Email sign-in.",
  "auth/missing-app-credential": "Security verification failed. Refresh the page and try again.",
  "auth/invalid-app-credential": "Security verification failed. Refresh the page and try again.",
};

export function authErrorMessage(err, fallback = "Something went wrong. Try again.") {
  if (!err) return fallback;
  return MESSAGES[err.code] || err.message || fallback;
}
