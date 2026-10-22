/* Replaced by the post-build script; do not register this source in development. */
const BUILD_VERSION = '5f8c69ed116cadb4478a';
const APP_ROOT = new URL('.', self.location.href || `${self.location.origin}/sw.js`).pathname;
const SHELL_URL = `${APP_ROOT}index.html`;
const CACHE_PREFIX = APP_ROOT === '/' ? 'steel-frontline-offline-' : `steel-frontline-offline-${APP_ROOT.slice(1).replaceAll('/', '-')}`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;
const MANIFEST_URL = `${APP_ROOT}offline-manifest.json`;
let work;
let lastStatus = { state: 'loading', progress: 0, message: '正在准备离线资源', updateAvailable: false };

async function announce(status, target) {
  lastStatus = { ...lastStatus, ...status, version: BUILD_VERSION };
  const payload = { type: 'OFFLINE_STATUS', status: lastStatus };
  if (target) target.postMessage(payload);
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(payload));
  return lastStatus;
}

function checkManifest(manifest) {
  if (!manifest || manifest.version !== BUILD_VERSION || !Array.isArray(manifest.urls) || !manifest.urls.length) {
    throw new Error('离线资源版本不一致，请联网刷新后重试。');
  }
  if (!manifest.urls.includes(SHELL_URL) || new Set(manifest.urls).size !== manifest.urls.length) {
    throw new Error('离线资源清单不完整，请重新构建游戏。');
  }
  if (manifest.urls.some((url) => typeof url !== 'string' || !url.startsWith(APP_ROOT) || new URL(url, self.location.origin).pathname !== url || new URL(url, self.location.origin).origin !== self.location.origin)) {
    throw new Error('离线资源清单包含无效地址。');
  }
  return manifest;
}

function describeError(error) {
  return error?.name === 'QuotaExceededError'
    ? '设备存储空间不足，离线资源未就绪。请释放空间后重试；已有版本仍保留。'
    : (error?.message || '离线资源下载失败，请检查网络后重试。');
}

async function cachedManifest(cache) {
  const response = await cache.match(MANIFEST_URL, { ignoreVary: true });
  if (!response) throw new Error('离线资源尚未下载完整，请联网后重试。');
  return checkManifest(await response.json());
}

function expectedMime(manifest, url) {
  const declared = (manifest.resources || []).find((resource) => resource.url === url)?.mime;
  if (declared) return declared;
  // Installed versions created before MIME metadata must also be readable safely.
  if (/\.m?js$/i.test(url)) return 'text/javascript';
  if (/\.css$/i.test(url)) return 'text/css';
  if (/\.html$/i.test(url)) return 'text/html';
  return null;
}

function validAsset(response, expected) {
  if (!response?.ok || response.type === 'opaque') return false;
  const actual = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  // SPA servers can return index.html with HTTP 200 for a deleted asset hash.
  if (actual === 'text/html' && expected !== 'text/html') return false;
  if (expected === 'text/javascript') return ['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-javascript'].includes(actual);
  if (expected === 'text/css' || expected === 'text/html') return actual === expected;
  if (expected?.startsWith('image/')) return actual === expected || (expected === 'image/x-icon' && actual === 'image/vnd.microsoft.icon');
  // Static hosting commonly serves models, sound and fonts as octet streams.
  if (!expected || expected === 'application/octet-stream' || actual === expected || actual === 'application/octet-stream') return true;
  if (expected.startsWith('font/')) return actual.startsWith('font/') || actual.startsWith('application/font-') || actual.startsWith('application/x-font-');
  if (expected.startsWith('audio/')) return actual.startsWith('audio/');
  if (expected === 'application/manifest+json') return actual === 'application/json';
  return false;
}

async function intactAsset(response, manifest, url) {
  if (!validAsset(response, expectedMime(manifest, url))) return false;
  if (url === SHELL_URL) {
    // Sites redirects /index.html to / and decorates the HTML. Verify that the
    // result is the game shell, not a login page, without comparing raw bytes.
    return (await response.clone().text()).includes('id="root"');
  }
  const resource = (manifest.resources || []).find((entry) => entry.url === url);
  if (!resource?.sha256) return true;
  const bytes = await response.clone().arrayBuffer();
  if (Number.isFinite(resource.bytes) && bytes.byteLength !== resource.bytes) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return hash === resource.sha256;
}

async function navigableShell(response) {
  if (!response.redirected) return response;
  // A cached /index.html fetch follows Sites' redirect to /. Chromium rejects
  // that redirected Response when it fulfills a navigation (redirect: manual).
  const headers = new Headers(response.headers);
  for (const name of ['content-encoding', 'content-length', 'location', 'set-cookie']) headers.delete(name);
  return new Response(await response.clone().arrayBuffer(), {
    status: response.status, statusText: response.statusText, headers,
  });
}

