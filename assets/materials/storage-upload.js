// Standard Storage POST with the student's token. Storage RLS still checks the pending path.
export function uploadStorageFile({ url, key, token, path, file, contentType, onProgress = () => {} }) {
  if (!token) return Promise.reject(new Error('Your session expired. Sign in again.'));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.floor(event.loaded / event.total * 100)));
    };
    xhr.open('POST', `${url.replace(/\/$/, '')}/storage/v1/object/submissions/${path.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', key);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('Cache-Control', 'max-age=0');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.timeout = 10 * 60 * 1000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(); }
      else {
        let message;
        try { const body = JSON.parse(xhr.responseText); message = body.message || body.error; } catch { /* Keep the HTTP fallback. */ }
        reject(new Error(typeof message === 'string' ? message : `Upload failed (${xhr.status}). Try again.`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try again.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled. Try again.'));
    onProgress(0); xhr.send(file);
  });
}
