const SAFE_FILENAME_REGEX = /[^a-zA-Z0-9._-]/g;

export function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/\s+/g, "-");
  const safe = trimmed.replace(SAFE_FILENAME_REGEX, "");
  return safe.length > 0 ? safe.slice(0, 120) : "file";
}

export function buildAssetObjectKey(input: {
  userId: string;
  brandId: string;
  assetId: string;
  fileName: string;
}): string {
  return `tenant/${input.userId}/brand/${input.brandId}/assets/${input.assetId}/${sanitizeFileName(input.fileName)}`;
}
