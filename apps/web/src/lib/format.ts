export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

export function eur(x: number): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: x % 1 === 0 ? 0 : 2 }).format(x);
}

export function cm(x: number | undefined | null, digits = 1): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return '—';
  return `${x.toFixed(digits)} cm`;
}

export function shortDate(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dayIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
