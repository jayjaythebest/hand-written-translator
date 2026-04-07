import heic2any from 'heic2any';

/** Convert HEIC/HEIF files to JPEG. Returns the original file for all other types. */
export async function normalizeToJpeg(file: File): Promise<File> {
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;

  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(result) ? result[0] : result;
  const jpegName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([blob], jpegName, { type: 'image/jpeg' });
}

/** Resize and compress an image dataUrl to keep it under Firestore's 1MB doc limit. */
export function compressImage(dataUrl: string, maxWidth = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);

      // Try quality 0.75 first; if still too large, drop to 0.4
      let result = canvas.toDataURL('image/jpeg', 0.75);
      if (result.length > 900_000) {
        result = canvas.toDataURL('image/jpeg', 0.4);
      }
      if (result.length > 900_000) {
        reject(new Error('圖片壓縮後仍超過限制，請使用較小的圖片'));
        return;
      }
      resolve(result);
    };
    img.onerror = () => reject(new Error('無法載入圖片'));
    img.src = dataUrl;
  });
}

/** Compute a lightweight fingerprint for duplicate detection within a project. */
export function computeImageHash(dataUrl: string): string {
  const len = dataUrl.length;
  const sample =
    dataUrl.slice(0, 200) +
    dataUrl.slice(Math.floor(len / 2) - 100, Math.floor(len / 2) + 100) +
    dataUrl.slice(-200) +
    len;
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash) + sample.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + '_' + len.toString(36);
}
