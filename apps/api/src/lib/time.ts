export const iso = (d: Date = new Date()): string => d.toISOString();
export const addMs = (d: Date, ms: number): Date => new Date(d.getTime() + ms);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** YYYY-MM-DD in UTC. */
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);
export const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
export const dayEnd = (day: string): Date => new Date(dayStart(day).getTime() + DAY);
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = dayStart(from).getTime(); t <= dayStart(to).getTime(); t += DAY) out.push(utcDay(new Date(t)));
  return out;
}
/** First day of the current monthly billing period given an anchor (YYYY-MM-DD). */
export function periodFor(anchor: string | null | undefined, now = new Date()): { start: string; end: string } {
  const a = anchor ? dayStart(anchor) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dom = Math.min(a.getUTCDate(), 28);
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dom));
  if (start > now) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, dom));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, dom));
  return { start: utcDay(start), end: utcDay(new Date(end.getTime() - DAY)) };
}
