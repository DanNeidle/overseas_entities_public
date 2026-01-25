

/**
 * Apply legend defaults early when restoring from a ?location link.
 * @returns {void}
 */
function applyLegendDefaultsForLocationRestore() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('location')) return;
    // If a compressed state is present, do not override.
    if (params.has('s')) return;

    const layersParam = params.get('layers');
    const defaultsOn = layersParam
        ? new Set(layersParam.split(',').map(s => s.trim()).filter(Boolean))
        : new Set(['red', 'grey', 'purple']);
    document.querySelectorAll('.legend-item').forEach(item => {
        const category = item.getAttribute('data-category');
        const shouldBeActive = defaultsOn.has(category);
        item.setAttribute('data-active', shouldBeActive ? 'true' : 'false');
        item.classList.toggle('inactive', !shouldBeActive);
        item.querySelector('.legend-box')?.classList.toggle('inactive', !shouldBeActive);
        item.setAttribute('aria-checked', shouldBeActive ? 'true' : 'false');
    });
}

/**
 * Fetch data and kick off marker building (called once at page load).
 * @returns {void}
 */
function initializeDataLoad() {
    resetStartupTiming();
    resetMarkerBuildCompletion();
    // Ensure legend defaults are applied before any layers are shown.
    applyLegendDefaultsForLocationRestore();
    // Get references to the loading UI elements
    const progressBar = document.getElementById('progressBar');
    const loadingText = document.getElementById('loading-text');
    // Track cumulative download progress across both data files
    let bytesProps = 0;
    let bytesOwners = 0;
    let totalBytes = CONFIG.DATA.FILE_SIZE; // Combined size of both files (fallback)
    // (totalBytes may be updated by manifest fetch)
    const updateProgress = (label) => {
        const loaded = bytesProps + bytesOwners;
        const pct = Math.min(100, Math.round((loaded / totalBytes) * 100));
        if (progressBar) {
            progressBar.style.width = pct + '%';
            progressBar.textContent = pct + '%';
        }
        if (loadingText && label) loadingText.innerHTML = label;
    };

    const finalizeStartup = () => {
        // --- make sure we start in the correct mode ---
        // During initial startup, do not let this default overwrite URL params
        // (e.g., preserve ?mode=beneficial_owners on refresh)
        STATE.URL.SUPPRESS_UPDATES = true;
        const initialParams = new URLSearchParams(window.location.search);
        const hasAnyStateParam = initialParams.has('s') || initialParams.has('location') || initialParams.has('mode') || initialParams.has('layers') || initialParams.has('popup');
        const hasModeOrLayersParam = initialParams.has('s') || initialParams.has('mode') || initialParams.has('layers');

        if (!hasModeOrLayersParam) {
            // No explicit mode/layers → set initial mode so map isn't empty
            MapService.setMode('properties');
        }

        if (!hasAnyStateParam) {
            // No URL state at all → apply startup legend defaults
            MapService.hideLayerCategory('green', 'properties');
            MapService.hideLayerCategory('blue', 'properties');
            MapService.hideLayerCategory('orange', 'properties');

            document.querySelectorAll('.legend-item[data-category="green"], .legend-item[data-category="orange"], .legend-item[data-category="blue"]').forEach(item => {
                item.setAttribute("data-active", "false");
                item.classList.add("inactive");
                item.querySelector(".legend-box")?.classList.add("inactive");
            });
        }

        // Keep overlay until proprietors finish downloading
        // Restore infobox history from cookie (if any)
        loadInfoHistoryFromCookie();
        updateInfoBarButtons();

        STATE.TUTORIAL.DATA_READY = true;

        const params = new URLSearchParams(window.location.search);
        const locationParam = params.get('location');
        const hasCompressedState = params.has('s');
        console.log(
            `[startup] STATE.TUTORIAL.PENDING=${STATE.TUTORIAL.PENDING} STATE.TUTORIAL.DATA_READY=${STATE.TUTORIAL.DATA_READY} `
            + `hasLocation=${!!locationParam} hasCompressedState=${hasCompressedState}`
        );

        // 1. Check for the 'location' parameter first
        if (locationParam) {
            console.log('[startup] restoring view from ?location');
            setTimeout(() => {
                const parts = locationParam.split(',');
                if (parts.length === 3) {
                    const lat = parseFloat(parts[0]);
                    const lon = parseFloat(parts[1]);
                    const zoom = parseInt(parts[2], 10);

                    // Set the map view if the values are valid numbers
                    if (!isNaN(lat) && !isNaN(lon) && !isNaN(zoom)) {
                        map.setView([lat, lon], zoom);
                    }
                }

                // Also restore mode, layers, and popup if provided
                const modeParam = params.get('mode');
                if (modeParam && modeLayers[modeParam]) {
                    // update UI active class
                    document.querySelectorAll('.mode-toggle-btn.active')
                            .forEach(btn => btn.classList.remove('active'));
                    const btn = document.querySelector(`.mode-toggle-btn[data-value="${modeParam}"]`);
                    if (btn) btn.classList.add('active');
                    MapService.setMode(modeParam, true);
                }

                const layersParam = params.get('layers');
                const activeSet = layersParam
                    ? new Set(layersParam.split(',').map(s => s.trim()).filter(Boolean))
                    : new Set(['red', 'grey', 'purple']);
                // Toggle layers to match (default to red/grey/purple when absent)
                Object.keys(modeLayers[STATE.MODE.CURRENT]).forEach(cat => {
                    const layer = modeLayers[STATE.MODE.CURRENT][cat];
                    const shouldBeActive = activeSet.has(cat);
                    if (shouldBeActive) {
                        MapService.showLayerCategory(cat, STATE.MODE.CURRENT);
                    } else {
                        MapService.hideLayerCategory(cat, STATE.MODE.CURRENT);
                    }
                    const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
                    if (legendItem) {
                        legendItem.setAttribute('data-active', shouldBeActive ? 'true' : 'false');
                        legendItem.classList.toggle('inactive', !shouldBeActive);
                        legendItem.querySelector('.legend-box')?.classList.toggle('inactive', !shouldBeActive);
                    }
                });

                const popupParam = params.get('popup');
                if (popupParam) {
                    waitForPropertyMarkersReady().then(() => {
                        const m = findMarkerByTitleNumber(popupParam);
                        if (m) {
                            focusMarkerOnMap(m, { openPanel: true, zoom: map.getZoom() });
                        }
                    });
                }

                // Re-enable URL updates after applying initial URL state
                STATE.URL.SUPPRESS_UPDATES = false;
            }, 500);

        // 2. Fall back to the existing 's' parameter
        } else if (hasCompressedState) {
            console.log('[startup] ?s detected; waiting for property markers before restore');
            waitForPropertyMarkersReady().then(() => {
                console.log('[startup] restoring view from ?s');
                applyUrlParameters();
                // Sharing links should not be mutated, but resume URL updates for user actions
                STATE.URL.SUPPRESS_UPDATES = false;
                if (STATE.TUTORIAL.PENDING) {
                    console.log('[startup] tutorial pending after ?s restore; attempting start');
                    maybeStartTutorial();
                } else {
                    console.log('[startup] tutorial not pending after ?s restore; skipping');
                }
            });
        } else if (STATE.TUTORIAL.PENDING) {
            STATE.TUTORIAL.DATA_READY = true;
            console.log('[startup] no ?s; tutorial pending and data ready; attempting start');
            maybeStartTutorial();
            // Resume URL updates even if tutorial start is deferred
            STATE.URL.SUPPRESS_UPDATES = false;
        } else {
            // No URL state to apply; resume URL updates after defaults
            console.log('[startup] no ?s; tutorial not pending; skipping tutorial');
            STATE.URL.SUPPRESS_UPDATES = false;
        }

        $('#loading-overlay').fadeOut();
    };

    DataService.loadAll({
        controlTypesUrl: 'overseas_entities_map_control_types.json',
        manifestUrl: 'overseas_entities_data_info.txt',
        propertiesUrl: CONFIG.FILES.PROPERTIES_DEFAULT,
        proprietorsUrl: CONFIG.FILES.PROPRIETORS_DEFAULT,
        defaultTotalBytes: totalBytes,
        cacheKeys: CONFIG.CACHE,
        onControlTypes: (mapData) => {
            STATE.DATA.CONTROL_TYPES_MAP = mapData;
            loadMaterialSymbols(mapData);
        },
        onManifest: ({ totalBytes: manifestBytes, propertiesUrl, proprietorsUrl, datasetVersionLabel }) => {
            if (Number.isFinite(manifestBytes)) {
                totalBytes = manifestBytes;
            }
            if (propertiesUrl) STATE.DATA.PROPERTIES_URL = propertiesUrl;
            if (proprietorsUrl) STATE.DATA.PROPRIETORS_URL = proprietorsUrl;
            if (datasetVersionLabel) {
                STATE.DATA.DATASET_VERSION_LABEL = datasetVersionLabel;
                updateFooterVersion();
            }
        },
        onStatus: (label) => updateProgress(label),
        onProgress: ({ file, loadedBytes, totalBytes: manifestBytes }) => {
            if (file === 'properties') {
                bytesProps = loadedBytes || bytesProps;
            } else if (file === 'proprietors') {
                bytesOwners = loadedBytes || bytesOwners;
            }
            if (Number.isFinite(manifestBytes)) {
                totalBytes = manifestBytes;
            }
            updateProgress();
        },
        onDownloadStart: () => {
            if (STATE.STARTUP.TIMING && !STATE.STARTUP.TIMING.downloadStart) {
                STATE.STARTUP.TIMING.downloadStart = performance.now();
            }
        },
        onCacheHit: () => {
            if (STATE.STARTUP.TIMING && STATE.STARTUP.TIMING.downloadDurationMs == null) {
                STATE.STARTUP.TIMING.downloadStart = performance.now();
                STATE.STARTUP.TIMING.downloadEnd = STATE.STARTUP.TIMING.downloadStart;
                STATE.STARTUP.TIMING.downloadDurationMs = 0;
                console.log(`Download time (cache hit): ${formatDurationMs(0)}`);
            }
        },
        onPropertiesLoaded: (properties) => {
            STATE.DATA.PROPERTIES = properties;
            MapService.buildPropertyMarkers();
            prepareValuablePropertiesData();
        },
        onProprietorsLoaded: (proprietorsById) => {
            if (STATE.STARTUP.TIMING && STATE.STARTUP.TIMING.downloadDurationMs == null && STATE.STARTUP.TIMING.downloadStart != null) {
                STATE.STARTUP.TIMING.downloadEnd = performance.now();
                STATE.STARTUP.TIMING.downloadDurationMs = STATE.STARTUP.TIMING.downloadEnd - STATE.STARTUP.TIMING.downloadStart;
                console.log(`Download time: ${formatDurationMs(STATE.STARTUP.TIMING.downloadDurationMs)}`);
            }
            STATE.DATA.PROPRIETORS_BY_ID = proprietorsById;
            MapService.buildOwnerMarkers();
            // All done — set to 100% and fade out overlay
            bytesOwners = Math.max(0, totalBytes - bytesProps); // force 100% if sizes differ slightly
            updateProgress('Done');
            finalizeStartup();
        },
        onProprietorsError: () => {
            $('#loading-overlay').fadeOut();
        },
    }).catch((err) => {
        const showError = (titleHtml) => {
            $('#loading-overlay').html(
                '<div style="text-align:left">'
                + titleHtml
                + '<p>Please try refreshing. If that doesn\'t work, this may be a caching issue.</p>'
                + '<button id="clear-app-data-btn" class="btn btn-sm btn-outline-danger">Clear app data and reload</button>'
                + '</div>'
            );
            $('#clear-app-data-btn').on('click', function(){
                $('#loading-overlay').html('<p>Clearing cached app data…</p>');
                clearAppDataAndReload();
            });
        };

        if (err && err.stage === 'control-types') {
            showError('<p style="color:red; font-weight:bold;">Error loading essential configuration data.</p>');
        } else {
            showError('<p style="color:red; font-weight:bold;">Error loading property data.</p>');
        }
    });

    // Continue session: reopen last viewed property if possible and no popup/s link used
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('s') && !params.get('popup')) {
        const raw = getCookie('infoHistory');
        if (raw) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed?.list) ? parsed.list : [];
          const idx = typeof parsed?.index === 'number' ? parsed.index : (list.length - 1);
          const title = list[idx];
          if (title) {
            const m = findMarkerByTitleNumber(title);
            if (m) {
              const pt = map.latLngToContainerPoint(m.getLatLng());
              UIService.showPanel(m.propertyItem, m.myId, pt);
            }
          }
        }
      }
    } catch (e) { /* console.warn('Session restore failed', e); */ }
}

