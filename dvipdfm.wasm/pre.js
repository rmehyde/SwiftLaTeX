const TEXCACHEROOT = "/tex";
const WORKROOT = "/work";
var Module = {};
self.memlog = "";
self.mainfile = "main.tex";
self.texlive_endpoint = "/lib/";
Module['print'] = function(a) {
    self.memlog += (a + "\n");
    console.log(a);
};

Module['printErr'] = function(a) {
    self.memlog += (a + "\n");
    console.log(a);
};

Module['preRun'] = function() {
    FS.mkdir(TEXCACHEROOT);
    FS.mkdir(WORKROOT);
};

function _allocate(content) {
    let res = _malloc(content.length);
    HEAPU8.set(new Uint8Array(content), res);
    return res; 
}

function prepareExecutionContext() {
    self.memlog = '';
    FS.chdir(WORKROOT);
}

Module['postRun'] = function() {
    self.postMessage({
        'result': 'ok',
    });
};

function cleanDir(dir) {
    let l = FS.readdir(dir);
    for (let i in l) {
        let item = l[i];
        if (item === "." || item === "..") {
            continue;
        }
        item = dir + "/" + item;
        let fsStat = undefined;
        try {
            fsStat = FS.stat(item);
        } catch (err) {
            console.error("Not able to fsstat " + item);
            continue;
        }
        if (FS.isDir(fsStat.mode)) {
            cleanDir(item);
        } else {
            try {
                FS.unlink(item);
            } catch (err) {
                console.error("Not able to unlink " + item);
            }
        }
    }

    if (dir !== WORKROOT) {
        try {
            FS.rmdir(dir);
        } catch (err) {
            console.error("Not able to top level " + dir);
        }
    }
}



Module['onAbort'] = function() {
    self.memlog += 'Engine crashed';
    self.postMessage({
        'result': 'failed',
        'status': -254,
        'log': self.memlog,
        'cmd': 'compile'
    });
    return;
};


async function compilePDFRoutine() {
    prepareExecutionContext();
    const setMainFunction = cwrap('setMainEntry', 'number', ['string']);
    setMainFunction(self.mainfile);
    let status = await Module.ccall(
        "compilePDF",  // c symbol name, no leading underscore
        "number",
        [],
        [],
        { async: true }
    );
    if (status === 0) {
        let pdfArrayBuffer = null;
        try {
            let pdfurl = WORKROOT + "/" + self.mainfile.substr(0, self.mainfile.length - 4) + ".pdf"
            pdfArrayBuffer = FS.readFile(pdfurl, {
                encoding: 'binary'
            });
        } catch (err) {
            console.error("Fetch content failed.");
            status = -253;
            self.postMessage({
                'result': 'failed',
                'status': status,
                'log': self.memlog,
                'cmd': 'compile'
            });
            return;
        }
        self.postMessage({
            'result': 'ok',
            'status': status,
            'log': self.memlog,
            'pdf': pdfArrayBuffer.buffer,
            'cmd': 'compile'
        }, [pdfArrayBuffer.buffer]);
    } else {
        console.error("Compilation failed, with status code " + status);
        self.postMessage({
            'result': 'failed',
            'status': status,
            'log': self.memlog,
            'cmd': 'compile'
        });
    }
}


function mkdirRoutine(dirname) {
    try {
        //console.log("removing " + item);
        FS.mkdir(WORKROOT + "/" + dirname);
        self.postMessage({
            'result': 'ok',
            'cmd': 'mkdir'
        });
    } catch (err) {
        console.error("Not able to mkdir " + dirname);
        self.postMessage({
            'result': 'failed',
            'cmd': 'mkdir'
        });
    }
}

function writeFileRoutine(filename, content) {
    try {
        FS.writeFile(WORKROOT + "/" + filename, content);
        self.postMessage({
            'result': 'ok',
            'cmd': 'writefile'
        });
    } catch (err) {
        console.error("Unable to write mem file");
        self.postMessage({
            'result': 'failed',
            'cmd': 'writefile'
        });
    }
}

function setTexliveEndpoint(url) {
    if(url) {
        if (!url.endsWith("/")) {
            url += '/';
        }
        self.texlive_endpoint = url;
    }
}

self['onmessage'] = function(ev) {
    let data = ev['data'];
    let cmd = data['cmd'];
    if (cmd === 'compilepdf') {
        compilePDFRoutine().catch(err => {
            console.error(err);
            self.postMessage({ result: 'failed', status: -1, log: String(err?.stack || err), cmd: 'compile' });
        });
    } else if (cmd === "mkdir") {
        mkdirRoutine(data['url']);
    } else if (cmd === "settexliveurl") {
        setTexliveEndpoint(data['url']);
    } else if (cmd === "writefile") {
        writeFileRoutine(data['url'], data['src']);
    } else if (cmd === "setmainfile") {
        self.mainfile = data['url'];
    } else if (cmd === "grace") {
        console.error("Gracefully Close");
        self.close();
    } else if (cmd === "flushcache") {
        cleanDir(WORKROOT);
    } else {
        console.error("Unknown command " + cmd);
    }
};

function kpse_find_file_impl(nameptr, format, _mustexist) {
    let reqname = UTF8ToString(nameptr);

    // It is a hack, since webassembly version latex engine stores 
    // all templates file inside /tex/, therefore, we have to fetch it again
    if (reqname.startsWith("/tex/")) {
        reqname = reqname.substr(5);
    }

    if (reqname.includes("/")) {
        return 0;
    }

    const cacheKey = format + "/" + reqname;
    return downloadAndCacheFile(cacheKey, 'xetex/', 'TexLive', texlive200_cache, texlive404_cache);
}