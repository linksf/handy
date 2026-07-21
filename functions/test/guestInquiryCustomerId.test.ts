import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {isOpaqueCustomerId} from "@handy/shared";
import {validateInquiryInput} from "../src/submitInquiry";
import {
  buildThumbtackCustomerWritePayload,
  resolveThumbtackCustomerId,
} from "../src/thumbtackWebhook";

describe("guest inquiry size validation", () => {
  const validInput = {
    category: "handyman",
    name: "Guest",
    description: "Repair a door",
  };

  it("rejects oversized inquiry strings", () => {
    assert.throws(
      () => validateInquiryInput({...validInput, name: "n".repeat(121)}),
      (error: unknown) => (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "invalid-argument"
      ),
    );
    assert.throws(
      () => validateInquiryInput({
        ...validInput,
        accessNotes: "a".repeat(1001),
      }),
      /maximum length/i,
    );
  });

  it("rejects too many or oversized photo URLs", () => {
    assert.throws(
      () => validateInquiryInput({
        ...validInput,
        photoUrls: Array.from({length: 11}, (_, i) => `https://x.test/${i}`),
      }),
      /at most 10/i,
    );
    assert.throws(
      () => validateInquiryInput({
        ...validInput,
        photoUrls: ["x".repeat(2001)],
      }),
      /maximum length/i,
    );
  });
});

describe("Thumbtack customer ID fallback", () => {
  it("preserves a valid Thumbtack customer ID", () => {
    const id = "123456789012345678";
    assert.equal(resolveThumbtackCustomerId(id), id);
  });

  it("generates an opaque ID for missing or invalid IDs", () => {
    const missing = resolveThumbtackCustomerId("");
    const invalid = resolveThumbtackCustomerId("customer-123");
    assert.equal(isOpaqueCustomerId(missing), true);
    assert.equal(isOpaqueCustomerId(invalid), true);
  });

  it("omits invalid Thumbtack IDs from customer writes", () => {
    const payload = buildThumbtackCustomerWritePayload({
      name: "Guest",
      phone: "",
      email: "",
      address: "",
      customerNotes: "",
      thumbtackCustomerId: "customer-123",
    }, "token", "timestamp", false);

    assert.equal("thumbtackCustomerId" in payload, false);
  });
});