function maybeStartTutorial() {
    if (STATE.TUTORIAL.STARTED || !STATE.TUTORIAL.PENDING) return;
    if (!STATE.TUTORIAL.DATA_READY) return;

    if (!window.TutorialService || typeof window.TutorialService.start !== 'function') {
        if (!STATE.TUTORIAL.START_RETRY_TIMER) {
            STATE.TUTORIAL.START_RETRY_TIMER = setTimeout(() => {
                STATE.TUTORIAL.START_RETRY_TIMER = null;
                maybeStartTutorial();
            }, 250);
        }
        return;
    }

    STATE.TUTORIAL.STARTED = true;
    try {
        window.TutorialService.start();
        setCookie(CONFIG.STORAGE.TUTORIAL_COOKIE_KEY, 'true', 365);
        STATE.TUTORIAL.PENDING = false;
    } catch (err) {
        STATE.TUTORIAL.STARTED = false;
        if (!STATE.TUTORIAL.START_RETRY_TIMER) {
            STATE.TUTORIAL.START_RETRY_TIMER = setTimeout(() => {
                STATE.TUTORIAL.START_RETRY_TIMER = null;
                maybeStartTutorial();
            }, 750);
        }
    }
}


function resetStartupTiming() {
    STATE.STARTUP.TIMING = {
        appStart: performance.now(),
        downloadStart: null,
        downloadEnd: null,
        downloadDurationMs: null,
        propertyBuildStart: null,
        propertyBuildEnd: null,
        propertyBuildDurationMs: null,
        ownerBuildStart: null,
        ownerBuildEnd: null,
        ownerBuildDurationMs: null,
        totalLogged: false,
    };
}



