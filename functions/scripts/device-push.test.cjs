const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkedEndpoint } = require("../lib/devicePush");

test("Web Push endpoints are restricted to supported HTTPS services", () => {
  for (const url of [
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/Qtoken",
  ]) assert.equal(checkedEndpoint(url), url);
  for (const url of [
    "http://fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com.fake.test/fcm/send/token",
    "https://127.0.0.1/private",
    "https://fcm.googleapis.com@local.test/token",
    "https://test@fcm.googleapis.com/token",
    "https://fcm.googleapis.com:8443/token",
    "https://fcm.googleapis.com/",
  ]) assert.throws(() => checkedEndpoint(url));
});
