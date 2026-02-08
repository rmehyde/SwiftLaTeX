/********************************************************************************
 * Copyright (C) 2019 Elliott Wen.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
export var EngineStatus;
(function (EngineStatus) {
    EngineStatus[EngineStatus["Init"] = 1] = "Init";
    EngineStatus[EngineStatus["Ready"] = 2] = "Ready";
    EngineStatus[EngineStatus["Busy"] = 3] = "Busy";
    EngineStatus[EngineStatus["Error"] = 4] = "Error";
})(EngineStatus || (EngineStatus = {}));
const ENGINE_PATH = 'swiftlatexdvipdfm.js';
export class CompileResult {
    constructor() {
        this.pdf = undefined;
        this.status = -254;
        this.log = 'No log';
    }
}
export class DvipdfmxEngine {
    constructor() {
        this.latexWorker = undefined;
        this.latexWorkerStatus = EngineStatus.Init;
    }
    async loadEngine(engineUrl = ENGINE_PATH) {
        if (this.latexWorker !== undefined) {
            throw new Error('Other instance is running, abort()');
        }
        this.latexWorkerStatus = EngineStatus.Init;
        await new Promise((resolve, reject) => {
            this.latexWorker = new Worker(engineUrl, { type: 'module' });
            this.latexWorker.onmessage = (ev) => {
                const data = ev.data;
                const cmd = data.result;
                if (cmd === 'ok') {
                    this.latexWorkerStatus = EngineStatus.Ready;
                    console.log('Dvipdfmx Worker loaded successfully');
                    resolve();
                }
                else {
                    this.latexWorkerStatus = EngineStatus.Error;
                    reject(new Error('Dvipdfmx Worker failed: ' + JSON.stringify(data)));
                }
            };
            this.latexWorker.onerror = (ev) => {
                console.error('Dvipdfmx Worker error:', ev.message, ev.filename, ev.lineno);
                this.latexWorkerStatus = EngineStatus.Error;
                const details = [
                    ev.message,
                    ev.filename ? `File: ${ev.filename}` : null,
                    ev.lineno ? `Line: ${ev.lineno}` : null,
                ].filter(Boolean).join('\n');
                reject(new Error(details));
            };
        });
        this.latexWorker.onmessage = (_) => { };
        this.latexWorker.onerror = (_) => { };
    }
    isReady() {
        return this.latexWorkerStatus === EngineStatus.Ready;
    }
    checkEngineStatus() {
        if (!this.isReady()) {
            throw Error('Engine is still spinning or not ready yet!');
        }
    }
    async compilePDF() {
        this.checkEngineStatus();
        this.latexWorkerStatus = EngineStatus.Busy;
        const start_compile_time = performance.now();
        const res = await new Promise((resolve, _) => {
            this.latexWorker.onmessage = (ev) => {
                const data = ev.data;
                const cmd = data.cmd;
                if (cmd !== 'compile')
                    return;
                const result = data.result;
                const log = data.log;
                const status = data.status;
                this.latexWorkerStatus = EngineStatus.Ready;
                console.log('Engine compilation finish ' + (performance.now() - start_compile_time));
                const nice_report = new CompileResult();
                nice_report.status = status;
                nice_report.log = log;
                if (result === 'ok') {
                    const pdf = new Uint8Array(data.pdf);
                    nice_report.pdf = pdf;
                }
                resolve(nice_report);
            };
            this.latexWorker.postMessage({ cmd: 'compilepdf' });
            console.log('Engine compilation start');
        });
        this.latexWorker.onmessage = (_) => { };
        return res;
    }
    setEngineMainFile(filename) {
        this.checkEngineStatus();
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ cmd: 'setmainfile', url: filename });
        }
    }
    writeMemFSFile(filename, srccode) {
        this.checkEngineStatus();
        if (srccode === undefined) {
            return;
        }
        if (srccode instanceof ArrayBuffer) {
            srccode = new Uint8Array(srccode);
        }
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ cmd: 'writefile', url: filename, src: srccode });
        }
    }
    makeMemFSFolder(folder) {
        this.checkEngineStatus();
        if (this.latexWorker !== undefined) {
            if (folder === '' || folder === '/') {
                return;
            }
            this.latexWorker.postMessage({ cmd: 'mkdir', url: folder });
        }
    }
    setTexliveEndpoint(url) {
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ 'cmd': 'settexliveurl', 'url': url });
        }
    }
    closeWorker() {
        if (this.latexWorker !== undefined) {
            this.latexWorker.postMessage({ cmd: 'grace' });
            this.latexWorker = undefined;
        }
    }
}
