
// Helper: tuned fly duration so search-driven moves feel deliberate without dragging
function getFlyDuration() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const durations = CONFIG.MAP.FLY_DURATION;
  if (reduce) return durations.REDUCED_MOTION;
  return isMobile() ? durations.MOBILE : durations.DESKTOP;
}


// Infer a sensible maximum zoom level for a Nominatim place result.
function getSuggestedMaxZoomForPlace(place) {
    const placeZoom = CONFIG.ZOOM_LEVELS.PLACE_RESULT;
    const FALLBACK_ZOOM = placeZoom.FALLBACK;
    const ABSOLUTE_MIN_ZOOM = placeZoom.ABSOLUTE_MIN;
    const ABSOLUTE_MAX_ZOOM = placeZoom.ABSOLUTE_MAX;

    if (!place || typeof place !== 'object') {
        return FALLBACK_ZOOM;
    }

    const bboxZoom = (() => {
        if (!Array.isArray(place.boundingbox) || place.boundingbox.length !== 4) return null;
        const coords = place.boundingbox.map(value => parseFloat(value));
        if (coords.some(value => Number.isNaN(value))) return null;
        const south = coords[0];
        const north = coords[1];
        const west = coords[2];
        const east = coords[3];
        const latDiff = Math.abs(north - south);
        let lonDiff = Math.abs(east - west);
        if (lonDiff > 180) {
            lonDiff = 360 - lonDiff;
        }
        const span = Math.max(latDiff, lonDiff);
        if (!span) return null;
        const zoom = Math.floor(Math.log2(360 / span));
        if (!Number.isFinite(zoom)) return null;
        return zoom;
    })();

    const rawType = (typeof place.type === 'string' && place.type) || (typeof place.addresstype === 'string' && place.addresstype) || '';
    const type = rawType.toLowerCase();
    const rawClass = (typeof place.class === 'string' && place.class) || (typeof place.category === 'string' && place.category) || '';
    const className = rawClass.toLowerCase();

    const TYPE_CAPS = CONFIG.ZOOM_LEVELS.TYPE_CAPS;
    const CLASS_CAPS = CONFIG.ZOOM_LEVELS.CLASS_CAPS;

    let cap = null;
    if (type && Object.prototype.hasOwnProperty.call(TYPE_CAPS, type)) {
        cap = TYPE_CAPS[type];
    } else if (className && Object.prototype.hasOwnProperty.call(CLASS_CAPS, className)) {
        cap = CLASS_CAPS[className];
    }

    const rankZoom = (() => {
        const rank = place.place_rank;
        if (typeof rank !== 'number' || Number.isNaN(rank)) return null;
        const thresholds = [
            [28, 17],
            [26, 16],
            [24, 14],
            [22, 13],
            [20, 12],
            [18, 11],
            [16, 10],
            [14, 9],
            [12, 8],
            [10, 7],
            [8, 6],
            [6, 5],
        ];
        for (const [minRank, zoom] of thresholds) {
            if (rank >= minRank) return zoom;
        }
        return 4;
    })();

    let zoom = bboxZoom;
    if (zoom === null) {
        zoom = rankZoom;
    }
    if (zoom === null) {
        zoom = FALLBACK_ZOOM;
    }

    if (cap !== null) {
        zoom = Math.min(zoom, cap);
    }

    if (typeof zoom !== 'number' || Number.isNaN(zoom)) {
        zoom = FALLBACK_ZOOM;
    }

    if (zoom < ABSOLUTE_MIN_ZOOM) zoom = ABSOLUTE_MIN_ZOOM;
    if (zoom > ABSOLUTE_MAX_ZOOM) zoom = ABSOLUTE_MAX_ZOOM;
    return zoom;
}

