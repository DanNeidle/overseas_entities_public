/**
 * data-service.js
 * Data loading, decoding, schema expansion, and caching helpers.
 */

function decodeKind(k) {
    if (k === undefined || k === null) return undefined;
    // Require numeric/ID form; no fallback to long strings (no legacy support)
    return CONFIG.BO_KIND.ID_TO_LONG[String(k)];
}

// Expand short-key JSON schema (phase 2) into the long-key shape expected by the app.
// No-op for already-long schemas.
function expandSchema(data) {
    if (!Array.isArray(data) || data.length === 0) return data;
    const sample = data[0] || {};
    const isShort = (typeof sample.t !== 'undefined') || (typeof sample.ps !== 'undefined');
    if (!isShort) return data;

    const RS_SHORT_TO_LONG = { sus: 'suspect', ind: 'individual' };

    function expandBO(sb) {
        if (!sb) return sb;
        const lat = (sb.lat !== undefined && sb.lat !== null) ? parseFloat(sb.lat) : sb.lat;
        const lon = (sb.lon !== undefined && sb.lon !== null) ? parseFloat(sb.lon) : sb.lon;
        return {
            name: sb.n,
            address: sb.a,
            lat: isNaN(lat) ? null : lat,
            lon: isNaN(lon) ? null : lon,
            reg_status: RS_SHORT_TO_LONG[sb.rs] || sb.rs,
            kind: decodeKind(sb.k),
            count: (typeof sb.c === 'string') ? parseInt(sb.c, 10) : sb.c,
            control: sb.ctrl,
            sanctioned: sb.san,
        };
    }

    function expandProprietor(sp) {
        if (!sp) return sp;
        const bos = Array.isArray(sp.bs) ? sp.bs.map(expandBO) : [];
        const plat = (sp.lat !== undefined && sp.lat !== null) ? parseFloat(sp.lat) : sp.lat;
        const plon = (sp.lon !== undefined && sp.lon !== null) ? parseFloat(sp.lon) : sp.lon;
        const out = {
            name: sp.n,
            address: sp.a,
            lat: isNaN(plat) ? null : plat,
            lon: isNaN(plon) ? null : plon,
            BOs: bos,
            country_incorporated: sp.ci,
            ch_number: sp.ch ?? sp.ch_number,
            count: (typeof sp.c === 'string') ? parseInt(sp.c, 10) : sp.c,
            wrong_address: sp.wa,
            BO_failure: sp.bf,
            trustee: sp.tr,
            excluded: sp.ex,
            status: sp.st,
            has_individual_non_trustee: sp.hin,
            has_suspect_bo: sp.hsb,
            has_sanctioned_bo: sp.hsan,
        };
        // Remove undefined keys to keep objects tidy
        Object.keys(out).forEach(k => { if (typeof out[k] === 'undefined') delete out[k]; });
        return out;
    }

    function expandProperty(sp) {
        let props = [];
        let pids = undefined;
        if (Array.isArray(sp.ps)) {
            if (sp.ps.length > 0 && typeof sp.ps[0] === 'object') {
                props = sp.ps.map(expandProprietor);
            } else {
                // Short schema with proprietor IDs only
                pids = sp.ps.map(v => (typeof v === 'string' ? parseInt(v, 10) : v));
            }
        }
        // Tenure decoding: prefer compact boolean 'fh' (1/0), fallback to 'ten'
        let tenure = undefined;
        if (typeof sp.fh !== 'undefined') {
            tenure = sp.fh ? 'Freehold' : 'Leasehold';
        } else if (typeof sp.ten !== 'undefined') {
            tenure = sp.ten;
        }
        // Coerce lat/lon and price to numbers
        const plat = (sp.lat !== undefined && sp.lat !== null) ? parseFloat(sp.lat) : sp.lat;
        const plon = (sp.lon !== undefined && sp.lon !== null) ? parseFloat(sp.lon) : sp.lon;
        const price = (sp.pr !== undefined && sp.pr !== null) ? parseInt(sp.pr, 10) : sp.pr;
        const out = {
            property_title_number: sp.t,
            property_tenure: tenure,
            property_uk_address: sp.ad,
            price_paid: (typeof price === 'number' && !isNaN(price)) ? price : sp.pr,
            date_added: sp.dt,
            property_type: sp.pt ?? sp.property_type,
            lat: isNaN(plat) ? null : plat,
            lon: isNaN(plon) ? null : plon,
            ...(props.length ? { props } : {}),
            ...(pids ? { pids } : {}),
            status: sp.st,
        };
        Object.keys(out).forEach(k => { if (typeof out[k] === 'undefined') delete out[k]; });
        return out;
    }

    return data.map(expandProperty);
}

