type AdminUploadPurpose = 'blog' | 'team' | 'service-store' | 'case-study' | 'site-media' | 'website-service';

interface AdminUploadOptions {
  purpose: AdminUploadPurpose;
  file: File | Blob;
  fileName?: string;
  assetId?: string;
  serviceId?: string;
  signal?: AbortSignal;
}

interface UploadResponse {
  message?: string;
  uploadUrl?: string;
  path?: string;
  url?: string;
}

async function responseData(response: Response): Promise<UploadResponse> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('The upload service is not connected to this site.');
  }
  return response.json() as Promise<UploadResponse>;
}

export async function uploadAdminMedia({
  purpose,
  file,
  fileName,
  assetId,
  serviceId,
  signal,
}: AdminUploadOptions): Promise<{ url: string }> {
  if (import.meta.env.DEV) {
    const formData = new FormData();
    const name = fileName || (file instanceof File ? file.name : 'upload');
    const field = purpose === 'site-media' ? 'media' : 'image';
    if (purpose === 'site-media') formData.set('assetId', assetId || '');
    if (purpose === 'website-service') formData.set('serviceId', serviceId || '');
    formData.set(field, file, name);
    const endpoint = {
      blog: '/api/admin/blogs/upload',
      team: '/api/admin/team/upload',
      'service-store': '/api/admin/service-packages/upload',
      'case-study': '/api/admin/case-studies/upload',
      'site-media': '/api/admin/site-content/media/upload',
      'website-service': '/api/admin/services/upload',
    }[purpose];
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', body: formData, signal });
    const result = await responseData(response);
    if (!response.ok) throw new Error(result.message || 'The image upload failed.');
    if (!result.url) throw new Error('The upload service returned no media URL.');
    return { url: result.url };
  }

  const mimeType = file.type || (() => {
    const extension = (fileName || (file instanceof File ? file.name : '')).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
      : extension === 'png' ? 'image/png'
        : extension === 'webp' ? 'image/webp'
          : extension === 'mp4' ? 'video/mp4'
            : extension === 'webm' ? 'video/webm' : '';
  })();
  const metadata = {
    purpose,
    mimeType,
    size: file.size,
    ...(assetId ? { assetId } : {}),
    ...(serviceId ? { serviceId } : {}),
  };
  const signResponse = await fetch('/api/admin/uploads/sign', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
    signal,
  });
  const signed = await responseData(signResponse);
  if (!signResponse.ok) throw new Error(signed.message || 'The upload could not be prepared.');
  if (!signed.uploadUrl || !signed.path || !signed.url) throw new Error('The upload service returned an invalid upload target.');

  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'false',
    },
    body: file,
    signal,
  });
  if (!uploadResponse.ok) throw new Error('The media file could not be uploaded to storage.');

  const completeResponse = await fetch('/api/admin/uploads/complete', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...metadata, path: signed.path }),
    signal,
  });
  const completed = await responseData(completeResponse);
  if (!completeResponse.ok) throw new Error(completed.message || 'The uploaded file could not be verified.');
  if (!completed.url) throw new Error('The upload service returned no verified media URL.');
  return { url: completed.url };
}
