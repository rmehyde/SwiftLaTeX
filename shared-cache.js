// Shared file caching implementation for SwiftLaTeX
// Used by both dvipdfm.wasm and xetex.wasm modules

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
let db = null;

async function initCache() {
    if (db) return db;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('texlive-file-cache', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('files')) {
                database.createObjectStore('files', { keyPath: 'cacheKey' });
            }
        };
    });
}

async function getCacheEntry(cacheKey) {
    await initCache();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(cacheKey);
        
        request.onsuccess = () => {
            const entry = request.result;
            if (!entry) {
                resolve(null);
                return;
            }
            
            // Check TTL
            const now = Date.now();
            if (now - entry.lastUpdated > TTL_MS) {
                // Entry expired, remove it
                deleteCacheEntry(cacheKey);
                resolve(null);
                return;
            }
            
            resolve(entry);
        };
        request.onerror = () => reject(request.error);
    });
}

async function setCacheEntry(cacheKey, exists, content = null) {
    await initCache();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        
        const entry = {
            cacheKey,
            exists,
            lastUpdated: Date.now(),
            content: content
        };
        
        const request = store.put(entry);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function deleteCacheEntry(cacheKey) {
    await initCache();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        const request = store.delete(cacheKey);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function purgeCache() {
    await initCache();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        const request = store.clear();
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function downloadAndCacheFile(cacheKey, endpoint) {
    // Check IndexedDB cache first
    const cacheEntry = await getCacheEntry(cacheKey);
    
    if (cacheEntry && !cacheEntry.exists) {
        // File was previously determined to not exist (404)
        return 0;
    }
    
    if (cacheEntry && cacheEntry.exists && cacheEntry.content) {
        // File exists in cache, restore to VFS
        const fileid = cacheKey.split("/").pop();
        const savepath = TEXCACHEROOT + "/" + fileid;
        
        try {
            // Convert blob back to Uint8Array and write to VFS
            const arrayBuffer = await cacheEntry.content.arrayBuffer();
            FS.writeFile(savepath, new Uint8Array(arrayBuffer));
            
            // Verify the write worked
            const stat = FS.stat(savepath);
            
            // Allocate and return the path
            return _allocate(intArrayFromString(savepath));
            
        } catch (err) {
            // Cache entry corrupted, remove it and continue to re-download
            await deleteCacheEntry(cacheKey);
        }
    }

    const remote_url = self.texlive_endpoint + endpoint + cacheKey;
    
    try {
        const response = await fetch(remote_url);
        
        if (response.ok) {
            const arraybuffer = await response.arrayBuffer();
            
            const fileid = remote_url.split("/").pop();
            const savepath = TEXCACHEROOT + "/" + fileid;
            
            try {
                FS.writeFile(savepath, new Uint8Array(arraybuffer));
                
                // Immediately verify the write worked
                const stat = FS.stat(savepath);
                
                // Cache the file content as blob in IndexedDB
                const blob = new Blob([arraybuffer]);
                await setCacheEntry(cacheKey, true, blob);
                
                // Allocate and return the path
                const allocatedPath = _allocate(intArrayFromString(savepath));
                return allocatedPath;
                
            } catch (writeErr) {
                console.error("DEBUG: [VFS_WRITE_ERROR] Failed to write file to VFS:", writeErr);
                return 0;
            }
            
        } else if (response.status === 301 || response.status === 404) {
            // Cache the 404 result
            await setCacheEntry(cacheKey, false);
            return 0;
        } else {
            return 0;
        }
        
    } catch (err) {
        console.error("DEBUG: [FETCH_EXCEPTION] Network error fetching", remote_url, "error:", err);
        return 0;
    }
}
