export interface InvoiceLine {key:string;name:string;amountCents:number;originalAmountCents:number;comped:boolean;invoiceId:string;billable:boolean;kind:string}
export const PRIMARY_INVOICE_ID: string;
export function jobInvoices(job: any): any[];
export function invoicePaid(job: any, invoiceId: string): number;
export function buildJobInvoiceLines(job: any, invoiceId?: string, includeUnbilled?: boolean): InvoiceLine[];
export function invoiceTotalFromLines(lines: InvoiceLine[]): number;
export function totalCentsFromLines(lines: InvoiceLine[]): number;
export function jobCostBreakdown(job: any): {reimbursable:number;nonReimbursable:number;total:number};
