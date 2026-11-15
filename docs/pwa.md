# Handy on a device

## Isolated install and offline test

Run `npm run preview:pwa` and open [the synthetic PWA](http://127.0.0.1:5176/admin/dashboard). The server is bound to loopback and uses fixtures. The local preview shows test notifications through the actual service worker. It does not register with a live push provider.

1. Open **Install and device settings** from Account. Wait for **Offline app shell ready on this device**.
2. Use **Install Handy** if the browser offers it, or use the browser’s install menu. On iPhone, serve over HTTPS, then use Safari’s **Share → Add to Home Screen** and open from the icon.
3. Open a job, switch the browser offline, and reload the deep link. The app shell and bundled assets still load. Open Capture and queue a note. Bring the browser online and verify it syncs.
4. Select **Show test notification**, allow permission, and verify the system notification appears. The live app uses **Enable notifications** and an authenticated push subscription.

## Production setup

Serve the production build over HTTPS. The Vite build generates a versioned worker with its own list of HTML, scripts, styles, icons and other bundled assets. Firebase serves the worker with revalidation. A new worker waits until the app is closed or the owner uses **Reload to update Handy**. Cache Storage holds app assets. Authentication, API and provider requests stay on their normal network paths.

On a trusted device, sign in, open **Install and device settings**, and select **Keep records on this device**. After the reload, open the jobs and records needed in the field. The Firestore cache provides previously loaded records and is independent of the offline capture queue. Sign into the relevant account while online before going offline. Use **Clear offline records** to remove the stored Firestore data. Close other Handy tabs first when clearing. Unsent capture drafts are managed separately in Capture.

For background Web Push, provision a P-256 VAPID key pair for the intended Firebase environment. One way to generate it locally is `cd functions && npx web-push generate-vapid-keys`. Store JSON with `publicKey`, `privateKey` and a `mailto:` `subject` in the Firebase Functions secret `HANDY_WEB_PUSH_VAPID`. Keep the same keys across releases. Changing the keys requires clients to unsubscribe and enroll again. Set the Firebase secret and release Hosting and the appropriate Functions only as part of an authorized rollout.

Owners who opt in receive generic alerts for new leads, guest inquiries and booking requests. Signed-in clients who opt in receive a generic alert when their booking is approved or declined. Notification text contains no customer names, addresses or payment information. Subscriptions are tied to the signed-in user, and sign-out attempts to unsubscribe this installation.

Live bookings, ledger transactions, provider extraction and pushes require connectivity. First sign-in requires connectivity. Offline cache eviction, custom-claim refresh, and native notification delivery still need physical-device verification in the intended environment.
