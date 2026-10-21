/*
 * Compatibility and offline queue layer for the Supabase copy.
 * App writes are first saved to IndexedDB when offline or when the network request fails.
 * Uploads are queued as Blobs and assigned stable client IDs, then synced in order when online.
 * Never place a Supabase service-role key in the browser.
 */
(function () {
  'use strict';
  var cfg = window.POLE_APP_CONFIG || {};
  var API_URL = String(cfg.API_URL || '').trim();
  var PUBLISHABLE_KEY = String(cfg.PUBLISHABLE_KEY || '').trim();
  var DB_NAME = 'pole-survey-supabase-copy-v1';
  var DB_VERSION = 1;
  var idbPromise = null;
  var syncing = false;
  var queuedWrites = new Set([
    'uploadPolePhoto', 'uploadPhoto', 'saveSurvey', 'saveCableStop', 'updateSurveyedCable',
    'deleteSurveyedCable', 'saveRouteKml', 'saveRouteDraft', 'saveRunDraft', 'clearRunDraft'
  ]);
  var cachedReads = new Set([
    'getPoles', 'getPolePhotos', 'getPolePhotoCounts', 'getSurveyedChanges',
    'getSurveyedRoutes', 'getCablesAtPole', 'getSurveyVersion', 'reverseGeocode'
  ]);

  function localError(message) { var e = new Error(message); e.isLocalBridgeError = true; return e; }
  function openDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(localError('เบราว์เซอร์นี้ไม่รองรับ IndexedDB จึงไม่สามารถเก็บงานออฟไลน์อย่างปลอดภัยได้'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || localError('เปิดพื้นที่เก็บข้อมูลออฟไลน์ไม่สำเร็จ')); };
    });
    return idbPromise;
  }
  function tx(store, mode, work) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), result;
        try { result = work(s, t); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error || localError('บันทึกข้อมูลออฟไลน์ไม่สำเร็จ')); };
        t.onabort = function () { reject(t.error || localError('รายการออฟไลน์ถูกยกเลิก')); };
      });
    });
  }
  function dbGet(store, key) {
    return openDB().then(function (db) { return new Promise(function (resolve, reject) {
      var r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = function () { resolve(r.result || null); };
      r.onerror = function () { reject(r.error); };
    }); });
  }
  function dbAll(store) {
    return openDB().then(function (db) { return new Promise(function (resolve, reject) {
      var r = db.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = function () { resolve(r.result || []); };
      r.onerror = function () { reject(r.error); };
    }); });
  }
  function dbPut(store, record) { return tx(store, 'readwrite', function (s) { s.put(record); }); }
  function dbDelete(store, key) { return tx(store, 'readwrite', function (s) { s.delete(key); }); }
  function keyFor(method, args) {
    var copy = clone(args || []);
    if (copy.length) copy[0] = '__app_code__';
    if (method === 'getSurveyedChanges') return 'read:getSurveyedChanges:full';
    return 'read:' + method + ':' + safeStringify(copy);
  }
  function clone(x) {
    if (typeof structuredClone === 'function') { try { return structuredClone(x); } catch (_) {} }
    return JSON.parse(JSON.stringify(x));
  }
  function safeStringify(x) {
    try { return JSON.stringify(x); } catch (_) { return String(Date.now()); }
  }
  function showStatus(text, showButton) {
    var box = document.getElementById('syncStatus');
    var label = document.getElementById('syncStatusText');
    var btn = document.getElementById('syncPendingBtn');
    if (!box || !label) return;
    label.textContent = text || '';
    box.style.display = text ? 'flex' : 'none';
    if (btn) btn.style.display = showButton ? 'inline-flex' : 'none';
  }
  function toastSafe(message, isError) {
    if (typeof window.toast === 'function') window.toast(message, !!isError);
    else if (isError) console.warn('[PoleSurvey]', message);
    else console.info('[PoleSurvey]', message);
  }
  function queueCount() { return dbAll('queue').then(function (q) { return q.length; }).catch(function () { return 0; }); }
  function updateStatus() {
    return Promise.all([queueCount(), Promise.resolve(navigator.onLine)]).then(function (v) {
      var n = v[0], online = v[1];
      if (!online) showStatus('ออฟไลน์ · งานค้าง ' + n + ' รายการ', n > 0);
      else if (n > 0) showStatus('รอซิงก์ ' + n + ' รายการ', true);
      else showStatus('', false);
    });
  }
  function getCode() { try { return localStorage.getItem('accessCode') || ''; } catch (_) { return ''; } }
  function cacheRead(method, args, result) {
    if (!cachedReads.has(method)) return Promise.resolve(result);
    var key = keyFor(method, args);
    if (method === 'getSurveyedChanges' && result && Array.isArray(result.items)) {
      return dbGet('cache', key).then(function (old) {
        var map = Object.create(null);
        (old && old.value && old.value.items || []).forEach(function (it) { map[String(it.runId) + '|' + String(it.no)] = it; });
        result.items.forEach(function (it) { map[String(it.runId) + '|' + String(it.no)] = it; });
        var merged = { t: Math.max(Number(result.t) || 0, Number(old && old.value && old.value.t) || 0), items: Object.keys(map).map(function (k) { return map[k]; }) };
        return dbPut('cache', { key: key, value: merged, savedAt: Date.now() }).then(function () { return merged; });
      });
    }
    return dbPut('cache', { key: key, value: result, savedAt: Date.now() }).then(function () { return result; });
  }
  function offlineRead(method, args) {
    if (!cachedReads.has(method)) return Promise.reject(localError('ยังไม่มีอินเทอร์เน็ต และไม่มีสำเนาออฟไลน์ของ ' + method));
    if (method === 'getSurveyedChanges') return dbGet('cache', 'read:getSurveyedChanges:full').then(function (x) {
      if (x && x.value) return x.value;
      return Promise.reject(localError('ยังไม่มีข้อมูลเส้นทางที่เคยซิงก์ไว้ในอุปกรณ์นี้'));
    });
    return dbGet('cache', keyFor(method, args)).then(function (x) {
      if (x) return x.value;
      if (method === 'reverseGeocode') return '';
      return Promise.reject(localError('ยังไม่มีข้อมูล ' + method + ' ที่เก็บไว้ในอุปกรณ์นี้')); 
    });
  }
  function blobFromBase64(value) {
    var s = String(value || '').replace(/^data:[^;]+;base64,/, '');
    var binary = atob(s), bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  function base64FromBlob(blob) {
    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer), chunk = 0x8000, pieces = [];
      for (var i = 0; i < bytes.length; i += chunk) pieces.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length))));
      return btoa(pieces.join(''));
    });
  }
  function prepareIds(method, args) {
    if (method === 'uploadPolePhoto' && args[1] && typeof args[1] === 'object') {
      args[1].clientPhotoId = args[1].clientPhotoId || ('p_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2)));
    } else if (method === 'uploadPhoto') {
      args[1] = args[1] || ('p_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2)));
    } else if (method === 'saveRouteKml') {
      args[4] = args[4] || ('k_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2)));
    }
    return args;
  }
  function offlineQueueArgs(method, args) {
    var a = clone(args);
    a = prepareIds(method, a);
    if (method === 'uploadPolePhoto' && typeof a[2] === 'string') a[2] = blobFromBase64(a[2]);
    if (method === 'uploadPhoto' && typeof a[4] === 'string') a[4] = blobFromBase64(a[4]);
    return a;
  }
  function offlineResult(method, args, qid) {
    if (method === 'uploadPolePhoto') {
      var meta = args[1] || {};
      return { ok: true, offlineQueued: true, id: meta.clientPhotoId, url: 'offline-photo://' + meta.clientPhotoId,
        fileName: String(meta.tag || 'เสา') + '_' + String(meta.clientPhotoId || qid) + '.jpg', tag: String(meta.tag || ''), takenAt: meta.takenAt || new Date().toISOString() };
    }
    if (method === 'uploadPhoto') return 'offline-photo://' + String(args[1] || qid);
    if (method === 'saveSurvey') return { ok: true, offlineQueued: true, id: String(args[0] && args[0].id || qid), photos: (args[0] && args[0].photoUrls || []).length };
    if (method === 'saveCableStop') return { ok: true, offlineQueued: true };
    if (method === 'updateSurveyedCable') return { ok: true, offlineQueued: true, status: 'รอซิงก์', updatedAt: Date.now() };
    if (method === 'deleteSurveyedCable') return { ok: true, offlineQueued: true, deleted: true };
    if (method === 'saveRouteKml') return 'offline-pending://' + qid;
    if (method === 'saveRouteDraft' || method === 'saveRunDraft') return new Date().toLocaleString('th-TH');
    if (method === 'clearRunDraft') return 1;
    return { ok: true, offlineQueued: true };
  }
  function mirrorDraft(method, args) {
    var isRun = method.toLowerCase().indexOf('run') >= 0;
    var key = isRun ? 'run' : 'route';
    if (method === 'saveRouteDraft' || method === 'saveRunDraft') {
      var payload = String(args.length >= 3 ? args[2] || '' : args[1] || '');
      return dbPut('kv', { key: 'draft:' + key, value: payload, savedAt: Date.now() });
    }
    if (method === 'clearRunDraft') return dbDelete('kv', 'draft:run');
    if (method === 'loadRouteDraft' || method === 'loadRunDraft') return dbGet('kv', 'draft:' + key).then(function (x) { return x ? String(x.value || '') : ''; });
    return Promise.resolve();
  }
  function postApi(method, args) {
    if (!API_URL || /YOUR_PROJECT_REF/.test(API_URL)) return Promise.reject(localError('ยังไม่ได้ตั้งค่า API_URL ใน config.js ให้เป็น URL ของ Edge Function ในโปรเจกต์ Supabase ใหม่'));
    var headers = { 'Content-Type': 'application/json' };
    if (PUBLISHABLE_KEY && !/YOUR_SUPABASE/.test(PUBLISHABLE_KEY)) headers.apikey = PUBLISHABLE_KEY;
    return fetch(API_URL, { method: 'POST', headers: headers, body: JSON.stringify({ method: method, args: args }) }).then(function (res) {
      return res.text().then(function (raw) {
        var body;
        try { body = JSON.parse(raw); } catch (_) { body = { ok: false, error: raw || ('HTTP ' + res.status) }; }
        if (!res.ok || !body || body.ok !== true) {
          var er = new Error(body && body.error || ('คำขอ Supabase ไม่สำเร็จ (HTTP ' + res.status + ')'));
          er.status = res.status; er.remote = true; throw er;
        }
        return body.result;
      });
    });
  }
  function resolveLinks(value, linkMap) {
    if (typeof value === 'string' && value.indexOf('offline-photo://') === 0) return linkMap[value] || value;
    if (Array.isArray(value)) return value.map(function (v) { return resolveLinks(v, linkMap); });
    if (value && typeof value === 'object' && !(value instanceof Blob)) {
      var out = {}; Object.keys(value).forEach(function (k) { out[k] = resolveLinks(value[k], linkMap); }); return out;
    }
    return value;
  }
  function loadLinkMap() { return dbGet('kv', 'offline-photo-link-map').then(function (x) { return x && x.value || {}; }); }
  function savePhotoLink(id, url) {
    return loadLinkMap().then(function (map) { map['offline-photo://' + id] = url; return dbPut('kv', { key: 'offline-photo-link-map', value: map }); });
  }
  function argsForReplay(rec, linkMap) {
    var a = resolveLinks(rec.args, linkMap);
    if (rec.method === 'uploadPolePhoto' && a[2] instanceof Blob) return base64FromBlob(a[2]).then(function (b64) { a[2] = b64; return a; });
    if (rec.method === 'uploadPhoto' && a[4] instanceof Blob) return base64FromBlob(a[4]).then(function (b64) { a[4] = b64; return a; });
    return Promise.resolve(a);
  }
  function syncQueue() {
    if (syncing || !navigator.onLine) return updateStatus();
    syncing = true;
    return Promise.all([dbAll('queue'), loadLinkMap()]).then(function (values) {
      var queue = values[0].sort(function (a, b) { return a.createdAt - b.createdAt; }), links = values[1];
      var chain = Promise.resolve(), synced = 0, lastError = null;
      queue.forEach(function (rec) {
        chain = chain.then(function () {
          if (lastError || !navigator.onLine) return;
          return argsForReplay(rec, links).then(function (args) { return postApi(rec.method, args); }).then(function (result) {
            var photoId = rec.method === 'uploadPolePhoto' ? rec.args[1] && rec.args[1].clientPhotoId : (rec.method === 'uploadPhoto' ? rec.args[1] : '');
            if (photoId && result && result.url) {
              links['offline-photo://' + photoId] = result.url;
              return dbPut('kv', { key: 'offline-photo-link-map', value: links }).then(function () { return dbDelete('queue', rec.id); }).then(function () { synced++; });
            }
            return dbDelete('queue', rec.id).then(function () { synced++; });
          }).catch(function (err) {
            lastError = err;
          });
        });
      });
      return chain.then(function () {
        return updateStatus().then(function () {
          if (synced) toastSafe('ซิงก์ข้อมูลออฟไลน์สำเร็จ ' + synced + ' รายการ', false);
          if (lastError) {
            if (lastError.status === 401) toastSafe('รหัสเข้าใช้งานไม่ถูกต้อง — เปิดแอปเพื่อกรอกรหัสใหม่ แล้วกดซิงก์อีกครั้ง', true);
            else toastSafe('ซิงก์ไม่ครบ ข้อมูลค้างไว้ในเครื่องอีกครั้ง: ' + (lastError.message || lastError), true);
          }
        });
      });
    }).catch(function (err) {
      toastSafe('ตรวจคิวซิงก์ไม่สำเร็จ: ' + (err.message || err), true);
    }).finally(function () { syncing = false; updateStatus(); });
  }
  function enqueue(method, args) {
    var id = 'q_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2));
    return Promise.resolve().then(function () {
      var qargs = offlineQueueArgs(method, args);
      return mirrorDraft(method, args).then(function () {
        return dbPut('queue', { id: id, method: method, args: qargs, createdAt: Date.now() });
      });
    }).then(function () {
      if (method === 'saveRouteDraft' || method === 'saveRunDraft') {
        var isRun = method === 'saveRunDraft';
        var payload = String(args.length >= 3 ? args[2] || '' : args[1] || '');
        return dbPut('cache', { key: 'draft:' + (isRun ? 'run' : 'route'), value: payload, savedAt: Date.now() });
      }
    }).then(function () {
      updateStatus();
      if (navigator.onLine) setTimeout(syncQueue, 500);
      return offlineResult(method, args, id);
    });
  }
  function invoke(method, args) {
    args = prepareIds(method, clone(args || []));
    if (!navigator.onLine) {
      if (method === 'allocRunId') {
        var now = new Date(), z = function (n) { return n < 10 ? '0' + n : String(n); };
        return Promise.resolve(z(now.getDate()) + '.' + z(now.getMonth() + 1) + '.' + (now.getFullYear() + 543) + '-OFF-' + Date.now().toString(36));
      }
      if (method === 'loadRouteDraft' || method === 'loadRunDraft') {
        var k = method === 'loadRouteDraft' ? 'route' : 'run';
        return dbGet('kv', 'draft:' + k).then(function (x) { return x ? String(x.value || '') : ''; }).catch(function () { return ''; });
      }
      if (method === 'clearRunDraft') return mirrorDraft(method, args).then(function () { return enqueue(method, args); });
      return queuedWrites.has(method) ? enqueue(method, args) : offlineRead(method, args);
    }
    if ((method === 'loadRouteDraft' || method === 'loadRunDraft')) {
      return postApi(method, args).then(function (result) {
        var k = method === 'loadRouteDraft' ? 'route' : 'run';
        if (result) dbPut('kv', { key: 'draft:' + k, value: result, savedAt: Date.now() });
        return result;
      }).catch(function (err) {
        if (!err.remote) return offlineRead(method, args);
        return offlineRead(method, args).catch(function () { throw err; });
      });
    }
    var requestArgs = args;
    return postApi(method, requestArgs).then(function (result) {
      return Promise.resolve(cacheRead(method, requestArgs, result)).then(function (cached) {
        if (method === 'saveRouteDraft' || method === 'saveRunDraft') return mirrorDraft(method, requestArgs).then(function () { return cached; });
        if (method === 'clearRunDraft') return mirrorDraft(method, requestArgs).then(function () { return cached; });
        return cached;
      });
    }).catch(function (err) {
      if (queuedWrites.has(method) && (!err.remote || err.status >= 500)) {
        return enqueue(method, requestArgs).then(function (result) { toastSafe('การเชื่อมต่อล้มเหลว: เก็บรายการไว้ในเครื่องเพื่อซิงก์ภายหลัง', false); return result; });
      }
      if (cachedReads.has(method)) return offlineRead(method, requestArgs).catch(function () { throw err; });
      throw err;
    });
  }
  function makeRunner() {
    var success = null, failure = null;
    var proxy;
    proxy = new Proxy({}, { get: function (_target, prop) {
      if (prop === 'withSuccessHandler') return function (fn) { success = fn; return proxy; };
      if (prop === 'withFailureHandler') return function (fn) { failure = fn; return proxy; };
      if (prop === 'withUserObject') return function () { return proxy; };
      if (typeof prop !== 'string') return undefined;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        invoke(prop, args).then(function (result) { if (success) success(result); }, function (err) {
          if (failure) failure(err);
          else { console.error('[PoleSurvey Supabase API]', prop, err); toastSafe(err.message || String(err), true); }
        });
      };
    } });
    return proxy;
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  try { Object.defineProperty(window.google.script, 'run', { configurable: true, get: makeRunner }); }
  catch (_) { window.google.script.run = makeRunner(); }
  window.PoleOfflineSync = { sync: syncQueue, status: updateStatus, queuedCount: queueCount };
  window.addEventListener('online', function () { updateStatus().then(syncQueue); });
  window.addEventListener('offline', updateStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && navigator.onLine) syncQueue(); });
  window.addEventListener('load', function () {
    var button = document.getElementById('syncPendingBtn');
    if (button) button.addEventListener('click', function () { syncQueue(); });
    updateStatus();
    if (navigator.onLine) setTimeout(syncQueue, 1500);
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') navigator.serviceWorker.register('./service-worker.js').catch(function (e) { console.warn('Service worker registration failed', e); });
  });
})();
