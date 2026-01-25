/**
 * utils.js
 * Shared helper functions for Overseas Entities Map.
 */

/**
 * Truncates a string to a specified length and adds an ellipsis.
 * If the original string is shorter than the limit, it returns the string unchanged.
 *
 * @param {string} str - The input string to truncate.
 * @param {number} limit - The maximum length of the truncated string.
 * @returns {string} The truncated string.
 */
function truncate(str, limit) {
    if (!str) {
        return "";
    }
    if (str.length <= limit) {
        return str;
    }
    return str.substring(0, limit) + "...";
}

// Convert a comma-separated string to title case (useful for addresses)
function toTitleCase(str) {
    if (!str) return "";
    return str.split(',')
        .map(part => part.trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' '))
        .join(', ');
}

/**
 * Capitalizes the first letter of a string.
 * @param {string} str The input string.
 * @returns {string} The string with its first letter capitalized.
 */
function capitalizeFirstLetter(str) {
    if (!str) {
        return "";
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value) {
    return escapeHtml(value);
}

function escapeJsString(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// Format large numbers with commas
function formatNumber(num) {
    if (num === null || num === undefined || num === "") return "";
    const numStr = String(num);
    return numStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatPriceShort(num) {
    if (num === null || num === undefined || num === "") return "";
    const value = Number(num);
    if (!Number.isFinite(value)) return "";
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
        const millions = value / 1000000;
        const decimals = absValue < 10000000 ? 1 : 0;
        const rounded = millions.toFixed(decimals).replace(/\.0$/, "");
        const withCommas = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return `${withCommas}m`;
    }
    return formatNumber(value);
}

// Helper function to delay execution
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

// Basic cookie helpers
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
}

/**
 * Copy inner text of an element to clipboard when clicked.
 * @param {MouseEvent} event Click event from a copyable element.
 * @param {HTMLElement} element Click target element.
 * @returns {void}
 */
function copyTextOnClick(event, element) {
    if (event) {
        event.stopPropagation();
    }
    const target = element || (event && event.currentTarget);
    if (!target) return;
    const textToCopy = (target.getAttribute('data-copy-text') || target.innerText).trim();

    if (!textToCopy) return;

    // 1. Check if the clipboard API is available at all
    if (!navigator.clipboard) {
        alert("Clipboard functionality is not available in your browser.\n(This feature requires a secure HTTPS connection).");
        return;
    }

    // 2. Try to write the text and handle success or failure
    navigator.clipboard.writeText(textToCopy).then(() => {
        // --- Success Notification (Your original code) ---
        const notification = document.createElement("div");
        notification.innerText = `Copied to clipboard!`;
        Object.assign(notification.style, {
            position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
            background: 'lightgreen', padding: '10px', borderRadius: '5px',
            zIndex: 9999, border: '1px solid black', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
        });
        document.body.appendChild(notification);
        setTimeout(() => { document.body.removeChild(notification); }, 2000);

    }).catch(() => {
        // --- Failure Notification ---
        alert('Could not copy text.\n\nThis can happen on non-secure (HTTP) pages or if you deny clipboard permissions.');
    });
}

/**
 * Copies a given latitude and longitude to the clipboard and shows a notification.
 * @param {number} lat - The latitude to copy.
 * @param {number} lon - The longitude to copy.
 */
function copyCoordsToClipboard(lat, lon) {
    const textToCopy = `${lat}, ${lon}`;

    if (!navigator.clipboard) {
        alert("Clipboard functionality is not available in your browser.");
        return;
    }

    navigator.clipboard.writeText(textToCopy).then(() => {
        // On success, show a confirmation message
        const notification = document.createElement("div");
        notification.innerText = `Coordinates copied to clipboard!`;
        Object.assign(notification.style, {
            position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
            background: 'lightgreen', padding: '10px', borderRadius: '5px',
            zIndex: 9999, border: '1px solid black', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
        });
        document.body.appendChild(notification);
        setTimeout(() => { document.body.removeChild(notification); }, 2500);
    }).catch(() => {
        alert('Could not copy coordinates.');
    });
}

function triggerHapticFeedback(el) {
    if (!el) return;
    el.classList.remove('haptic-bump');
    void el.offsetWidth; // restart the animation if it was already running
    el.classList.add('haptic-bump');
    el.addEventListener('animationend', () => {
        el.classList.remove('haptic-bump');
    }, { once: true });
}

// change the icon onclick to pass the element (see section 3 as well):
// onclick="showMobileTooltip(this, '...');"

// Allow \n and <br>, escape everything else
function safeTooltipHTML(s) {
    if (!s) return '';
    const escaped = String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return escaped.replace(/\n/g, '<br>').replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

function showMobileTooltip(el, rawHtml) {
    if (!isMobile()) return;
    const html = safeTooltipHTML(rawHtml);
    DOM.INFO_TOOLTIP.innerHTML = html;
    DOM.INFO_TOOLTIP.style.display = 'block';
    DOM.INFO_TOOLTIP.style.opacity = 1;

    const rect = el.getBoundingClientRect();

    // position above the element, centered
    const topPos = Math.max(8, rect.top - DOM.INFO_TOOLTIP.offsetHeight - 8);
    const leftPos = Math.min(
        window.innerWidth - DOM.INFO_TOOLTIP.offsetWidth - 8,
        Math.max(8, rect.left + rect.width / 2 - DOM.INFO_TOOLTIP.offsetWidth / 2)
    );

    DOM.INFO_TOOLTIP.style.top = `${topPos}px`;
    DOM.INFO_TOOLTIP.style.left = `${leftPos}px`;

    // hide after a short delay or on next tap
    clearTimeout(showMobileTooltip._t);
    showMobileTooltip._t = setTimeout(() => {
        DOM.INFO_TOOLTIP.style.opacity = 0;
        setTimeout(() => (DOM.INFO_TOOLTIP.style.display = 'none'), 200);
    }, 2500);
}

/**
 * Make an element draggable by mouse/touch, optionally using a handle selector.
 * @param {HTMLElement|string} elementOrId Element or its ID.
 * @param {string|null} [handleSelector=null] Optional selector for a handle inside the element.
 * @param {Object} [options={}] Optional behavior overrides.
 * @param {boolean} [options.suppressClick=false] Suppress the next click after a drag.
 * @param {number} [options.longPressMs=0] Enable long-press drag on touch (ms).
 * @param {number} [options.longPressMoveTolerance=6] Max move in px before cancelling long-press.
 * @returns {void}
 */
function makeElementDraggable(elementOrId, handleSelector = null, options = {}) {
    const element = typeof elementOrId === 'string'
        ? document.getElementById(elementOrId)
        : elementOrId;
    if (!element) return;

    const handle = handleSelector ? element.querySelector(handleSelector) : element;
    if (!handle) return;

    handle.style.cursor = 'grab';

    const {
        suppressClick = false,
        longPressMs = 0,
        longPressMoveTolerance = 6
    } = options;
    let isDragging = false;
    let didDrag = false;
    let suppressClickUntil = 0;
    let offsetX, offsetY;
    let fixedCBRect = { left: 0, top: 0 }; // containing-block rect for fixed elements
    let longPressTimer = null;
    let longPressStart = null;

    // Find the nearest ancestor that will act as the containing block for position:fixed
    function getFixedContainingBlockRect(el) {
        let node = el.parentElement;
        while (node && node !== document.body) {
            const cs = getComputedStyle(node);
            if (
                (cs.transform && cs.transform !== 'none') ||
                (cs.perspective && cs.perspective !== 'none') ||
                (cs.filter && cs.filter !== 'none') ||
                cs.contain === 'paint'
            ) {
                return node.getBoundingClientRect();
            }
            node = node.parentElement;
        }
        return { left: 0, top: 0 };
    }

    function isIgnoredTarget(target) {
        if (!target) return false;
        const ignored = ['A', 'BUTTON', 'INPUT', 'I', 'TEXTAREA', 'SELECT', 'LABEL'];
        if (ignored.includes(target.tagName)) return true;
        return !!target.closest('a,button,input,textarea,select,label');
    }

    function dragStart(e) {
        if (isIgnoredTarget(e.target)) return;

        isDragging = true;
        didDrag = false;
        element.classList.add('is-dragging');
        handle.style.cursor = 'grabbing';
        element.style.zIndex = 4001;
        if (window.TutorialService?.removeCustomHighlight) {
            window.TutorialService.removeCustomHighlight();
        }

        const clientX = e.clientX ?? e.touches?.[0].clientX;
        const clientY = e.clientY ?? e.touches?.[0].clientY;

        const rect = element.getBoundingClientRect();
        fixedCBRect = getFixedContainingBlockRect(element);

        // Switch to fixed; position relative to the transformed ancestor, not the viewport
        element.style.position = 'fixed';
        element.style.transform = 'none';
        element.style.left = `${rect.left - fixedCBRect.left}px`;
        element.style.top = `${rect.top - fixedCBRect.top}px`;

        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;

        document.addEventListener('mousemove', dragMove);
        document.addEventListener('mouseup', dragEnd, { once: true });
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('touchend', dragEnd, { once: true });
    }

    function dragMove(e) {
        if (!isDragging) return;
        if (e.type === 'touchmove') e.preventDefault();
        didDrag = true;

        const clientX = e.clientX ?? e.touches?.[0].clientX;
        const clientY = e.clientY ?? e.touches?.[0].clientY;

        element.style.left = `${clientX - fixedCBRect.left - offsetX}px`;
        element.style.top = `${clientY - fixedCBRect.top - offsetY}px`;
    }

    function dragEnd() {
        isDragging = false;
        element.classList.remove('is-dragging');
        handle.style.cursor = 'grab';
        element.style.zIndex = '';
        if (suppressClick && didDrag) {
            suppressClickUntil = Date.now() + 450;
        }
        const highlightTarget = window.TutorialService?.getCurrentHighlightTarget?.();
        if (didDrag && highlightTarget && window.TutorialService?.addCustomHighlight) {
            requestAnimationFrame(() => {
                window.TutorialService.addCustomHighlight(highlightTarget);
            });
        }
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('touchmove', dragMove);
    }

    function maybeSuppressClick(e) {
        if (!suppressClick || Date.now() > suppressClickUntil) return;
        suppressClickUntil = 0;
        e.preventDefault();
        e.stopPropagation();
    }

    if (suppressClick) {
        handle.addEventListener('click', maybeSuppressClick, true);
    }

    function clearLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        longPressStart = null;
        document.removeEventListener('touchmove', onLongPressMove);
        document.removeEventListener('touchend', clearLongPress);
        document.removeEventListener('touchcancel', clearLongPress);
    }

    function onLongPressMove(e) {
        if (!longPressTimer || !longPressStart) return;
        const clientX = e.touches?.[0]?.clientX;
        const clientY = e.touches?.[0]?.clientY;
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
        const dx = Math.abs(clientX - longPressStart.x);
        const dy = Math.abs(clientY - longPressStart.y);
        if (dx > longPressMoveTolerance || dy > longPressMoveTolerance) {
            clearLongPress();
        }
    }

    function onLongPressStart(e) {
        if (!longPressMs) return;
        if (!e.touches || e.touches.length !== 1) return;
        if (handleSelector && e.target.closest(handleSelector)) return;
        if (isIgnoredTarget(e.target)) return;

        clearLongPress();
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        longPressStart = { x: clientX, y: clientY };

        longPressTimer = setTimeout(() => {
            clearLongPress();
            dragStart(e);
        }, longPressMs);

        document.addEventListener('touchmove', onLongPressMove, { passive: true });
        document.addEventListener('touchend', clearLongPress, { once: true });
        document.addEventListener('touchcancel', clearLongPress, { once: true });
    }

    handle.addEventListener('mousedown', dragStart);
    handle.addEventListener('touchstart', dragStart, { passive: true });
    if (longPressMs) {
        element.addEventListener('touchstart', onLongPressStart, { passive: true });
    }
}


/**
 * Finds the primary "property" marker for a given property title number.
 * This is needed to restore state without a pre-built lookup table.
 * @param {string} titleNumber - The property title number to search for.
 * @returns {L.Marker|null} The found marker, or null.
 */
/**
 * Look up a property marker by its Land Registry title number.
 * @param {string} titleNumber The property title number to find.
 * @returns {L.Marker|null} The marker if found, otherwise null.
 */
function findMarkerByTitleNumber(titleNumber) {
    if (!titleNumber) return null;
    // Search only within the 'properties' mode layers, as this is where the
    // primary markers corresponding to properties are stored.
    for (const cat in modeLayers.properties) {
        const markers = modeLayers.properties[cat].getLayers();
        const found = markers.find(m => m.propertyItem?.property_title_number === titleNumber);
        if (found) {
            return found;
        }
    }
    return null; // Return null if no marker is found across all categories.
}

/**
 * Ensure a marker is visible (unclustered) before running follow-up actions.
 * @param {L.Marker} marker The marker to reveal.
 * @param {Object} [options] Optional behavior flags.
 * @param {number} [options.zoom] Fallback zoom if cluster helpers are unavailable.
 * @param {boolean} [options.openPanel=false] Whether to open the info panel.
 * @param {boolean} [options.fromHistory=false] Whether the panel open is a history action.
 * @param {Function} [options.onVisible] Callback once the marker is visible.
 * @returns {boolean} True if a marker was handled.
 */
function focusMarkerOnMap(marker, options = {}) {
    if (!marker) return false;
    const { zoom, openPanel = false, fromHistory = false, onVisible } = options;

    ensureMarkerLayerIsVisible(marker);

    const layerGroup = modeLayers?.[STATE.MODE.CURRENT]?.[marker.category];
    const targetLatLng = marker.getLatLng();

    const finish = () => {
        if (openPanel && typeof UIService !== 'undefined' && typeof UIService.showPanel === 'function') {
            const point = map.latLngToContainerPoint(targetLatLng);
            UIService.showPanel(marker.propertyItem, marker.myId, point, fromHistory);
        }
        if (typeof onVisible === 'function') onVisible(marker);
    };

    if (layerGroup && typeof layerGroup.zoomToShowLayer === 'function' && layerGroup.hasLayer(marker)) {
        layerGroup.zoomToShowLayer(marker, finish);
        return true;
    }

    if (Number.isFinite(zoom)) {
        map.flyTo(targetLatLng, zoom, { duration: getFlyDuration() });
        map.once('moveend', finish);
    } else {
        map.panTo(targetLatLng);
        map.once('moveend', finish);
    }
    return true;
}

// Map "proprietor"/"beneficiary" to your internal modes
function roleToMode(role) {
  return (role === 'beneficiary') ? 'beneficial_owners' : 'proprietors';
}
/**
 * Normalizes status strings and maps them to a color category used by clusters/legend.
 */
function getMarkerColor(status) {
    // Normalise status strings and map them to a colour category used by
    // clusters/legend. We trim to avoid issues with stray whitespace.
    const norm = (status || '').toString().trim().toLowerCase();
    return ['red', 'orange', 'grey', 'blue', 'purple', 'green'].includes(norm)
        ? norm
        : 'green';
}

/**
 * Look up a marker by its internal runtime ID.
 * @param {number} id Marker ID.
 * @returns {L.Marker|null}
 */
function findMarkerById(id) {
    return allMarkersById[id] || null;
}


const getPropertyDefaultZoom = () => (
    isMobile() ? CONFIG.MAP.DEFAULT_ZOOM.MOBILE : CONFIG.MAP.DEFAULT_ZOOM.DESKTOP
);


function formatDurationMs(ms) {
    return `${Math.round(ms)}ms`;
}


function logStartupTotalIfReady() {
    if (!STATE.STARTUP.TIMING || STATE.STARTUP.TIMING.totalLogged) return;
    if (
        STATE.STARTUP.TIMING.downloadDurationMs == null
        || STATE.STARTUP.TIMING.propertyBuildDurationMs == null
        || STATE.STARTUP.TIMING.ownerBuildDurationMs == null
        || STATE.STARTUP.TIMING.ownerBuildEnd == null
    ) {
        return;
    }
    const totalMs = STATE.STARTUP.TIMING.ownerBuildEnd - STATE.STARTUP.TIMING.appStart;
    const sumMs = STATE.STARTUP.TIMING.downloadDurationMs
        + STATE.STARTUP.TIMING.propertyBuildDurationMs
        + STATE.STARTUP.TIMING.ownerBuildDurationMs;
    console.log(
        `Total startup time (startup -> buildOwnerMarkers complete): ${formatDurationMs(totalMs)} `
        + `(sum: ${formatDurationMs(sumMs)})`
    );
    STATE.STARTUP.TIMING.totalLogged = true;
}



// Suppress URL updates during programmatic resets/navigation
function normalizePropertyType(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim().toUpperCase();
    if (!s) return null;
    return s;
}

function propertyTypeMatches(propertyItem) {
    if (STATE.SELECTION.PROPERTY_TYPE === CONFIG.PROPERTY_TYPES.DEFAULT) return true;
    const itemType = normalizePropertyType(propertyItem?.property_type);
    return itemType === STATE.SELECTION.PROPERTY_TYPE;
}
