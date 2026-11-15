import { expect, test } from "vitest";
import { customerMatches, intakeRows } from "./intake";

test("surfaces both matches and keeps the raw customer distinct from the owner choice", () => {
  const lead = { id: "l", status: "active", phone: "+1 (415) 555-0100", customerId: "old" };
  const customers = [{ id: "old" }, { id: "chosen", phone: "415-555-0100" }];
  const [source] = intakeRows({ leads: [lead], customers, inquiries: [], jobs: [],
    intake: { "lead:l": { customerId: "chosen", jobId: "j" } } });
  expect(source).toMatchObject({ customerId: "chosen", jobId: "j", row: { customerId: "old" } });
  expect(customerMatches(source, customers).map(row => row.id)).toEqual(["old", "chosen"]);
});

test("a newly assessed reply reopens Waiting without duplicating its preliminary job", () => {
  const lead = { id: "l", status: "active", jobId: "j",
    followUp: { owner: "business", evidence: [{ messageId: "new" }] } };
  const [source, extra] = intakeRows({ leads: [lead], customers: [], inquiries: [],
    jobs: [{ id: "j", status: "Draft", source: "thumbtack" }],
    intake: { "lead:l": { group: "Waiting", acknowledgedEvidence: "old" } } });
  expect(source.group).toBe("Next reply");
  expect(extra).toBeUndefined();
});
