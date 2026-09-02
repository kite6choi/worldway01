// sw.js — 월드웨이 예지보전 AI PWA Service Worker
// 캐시 버전을 날짜 기반으로 관리: 코드 변경 시 자동으로 구 캐시 폐기
const CACHE_VERSION = '20260902-v4';
const CACHE_SHELL   = `worldway-shell-${CACHE_VERSION}`;
const CACHE_CDN     = `worldway-cdn-${CACHE_VERSION}`;

// 앱 셸 (로컬 파일) — 항상 최신 버전으로 캐시
const SHELL_ASSETS = [
  './',
  './index.html',
  './viewer.html',
  './viewer.js',
  './viewer.css',
  './styles.css',
  './app.js',
  './ai-engine.js',
  './data-store.js',
  './charts-manager.js',
  './metrics-calculator.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// CDN 리소스 — 별도 캐시로 관리 (네트워크 실패 시 캐시 폴백)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css',
  'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js',
  'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js'
];

// ── INSTALL: 앱 셸 캐시 ──────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW] Install — cache: ${CACHE_SHELL}`);
  event.waitUntil(
    Promise.all([
      // 앱 셸: 실패 시 설치 중단 (필수)
      caches.open(CACHE_SHELL).then((cache) => cache.addAll(SHELL_ASSETS)),
      // CDN: 실패해도 설치 계속 (선택)
      caches.open(CACHE_CDN).then((cache) =>
        cache.addAll(CDN_ASSETS).catch((err) =>
          console.warn('[SW] CDN pre-cache partial fail (offline 시 첫 로딩에만 영향):', err)
        )
      )
    ])
  );
  // 새 SW를 즉시 활성화 (기존 탭 재로딩 불필요)
  self.skipWaiting();
});

// ── ACTIVATE: 구 캐시 전부 삭제 ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activate — purging old caches`);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_SHELL && k !== CACHE_CDN)
          .map((k) => {
            console.log(`[SW] Deleting old cache: ${k}`);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: 요청 유형별 캐시 전략 ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // CSV 업로드, IndexedDB(idb), POST 요청은 캐시 바이패스
  if (request.method !== 'GET') return;
  if (url.pathname.endsWith('.csv')) return;

  // ① CDN 리소스: Cache-First (오프라인 지원)
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.open(CACHE_CDN).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return cached || new Response('오프라인: CDN 리소스 없음', { status: 503 });
        }
      })
    );
    return;
  }

  // ② 앱 셸 (로컬 파일): Network-First → Cache Fallback
  //    → 개발 중에도 항상 최신 파일을 먼저 사용
  event.respondWith(
    fetch(request)
      .then((networkRes) => {
        if (networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE_SHELL).then((cache) => cache.put(request, clone));
        }
        return networkRes;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || caches.match('./index.html')
        )
      )
  );
});
