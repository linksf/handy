export function hourlyLaborTotal(job: Record<string, any>): number;
export function dayOf(value: unknown): string | null;
export function moneyCents(value: unknown): number;
export function periodRange(kind: string, anchor: unknown, previous?: boolean): {start:string;end:string};
export function cashReport(data: {jobs?:Record<string,any>[];payments?:Record<string,any>[];costs?:Record<string,any>[];leads?:Record<string,any>[]}, range:{start:string;end:string}): Record<string,any>;