function resetMarkerBuildCompletion() {
    STATE.STARTUP.PROPERTY_READY_PROMISE = new Promise(resolve => {
        STATE.STARTUP.PROPERTY_READY_RESOLVE = resolve;
    });
    STATE.STARTUP.OWNER_READY_PROMISE = new Promise(resolve => {
        STATE.STARTUP.OWNER_READY_RESOLVE = resolve;
    });
}

function ensurePropertyMarkersPromise() {
    if (!STATE.STARTUP.PROPERTY_READY_PROMISE) {
        STATE.STARTUP.PROPERTY_READY_PROMISE = new Promise(resolve => {
            STATE.STARTUP.PROPERTY_READY_RESOLVE = resolve;
        });
    }
}

function ensureOwnerMarkersPromise() {
    if (!STATE.STARTUP.OWNER_READY_PROMISE) {
        STATE.STARTUP.OWNER_READY_PROMISE = new Promise(resolve => {
            STATE.STARTUP.OWNER_READY_RESOLVE = resolve;
        });
    }
}

function waitForPropertyMarkersReady() {
    return STATE.STARTUP.PROPERTY_READY_PROMISE || Promise.resolve();
}

function waitForOwnerMarkersReady() {
    return STATE.STARTUP.OWNER_READY_PROMISE || Promise.resolve();
}




