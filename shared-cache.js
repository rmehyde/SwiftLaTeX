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