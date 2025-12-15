// Shared file caching implementation for SwiftLaTeX
// Used by both dvipdfm.wasm and xetex.wasm modules

let cache200 = {};
let cache404 = {};

async function downloadAndCacheFile(cacheKey, endpoint) {
    // Check 404 cache
    if (cacheKey in cache404) {
        return 0;
    }

    // Check 200 cache
    if (cacheKey in cache200) {
        const savepath = cache200[cacheKey];
        
        // Verify file actually exists in VFS before returning
        try {
            const stat = FS.stat(savepath);
            return _allocate(intArrayFromString(savepath));
        } catch (err) {
            // Remove from cache and continue to re-download
            delete cache200[cacheKey];
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
                
                // Cache the path
                cache200[cacheKey] = savepath;
                
                // Allocate and return the path
                const allocatedPath = _allocate(intArrayFromString(savepath));
                return allocatedPath;
                
            } catch (writeErr) {
                console.error("DEBUG: [VFS_WRITE_ERROR] Failed to write file to VFS:", writeErr);
                return 0;
            }
            
        } else if (response.status === 301 || response.status === 404) {
            cache404[cacheKey] = 1;
            return 0;
        } else {
            return 0;
        }
        
    } catch (err) {
        console.error("DEBUG: [FETCH_EXCEPTION] Network error fetching", remote_url, "error:", err);
        return 0;
    }
}