function focusMapOnPlaceResult(place) {
    if (!place || typeof place !== 'object') return;

    let minZoom = CONFIG.ZOOM_LEVELS.PLACE_RESULT.ABSOLUTE_MIN;
    let maxZoom = CONFIG.ZOOM_LEVELS.PLACE_RESULT.ABSOLUTE_MAX;
    if (typeof map !== 'undefined') {
        if (typeof map.getMinZoom === 'function') {
            const mz = map.getMinZoom();
            if (typeof mz === 'number' && !Number.isNaN(mz)) {
                minZoom = mz;
            }
        }
        if (typeof map.getMaxZoom === 'function') {
            const mz = map.getMaxZoom();
            if (typeof mz === 'number' && !Number.isNaN(mz)) {
                maxZoom = mz;
            }
        }
    }

    const suggested = getSuggestedMaxZoomForPlace(place);
    const safeZoom = Math.max(minZoom, Math.min(suggested, maxZoom));
    const duration = getFlyDuration();

    const hasBounds = Array.isArray(place.boundingbox) && place.boundingbox.length === 4;
    if (hasBounds) {
        const coords = place.boundingbox.map(value => parseFloat(value));
        if (!coords.some(value => Number.isNaN(value))) {
            const south = coords[0];
            const north = coords[1];
            const west = coords[2];
            const east = coords[3];
            const bounds = L.latLngBounds(
                [Math.min(south, north), Math.min(west, east)],
                [Math.max(south, north), Math.max(west, east)]
            );
            map.flyToBounds(bounds, { maxZoom: safeZoom, duration, padding: [24, 24] });
            return;
        }
    }

    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        map.flyTo([lat, lon], safeZoom, { duration });
    }
}



// Fire the existing search flow programmatically
/**
 * Use the app's search to find all properties where this person (proprietor/beneficiary)
 * appears. If mode differs, switch first and wait ~0.5s to allow UI to settle.
 */
function personSearch(name, role) {
  const desiredMode = roleToMode(role);
  const go = () => {
    triggerSearch(name);
    // On mobile, open the hamburger so results are visible immediately
    if (isMobile()) {
      const offcanvasEl = document.getElementById('mobileControlsOffcanvas');
      if (offcanvasEl && window.bootstrap && bootstrap.Offcanvas) {
        const inst = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
        inst.show();
      }
    }
  };


  if (STATE.MODE.CURRENT !== desiredMode) {
    // First, find and deactivate the currently active button
    const currentActiveBtn = document.querySelector('.mode-toggle-btn.active');
    if (currentActiveBtn) {
      currentActiveBtn.classList.remove('active');
    }

    // Next, find and activate the new mode's button
    const newActiveBtn = document.querySelector(`.mode-toggle-btn[data-value="${desiredMode}"]`);
    if (newActiveBtn) {
      newActiveBtn.classList.add('active');
    }

    MapService.setMode(desiredMode);
    setTimeout(go, 500); // give clusters/layers a moment to attach
  } else {
    go();
  }
}




/**
 * Handles the click event for a property title number link.
 * Copies the title number to the clipboard and opens the Land Registry search page.
 * @param {Event} event - The click event.
 * @param {string} titleNumber - The property title number to be copied.
 */
function searchLandRegistry(event, titleNumber) {
    // Stop the event from bubbling up and potentially closing the info panel
    if (event) {
        event.stopPropagation();
    }

    // Copy the title number to the clipboard
    navigator.clipboard.writeText(titleNumber).then(() => {
        // Create a small, temporary notification to confirm the copy was successful
        const notification = document.createElement("div");
        notification.innerText = `Title "${titleNumber}" copied to clipboard!`;
        Object.assign(notification.style, {
            position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
            background: 'lightgreen', padding: '10px', borderRadius: '5px',
            zIndex: 9999, border: '1px solid black', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
        });
        document.body.appendChild(notification);
        setTimeout(() => { document.body.removeChild(notification); }, 2500); // Message disappears after 2.5 seconds

    }).catch(() => {
        // console.error('Failed to copy title to clipboard: ', err);
    });

    // Open the Land Registry search page in a new tab
    const landRegistryUrl = CONFIG.URLS.LAND_REGISTRY_SEARCH;
    window.open(landRegistryUrl, '_blank');
}



// Search & inputs
function triggerSearch(query) {
    const input = document.getElementById('searchInput');
    if (!input) return;

    // Focus will auto-exit focus mode via your existing listener
    input.focus();

    // Set the query and synthesize the keyup (your search is bound to keyup+debounce)
    input.value = query;

    // Fire a keyup event so the debounced handler runs
    const ev = new KeyboardEvent('keyup', { bubbles: true });
    input.dispatchEvent(ev);
}

// Panel visibility & interactions
function updateInfoBarButtons() {
    const backBtn = document.getElementById('info-back');
    const fwdBtn = document.getElementById('info-forward');
    if (!backBtn || !fwdBtn) return;
    const hasHistory = infoHistory.length > 0 && infoHistoryIndex >= 0;
    backBtn.disabled = !(hasHistory && infoHistoryIndex > 0);
    fwdBtn.disabled = !(hasHistory && infoHistoryIndex < infoHistory.length - 1);
}