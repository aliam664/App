import type { TelemetryEvent } from '../../packages/contracts/src/index.ts';
export function summarizeEvents(events: TelemetryEvent[], since: string) {
  const rows = events.filter((e) => e.occurred_at >= since);
  const totals = new Map<string, number>(),
    daily = new Map<string, any>(),
    packages = new Map<string, any>();
  for (const e of rows) {
    totals.set(e.type, (totals.get(e.type) || 0) + 1);
    const day = e.occurred_at.slice(0, 10);
    const d = daily.get(day) || { day, opens: 0, downloads: 0, installs: 0, errors: 0 };
    if (e.type === 'app_open') d.opens++;
    if (e.type === 'package_download_completed') d.downloads++;
    if (e.type === 'install_completed') d.installs++;
    if (e.type.endsWith('failed') || e.type === 'app_error') d.errors++;
    daily.set(day, d);
    if (e.package_id) {
      const p = packages.get(e.package_id) || {
        package_id: e.package_id,
        downloads: 0,
        installs: 0,
        errors: 0,
      };
      if (e.type === 'package_download_completed') p.downloads++;
      if (e.type === 'install_completed') p.installs++;
      if (e.type.endsWith('failed')) p.errors++;
      packages.set(e.package_id, p);
    }
  }
  return {
    totals: [...totals].map(([type, count]) => ({ type, count })),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    packages: [...packages.values()].sort((a, b) => b.downloads - a.downloads),
  };
}
