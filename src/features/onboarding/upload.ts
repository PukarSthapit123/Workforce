import { PREVIEW_MAX_SIDE, PREVIEW_QUALITY, hasPreview, uploadProblem, type OnbRefusal } from '@/domain/onboarding';
import type { UploadFile } from '@/api/onboarding';

/* The prototype's readUpload (qnipay-workforce-v15.html:4350-4375), as brief
   D3 rules it. The browser reads the file; what is sent is its name, size and
   type and, for an image, a downscaled preview (longest side 560px, JPEG at
   0.7) as a data URL. Nothing else of the file leaves this function. */

/* Refused before the file is read: a file over the limit is never opened. */
export const tooLarge = (f: Pick<File, 'name' | 'size'>): OnbRefusal | null => uploadProblem(f);

/* An image that never loads (a corrupt file, or a browser that cannot draw it)
   is sent without a preview rather than holding the upload up. */
const GIVE_UP_MS = 4000;

export function readUpload(file: File): Promise<UploadFile> {
  const meta: UploadFile = { name: file.name, size: file.size, type: file.type };
  if (!hasPreview(file.type)) return Promise.resolve(meta);
  return new Promise(resolve => {
    let settled = false;
    const done = (v: UploadFile) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(meta), GIVE_UP_MS);
    const finish = (v: UploadFile) => { clearTimeout(timer); done(v); };
    const r = new FileReader();
    r.onerror = () => finish(meta);
    r.onload = () => {
      if (typeof r.result !== 'string') { finish(meta); return; }
      const img = new Image();
      img.onerror = () => finish(meta);
      img.onload = () => {
        const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(img.width, img.height, 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        try {
          const ctx = c.getContext('2d');
          if (!ctx) { finish(meta); return; }
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const preview = c.toDataURL('image/jpeg', PREVIEW_QUALITY);
          finish(preview.startsWith('data:image/') ? { ...meta, preview } : meta);
        } catch {
          finish(meta);
        }
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
