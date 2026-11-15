import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { buildJobInvoiceLines, invoiceTotalFromLines } from "./jobInvoiceLines";
import { buildJobInvoiceLines as serverLines } from "../../server/jobInvoiceLines.mjs";
import { hourlyLaborTotal, cashReport } from "../../shared/finance.js";
const require = createRequire(import.meta.url);
const functionLines = require("../../functions/lib/jobInvoiceLines.js").buildJobInvoiceLines;

const job = { status: "Complete", laborEntries: [
  { name: "Planning", hours: "1", hourlyRate: "0" },
  { name: "Standard labor", hours: "4", hourlyRate: "75" },
  { name: "Two-person crew", hours: "2", hourlyRate: "100" },
] };

test("all invoice paths include complimentary planning and multiple labor rates", () => {
  const lines = buildJobInvoiceLines(job);
  expect(lines.map(line => line.amountCents)).toEqual([0, 30000, 20000]);
  expect(lines[0].name).toBe("Planning (1 hr × $0.00/hr)");
  expect(invoiceTotalFromLines(lines)).toBe(500);
  expect(serverLines(job)).toEqual(lines);
  expect(functionLines(job)).toEqual(lines);
  expect(hourlyLaborTotal(job)).toBe(500);
  expect(cashReport({ jobs: [job] }, { start: "2026-10-01", end: "2026-11-01" }).outstandingCents).toBe(50000);
});

test("existing hours, flat prices, and reimbursements remain additive", () => {
  const mixed = { ...job, price: 10, hours: 1, hourlyRate: 75, expenses: [{ name: "Parts", amount: 20, reimbursable: true }] };
  expect(invoiceTotalFromLines(buildJobInvoiceLines(mixed))).toBe(605);
  expect(hourlyLaborTotal(mixed)).toBe(575);
});

test("invalid additional labor cannot create negative or nonfinite invoice amounts", () => {
  const invalid = { laborEntries: [{ hours: -1, hourlyRate: 75 }, { hours: 1, hourlyRate: -5 }, { hours: "Infinity", hourlyRate: 5 }] };
  expect(buildJobInvoiceLines(invalid)).toEqual([]);
  expect(hourlyLaborTotal(invalid)).toBe(0);
});

test("separate invoices partition charges and comps retain costs and original value", () => {
  const multi = {...job, amountPaid: 100, invoices:[{id:"primary",name:"Visit 1"},{id:"second",name:"Visit 2"}],
    invoiceItems:[{id:"assistant",invoiceId:"second",kind:"labor",name:"Crew",hours:2,hourlyRate:100}],
    expenses:[{id:"parts",name:"Parts",amount:40,reimbursable:false,datePaid:"2026-10-10"}],
    invoiceOverrides:{"labor:1":{invoiceId:"second",comped:true},"expense:parts":{invoiceId:"second",comped:true}},
  };
  const first = buildJobInvoiceLines(multi,"primary"), second = buildJobInvoiceLines(multi,"second");
  expect(invoiceTotalFromLines(first)).toBe(200);
  expect(invoiceTotalFromLines(second)).toBe(200);
  expect(second.find(l=>l.key==="labor:1")).toMatchObject({amountCents:0,originalAmountCents:30000,comped:true});
  expect(second.find(l=>l.key==="expense:parts")).toMatchObject({amountCents:0,originalAmountCents:4000,comped:true});
  expect(buildJobInvoiceLines(multi)).toEqual([...first,...second].sort((a,b)=>buildJobInvoiceLines(multi).findIndex(l=>l.key===a.key)-buildJobInvoiceLines(multi).findIndex(l=>l.key===b.key)));
  expect(serverLines(multi)).toEqual(buildJobInvoiceLines(multi));
  expect(functionLines(multi)).toEqual(buildJobInvoiceLines(multi));
  const report = cashReport({jobs:[multi]}, {start:"2026-10-01",end:"2026-11-01"});
  expect(report.outstandingCents).toBe(30000);
  expect(report.expenseCents).toBe(4000);
  const restored = {...multi,invoiceOverrides:{...multi.invoiceOverrides,"labor:1":{invoiceId:"second",comped:false}}};
  expect(invoiceTotalFromLines(buildJobInvoiceLines(restored,"second"))).toBe(500);
});
