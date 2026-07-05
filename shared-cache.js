// Shared file caching implementation for SwiftLaTeX
// Used by both dvipdfm.wasm and xetex.wasm modules

let texlive404_cache = {};
let texlive200_cache = {};
let font200_cache = {};
let font404_cache = {};

function downloadAndCacheFile(cacheKey, endpoint, logPrefix, cache200, cache404) {
    if (cacheKey in cache404) {
        return 0;
    }

    if (cacheKey in cache200) {
        const savepath = cache200[cacheKey];
        return _allocate(intArrayFromString(savepath));
    }

    // Sealed cache: after a full prewarm, the in-memory set mirrors the entire
    // static server, so any miss is a file the server also lacks. Short-circuit
    // to "absent" instead of the blocking sync XHR -> a warm compile makes zero
    // network requests. (Misses are expected: TeX speculatively probes for optional
    // files that legitimately don't exist.)
    if (self.cacheSealed) {
        return 0;
    }

    const remote_url = self.texlive_endpoint + endpoint + cacheKey;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", remote_url, false);
    xhr.timeout = 150000;
    xhr.responseType = "arraybuffer";
    console.log("Start downloading " + logPrefix + " file " + remote_url);
    
    try {
        xhr.send();
    } catch (err) {
        console.log(logPrefix + " Download Failed " + remote_url);
        return 0;
    }

    if (xhr.status === 200) {
        let arraybuffer = xhr.response;
        const fileid = remote_url.split("/").pop();

        const savepath = TEXCACHEROOT + "/" + fileid;
        FS.writeFile(savepath, new Uint8Array(arraybuffer));
        cache200[cacheKey] = savepath;
        return _allocate(intArrayFromString(savepath));

    } else if (xhr.status === 301 || xhr.status === 404) {
        console.log(logPrefix + " File not exists " + remote_url);
        cache404[cacheKey] = 1;
        return 0;
    }

    return 0;
}

// --- Durable cache (IndexedDB) + prewarming --------------------------------
// Prepopulate the in-memory caches + MEMFS before the synchronous compile, so the
// sync kpse lookup hits memory with no per-file XHR. Bytes are stored durably in
// IndexedDB keyed by cacheKey + a bundle version: the first load (or a version bump)
// fetches over the network and fills IndexedDB; every later load hydrates from
// IndexedDB
self.cacheSealed = false;

function prewarmMapsFor(endpoint) {
    if (endpoint === 'fontconfig/' && typeof font200_cache !== 'undefined') {
        return font200_cache;
    }
    return texlive200_cache;
}

const PREWARM_DB = 'swiftlatex-cache';
const PREWARM_FILES = 'files';
const PREWARM_META = 'meta';

function prewarmOpenDB() {
    return new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(PREWARM_DB, 1); }
        catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(PREWARM_FILES)) db.createObjectStore(PREWARM_FILES);
            if (!db.objectStoreNames.contains(PREWARM_META)) db.createObjectStore(PREWARM_META);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function prewarmIdbGet(db, store, key) {
    return new Promise((resolve, reject) => {
        const r = db.transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

function prewarmIdbPut(db, store, key, val) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// manifest: [{cacheKey, endpoint}]; version: string identifying the bundle contents.
async function prewarmCache(manifest, version) {
    let hydrated = 0, fetched = 0, failed = 0, skipped = 0;
    let db = null;
    try { db = await prewarmOpenDB(); }
    catch (e) { console.warn('[prewarm] IndexedDB unavailable, network-only: ' + e); }

    // Only trust IndexedDB contents when the stored version matches this bundle.
    let warm = false;
    if (db) {
        try { warm = (await prewarmIdbGet(db, PREWARM_META, 'version')) === version; }
        catch (e) { warm = false; }
    }

    const CONCURRENCY = 8;
    let idx = 0;
    async function pump() {
        while (idx < manifest.length) {
            const entry = manifest[idx++];
            const endpoint = entry.endpoint || 'xetex/';
            const cache200 = prewarmMapsFor(endpoint);
            const key = entry.cacheKey;
            if (key in cache200) { skipped++; continue; }
            const fileid = key.split('/').pop();
            const savepath = TEXCACHEROOT + '/' + fileid;

            let bytes = null;
            if (warm && db) {
                try { bytes = (await prewarmIdbGet(db, PREWARM_FILES, key)) || null; }
                catch (e) { bytes = null; }
            }
            if (!bytes) {
                const remote_url = self.texlive_endpoint + endpoint + key;
                try {
                    const resp = await fetch(remote_url);
                    if (!resp.ok) { failed++; console.warn('[prewarm] ' + resp.status + ' ' + remote_url); continue; }
                    bytes = await resp.arrayBuffer();
                } catch (err) {
                    failed++; console.warn('[prewarm] fetch failed ' + remote_url + ' ' + err); continue;
                }
                if (db) { try { await prewarmIdbPut(db, PREWARM_FILES, key, bytes); } catch (e) {} }
                fetched++;
            } else {
                hydrated++;
            }
            FS.writeFile(savepath, new Uint8Array(bytes));
            cache200[key] = savepath;
        }
    }
    const pool = [];
    for (let k = 0; k < Math.min(CONCURRENCY, manifest.length); k++) pool.push(pump());
    await Promise.all(pool);

    // Mark the bundle durable only after a complete, clean population.
    if (db && !warm && failed === 0) {
        try { await prewarmIdbPut(db, PREWARM_META, 'version', version); } catch (e) {}
    }
    return { hydrated: hydrated, fetched: fetched, failed: failed, skipped: skipped, total: manifest.length };
}