import { native, invoke } from './device';
import { L } from './i18n';
/** Reads only the explicitly selected file. Bytes never leave this device. */
export async function inspectArtifact(): Promise<{
  name: string;
  size: number;
  sha256: string;
} | null> {
  if (native) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      directory: false,
      title: L(
        'انتخاب فایل برای محاسبهٔ محلی SHA-256؛ بدون آپلود',
        'Select file for local SHA-256 calculation (no upload)',
      ),
    });
    if (!path) return null;
    return invoke('inspect_artifact', { path });
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) return null;
  if (file.size > 32 * 1024 * 1024)
    throw new Error(
      L(
        'برای فایل بزرگ‌تر از ۳۲ مگابایت، محاسبهٔ جریانی را در نسخهٔ ویندوز انجام دهید یا هش ابزار محلی را وارد کنید. هیچ فایلی آپلود نشد.',
        'For files larger than 32 MB, compute SHA-256 in the Windows desktop client or paste a local digest. Nothing was uploaded.',
      ),
    );
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return {
    name: file.name,
    size: file.size,
    sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