/**
 * Collects all used Material Symbols, builds the optimized font URL, 
 * and injects it into the document's <head>.
 * @param {object} controlTypes - The map data from your control types JSON file.
 */
function loadMaterialSymbols(controlTypes) {
    // 1. Define icons that are hardcoded in your HTML/JS
    const staticIcons = CONFIG.ICONS.MATERIAL_SYMBOLS_STATIC || [];

    // 2. Extract icon names from your dynamic JSON data (ignore helper keys like _ids)
    const dynamicIcons = Object.values(controlTypes)
        .map(type => type && type.icon)
        .filter(icon => typeof icon === 'string' && icon.length > 0);

    // 3. Combine, de-duplicate, and sort the icon names
    const allIcons = [...new Set([...staticIcons, ...dynamicIcons])];
    allIcons.sort(); // The Google Fonts API requires the list to be alphabetical

    // 4. Build the final URL
    const iconNamesStr = allIcons.join(',');
    const fontUrl = `${CONFIG.URLS.MATERIAL_SYMBOLS_BASE}&icon_names=${iconNamesStr}&display=block`;

    // 5. Create and inject the new <link> tag
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontUrl;
    document.head.appendChild(link);

    // console.log(`Loaded ${allIcons.length} Material Symbols.`);
}

/**
 * now the big set of functions enabling the person search icon
 * 
 * 
 */