// Expand proprietors dictionary from short keys to long keys
function expandProprietorsDictShortToLong(data) {
    if (!data || typeof data !== 'object') return {};
    const RS_SHORT_TO_LONG = { sus: 'suspect', ind: 'individual' };

    function expandBO(sb) {
        if (!sb) return sb;
        return {
            name: sb.n,
            address: sb.a,
            lat: sb.lat,
            lon: sb.lon,
            reg_status: RS_SHORT_TO_LONG[sb.rs] || sb.rs,
            kind: decodeKind(sb.k),
            count: sb.c,
            control: sb.ctrl,
            sanctioned: sb.san,
        };
    }
    function expandProprietor(sp) {
        const bos = Array.isArray(sp.bs) ? sp.bs.map(expandBO) : [];
        const out = {
            name: sp.n,
            address: sp.a,
            lat: sp.lat,
            lon: sp.lon,
            BOs: bos,
            country_incorporated: sp.ci,
            ch_number: sp.ch ?? sp.ch_number,
            count: sp.c,
            wrong_address: sp.wa,
            BO_failure: sp.bf,
            trustee: sp.tr,
            excluded: sp.ex,
            status: sp.st,
            has_individual_non_trustee: sp.hin,
            has_suspect_bo: sp.hsb,
            has_sanctioned_bo: sp.hsan,
        };
        Object.keys(out).forEach(k => { if (typeof out[k] === 'undefined') delete out[k]; });
        return out;
    }

    const out = {};
    for (const [k, v] of Object.entries(data)) {
        const id = /^\d+$/.test(k) ? parseInt(k, 10) : k; // keep numeric if possible
        out[id] = expandProprietor(v);
    }
    return out;
}

// Resolve property pids into props using proprietorsById (run after proprietors load)
function resolveProprietorRefs(properties, proprietorsById) {
    if (!Array.isArray(properties) || !proprietorsById) return;
    for (const item of properties) {
        if (!item.props && Array.isArray(item.pids)) {
            item.props = item.pids.map(pid => proprietorsById[pid]).filter(Boolean);
        }
    }
}

function decodeMsgpack(buffer) {
    if (!window.MessagePack || typeof MessagePack.decode !== 'function') {
        throw new Error('MessagePack decoder not available');
    }
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return MessagePack.decode(bytes);
}

function loadBinary(url, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";

        xhr.onprogress = (evt) => {
            if (onProgress) onProgress(evt.loaded);
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response);
            } else {
                reject(new Error(`HTTP ${xhr.status} for ${url}`));
            }
        };

        xhr.onerror = () => reject(new Error("Network Error"));
        xhr.send();
    });
}

