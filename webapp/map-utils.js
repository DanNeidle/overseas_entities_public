/**
 * map-utils.js
 * Shared map-specific helpers.
 */

/**
 * Process a list of items in time-sliced chunks to avoid blocking the UI.
 * @param {Array} items List of items to process.
 * @param {Function} processItemFn Function invoked per item.
 * @param {Function} [onComplete] Called once all items are processed.
 * @param {Object} [options={}] Optional tuning parameters.
 * @param {number} [options.chunkSize=2000] Max items per chunk.
 * @param {number} [options.timeBudgetMs=15] Max ms per chunk.
 * @returns {void}
 */
function processInChunks(items, processItemFn, onComplete, options = {}) {
    if (!Array.isArray(items) || items.length === 0 || typeof processItemFn !== 'function') {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    const { chunkSize = 2000, timeBudgetMs = 15 } = options || {};
    let index = 0;
    const total = items.length;

    function nextChunk() {
        const start = performance.now();
        let processed = 0;

        while (
            index < total &&
            processed < chunkSize &&
            performance.now() - start < timeBudgetMs
        ) {
            processItemFn(items[index], index);
            index += 1;
            processed += 1;
        }

        if (index < total) {
            setTimeout(nextChunk, 0);
        } else if (typeof onComplete === 'function') {
            onComplete();
        }
    }

    nextChunk();
}



// Permalink helpers (non-conflicting with ?s= compressed share)
function hasCompressedShare() {
    return new URLSearchParams(window.location.search).has('s');
}

function updatePermalinkParam(key, value) {
    if (STATE.URL.SUPPRESS_UPDATES) return;
    if (hasCompressedShare()) return; // do not touch URLs derived from shared state
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (value === null || value === undefined || value === '') {
        params.delete(key);
    } else {
        params.set(key, value);
    }
    // Keep existing params untouched; just replace state
    history.replaceState(null, '', url.pathname + '?' + params.toString());
}

// Force-remove a URL param (used to clear ?s= shared state on explicit reset)
function removeUrlParam(key) {
    const url = new URL(window.location.href);
    url.searchParams.delete(key);
    const query = url.searchParams.toString();
    history.replaceState(null, '', url.pathname + (query ? ('?' + query) : ''));
}

// Remove all state-bearing params to return to a clean URL
function clearStateParams() {
    ['s','mode','layers','location','popup'].forEach(removeUrlParam);
}

function updateLocationParamFromMap() {
    if (STATE.URL.SUPPRESS_UPDATES) return;
    if (hasCompressedShare()) return;
    const c = map.getCenter();
    const z = map.getZoom();
    const loc = `${c.lat.toFixed(6)},${c.lng.toFixed(6)},${z}`;
    updatePermalinkParam('location', loc);
}