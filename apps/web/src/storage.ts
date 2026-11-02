import { staticPreview, buildRevision } from './runtime';

// Public demo data must never overwrite a real launcher/web session.
const prefix = staticPreview ? `uhm-pages:${import.meta.env.BASE_URL}:${buildRevision}:` : '';
function scoped(getStorage: () => Storage) {
  return {
    getItem: (key: string) => getStorage().getItem(prefix + key),
    setItem: (key: string, value: string) => getStorage().setItem(prefix + key, value),
    removeItem: (key: string) => getStorage().removeItem(prefix + key),
  };
}
export const localStore = scoped(() => localStorage);
export const sessionStore = scoped(() => sessionStorage);
