export function buildJobInvoiceLines(job) {
  const lines = [];
  const title = (job.title || "").trim() || "Job";

  const flat = parseFloat(String(job.price ?? "")) || 0;
  if (flat > 0) {
    lines.push({ name: `${title} — flat rate`, amountCents: Math.round(flat * 100) });
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
        lines.push({ name: label, amountCents: Math.round(amt * 100) });
      }
    }
  }

  return lines;
}

export function totalCentsFromLines(lines) {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}