async function staticEntry(cache, request) {
  const manifestResponse = await cache.match(MANIFEST_URL, { ignoreVary: true });
  if (!manifestResponse) return null;
  let manifest;
  try { manifest = await manifestResponse.json(); } catch { return null; }
  const url = new URL(typeof request === 'string' ? request : request.url, self.location.origin);
  if (url.origin !== self.location.origin || !Array.isArray(manifest.urls) || !manifest.urls.includes(url.pathname)) return null;
  // Only manifest-declared immutable local assets ignore Vary: Origin. Dynamic
  // requests never enter this branch; a module and its precache use one URL key.
  const response = await cache.match(url.pathname, { ignoreVary: true });
  const mime = expectedMime(manifest, url.pathname);
  const valid = url.pathname === SHELL_URL
    ? await intactAsset(response, manifest, url.pathname)
    : validAsset(response, mime);
  return { response: valid ? response : null, mime, url: url.pathname };
}

async function verifyCache() {
  const cache = await caches.open(CACHE_NAME);
  const manifest = await cachedManifest(cache);
  const missing = [];
  for (const url of manifest.urls) {
    const response = await cache.match(url, { ignoreVary: true });
    if (!await intactAsset(response, manifest, url)) missing.push(url);
  }
  if (missing.length) throw new Error(`有 ${missing.length} 项离线资源缺失，请联网后重试。`);
  return announce({ state: 'ready', progress: 100, message: '离线资源已就绪，可断网游玩', updateAvailable: false });
}

async function downloadResources() {
  const existed = (await caches.keys()).includes(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  try {
    await announce({ state: 'loading', progress: 0, message: '正在读取离线资源清单' });
    const response = await fetch(new Request(MANIFEST_URL, { cache: 'no-store' }));
    if (!response.ok) throw new Error('无法读取离线资源清单，请检查网络后重试。');
    const manifest = checkManifest(await response.json());
    const sizes = new Map((manifest.resources || []).map((resource) => [resource.url, resource.bytes]));
    const total = manifest.urls.reduce((sum, url) => sum + Math.max(1, sizes.get(url) || 1), 0);
    let completed = 0;
    for (let index = 0; index < manifest.urls.length; index += 1) {
      const url = manifest.urls[index];
      const existing = await cache.match(url, { ignoreVary: true });
      if (!await intactAsset(existing, manifest, url)) {
        const asset = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
        if (!await intactAsset(asset, manifest, url)) throw new Error(`离线资源下载失败、文件类型不正确或内容不一致（${index + 1}/${manifest.urls.length}），请联网后重试。`);
        if (asset.url && new URL(asset.url).origin !== self.location.origin) throw new Error('离线资源跳转到了其他网站，请重试。');
        await cache.put(url, url === SHELL_URL ? await navigableShell(asset) : asset);
      }
      completed += Math.max(1, sizes.get(url) || 1);
      await announce({ state: 'loading', progress: Math.min(99, Math.round(completed / total * 100)), message: `正在保存离线资源 ${index + 1}/${manifest.urls.length}` });
    }
    // The manifest is the commit marker: incomplete installations never appear ready.
    await cache.put(MANIFEST_URL, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
    return await verifyCache();
  } catch (error) {
    // A failed candidate must never delete a previously installed, possibly active cache.
    if (!existed) await caches.delete(CACHE_NAME);
    await announce({ state: 'error', progress: 0, message: describeError(error) });
    throw error;
  }
}

function downloadOnce() {
  if (!work) work = downloadResources().finally(() => { work = undefined; });
  return work;
}

self.addEventListener('install', (event) => {
  // No skipWaiting here: an update waits until the user confirms from the garage.
  event.waitUntil(downloadOnce());
});

self.addEventListener('activate', (event) => {
  // Keep prior version caches for open game windows and for recovery from quota failure.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  const port = event.ports?.[0];
  const reply = (status) => port?.postMessage({ type: 'OFFLINE_STATUS', status });
  if (type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting().then(() => reply({ ...lastStatus, state: 'ready' })));
    return;
  }
  if (!['STATUS', 'VERIFY', 'RETRY'].includes(type)) return;
  event.waitUntil((async () => {
    try {
      const status = type === 'RETRY' ? await downloadOnce() : work ? (type === 'STATUS' ? lastStatus : await work) : await verifyCache();
      reply(status);
    } catch (error) {
      reply(await announce({ state: 'error', progress: 0, message: describeError(error) }));
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    let expected;
    try {
      const cache = await caches.open(CACHE_NAME);
      const key = request.mode === 'navigate' ? SHELL_URL : request;
      const current = await staticEntry(cache, key);
      if (current?.response) return request.mode === 'navigate' ? navigableShell(current.response) : current.response;
      expected = current;
      // An already-open older build can still request its content-hashed assets.
      for (const name of await caches.keys()) {
        if (name !== CACHE_NAME && name.startsWith(CACHE_PREFIX)) {
          const older = await staticEntry(await caches.open(name), key);
          if (older?.response) return request.mode === 'navigate' ? navigableShell(older.response) : older.response;
          if (!expected && older) expected = older;
        }
      }
    } catch {
      // Cache Storage can fail independently of the network. A navigation must
      // still reach the hosted page instead of rejecting with net::ERR_FAILED.
    }
    try {
      const response = await fetch(request);
      if (expected && !validAsset(response, expected.mime)) {
        await announce({ state: 'error', progress: 0, message: '游戏资源版本不完整，请联网后重试下载。' });
        throw new Error('Static resource returned an invalid content type');
      }
      return response;
    }
    catch {
      return new Response(request.mode === 'navigate' ? '离线资源未就绪，请联网打开游戏并完成下载。' : 'Offline resource unavailable', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