// Map "proprietor"/"beneficiary" to your internal modes
function roleToMode(role) {
  return (role === 'beneficiary') ? 'beneficial_owners' : 'proprietors';
}






/**
 * Filters, sorts, and caches the top 10,000 most valuable properties.
 */
function prepareValuablePropertiesData() {
    const valuable = STATE.DATA.PROPERTIES.filter(p => p.price_paid);
    valuable.sort((a, b) => b.price_paid - a.price_paid);
    const capped = valuable.slice(0, CONFIG.UI.TOP_VALUABLE_PROPERTIES_LIMIT);
    const sanctioned = valuable.filter(p => getMarkerColor(p.status) === 'purple');
    const combined = new Map();
    capped.forEach(p => combined.set(p.property_title_number, p));
    sanctioned.forEach(p => combined.set(p.property_title_number, p));
    STATE.DATA.TOP_VALUABLE_PROPERTIES = Array.from(combined.values());
}


/**
 * Apply URL parameters to initial map state and queued actions.
 * @returns {void}
 */
function applyUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("s");
    if (!s) return;

    let state;
    try {
        const json = LZString.decompressFromEncodedURIComponent(s);
        state = JSON.parse(json);
    } catch (e) {
        // console.error("Failed to decompress/parse saved state:", e);
        return;
    }
    console.log('[startup] ?s parsed; applying saved state');

    // 1. Switch mode but do NOT let it reset the view
    if (state.mode && modeLayers[state.mode]) {
        document.querySelectorAll('.mode-toggle-btn.active')
                .forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.mode-toggle-btn[data-value="${state.mode}"]`);
        if (btn) btn.classList.add('active');
        MapService.setMode(state.mode, true);
    }

    // 2. Restore each layer’s visibility and keep the legend UI in sync
    if (state.layers) {
        Object.entries(state.layers).forEach(([cat, visible]) => {
            const layerGroup = modeLayers[state.mode]?.[cat];
            if (layerGroup) {
                visible ? MapService.showLayerCategory(cat, state.mode) : MapService.hideLayerCategory(cat, state.mode);
            }
            const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
            if (legendItem) {
                legendItem.setAttribute("data-active", visible ? "true" : "false");
                legendItem.classList.toggle("inactive", !visible);
                legendItem.querySelector(".legend-box")
                          ?.classList.toggle("inactive", !visible);
            }
        });
    }

    // 3. Redraw any links that were saved
    if (state.links && state.links.length > 0) {
        enterFocusMode(); // Activate focus mode UI
        state.links.forEach(titleNumber => {
            // Find the marker by its persistent title number
            const m = findMarkerByTitleNumber(titleNumber);
            if (m?.propertyItem) {
                drawLinksForProperty(m.propertyItem, m);
            }
        });
        // The `links` array in the state already contains the title numbers
        STATE.LINKED_ITEM_IDS = state.links.slice();
    }

    // 4. Set the saved map view and then open the popup.
    // We use nested setTimeouts to create a reliable sequence.
    if (state.lat != null && state.lng != null && state.zoom != null) {
        // console.log("Scheduling view restore →", state.lat, state.lng, state.zoom);
        
        // First, wait 300ms for layers to settle before moving the map.
        setTimeout(() => {
            // console.log("Executing view restore now.");
            console.log('[startup] restoring map position', {
                lat: state.lat,
                lng: state.lng,
                zoom: state.zoom,
                popup: state.popup
            });
            map.invalidateSize();
            map.setView([+state.lat, +state.lng], +state.zoom, { animate: true });

            // If a popup needs to be opened, wait another 200ms after the map starts moving.
            if (state.popup != null) {
                setTimeout(() => {
                    // Find the marker by its persistent title number from the URL
                    const m = findMarkerByTitleNumber(state.popup);
                    if (m) {
                        console.log('[startup] opening info panel from ?s', state.popup);
                        // console.log("Opening info box for property title:", state.popup);
                        const pt = map.latLngToContainerPoint(m.getLatLng());
                        // We still pass m.myId here, which is the temporary ID used
                        // by the info panel logic to manage the active marker.
                        UIService.showPanel(m.propertyItem, m.myId, pt);
                    } else {
                        console.log('[startup] info panel marker not found for ?s', state.popup);
                    }
                }, 200); // Wait for map animation to be underway
            }

        }, 300); // Wait for 300ms before setting the view
    }
}




// Clear app-controlled storage and attempt a hard reload
async function clearAppDataAndReload() {
    console.warn("CRITICAL: Nuking all app data and reloading...");

    // 1. Clear IndexedDB (where the large data lives)
    try {
        if (window.localforage && typeof localforage.clear === 'function') {
            await localforage.clear();
        }
    } catch (e) {
        console.error("Failed to clear IndexedDB", e);
    }

    // 2. Clear CacheStorage (Service Worker caches)
    try {
        if (window.caches) {
            const keys = await window.caches.keys();
            await Promise.all(keys.map(key => window.caches.delete(key)));
        }
    } catch (e) {
        console.error("Failed to clear Caches", e);
    }

    // 3. Clear LocalStorage/SessionStorage (User settings, history)
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (e) {
        console.error("Failed to clear LocalStorage", e);
    }

    // 4. Unregister Service Workers (The brain of the PWA)
    try {
        if (navigator.serviceWorker) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(r => r.unregister()));
        }
    } catch (e) {
        console.error("Failed to unregister SW", e);
    }

    // 5. Force Reload from Server (Bypass browser cache)
    window.location.reload(true);
}

function resetToStartupDefaults() {
    // Suppress URL updates while resetting, and start from a clean URL
    STATE.URL.SUPPRESS_UPDATES = true;
    clearStateParams();

    // Always perform a full clear (removes links and exits focus mode)
    clearLinksAndFocus();

    setPropertyTypeSelection(CONFIG.PROPERTY_TYPES.DEFAULT);

    // As a safety net, ensure the floating clear button is hidden
    const floating = document.getElementById('floatingClearButton');
    if (floating) floating.style.display = 'none';
    if (typeof syncGoToLocationVisibility === 'function') {
        syncGoToLocationVisibility();
    }

    // Switch to properties without changing view yet
    document.querySelectorAll('.mode-toggle-btn.active')
            .forEach(b => b.classList.remove('active'));
    const propBtn = document.querySelector('.mode-toggle-btn[data-value="properties"]');
    if (propBtn) propBtn.classList.add('active');
    MapService.setMode('properties');

    // Set legend defaults: disable green, blue, orange; enable red, grey, purple
    const defaultsOff = new Set(['green','blue','orange']);
    const allCats = ['green','orange','red','grey','blue','purple'];
    allCats.forEach(cat => {
        const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
        const layer = modeLayers[STATE.MODE.CURRENT]?.[cat];
        const shouldBeOn = !defaultsOff.has(cat);
        if (legendItem) {
            legendItem.setAttribute('data-active', shouldBeOn ? 'true' : 'false');
            legendItem.classList.toggle('inactive', !shouldBeOn);
            legendItem.querySelector('.legend-box')?.classList.toggle('inactive', !shouldBeOn);
        }
        if (layer) {
            if (shouldBeOn) {
                MapService.showLayerCategory(cat, STATE.MODE.CURRENT);
            } else {
                MapService.hideLayerCategory(cat, STATE.MODE.CURRENT);
            }
        }
    });

    // Reset view for properties
    map.setView(CONFIG.MAP.DEFAULT_CENTER, getPropertyDefaultZoom());

    // Clear focus mode & info panel
    UIService.hidePanel();

    // Re-enable URL updates after the map settles, and ensure the URL is clean
    map.once('moveend', () => {
        clearStateParams();
        STATE.URL.SUPPRESS_UPDATES = false;
    });
}