async function fetchManifest(defaultTotalBytes, options = {}) {
    const {
        manifestUrl = 'overseas_entities_data_info.txt',
        propertiesUrl = 'overseas_entities_properties.msgpack',
        proprietorsUrl = 'overseas_entities_proprietors.msgpack',
    } = options;

    try {
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const txt = await response.text();
        const lines = (txt || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let dataHash = null;
        let totalBytes = defaultTotalBytes;
        let datasetVersionLabel = null;
        let propsUrl = propertiesUrl;
        const propsBase = propertiesUrl.replace(/\.msgpack$/i, '');
        let ownersUrl = proprietorsUrl;
        const ownersBase = proprietorsUrl.replace(/\.msgpack$/i, '');

        if (lines.length >= 2) {
            const size = parseInt(lines[0], 10);
            const hash = lines[1];
            if (!isNaN(size) && size > 0) totalBytes = size;
            if (hash && /^[a-f0-9]{8}$/i.test(hash)) {
                dataHash = hash;
                propsUrl = propsBase === propertiesUrl ? propertiesUrl : `${propsBase}.${hash}.msgpack`;
                ownersUrl = ownersBase === proprietorsUrl ? proprietorsUrl : `${ownersBase}.${hash}.msgpack`;
            }
        }
        if (lines.length >= 3 && lines[2]) {
            datasetVersionLabel = lines[2];
        }
        return {
            dataHash,
            totalBytes,
            datasetVersionLabel,
            propertiesUrl: propsUrl,
            proprietorsUrl: ownersUrl,
            usedFallback: false,
        };
    } catch {
        return {
            dataHash: null,
            totalBytes: defaultTotalBytes,
            datasetVersionLabel: null,
            propertiesUrl: propertiesUrl,
            proprietorsUrl: proprietorsUrl,
            usedFallback: true,
        };
    }
}

async function loadControlTypes(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

function canUseLocalForage() {
    return window.localforage && typeof localforage.getItem === 'function';
}

function scheduleAfterPaint() {
    return new Promise((resolve) => {
        if (window.requestIdleCallback) {
            requestIdleCallback(() => resolve(), { timeout: 200 });
        } else {
            // Two rAFs ensure at least one paint before heavy work.
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        }
    });
}

async function loadAll(options = {}) {
    const {
        controlTypesUrl = 'overseas_entities_map_control_types.json',
        manifestUrl = 'overseas_entities_data_info.txt',
        propertiesUrl = 'overseas_entities_properties.msgpack',
        proprietorsUrl = 'overseas_entities_proprietors.msgpack',
        defaultTotalBytes = 0,
        cacheKeys = null,
        onControlTypes,
        onManifest,
        onStatus,
        onProgress,
        onDownloadStart,
        onCacheHit,
        onPropertiesLoaded,
        onProprietorsLoaded,
        onProprietorsError,
    } = options;

    const emitStatus = (label) => {
        if (onStatus && label) onStatus(label);
    };

    let bytesProps = 0;
    let bytesOwners = 0;
    let totalBytes = defaultTotalBytes;

    const reportProgress = (file, loadedBytes) => {
        if (file === 'properties') {
            bytesProps = loadedBytes || bytesProps;
        } else if (file === 'proprietors') {
            bytesOwners = loadedBytes || bytesOwners;
        }
        if (onProgress) {
            onProgress({
                file,
                loadedBytes,
                bytesProps,
                bytesOwners,
                totalBytes,
                overallLoaded: bytesProps + bytesOwners,
            });
        }
    };

    // 1. Load control types map
    let controlTypesMap;
    try {
        controlTypesMap = await loadControlTypes(controlTypesUrl);
    } catch (err) {
        const error = new Error('Failed to load control types');
        error.stage = 'control-types';
        error.original = err;
        throw error;
    }
    if (onControlTypes) onControlTypes(controlTypesMap);

    // 2. Fetch manifest for hashed filenames and total size
    const manifest = await fetchManifest(defaultTotalBytes, {
        manifestUrl,
        propertiesUrl,
        proprietorsUrl,
    });

    if (Number.isFinite(manifest.totalBytes)) {
        totalBytes = manifest.totalBytes;
    }
    if (onManifest) onManifest(manifest);

    const dataHash = manifest.dataHash;
    const propertiesUrlResolved = manifest.propertiesUrl || propertiesUrl;
    const proprietorsUrlResolved = manifest.proprietorsUrl || proprietorsUrl;

    const cacheEnabled = !!cacheKeys && canUseLocalForage();

    async function loadFromCacheIfFresh() {
        if (!cacheEnabled || !dataHash) return null;
        try {
            const cachedHash = await localforage.getItem(cacheKeys.VERSION_KEY);
            if (!cachedHash || cachedHash !== dataHash) return null;
            const cached = await Promise.all([
                localforage.getItem(cacheKeys.PROPERTIES_KEY),
                localforage.getItem(cacheKeys.PROPRIETORS_KEY),
            ]);
            const cachedProperties = cached[0];
            const cachedProprietors = cached[1];
            if (!cachedProperties || !cachedProprietors) return null;
            return { properties: cachedProperties, proprietorsById: cachedProprietors };
        } catch {
            return null;
        }
    }

    function saveDataToCache(properties, proprietorsById) {
        if (!cacheEnabled || !dataHash) return;
        Promise.all([
            localforage.setItem(cacheKeys.VERSION_KEY, dataHash),
            localforage.setItem(cacheKeys.PROPERTIES_KEY, properties),
            localforage.setItem(cacheKeys.PROPRIETORS_KEY, proprietorsById),
        ]).catch(() => {});
    }

    const cached = await loadFromCacheIfFresh();
    if (cached) {
        if (onCacheHit) onCacheHit({ dataHash });
        emitStatus('Loading cached data...');
        reportProgress('properties', totalBytes);
        resolveProprietorRefs(cached.properties, cached.proprietorsById);
        if (onPropertiesLoaded) onPropertiesLoaded(cached.properties);
        if (onProprietorsLoaded) onProprietorsLoaded(cached.proprietorsById);
        emitStatus('Done');
        return {
            controlTypesMap,
            properties: cached.properties,
            proprietorsById: cached.proprietorsById,
            dataHash,
            datasetVersionLabel: manifest.datasetVersionLabel,
            totalBytes,
            propertiesUrl: propertiesUrlResolved,
            proprietorsUrl: proprietorsUrlResolved,
            usedFallback: manifest.usedFallback,
            fromCache: true,
        };
    }

    // 3. Load properties
    let properties = null;
    try {
        if (onDownloadStart) onDownloadStart();
        emitStatus('Downloading data (1/2)...<br>This may take a while, potentially a minute<br>or more if you\'re on mobile or have a slow connection.');
        const buffer = await loadBinary(propertiesUrlResolved, (loaded) => {
            reportProgress('properties', loaded);
        });
        emitStatus('Processing properties...');
        const data = decodeMsgpack(buffer);
        await scheduleAfterPaint();
        properties = expandSchema(data);
        if (onPropertiesLoaded) onPropertiesLoaded(properties);
    } catch (err) {
        const error = new Error('Error loading property data');
        error.stage = 'properties';
        error.original = err;
        throw error;
    }

    // 4. Load proprietors
    try {
        emitStatus('Downloading data (2/2)...');
        const pBuffer = await loadBinary(proprietorsUrlResolved, (loaded) => {
            reportProgress('proprietors', loaded);
        });
        emitStatus('Processing owners...');
        const pData = decodeMsgpack(pBuffer);
        const proprietorsById = expandProprietorsDictShortToLong(pData);
        saveDataToCache(properties, proprietorsById);
        resolveProprietorRefs(properties, proprietorsById);
        if (onProprietorsLoaded) onProprietorsLoaded(proprietorsById);

        emitStatus('Done');

        return {
            controlTypesMap,
            properties,
            proprietorsById,
            dataHash,
            datasetVersionLabel: manifest.datasetVersionLabel,
            totalBytes,
            propertiesUrl: propertiesUrlResolved,
            proprietorsUrl: proprietorsUrlResolved,
            usedFallback: manifest.usedFallback,
            fromCache: false,
        };
    } catch (err) {
        // Proprietors load failure: allow partial startup.
        if (onProprietorsError) onProprietorsError(err);
        return {
            controlTypesMap,
            properties,
            proprietorsById: null,
            dataHash,
            datasetVersionLabel: manifest.datasetVersionLabel,
            totalBytes,
            propertiesUrl: propertiesUrlResolved,
            proprietorsUrl: proprietorsUrlResolved,
            usedFallback: manifest.usedFallback,
            fromCache: false,
            error: err,
        };
    }
}

const DataService = {
    decodeKind,
    expandSchema,
    expandProprietorsDictShortToLong,
    resolveProprietorRefs,
    decodeMsgpack,
    loadBinary,
    fetchManifest,
    loadControlTypes,
    loadAll,
};
