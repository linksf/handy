import { describe, expect, test } from "vitest";
import { generateOpaqueCustomerId, isOpaqueCustomerId } from "@handy/shared";

describe("customerIds", () => {
  test("generateOpaqueCustomerId returns 18 digits", () => {
    const id = generateOpaqueCustomerId();
    expect(id).toMatch(/^\d{18}$/);
  });

  test("generateOpaqueCustomerId values differ", () => {
    expect(generateOpaqueCustomerId()).not.toBe(generateOpaqueCustomerId());
  });

  test("isOpaqueCustomerId accepts Thumbtack-shaped ids", () => {
    expect(isOpaqueCustomerId("521561969212661774")).toBe(true);
    expect(isOpaqueCustomerId("abc")).toBe(false);
    expect(isOpaqueCustomerId("")).toBe(false);
  });
});
