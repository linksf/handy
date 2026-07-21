import { describe, expect, test } from "vitest";
import { adminPathForView, parseAdminPath } from "./adminRoutes";

describe("inquiries admin route", () => {
  test("builds the inquiries path", () => {
    expect(adminPathForView("inquiries")).toBe("/admin/inquiries");
  });

  test("parses the inquiries path", () => {
    expect(parseAdminPath("/admin/inquiries")).toEqual({ view: "inquiries", param: null });
  });
});
