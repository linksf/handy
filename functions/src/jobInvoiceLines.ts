export interface JobInvoiceLine {
  name: string;
  amountCents: number;
}

interface JobLike {
  title?: string;
  price?: string | number;
  hourlyRate?: string | number;
  hours?: string | number;
  tasks?: Array<{
    name?: string;
    materials?: Array<{
      name?: string;
      cost?: string | number;
      qty?: string | number;
      reimbursable?: boolean;
    }>;
  }>;
  expenses?: Array<{
    name?: string;
    amount?: string | number;
    reimbursable?: boolean;
  }>;
}

export function buildJobInvoiceLines(job: JobLike): JobInvoiceLine[] {
  const lines: JobInvoiceLine[] = [];
  const title = (job.title || "").trim() || "Job";

  const flat = parseFloat(String(job.price ?? "")) || 0;
  if (flat > 0) {
    lines.push({name: `${title} — flat rate`, amountCents: Math.round(flat * 100)});
  }

  const hourlyRate = parseFloat(String(job.hourlyRate ?? "")) || 0;
  const hours = parseFloat(String(job.hours ?? "")) || 0;
  if (hourlyRate > 0 && hours > 0) {
    lines.push({
      name: `Labor (${hours} hr × $${hourlyRate.toFixed(2)}/hr)`,
      amountCents: Math.round(hourlyRate * hours * 100),
    });
  }

  for (const exp of job.expenses || []) {
    if (!exp.reimbursable) continue;
    const amt = parseFloat(String(exp.amount ?? "")) || 0;
    if (amt > 0) {
      lines.push({
        name: (exp.name || "Reimbursable expense").trim(),
        amountCents: Math.round(amt * 100),
      });
    }
  }

  for (const task of job.tasks || []) {
    for (const m of task.materials || []) {
      if (!m.reimbursable) continue;
      const amt =
        (parseFloat(String(m.cost ?? "")) || 0) *
        (parseFloat(String(m.qty ?? "")) || 1);
      if (amt > 0) {
        const label = [task.name, m.name || "materials"].filter(Boolean).join(": ");
        lines.push({name: label, amountCents: Math.round(amt * 100)});
      }
    }
  }

  return lines;
}

export function totalCentsFromLines(lines: JobInvoiceLine[]): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}
