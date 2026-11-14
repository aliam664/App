import { L } from './i18n';

export type LocalItem = {
  id: string;
  kind: string;
  parent: string | null;
  path: string;
  metadata: Record<string, unknown>;
  bytes: number;
  files: number;
  image: string | null;
  source: string;
  warnings: string[];
};
export type Snapshot = {
  items: LocalItem[];
  bytes: number;
  scanned_at: number;
  warnings: string[];
  packages: { id: string; version: string; files: number; missing: number; integrity: string }[];
};
export const kinds: Record<string, string> = {
  car: 'ماشین',
  track: 'پیست',
  skin: 'اسکین',
  layout: 'لی‌اوت',
};
export const kindLabels = () => ({
  car: L('ماشین', 'Car'),
  track: L('پیست', 'Track'),
  skin: L('اسکین', 'Skin / Livery'),
  layout: L('لی‌اوت', 'Track Layout'),
});
export const origins: Record<string, string> = {
  external: 'خارج از لانچر',
  launcher: 'لانچر',
  mixed: 'ترکیبی',
};
export const originLabels = () => ({
  external: L('خارج از لانچر', 'External'),
  launcher: L('لانچر', 'Launcher'),
  mixed: L('ترکیبی', 'Mixed'),
});
export const text = (v: unknown) =>
  typeof v === 'string' && v.trim()
    ? v
    : typeof v === 'number'
      ? String(v)
      : L('نامشخص', 'Unknown');
export const localName = (i: LocalItem) => text(i.metadata.name ?? i.metadata.skinname);
export function filterLocal(
  items: LocalItem[],
  query: string,
  kind: string,
  origin: string,
  sort: string,
): LocalItem[] {
  const q = query.trim().toLocaleLowerCase();
  return items
    .filter(
      (i) =>
        (kind === 'all' || i.kind === kind) &&
        (origin === 'all' || i.source === origin) &&
        `${i.path} ${Object.values(i.metadata).flat().join(' ')}`.toLocaleLowerCase().includes(q),
    )
    .sort((a, b) =>
      sort === 'size'
        ? b.bytes - a.bytes
        : sort === 'brand'
          ? text(a.metadata.brand).localeCompare(text(b.metadata.brand))
          : localName(a).localeCompare(localName(b)),
    );
}
