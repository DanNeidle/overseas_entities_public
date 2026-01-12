/**
 * © Tax Policy Associates Ltd 2026, and licensed under the Creative Commons BY-SA 4.0 licence (unless stated otherwise).
 * You may freely use and adapt any of our original material for any purpose, provided you attribute it to Tax Policy Associates Ltd.
 * We’d appreciate it if you let us know, but you don't have to.
 *
 * Overseas Entities Map — main client script.
 *
 * Responsibilities:
 * - Load data and control-type descriptions
 * - Build marker clusters for properties, proprietors, and beneficial owners
 * - Render and manage the info panel, legend, and controls
 * - Provide search, selection, share links, and accessibility affordances
 *
 * Third‑party libraries:
 * - jQuery (MIT)
 * - Leaflet (BSD 2‑Clause)
 * - Leaflet.markercluster (MIT)
 * - Leaflet.Control.Geocoder (MIT)
 * - Leaflet.draw (MIT)
 * - LZ‑String (MIT)
 */



// Application version (dataset appended dynamically once manifest loads)
const APP_VERSION = "0.92";

// Total JSON file size in bytes (uncompressed)
const JSON_FILE_SIZE = 47199453; // used for initial properties download progress (fallback)
let PROPERTIES_JSON_URL = "overseas_entities_properties.json"; // overwritten by manifest
let PROPRIETORS_JSON_URL = "overseas_entities_proprietors.json"; // overwritten by manifest
let datasetVersionLabel = null; // Set once exporter provides current dataset month/year
const MAP_ATTRIBUTION_HTML = 'Map tiles: &copy; OpenStreetMap contributors &copy; CARTO.';
const PROPERTY_FLY_TO_ZOOM = 17;

// Maximum number of items to load - when developing/debugging, set to e.g. 1000. Or null for normal behaviour
const debug_limit = null;

const isEmbedded = (() => {
    try {
        return window.self !== window.top;
    } catch (err) {
        return true;
    }
})();

if (isEmbedded) {
    document.documentElement.classList.add('embedded');
}

const IOS_ADD_TO_HOME_PROMPT_STORAGE_KEY = 'oeMapIosAddToHomePromptShown';
const TUTORIAL_COOKIE_KEY = 'tutorialSeen_intro';
let tutorialDataReady = false;
let tutorialStarted = false;
let tutorialStartRetryTimer = null;
let tutorialPending = true;

try {
    tutorialPending = getCookie(TUTORIAL_COOKIE_KEY) !== 'true';
} catch (err) {
    tutorialPending = true;
}

function maybeStartTutorial() {
    if (tutorialStarted || !tutorialPending) return;
    if (!tutorialDataReady) return;

    if (typeof window.setupAndStartTutorial !== 'function') {
        if (!tutorialStartRetryTimer) {
            tutorialStartRetryTimer = setTimeout(() => {
                tutorialStartRetryTimer = null;
                maybeStartTutorial();
            }, 250);
        }
        return;
    }

    tutorialStarted = true;
    try {
        setupAndStartTutorial();
        setCookie(TUTORIAL_COOKIE_KEY, 'true', 365);
        tutorialPending = false;
    } catch (err) {
        tutorialStarted = false;
        if (!tutorialStartRetryTimer) {
            tutorialStartRetryTimer = setTimeout(() => {
                tutorialStartRetryTimer = null;
                maybeStartTutorial();
            }, 750);
        }
    }
}

function hasShownIosAddToHomePrompt() {
    try {
        if (window.localStorage.getItem(IOS_ADD_TO_HOME_PROMPT_STORAGE_KEY) === 'true') {
            return true;
        }
    } catch (err) {
        // ignore lack of localStorage access
    }
    const cookieMatch = document.cookie.split('; ').find(cookie => cookie.startsWith(`${IOS_ADD_TO_HOME_PROMPT_STORAGE_KEY}=`));
    return cookieMatch === `${IOS_ADD_TO_HOME_PROMPT_STORAGE_KEY}=1`;
}

function rememberIosAddToHomePromptShown() {
    try {
        window.localStorage.setItem(IOS_ADD_TO_HOME_PROMPT_STORAGE_KEY, 'true');
    } catch (err) {
        // ignore storage failures
    }
    const oneYear = 365 * 24 * 60 * 60;
    document.cookie = `${IOS_ADD_TO_HOME_PROMPT_STORAGE_KEY}=1; path=/; max-age=${oneYear}; SameSite=Lax`;
}

function isStandaloneDisplayMode() {
    try {
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
            return true;
        }
    } catch (err) {
        // ignore matchMedia issues
    }
    return window.navigator.standalone === true;
}

function maybeShowIosAddToHomePrompt() {
    if (hasShownIosAddToHomePrompt()) return;

    const userAgent = window.navigator.userAgent || '';
    const isIphone = /iPhone/.test(userAgent);

    if (!isIphone || isStandaloneDisplayMode()) return;

    rememberIosAddToHomePromptShown();
    window.alert('To add the Overseas Entities Map to your home screen, tap the share button in Safari and choose \"Add to Home Screen\".');
}


function updateFooterVersion() {
    const footerEl = document.getElementById('footerVersion');
    if (!footerEl) return;

    const datasetSuffix = datasetVersionLabel ? `, ${datasetVersionLabel} data` : '';
    const versionSegment = `Version ${APP_VERSION}${datasetSuffix}`;
    const copyright = `${versionSegment}, &copy Tax Policy Associates, 2026, HM Land Registry data Crown copyright 2026.`;
    footerEl.innerHTML = `${copyright} ${MAP_ATTRIBUTION_HTML}`;
}


/*********************** CONFIGURATION & GLOBAL VARIABLES **************************/
const isMobile = () => window.innerWidth < 992;
let activeMarker = null;                  // Currently active (opened) marker
let tempMarkers = []; // Array to hold the temporary marker for pan-to-location

let currentMode = 'properties'; // Default mode

let linkLayers = [];                      // Array to hold all drawn polylines
let giantMarkers = [];                  // Array to hold all extra (big) markers

let drawnLayer = null;

let linkedItemIds = [];                  // Stores unique IDs of items with links drawn

let allPropertiesData = []; // Properties list (expanded to long keys)
let proprietorsById = null; // Set after proprietors JSON loads

let currentPanelPropertyTitle = null;

let focusModeState = {
    mode: '',
};

let topValuableProperties = [];
const TOP_VALUABLE_PROPERTIES_LIMIT = 10000; // Cap for overall list; sanctioned properties are added separately.

// infobox tooltip stuff
let controlTypesMap = {}; // Will hold the control code -> icon/description mapping

const infoTooltip = document.createElement('div');
infoTooltip.id = 'info-tooltip';
document.body.appendChild(infoTooltip);

// Suppress URL updates during programmatic resets/navigation
let suppressUrlUpdates = false;

// Helper: get control type info from either a long code key or a compact numeric ID
function getControlInfo(code) {
    if (!controlTypesMap) return null;
    // Direct lookup by long code
    if (typeof code === 'string' && controlTypesMap[code]) return controlTypesMap[code];
    // Numeric or numeric-like code → map via _ids
    const idStr = String(code);
    const idsMap = controlTypesMap._ids;
    if (idsMap && Object.prototype.hasOwnProperty.call(idsMap, idStr)) {
        const longCode = idsMap[idStr];
        return controlTypesMap[longCode] || null;
    }
    return null;
}

// Beneficial-owner kind mapping (compact ID -> long string)
// Must be kept in sync with exporter mapping in roe_6_export_to_json_and_csv.py
const KIND_ID_TO_LONG = {
  '1': 'individual-beneficial-owner',
  '2': 'corporate-entity-beneficial-owner',
  '3': 'legal-person-beneficial-owner',
  '4': 'super-secure-beneficial-owner',
  '5': 'super-secure-person-with-significant-control',
  '6': 'corporate-entity-person-with-significant-control',
};

function decodeKind(k) {
  if (k === undefined || k === null) return undefined;
  // Require numeric/ID form; no fallback to long strings (no legacy support)
  return KIND_ID_TO_LONG[String(k)];
}

// Expand short-key JSON schema (phase 2) into the long-key shape expected by the app.
// No-op for already-long schemas.
function expandShortSchemaIfNeeded(data) {
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
function resolveProprietorRefs() {
    if (!proprietorsById) return;
    for (const item of allPropertiesData) {
        if (!item.props && Array.isArray(item.pids)) {
            item.props = item.pids.map(pid => proprietorsById[pid]).filter(Boolean);
        }
    }
}

// make sure we get clear buttons where needed (skip on desktop Safari to avoid double icons)
setupSearchClearButtons();

// Create and configure the  clear button on page load
const floatingClearButton = document.createElement('button');
floatingClearButton.id = 'floatingClearButton';
floatingClearButton.innerHTML = '<i class="material-symbols-outlined" aria-hidden="true">cancel</i> Clear';
floatingClearButton.setAttribute('aria-label', 'Clear links and exit focus mode');
document.body.appendChild(floatingClearButton);


// This will hold our pre-built marker cluster layers for each mode and category
const modeLayers = {
    properties: {
        green: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        orange: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        red: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        grey: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        purple: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        blue: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon })
    },
    proprietors: {
        green: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        orange: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        red: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        grey: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        purple: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        blue: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon })
    },
    beneficial_owners: {
        green: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        orange: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        red: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        grey: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        purple: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon }),
        blue: L.markerClusterGroup({ showCoverageOnHover: false, iconCreateFunction: createCustomClusterIcon })
    }
};

// We still need a way to find any marker by its ID for popups
let allMarkersById = {};

// Initialize map at a global view initially
const worldBounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));
const map = L.map('map', { center: [54, -2], zoom: 2, minZoom: 2, zoomControl: false, maxBounds: worldBounds, maxBoundsViscosity: 1.0, attributionControl: false });


L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { worldCopyJump: true, noWrap: false}).addTo(map);
// make sure info box disappears when clicked
map.on('click', function() {
    hideInfoPanel(); 
});

// --- Add prominent no-data markers for Scotland and Northern Ireland ---
const noDataMarkers = [];

function addNoDataMarkers() {
    // Create a dedicated high-z pane so badges stay above clusters
    const pane = map.createPane('no-data-pane');
    pane.style.zIndex = 650;
    pane.style.pointerEvents = 'auto';

    // Helper to build the DivIcon with accessible markup
    const makeNoDataIcon = () => L.divIcon({
        className: 'no-data-icon',
        html: '<div class="no-data-badge" role="button" aria-label="No data available" tabindex="0">?</div>',
        iconSize: null
    });

    // Country centroids (visual/geographic centres)
    const scotland = L.marker([56.599439013318005, -4.22718327285142], { pane: 'no-data-pane', icon: makeNoDataIcon() }).addTo(map);
    const ni       = L.marker([54.71511897854079, -6.86011631976435], { pane: 'no-data-pane', icon: makeNoDataIcon() }).addTo(map);

    const openNoDataPopup = (latlng) => {
        L.popup({ className: 'no-data-popup', autoPan: true })
         .setLatLng(latlng)
         .setContent('No data available; see article for more details')
         .openOn(map);
    };

    [scotland, ni].forEach((m) => {
        m.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openNoDataPopup(m.getLatLng());
        });
        m.on('add', () => {
            // Add keyboard activation for accessibility
            const el = m.getElement();
            const badge = el ? el.querySelector('.no-data-badge') : null;
            if (badge) {
                badge.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        openNoDataPopup(m.getLatLng());
                    }
                });
            }
        });
        noDataMarkers.push(m);
    });

    // Initial size tuning based on current zoom
    updateNoDataBadgeSizes();
}

function updateNoDataBadgeSizes() {
    const z = map.getZoom();
    // Scale size with zoom: 24px at z=2 → up to ~84px by z>=8
    const size = Math.max(24, Math.min(84, 24 + (z - 2) * 12));
    noDataMarkers.forEach((m) => {
        const el = m.getElement();
        const badge = el ? el.querySelector('.no-data-badge') : null;
        if (badge) {
            badge.style.width = `${size}px`;
            badge.style.height = `${size}px`;
            badge.style.fontSize = `${Math.round(size * 0.56)}px`;
            badge.style.borderWidth = `${Math.max(2, Math.round(size * 0.045))}px`;
        }
    });
}

map.on('zoomend', updateNoDataBadgeSizes);

addNoDataMarkers();

// Show/hide the Scotland/NI no-data markers by mode
function setNoDataMarkersVisible(isVisible) {
    noDataMarkers.forEach((m) => {
        const isOnMap = map.hasLayer(m);
        if (isVisible && !isOnMap) {
            m.addTo(map);
        } else if (!isVisible && isOnMap) {
            map.removeLayer(m);
        }
    });
}

// Permalink helpers (non-conflicting with ?s= compressed share)
function hasCompressedShare() {
    return new URLSearchParams(window.location.search).has('s');
}

function updatePermalinkParam(key, value) {
    if (suppressUrlUpdates) return;
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
    if (suppressUrlUpdates) return;
    if (hasCompressedShare()) return;
    const c = map.getCenter();
    const z = map.getZoom();
    const loc = `${c.lat.toFixed(6)},${c.lng.toFixed(6)},${z}`;
    updatePermalinkParam('location', loc);
}

map.on('moveend', updateLocationParamFromMap);



/*********************** HELPER FUNCTIONS **************************/

/**
 * Collects all used Material Symbols, builds the optimized font URL, 
 * and injects it into the document's <head>.
 * @param {object} controlTypes - The map data from your control types JSON file.
 */
function loadMaterialSymbols(controlTypes) {
    // 1. Define icons that are hardcoded in your HTML/JS
    const staticIcons = [
        'cancel', // Used in the floating clear button
        'link',   // Used in the "Draw connections" button
        'search', 
        'factory',
        'add',
        'map',
        'remove',
        'menu',
        'apartment',
        'article',
        'group',
        'search',
        'rocket',
        'currency_pound',
        'draw',
        'globe',
        'attach_email',
        'help_outline',
        'link',
        'g_mobiledata_badge',
        // Infobox bar controls
        'chevron_left',
        'chevron_right',
        'close',
        // Icons for connection role markers
        'person'
    ];

    // 2. Extract icon names from your dynamic JSON data (ignore helper keys like _ids)
    const dynamicIcons = Object.values(controlTypes)
        .map(type => type && type.icon)
        .filter(icon => typeof icon === 'string' && icon.length > 0);

    // 3. Combine, de-duplicate, and sort the icon names
    const allIcons = [...new Set([...staticIcons, ...dynamicIcons])];
    allIcons.sort(); // The Google Fonts API requires the list to be alphabetical

    // 4. Build the final URL
    const iconNamesStr = allIcons.join(',');
    const fontUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&icon_names=${iconNamesStr}&display=block`;

    // 5. Create and inject the new <link> tag
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontUrl;
    document.head.appendChild(link);

    // console.log(`Loaded ${allIcons.length} Material Symbols.`);
}

/**
 * Truncates a string to a specified length and adds an ellipsis.
 * If the original string is shorter than the limit, it returns the string unchanged.
 *
 * It is designed to work with the custom data-tooltip-infopanel system.
 *
 * @param {string} str - The input string to truncate.
 * @param {number} limit - The maximum length of the truncated string.
 * @returns {string} The truncated string or an HTML span with the custom data attribute.
 */

function truncate(str, limit) {
  if (!str) {
    return "";
  }
  if (str.length <= limit) {
    return str;
  }
  const truncated = str.substring(0, limit) + "...";
  return truncated;
}

function truncateWithTooltip(str, limit) {

  // Use the custom data attribute instead of the native `title` attribute
  // for a consistent look and feel with the rest of the application's tooltips.
  return `<span data-tooltip-infopanel="${str}">${truncate(str, limit)}</span>`;
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

/**
 * Creates a small, clickable badge to display the property count and trigger a search.
 * Returns an empty string if the count is not provided or is 1.
 * @param {string} name - The name of the entity to search for.
 * @param {'proprietor'|'beneficiary'} role - The role of the entity.
 * @param {number} count - The number of properties associated with the entity.
 * @returns {string} The HTML string for the clickable badge, or an empty string.
 */
function createOwnershipCountBadge(name, role, count) {
    // Only show the badge if the entity is associated with more than one property.
    if (!count || count <= 1) {
        return '';
    }

    const roleLabel = (role === 'beneficiary') ? 'beneficial owner' : 'proprietor';
    const tooltipText = `This ${roleLabel} is associated with ${count} properties. Click to find them all.`;

    // The badge is now a clickable link (<a> tag) that executes the search.
    // We encode the name to safely handle names with quotes or special characters.
    return `
        <a href="javascript:void(0);"
           class="ownership-count-badge"
           data-tooltip-infopanel="${tooltipText}"
           onclick="event.stopPropagation(); personSearch(decodeURIComponent('${encodeURIComponent(name)}'), '${role}')">
           ${count}
        </a>`;
}


function createFlyThereIcon(lat, lon, title, propertyTitleNumber, markerId, categoryForColor = null, zoomLevel = null) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return '';

    const safeTitle = escapeJsString(title);
    // Determine the highlight color: prefer an explicit category/status if provided; otherwise fall back
    // to the previous behavior (deriving via getMarkerColor on the title, which defaults to green).
    const color = categoryForColor
        ? categoryColours[getMarkerColor(categoryForColor)]
        : categoryColours[getMarkerColor(title)];
    const zoom = (typeof zoomLevel === 'number' && !isNaN(zoomLevel)) ? zoomLevel : 12;

    return `
        <a href="javascript:void(0);"
            data-tooltip-infopanel="Fly to location"
            aria-label="Fly to location"
            onclick="panToLocation(
                ${latNum},
                ${lonNum},
                '${color}',
                '${safeTitle}',
                event,
                '${propertyTitleNumber}',
                '${markerId}',
                ${zoom}
            )"
            class="search-icon"
        >
            <i class="material-symbols-outlined" aria-hidden="true">rocket</i>
        </a>
    `;
}


/**
 * Creates the HTML for a Google search icon link for a given name.
 * @param {string} name - The name of the entity to search for.
 * @returns {string} The HTML string for the link, or an empty string if no name is provided.
 */
function createGoogleSearchIcon(name) {
    // Return nothing if the name is empty or null
    if (!name) {
        return '';
    }

    const encodedName = encodeURIComponent(`"${name}"`);
    const googleSearchUrl = `https://www.google.com/search?q=${encodedName}`;
    
    const tooltipText = `Google search`;

    return `
        <a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="Google search" onclick="event.stopPropagation()">
            <i class="material-symbols-outlined" aria-hidden="true">g_mobiledata_badge</i>
        </a>
    `;
}



/**
 * Creates the HTML for a Google MAP search icon link for a given name.
 * @param {string} name - The name of the entity to search for.
 * @returns {string} The HTML string for the link, or an empty string if no name is provided.
 */
function createGoogleMapIcon(name) {
    // Return nothing if the name is empty or null
    if (!name) {
        return '';
    }

    const encodedName = encodeURIComponent(name);
    // Use the correct Google Maps search URL with the 'search' path
    const googleSearchUrl = `https://www.google.com/maps/search/${encodedName}`;
    
    const tooltipText = `Google Maps search`;

    return `
        <a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="Google Maps search" onclick="event.stopPropagation()">
            <i class="material-symbols-outlined" aria-hidden="true">globe</i>
        </a>
    `;
}


/**
 * Creates the HTML for a Companies House icon link.
 * If a company number is provided, link directly to the company page; otherwise, link to a search by name.
 * @param {string} name - The proprietor name for fallback search.
 * @param {string|number} [companyNumber] - Optional Companies House company number.
 * @returns {string} The HTML string for the link, or an empty string if neither name nor number is provided.
 */
function createCompaniesHouseSearchIcon(name, companyNumber) {
    const hasNumber = companyNumber !== undefined && companyNumber !== null && String(companyNumber).trim() !== '';
    const hasName = !!name;
    if (!hasNumber && !hasName) return '';

    const url = hasNumber
        ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(String(companyNumber).trim())}`
        : `https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}`;

    const tooltipText = hasNumber ? 'Companies House company page' : 'Companies House search for proprietor';
    const ariaLabel = hasNumber ? 'Companies House company page' : 'Companies House search';

    return `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="${ariaLabel}" onclick="event.stopPropagation()">
            <i class="material-symbols-outlined" aria-hidden="true">factory</i>
        </a>
    `;
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

// Fire the existing search flow programmatically
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


  if (currentMode !== desiredMode) {
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

    switchMode(desiredMode);
    setTimeout(go, 500); // give clusters/layers a moment to attach
  } else {
    go();
  }
}




/**
 * Create a big marker icon (for endpoints of a link).
 */
function createBigIcon(markerColor) {
    // Use the colour associated with the marker's status
    return L.divIcon({
      html: `<div style="background-color:${markerColor}; width:24px; height:24px; border-radius:50%; border:2px solid black;"></div>`,
      className: '',
      iconSize: [24, 24]
    });
  }

/**
 * Creates a role-specific icon for temporary connection endpoints.
 * @param {string} markerColor - Color to theme the border.
 * @param {'property'|'proprietor'|'bo'} role - The type of node.
 */
function createRoleIcon(markerColor, role) {
    let glyph = 'apartment'; // default to property icon
    if (role === 'proprietor') glyph = 'factory';
    if (role === 'bo') glyph = 'person';

    const html = `
      <div class="role-marker" style="border-color: ${markerColor}">
        <i class="material-symbols-outlined role-marker-icon" aria-hidden="true">${glyph}</i>
      </div>
    `;

    return L.divIcon({
        html,
        className: 'role-marker-wrapper',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
}

/**
 * Checks if a marker's layer is active and, if not, enables it and updates the legend.
 * @param {L.Marker} marker - The marker whose layer needs to be checked.
 */
function ensureMarkerLayerIsVisible(marker) {
    // Safety check in case a marker or its category is missing
    if (!marker || !marker.category) return;

    const category = marker.category;
    const layerGroup = modeLayers[currentMode]?.[category];

    // Check if the layer group exists and is NOT currently on the map
    if (layerGroup && !map.hasLayer(layerGroup)) {
        // 1. Add the layer to the map
        map.addLayer(layerGroup);

        // 2. Find the corresponding legend item and update its UI to match
        const legendItem = document.querySelector(`.legend-item[data-category="${category}"]`);
        if (legendItem) {
            legendItem.setAttribute("data-active", "true");
            legendItem.classList.remove("inactive");
            legendItem.querySelector(".legend-box")?.classList.remove("inactive");
        }
    }
}

/**
 * Filters, sorts, and caches the top 10,000 most valuable properties.
 */
function prepareValuablePropertiesData() {
    const valuable = allPropertiesData.filter(p => p.price_paid);
    valuable.sort((a, b) => b.price_paid - a.price_paid);
    const capped = valuable.slice(0, TOP_VALUABLE_PROPERTIES_LIMIT);
    const sanctioned = valuable.filter(p => getMarkerColor(p.status) === 'purple');
    const combined = new Map();
    capped.forEach(p => combined.set(p.property_title_number, p));
    sanctioned.forEach(p => combined.set(p.property_title_number, p));
    topValuableProperties = Array.from(combined.values());
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
 * Creates a custom pie-chart-style icon for a cluster.
 * The icon shows the proportion of each marker category within the cluster.
 */
function createCustomClusterIcon(cluster) {
    const markers = cluster.getAllChildMarkers();
    const count = markers.length;
    const displayCount = (typeof count === 'number') ? count.toLocaleString('en-GB') : '';
    const counts = {};

    // Count markers in each category
    markers.forEach(marker => {
        const category = marker.category || 'green'; // Default to green if undefined
        counts[category] = (counts[category] || 0) + 1;
    });

    const categories = Object.keys(counts).sort();
    let gradientString = 'conic-gradient(';
    let currentPercent = 0;

    categories.forEach(category => {
        const percent = (counts[category] / count) * 100;
        const color = categoryColours[category] || 'gray';
        gradientString += `${color} ${currentPercent}% ${currentPercent + percent}%, `;
        currentPercent += percent;
    });

    gradientString = gradientString.slice(0, -2) + ')';

    const size = count < 100 ? 40 : (count < 1000 ? 50 : 60);

    // Create a single div for the icon. The line-height property vertically
    // centres the count within the circle.
    const html = `<div class="custom-cluster-icon" style="background: ${gradientString}; width: ${size}px; height: ${size}px; line-height: ${size}px;">
                    <span>${displayCount}</span>
                  </div>`;

    return L.divIcon({
        html: html,
        className: '', // Clear the class here, as it's in the HTML string
        iconSize: [size, size]
    });
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
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}


function getMarkerColor(status) {
    // Normalise status strings and map them to a colour category used by
    // clusters/legend. We trim to avoid issues with stray whitespace.
    const norm = (status || '').toString().trim().toLowerCase();
    switch (norm) {
        case 'red':
            return 'red';
        case 'orange':
            return 'orange';
        case 'grey':
            return 'grey';
        case 'blue':
            return 'blue';
        case 'purple':
            return 'purple';
        case 'green':
            return 'green';
        default:
            return 'green';
    }
}

const categoryColours = {
    green: '#6ACC64',
    orange: '#DD8452',
    red: '#C44E52',
    grey: '#939699',
    purple: '#563d7c',
    blue: '#4C72B0'
};

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

// Format a date string of the form DD-MM-YYYY into "D Month YYYY"
function formatDate(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    const [day, month, year] = parts;
    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const monthIndex = parseInt(month, 10) - 1;
    const monthName = months[monthIndex] || month;
    return `${parseInt(day, 10)} ${monthName} ${year}`;
}



/**
 * Switches the map’s display mode (properties, proprietors, or beneficial_owners).
 * @param {string} newMode – the mode to switch to.
 * @param {boolean} [dont_change_view=false] – if true, skip resetting the map view.
 */
function switchMode(newMode, dont_change_view = false) {
    // 1. Capture which categories (green/orange/red/grey/purple) are currently active in the legend
    const activeCategories = new Set();
    document.querySelectorAll('.legend-item[data-active="true"]').forEach(item => {
        activeCategories.add(item.getAttribute('data-category'));
    });

    // 2. Remove all layers from *every* mode
    for (const mode in modeLayers) {
        for (const cat in modeLayers[mode]) {
            const layerGroup = modeLayers[mode][cat];
            if (map.hasLayer(layerGroup)) {
                map.removeLayer(layerGroup);
            }
        }
    }

    // 3. Add back only those categories that were active, under the chosen mode
    for (const cat in modeLayers[newMode]) {
        if (activeCategories.has(cat)) {
            map.addLayer(modeLayers[newMode][cat]);
        }
    }

    // 4. Update global state
    currentMode = newMode;

    // 4a. Only show Scotland/NI no-data badges in properties mode
    setNoDataMarkersVisible(currentMode === 'properties');

    // 5. Optionally reset map center/zoom based on mode defaults
    if (!dont_change_view) {
        if (currentMode === 'properties') {
            map.setView([55, -2], 6);
        } else {
            map.setView([54, -2], 2);
        }
    }

    // 6. Update the search‐box placeholder to match the active mode
    const searchInput = document.getElementById("searchInput");
    const placeholderMap = {
        properties: "Search address/title",
        proprietors: "Search proprietor",
        beneficial_owners: "Search BO names/addresses"
    };
    searchInput.placeholder = placeholderMap[newMode] || "Search...";
    // Update permalink with mode
    updatePermalinkParam('mode', currentMode);
}


/**
 * Reads the compressed state from the URL (?s=…), restores mode, filters, links, map view, and info‐panel.
 */
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

    // 1. Switch mode but do NOT let it reset the view
    if (state.mode && modeLayers[state.mode]) {
        document.querySelectorAll('.mode-toggle-btn.active')
                .forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.mode-toggle-btn[data-value="${state.mode}"]`);
        if (btn) btn.classList.add('active');
        switchMode(state.mode, true);
    }

    // 2. Restore each layer’s visibility and keep the legend UI in sync
    if (state.layers) {
        Object.entries(state.layers).forEach(([cat, visible]) => {
            const layerGroup = modeLayers[state.mode]?.[cat];
            if (layerGroup) {
                visible ? map.addLayer(layerGroup) : map.removeLayer(layerGroup);
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
        linkedItemIds = state.links.slice();
    }

    // 4. Set the saved map view and then open the popup.
    // We use nested setTimeouts to create a reliable sequence.
    if (state.lat != null && state.lng != null && state.zoom != null) {
        // console.log("Scheduling view restore →", state.lat, state.lng, state.zoom);
        
        // First, wait 300ms for layers to settle before moving the map.
        setTimeout(() => {
            // console.log("Executing view restore now.");
            map.invalidateSize();
            map.setView([+state.lat, +state.lng], +state.zoom, { animate: true });

            // If a popup needs to be opened, wait another 200ms after the map starts moving.
            if (state.popup != null) {
                setTimeout(() => {
                    // Find the marker by its persistent title number from the URL
                    const m = findMarkerByTitleNumber(state.popup);
                    if (m) {
                        // console.log("Opening info box for property title:", state.popup);
                        const pt = map.latLngToContainerPoint(m.getLatLng());
                        // We still pass m.myId here, which is the temporary ID used
                        // by the info panel logic to manage the active marker.
                        showInfoPanel(m.propertyItem, m.myId, pt);
                    }
                }, 200); // Wait for map animation to be underway
            }

        }, 300); // Wait for 300ms before setting the view
    }
}



/**
 * Look up a marker by its internal runtime ID.
 * @param {number} id Marker ID.
 * @returns {L.Marker|null}
 */
function findMarkerById(id) {
    return allMarkersById[id] || null;
}


/**
 * Draws all lines (Property -> Proprietors -> BOs) for a given property item.
 * @param {object} propertyItem - The complete property object from the JSON.
 * @param {L.Marker} [originalMarker] - The marker that initiated the link drawing.
 */
function drawLinksForProperty(propertyItem, originalMarker) {
    const propertyCoords = [propertyItem.lat, propertyItem.lon];
    if (!propertyCoords[0] || !propertyCoords[1]) return null;

    let bounds = L.latLngBounds([propertyCoords, propertyCoords]);
    const category = getMarkerColor(propertyItem.status);
    const displayColor = categoryColours[category] || category;

    /**
     * This is the new, intelligent click handler for the big "link" markers.
     * It checks if the relevant info panel is already open before doing anything.
     */
    const giantMarkerClickHandler = function(e) {
        // Stop the click from propagating to the map
        L.DomEvent.stopPropagation(e);

        // Check if the currently displayed panel belongs to this set of links.
        // If it does, do nothing.
        if (currentPanelPropertyTitle === propertyItem.property_title_number) {
            return;
        }

        // --- This code only runs if the panel is closed or showing a different property ---

        // Re-focus on the original marker that created these links
        if (originalMarker) {
            map.panTo(originalMarker.getLatLng());

            // And show its info panel to maintain a consistent UI
            const point = map.latLngToContainerPoint(originalMarker.getLatLng());
            const propObj = (originalMarker.propertyItem && originalMarker.propertyItem.property)
                ? originalMarker.propertyItem.property
                : originalMarker.propertyItem;
            showInfoPanel(propObj, originalMarker.myId, point);
        }
    };

    // Add a role-specific marker at the property's location
    const extraProperty = L.marker(propertyCoords, { icon: createRoleIcon(displayColor, 'property') }).addTo(map);
    extraProperty.on('click', giantMarkerClickHandler); // Use the click handler
    giantMarkers.push(extraProperty);

    if (propertyItem.props) {
        propertyItem.props.forEach(prop => {
            const proprietorCoords = [prop.lat, prop.lon];
            if (!proprietorCoords[0] || !proprietorCoords[1]) return; // Skip if no coords

            // Rule: Property-to-Proprietor Line
            const propLineColor = (prop.BOs && prop.BOs.length > 0) ? 'black' : 'red';
            const propLine = L.polyline([propertyCoords, proprietorCoords], { color: propLineColor, weight: 3 }).addTo(map);
            linkLayers.push(propLine);
            bounds.extend(proprietorCoords);

            // Add role-specific marker for proprietor
            const extraProp = L.marker(proprietorCoords, { icon: createRoleIcon(displayColor, 'proprietor') }).addTo(map);
            extraProp.on('click', giantMarkerClickHandler); // Use the click handler
            giantMarkers.push(extraProp);

            // Rule: Proprietor-to-Beneficial-Owner Lines
            if (prop.BOs) {
                prop.BOs.forEach(bo => {
                    const boCoords = [bo.lat, bo.lon];
                    if (!boCoords[0] || !boCoords[1]) return;

                    let boLineColor = 'green';
                    // Only draw suspect links as red if the proprietor lacks any individual non-trustee BO
                    if (bo.reg_status === "suspect" && !prop.has_individual_non_trustee) boLineColor = 'red';

                    const boLine = L.polyline([proprietorCoords, boCoords], { 
                        color: boLineColor, 
                        weight: 3, 
                        dashArray: '5, 10' // This creates a dashed line
                    }).addTo(map);
                    linkLayers.push(boLine);
                    bounds.extend(boCoords);

                    // Add role-specific marker for BO
                    const extraBo = L.marker(boCoords, { icon: createRoleIcon(displayColor, 'bo') }).addTo(map);
                    extraBo.on('click', giantMarkerClickHandler); // Use the click handler
                    giantMarkers.push(extraBo);
                });
            }
        });
    }

    // If owners not yet loaded, return bounds with only the property marker
    if (!propertyItem.props) {
        return bounds.isValid() ? bounds : null;
    }

    return bounds.isValid() ? bounds : null;
}


// Repeatedly invalidate size to ensure the map positions correctly on mobile
function scheduleInvalidateSize() {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 200);
    setTimeout(() => map.invalidateSize(), 400);
    setTimeout(() => map.invalidateSize(), 600);
  }

// Display the mobile controls offcanvas during the tutorial
function showHamburger() {

    if (!isMobile()) {
      return Promise.resolve();
    }

    const offcanvasEl = document.getElementById('mobileControlsOffcanvas');
    let bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
    bsOffcanvas.show();

    return new Promise(resolve => setTimeout(resolve, 300));
  }

// Basic cookie helpers
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days*24*60*60*1000));
      expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
  }

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
  }

// Clear app-controlled storage and attempt a hard reload
function clearAppDataAndReload() {
    try {
        // Clear Local/Session storage
        try { localStorage.clear(); } catch (e) {}
        try { sessionStorage.clear(); } catch (e) {}

        // Clear cookies set on path '/'
        try {
            (document.cookie || '').split(';').forEach(function(c){
                var eqPos = c.indexOf('=');
                var name = (eqPos > -1 ? c.substr(0, eqPos) : c).trim();
                if (name) document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
            });
        } catch (e) {}

        // Delete Cache Storage entries (if any)
        var cachePromise = Promise.resolve();
        if (window.caches && caches.keys) {
            cachePromise = caches.keys().then(function(keys){
                return Promise.all(keys.map(function(k){ return caches.delete(k); }));
            }).catch(function(){ /* ignore */ });
        }

        // Unregister Service Workers (if any)
        var swPromise = Promise.resolve();
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            swPromise = navigator.serviceWorker.getRegistrations()
                .then(function(regs){ return Promise.all(regs.map(function(r){ return r.unregister(); })); })
                .catch(function(){ /* ignore */ });
        }

        // After best-effort cleanup, reload with a cache-busting param
        Promise.all([cachePromise, swPromise]).finally(function(){
            var href = window.location.href;
            var hasQuery = href.indexOf('?') !== -1;
            var sep = hasQuery ? '&' : '?';
            window.location.replace(href + sep + 'reload=' + Date.now());
        });
    } catch (e) {
        // Fallback: try a normal reload
        try { window.location.reload(); } catch(_) {}
    }
}
/**
 * Fetch data and kick off marker building (called once at page load).
 * @returns {void}
 */
function initializeApp() {
    // Get references to the loading UI elements
    const progressBar = document.getElementById('progressBar');
    const loadingText = document.getElementById('loading-text');
    // Track cumulative download progress across both JSON files
    let bytesProps = 0;
    let bytesOwners = 0;
    let totalBytes = JSON_FILE_SIZE; // Combined size of both files (fallback)
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
    

    // 1. First, fetch the control types map. It's small, so a simple getJSON is fine.
    $.getJSON("overseas_entities_map_control_types.json", function(mapData) {
        controlTypesMap = mapData; // Store the map data in our global variable

        loadMaterialSymbols(mapData);  // Load the icons

        const startDataLoads = () => {
        $.ajax({
            dataType: "json",
            url: PROPERTIES_JSON_URL,
            xhr: function () {
                // Create an XMLHttpRequest so we can track download progress
                const xhr = new window.XMLHttpRequest();

                // Attach a 'progress' listener to update the download progress bar
                xhr.addEventListener("progress", function (evt) {
                    bytesProps = evt.loaded || bytesProps;
                    updateProgress('Downloading data (1/2)…<br>This may take a while, potentially a minute<br>or more if you\'re on mobile or have a slow connection.');
                }, false);
                return xhr;
            },
            success: function(data) {
                // Processing properties while continuing to download proprietors
                updateProgress('Processing properties…');

                // Use a short timeout to allow the browser to repaint the UI updates
                // before starting the intensive processing loop.
                setTimeout(() => {
                    allPropertiesData = expandShortSchemaIfNeeded(data);
                    
                    // Build property markers first
                    buildPropertyMarkers();
                    prepareValuablePropertiesData();
                    
                    // Load proprietors in background with progress; then wire refs and build owner markers
                    $.ajax({
                        dataType: 'json',
                        url: PROPRIETORS_JSON_URL,
                        xhr: function () {
                            const xhr2 = new window.XMLHttpRequest();
                            xhr2.addEventListener('progress', function (evt) {
                                bytesOwners = evt.loaded || bytesOwners;
                                updateProgress('Downloading data (2/2)…');
                            }, false);
                            return xhr2;
                        },
                        success: function(pData) {
                            updateProgress('Processing owners…');
                            proprietorsById = expandProprietorsDictShortToLong(pData);
                            resolveProprietorRefs();
                            buildOwnerMarkers();
                            // All done — set to 100% and fade out overlay
                            bytesOwners = Math.max(0, totalBytes - bytesProps); // force 100% if sizes differ slightly
                            updateProgress('Done');
                            
                            // --- make sure we start in the correct mode ---
                            // During initial startup, do not let this default overwrite URL params
                            // (e.g., preserve ?mode=beneficial_owners on refresh)
                            suppressUrlUpdates = true;
                            const initialParams = new URLSearchParams(window.location.search);
                            const hasAnyStateParam = initialParams.has('s') || initialParams.has('location') || initialParams.has('mode') || initialParams.has('layers') || initialParams.has('popup');
                            const hasModeOrLayersParam = initialParams.has('s') || initialParams.has('mode') || initialParams.has('layers');

                            if (!hasModeOrLayersParam) {
                                // No explicit mode/layers → set initial mode so map isn't empty
                                switchMode('properties');
                            }

                            if (!hasAnyStateParam) {
                                // No URL state at all → apply startup legend defaults
                                map.removeLayer(modeLayers.properties.green);
                                map.removeLayer(modeLayers.properties.blue);
                                map.removeLayer(modeLayers.properties.orange);

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

                            tutorialDataReady = true;
                            
                            const params = new URLSearchParams(window.location.search);
                            const locationParam = params.get('location');
                            
                            // 1. Check for the 'location' parameter first
                            if (locationParam) {
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
                                        switchMode(modeParam, true);
                                    }

                                    const layersParam = params.get('layers');
                                    if (layersParam) {
                                        const activeSet = new Set(layersParam.split(',').map(s=>s.trim()).filter(Boolean));
                                        // Toggle layers to match
                                        Object.keys(modeLayers[currentMode]).forEach(cat => {
                                            const layer = modeLayers[currentMode][cat];
                                            const shouldBeActive = activeSet.has(cat);
                                            if (shouldBeActive) {
                                                if (!map.hasLayer(layer)) map.addLayer(layer);
                                            } else {
                                                if (map.hasLayer(layer)) map.removeLayer(layer);
                                            }
                                            const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
                                            if (legendItem) {
                                                legendItem.setAttribute('data-active', shouldBeActive ? 'true' : 'false');
                                                legendItem.classList.toggle('inactive', !shouldBeActive);
                                                legendItem.querySelector('.legend-box')?.classList.toggle('inactive', !shouldBeActive);
                                            }
                                        });
                                    }

                                    const popupParam = params.get('popup');
                                    if (popupParam) {
                                        const m = findMarkerByTitleNumber(popupParam);
                                        if (m) {
                                            const pt = map.latLngToContainerPoint(m.getLatLng());
                                            showInfoPanel(m.propertyItem, m.myId, pt);
                                        }
                                    }

                                    // Re-enable URL updates after applying initial URL state
                                    suppressUrlUpdates = false;
                                }, 500);

                            // 2. Fall back to the existing 's' parameter
                            } else if (params.has("s")) {
                                applyUrlParameters();
                                // Sharing links should not be mutated, but resume URL updates for user actions
                                suppressUrlUpdates = false;
                            } else if (tutorialPending) {
                                tutorialDataReady = true;
                                maybeStartTutorial();
                                // Resume URL updates even if tutorial start is deferred
                                suppressUrlUpdates = false;
                            } else {
                                // No URL state to apply; resume URL updates after defaults
                                suppressUrlUpdates = false;
                            }

                            $('#loading-overlay').fadeOut();
                        },
                        error: function() {
                            // Proceed without proprietors if failed
                            $('#loading-overlay').fadeOut();
                        }
                    });
                }, 50); // A 50ms delay is enough for the UI to update.
            },
            error: function(err) {
                // console.error("Error loading JSON data:", err);
                $('#loading-overlay').html(
                    '<div style="text-align:left">'
                    + '<p style="color:red; font-weight:bold;">Error loading property data.</p>'
                    + '<p>Please try refreshing. If that doesn\'t work, this may be a caching issue.</p>'
                    + '<button id="clear-app-data-btn" class="btn btn-sm btn-outline-danger">Clear app data and reload</button>'
                    + '</div>'
                );
                $('#clear-app-data-btn').on('click', function(){
                    $('#loading-overlay').html('<p>Clearing cached app data…</p>');
                    clearAppDataAndReload();
                });
            }
        });
        };

        // Fetch manifest for hashed filenames and total size, then start data loads
        $.ajax({
            url: 'overseas_entities_json_info.txt',
            dataType: 'text',
            cache: false,
            success: function(txt){
                const lines = (txt || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
                if (lines.length >= 2) {
                    const size = parseInt(lines[0], 10);
                    const hash = lines[1];
                    if (!isNaN(size) && size > 0) totalBytes = size;
                    if (hash && /^[a-f0-9]{8}$/i.test(hash)) {
                        PROPERTIES_JSON_URL = `overseas_entities_properties.${hash}.json`;
                        PROPRIETORS_JSON_URL = `overseas_entities_proprietors.${hash}.json`;
                    }
                }
                if (lines.length >= 3 && lines[2]) {
                    datasetVersionLabel = lines[2];
                    updateFooterVersion();
                }
                startDataLoads();
            },
            error: function(){
                // Fallback to legacy names and default size
                PROPERTIES_JSON_URL = 'overseas_entities_properties.json';
                PROPRIETORS_JSON_URL = 'overseas_entities_proprietors.json';
                startDataLoads();
            }
        });
    }).fail(function(err) {
        // Add error handling for the new file load
        // console.error("CRITICAL: Could not load overseas_entities_map_control_types.json", err);
        $('#loading-overlay').html(
            '<div style="text-align:left">'
            + '<p style="color:red; font-weight:bold;">Error loading essential configuration data.</p>'
            + '<p>Please try refreshing. If that doesn\'t work, this may be a caching issue.</p>'
            + '<button id="clear-app-data-btn" class="btn btn-sm btn-outline-danger">Clear app data and reload</button>'
            + '</div>'
        );
        $('#clear-app-data-btn').on('click', function(){
            $('#loading-overlay').html('<p>Clearing cached app data…</p>');
            clearAppDataAndReload();
        });
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
              showInfoPanel(m.propertyItem, m.myId, pt);
            }
          }
        }
      }
    } catch (e) { /* console.warn('Session restore failed', e); */ }
}

/**
 * Build all marker layers from `allPropertiesData` and update the progress UI.
 * @returns {void}
 */
function buildAllMarkers() {
    let markerIdCounter = 0;
    let processedCount = 0;
    const totalItems = allPropertiesData.length;

    // Get references to the new progress bar and text elements
    const progressBar = document.getElementById('progressBar');
    const loadingText = document.getElementById('loading-text');
    let lastPercent = -1; // To avoid unnecessary DOM updates

    for (const item of allPropertiesData) {
        if (debug_limit && processedCount >= debug_limit) {
            break;
        }
        processedCount++;

        // --- Marker creation logic ---
        if (!item.property_title_number) continue;
        const category = getMarkerColor(item.status);
        const displayColor = categoryColours[category] || category;
        const createMarker = (lat, lon, title, specificEntity = null) => {
            const uniqueId = markerIdCounter++;
            const iconHtml = `<div style="background-color:${displayColor}; width:12px; height:12px; border-radius:50%; border:1px solid black;"></div>`;
            const marker = L.marker([lat, lon], {
                title: title,
                icon: L.divIcon({ html: iconHtml, className: '' })
            });
            marker.on('click', function(e) {
                L.DomEvent.stopPropagation(e);

                // Check if the panel is already open for THIS specific marker.
                // If so, do nothing and exit. This prevents re-opening the same panel.
                const clickedMarkerTitle = marker.propertyItem.property_title_number;
                if (currentPanelPropertyTitle === clickedMarkerTitle) {
                    return;
                }

                // For any other case (panel is closed, or a different panel is open),
                // just show the info panel for the marker that was just clicked.
                const point = map.latLngToContainerPoint(e.latlng);
                showInfoPanel(marker.propertyItem, marker.myId, point);
            });
            marker.propertyItem = item;
            marker.specificEntity = specificEntity || item;
            marker.myId = uniqueId;
            marker.category = category;
            allMarkersById[uniqueId] = marker;
            return marker;
        };
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const propMarker = createMarker(lat, lon, item.property_title_number, item);
            modeLayers.properties[category].addLayer(propMarker);
        }

        const percentComplete = Math.round((processedCount / totalItems) * 100);
        // Only update the bar if the percentage has changed, for better performance
        if (percentComplete > lastPercent) {
            if (progressBar) {
                progressBar.style.width = percentComplete + '%';
                progressBar.textContent = percentComplete + '%';
            }
            lastPercent = percentComplete;
        }
    }

    // --- After the loop, update the text to show we're nearly done
    if (loadingText) {
        loadingText.textContent = 'Finalising map...';
    }

    // console.log(
        'properties layer counts:',
        'green=', modeLayers.properties.green.getLayers().length,
        'orange=', modeLayers.properties.orange.getLayers().length,
        'red=', modeLayers.properties.red.getLayers().length,
        'grey=', modeLayers.properties.grey.getLayers().length,
        'purple=', modeLayers.properties.purple.getLayers().length,
        'blue=', modeLayers.properties.blue.getLayers().length
    // );

    // An array of the categories to update.
    const categories = ['green', 'orange', 'red', 'grey', 'purple', 'blue'];

    categories.forEach(category => {
        // Find the specific legend item using its data-category attribute.
        const legendItem = document.querySelector(`.legend-item[data-category="${category}"]`);

        if (legendItem) {
            // Get the count of markers for this category in the 'properties' view.
            const count = modeLayers.properties[category].getLayers().length;

            // Create a new <span> element to hold the count.
            const countElement = document.createElement('span');
            countElement.className = 'legend-count'; // Add a class for styling.
            
            // Set the text, using the existing formatNumber function for consistency.
            countElement.textContent = ` (${formatNumber(count)})`;
            
            // Append the new element to the legend item.
            legendItem.appendChild(countElement);
        }
    });
}

// New: build only property markers (fast path)
function buildPropertyMarkers() {
    let markerIdCounter = 0;
    const createMarker = (lat, lon, title, specificEntity = null, displayColor = null, category = null) => {
        const uniqueId = markerIdCounter++;
        const finalCategory = category || 'green';
        const color = displayColor || (categoryColours[finalCategory] || finalCategory);
        const iconHtml = `<div style="background-color:${color}; width:12px; height:12px; border-radius:50%; border:1px solid black;"></div>`;
        const marker = L.marker([lat, lon], { title, icon: L.divIcon({ html: iconHtml, className: '' }) });
        marker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            const clickedMarkerTitle = marker.propertyItem.property_title_number;
            if (currentPanelPropertyTitle === clickedMarkerTitle) return;
            const point = map.latLngToContainerPoint(e.latlng);
            showInfoPanel(marker.propertyItem, marker.myId, point);
        });
        // For property markers, both propertyItem and specificEntity should point to the property object
        marker.propertyItem = specificEntity || {};
        marker.specificEntity = specificEntity || {};
        marker.category = finalCategory;
        marker.myId = uniqueId;
        allMarkersById[uniqueId] = marker;
        return marker;
    };

    for (const item of allPropertiesData) {
        if (!item.property_title_number) continue;
        const category = getMarkerColor(item.status);
        const displayColor = categoryColours[category] || category;
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const propMarker = createMarker(lat, lon, item.property_title_number, item, displayColor, category);
            modeLayers.properties[category].addLayer(propMarker);
        }
    }

    // Update legend counts for properties
    const categories = ['green', 'orange', 'red', 'grey', 'purple', 'blue'];
    categories.forEach(category => {
        const legendItem = document.querySelector(`.legend-item[data-category="${category}"]`);
        if (legendItem) {
            const count = modeLayers.properties[category].getLayers().length;
            const countElement = document.createElement('span');
            countElement.className = 'legend-count';
            countElement.textContent = `(${count})`;
            const existing = legendItem.querySelector('.legend-count');
            if (existing) existing.remove();
            legendItem.appendChild(countElement);
        }
    });
}

// New: build proprietor and BO markers after proprietors load
function buildOwnerMarkers() {
    if (!proprietorsById) return;
    let markerIdCounter = 1000000; // separate namespace to avoid clashes
    const createMarker = (lat, lon, title, specificEntity = null, displayColor = null, category = null, propertyObj = null) => {
        const uniqueId = markerIdCounter++;
        const finalCategory = category || 'green';
        const color = displayColor || (categoryColours[finalCategory] || finalCategory);
        const iconHtml = `<div style=\"background-color:${color}; width:12px; height:12px; border-radius:50%; border:1px solid black;\"></div>`;
        const marker = L.marker([lat, lon], { title, icon: L.divIcon({ html: iconHtml, className: '' }) });
        marker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            const point = map.latLngToContainerPoint(e.latlng);
            showInfoPanel(marker.propertyItem, marker.myId, point);
        });
        // propertyItem is the property; specificEntity is the owner (proprietor/BO)
        marker.propertyItem = propertyObj || {};
        marker.specificEntity = specificEntity || {};
        marker.category = finalCategory;
        marker.myId = uniqueId;
        allMarkersById[uniqueId] = marker;
        return marker;
    };

    for (const item of allPropertiesData) {
        const category = getMarkerColor(item.status);
        const displayColor = categoryColours[category] || category;
        if (!item.props) continue;
        item.props.forEach(prop => {
            const propLat = Number(prop.lat);
            const propLon = Number(prop.lon);
            if (Number.isFinite(propLat) && Number.isFinite(propLon)) {
                const pMarker = createMarker(propLat, propLon, prop.name, prop, displayColor, category, item);
                modeLayers.proprietors[category].addLayer(pMarker);
            }
            if (prop.BOs) {
                prop.BOs.forEach(bo => {
                    const boLat = Number(bo.lat);
                    const boLon = Number(bo.lon);
                    if (Number.isFinite(boLat) && Number.isFinite(boLon)) {
                        const boMarker = createMarker(boLat, boLon, bo.name, bo, displayColor, category, item);
                        modeLayers.beneficial_owners[category].addLayer(boMarker);
                    }
                });
            }
        });
    }
}



/*********************** EVENT LISTENERS **************************/
// Mode toggle buttons
document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener("click", function() {
        const targetMode = this.dataset.value;
        // If user clicks the already active mode, reset to startup defaults
        if (targetMode === currentMode) {
            resetToStartupDefaults();
            // Show this tip only the first time
            try {
                if (getCookie('modeResetTipShown') !== 'true') {
                    showTipToast('Tip: Clicking the active mode resets the view and filters.');
                    setCookie('modeResetTipShown','true',365);
                }
            } catch {}
            return;
        }

        // Remove 'active' class from any currently active button
        document.querySelector('.mode-toggle-btn.active').classList.remove('active');
        // Add 'active' class to the clicked button
        this.classList.add('active');

        // leave focus mode 
        const clearButton = document.getElementById('floatingClearButton');
        if (clearButton && clearButton.style.display === 'block') {
            clearButton.click();
        }
        // Call your switchMode function with the button's data-value
        switchMode(targetMode);

        // Clear any visible search results when changing mode
        const entityResults = document.getElementById('searchResults');
        if (entityResults) {
            entityResults.innerHTML = '';
            entityResults.style.display = 'none';
        }
        const placeResults = document.getElementById('placeSearchResults');
        if (placeResults) {
            placeResults.innerHTML = '';
            placeResults.style.display = 'none';
        }
    });
});

function resetToStartupDefaults() {
    // Suppress URL updates while resetting, and start from a clean URL
    suppressUrlUpdates = true;
    clearStateParams();

    // Always perform a full clear (removes links and exits focus mode)
    const clearCtl = document.getElementById('clearButton');
    if (clearCtl) clearCtl.click();

    // As a safety net, ensure the floating clear button is hidden
    const floating = document.getElementById('floatingClearButton');
    if (floating) floating.style.display = 'none';

    // Switch to properties without changing view yet
    document.querySelectorAll('.mode-toggle-btn.active')
            .forEach(b => b.classList.remove('active'));
    const propBtn = document.querySelector('.mode-toggle-btn[data-value="properties"]');
    if (propBtn) propBtn.classList.add('active');
    switchMode('properties');

    // Set legend defaults: disable green, blue, orange; enable red, grey, purple
    const defaultsOff = new Set(['green','blue','orange']);
    const allCats = ['green','orange','red','grey','blue','purple'];
    allCats.forEach(cat => {
        const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
        const layer = modeLayers[currentMode]?.[cat];
        const shouldBeOn = !defaultsOff.has(cat);
        if (legendItem) {
            legendItem.setAttribute('data-active', shouldBeOn ? 'true' : 'false');
            legendItem.classList.toggle('inactive', !shouldBeOn);
            legendItem.querySelector('.legend-box')?.classList.toggle('inactive', !shouldBeOn);
        }
        if (layer) {
            if (shouldBeOn && !map.hasLayer(layer)) map.addLayer(layer);
            if (!shouldBeOn && map.hasLayer(layer)) map.removeLayer(layer);
        }
    });

    // Reset view for properties
    map.setView([55, -2], 6);

    // Clear focus mode & info panel
    hideInfoPanel();

    // Re-enable URL updates after the map settles, and ensure the URL is clean
    map.once('moveend', () => {
        clearStateParams();
        suppressUrlUpdates = false;
    });
}

function showTipToast(text) {
    const t = document.createElement('div');
    t.innerText = text;
    Object.assign(t.style, {
        position:'fixed', bottom:'12px', left:'50%', transform:'translateX(-50%)',
        background:'#1133AF', color:'#fff', padding:'8px 12px', borderRadius:'6px', zIndex:5000,
        boxShadow:'0 2px 8px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(t);
    setTimeout(()=>{ t.remove(); }, 2500);
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


// Search input filtering
document.getElementById("searchInput").addEventListener("keyup", debounce(function() {
    const searchText = this.value.trim().toLowerCase();
    const resultsDiv = document.getElementById("searchResults");
    resultsDiv.innerHTML = "";
    // Add a results header with inline clear badge
    const header = document.createElement('div');
    header.className = 'results-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'results-title';
    titleSpan.textContent = 'Results';
    const clearLink = document.createElement('button');
    clearLink.type = 'button';
    clearLink.className = 'results-clear';
    clearLink.textContent = 'Clear';
    clearLink.setAttribute('aria-label', 'Clear search results');
    clearLink.addEventListener('click', (e) => {
        e.stopPropagation();
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
    });
    header.appendChild(titleSpan);
    header.appendChild(clearLink);
    resultsDiv.appendChild(header);

    if (searchText.length < 2) { // Minimum characters to start searching
        resultsDiv.style.display = 'none';
        return;
    }

    let count = 0;
    const maxResults = Infinity;   // when debugging this can be e.g. 20

    // Get an array of all markers that are currently visible on the map
    let visibleMarkers = [];
    for (const cat in modeLayers[currentMode]) {
        visibleMarkers.push(...modeLayers[currentMode][cat].getLayers());
    }

    if (currentMode === 'properties') {
        // --- LOGIC FOR PROPERTY MODE ---
        visibleMarkers.forEach(marker => {
            if (count >= maxResults) return;

            const entity = marker.specificEntity;
            if (!entity) return;

            // Search both the address and the title number
            const addressMatch = entity.property_uk_address?.toLowerCase().includes(searchText);
            const titleMatch = entity.property_title_number?.toLowerCase().includes(searchText);

            if (addressMatch || titleMatch) {
                const div = document.createElement("div");
                div.className = "result-item";
                div.setAttribute('role','option');
                div.setAttribute('tabindex','0');

                // For property results, display the full address to be more user-friendly
                const truncatedAddress = truncate(toTitleCase(entity.property_uk_address), 50);
                const colorCategory = marker.category || getMarkerColor(entity.status);
                const color = categoryColours[colorCategory] || '#ccc';
                div.innerHTML = `<span class="status-dot" style="background-color:${color}"></span>${truncatedAddress}`;

                div.addEventListener("click", () => {

                    ensureMarkerLayerIsVisible(marker);

                    const targetLatLng = marker.getLatLng();

                    // Animate the map view smoothly
                    map.flyTo(targetLatLng, 18, {duration: getFlyDuration() });

                    // Wait for the animation to finish, then show the info panel
                    map.once('moveend', () => {
                        const point = map.latLngToContainerPoint(targetLatLng);
                        showInfoPanel(marker.propertyItem, marker.myId, point);
                    });

                    // Visually highlight the clicked result
                    Array.from(resultsDiv.children).forEach(el => el.classList.remove('selected'));
                    div.classList.add('selected');

                    // Keep search results visible for easier browsing
                    // Do not clear input or dismiss the menu here
                });

                // Keyboard activation
                div.addEventListener('keydown', (e) => { if (e.key === 'Enter') div.click(); });
                resultsDiv.appendChild(div);
                count++;
            }
        });

    } else {

        // --- LOGIC FOR PROPRIETOR & BO MODE ---
        const allMatches = [];
        visibleMarkers.forEach(marker => {
            const entity = marker.specificEntity;
            if (!entity) return;

            // Search both the entity's name and its address
            const nameMatch = entity.name?.toLowerCase().includes(searchText);
            const addressMatch = entity.address?.toLowerCase().includes(searchText);

            if (nameMatch || addressMatch) {
                allMatches.push(marker); // Collect every single matching marker
            }
        });

        // Now create a result div for each match, up to the max limit
        allMatches.slice(0, maxResults).forEach(marker => {
            const entityName = marker.specificEntity.name;
            const propertyAddress = marker.propertyItem.property_uk_address;

            const div = document.createElement("div");
            div.className = "result-item";
            div.setAttribute('role','option');
            div.setAttribute('tabindex','0');

            // Display Format: Name (Property Address)
            const truncatedAddress = truncate(toTitleCase(propertyAddress), 30);
            // Display Format: Name (Truncated Property Address) with status dot
            const colorCategory = marker.category;
            const color = categoryColours[colorCategory] || '#ccc';
            div.innerHTML = `<span class="status-dot" style="background-color:${color}"></span>${toTitleCase(entityName)} <span style="color: #6c757d; font-size: 0.9em;">(${truncatedAddress})</span>`;

            // The click handler is tied to this specific marker, ensuring the correct info panel opens
            div.addEventListener("click", () => {

                ensureMarkerLayerIsVisible(marker);

                const layerGroup = modeLayers[currentMode]?.[marker.category];
                if (layerGroup) {
                    layerGroup.zoomToShowLayer(marker, () => {
                        const point = map.latLngToContainerPoint(marker.getLatLng());
                        showInfoPanel(marker.propertyItem, marker.myId, point);
                    });
                }
                // Visually highlight the clicked result
                Array.from(resultsDiv.children).forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');

                // Keep search results visible for easier browsing
                // Do not clear input or dismiss the menu here
            });

            // Keyboard activation
            div.addEventListener('keydown', (e) => { if (e.key === 'Enter') div.click(); });
            resultsDiv.appendChild(div);
            count++;
        });
    }

    resultsDiv.style.display = (count > 0) ? 'block' : 'none';
    // Announce result count for accessibility
    const live = document.getElementById('liveRegion');
    if (live) live.textContent = count > 0 ? `${count} results` : 'No results';
}, 300)); 


// Legend toggling for layers (categories in legend must match layer groups)
document.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener("click", function() {
        const cat = this.getAttribute("data-category");
        const active = this.getAttribute("data-active") === "true";

        // leave focus mode when searching
        const clearButton = document.getElementById('floatingClearButton');
        if (clearButton && clearButton.style.display === 'block') {
            clearButton.click();

        }

        // Find the correct layer group for the current mode and category
        const layerToToggle = modeLayers[currentMode]?.[cat];

        if (!layerToToggle) {
            // console.warn(`No layer found for category "${cat}" in mode "${currentMode}"`);
            return;
        }

        triggerHapticFeedback(this);
        triggerHapticFeedback(this.querySelector('.legend-box'));

        // Toggle the layer's visibility on the map and update the UI
        if (active) {
            map.removeLayer(layerToToggle);
            this.setAttribute("data-active", "false");
            this.classList.add("inactive");
            this.querySelector(".legend-box")?.classList.add("inactive");
            this.setAttribute('aria-checked', 'false');
        } else {
            map.addLayer(layerToToggle);
            this.setAttribute("data-active", "true");
            this.classList.remove("inactive");
            this.querySelector(".legend-box")?.classList.remove("inactive");
            this.setAttribute('aria-checked', 'true');
        }

        // refresh valuable property list if it is active
        const panel = document.getElementById('valuable-properties-panel');
        // If the panel is open, refresh its list to match the new legend state
        if (!panel.classList.contains('hidden')) {
            // A tiny delay ensures the legend attributes have updated before we rebuild the list
            setTimeout(showValuablePropertiesPanel, 50);
        }

        // Update layers param in permalink (comma-separated active categories)
        const activeCats = Array.from(document.querySelectorAll('.legend-item[data-active="true"]'))
              .map(el => el.getAttribute('data-category'));
        updatePermalinkParam('layers', activeCats.join(','));
    });
});

// Enhance legend accessibility: role, states, and keyboard support
function setupLegendAccessibility() {
    const items = document.querySelectorAll('.legend-item');
    items.forEach((el, idx) => {
        el.setAttribute('role', 'switch');
        const isActive = el.getAttribute('data-active') === 'true';
        el.setAttribute('aria-checked', isActive ? 'true' : 'false');
        el.setAttribute('tabindex', '0');
        el.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                el.click();
                el.setAttribute('aria-checked', el.getAttribute('data-active'));
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const next = items[idx + 1] || items[0];
                next.focus();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = items[idx - 1] || items[items.length - 1];
                prev.focus();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', setupLegendAccessibility);


// Share view functionality – include IDs of drawn links in the saved state
window.addEventListener("load", function() {
    document.getElementById("shareViewButton").addEventListener("click", function() {
        const center = map.getCenter();
        const zoom = map.getZoom();

        // Warning for too many links
        const maxSharedLinks = 9; // Keep limit
        if (linkedItemIds.length > maxSharedLinks) {
          const warning = document.createElement("div");
          warning.innerText = `Sharing limit: Only the first ${maxSharedLinks} of the ${linkedItemIds.length} links drawn can be included in the shared URL.`;
          Object.assign(warning.style, { /* ... existing styles ... */ }); // Keep styles
          document.body.appendChild(warning);
          setTimeout(() => { document.body.removeChild(warning); }, 4000); // Longer timeout
        }

        // Build the state object
        const popupTitle = currentPanelPropertyTitle
            || (activeMarker && activeMarker.propertyItem
                ? activeMarker.propertyItem.property_title_number
                : null);
        const state = {
            lat: center.lat.toFixed(6),
            lng: center.lng.toFixed(6),
            zoom: zoom,
            mode: currentMode, // record the current display mode
            popup: popupTitle,
    // Store the unique IDs of items with links (up to the limit)
            links: linkedItemIds.slice(0, maxSharedLinks),
            // Store layer visibility state
            layers: {}
        };
         
        // Store layer visibility state based on the current mode
        state.layers = {};
        Object.keys(modeLayers[currentMode]).forEach(cat => {
            if (Object.prototype.hasOwnProperty.call(modeLayers[currentMode], cat)) {
                const legendItem = document.querySelector(`.legend-item[data-category="${cat}"]`);
                state.layers[cat] = legendItem.getAttribute('data-active') === 'true';

            }
        });


        // JSON encode and compress
        const jsonState = JSON.stringify(state);
        const compressedState = LZString.compressToEncodedURIComponent(jsonState);

        // Build and display the share URL
        const shareUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + "?s=" + compressedState;
        
        navigator.clipboard.writeText(shareUrl).then(() => {
            // On success, show a confirmation message
            const notification = document.createElement("div");
            notification.innerText = "Shareable URL copied to clipboard!";
            Object.assign(notification.style, {
                position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
                background: 'lightgreen', padding: '10px', borderRadius: '5px',
                zIndex: 9999, border: '1px solid black', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            });
            document.body.appendChild(notification);
            setTimeout(() => { document.body.removeChild(notification); }, 2500);
        }).catch(err => {
            // On failure, log an error and alert the user
            // console.error('Failed to copy share URL: ', err);
            alert('Could not copy URL. Your browser might not support this feature.');
        });

    });

});

// Initially load markers
initializeApp();

// Infer a sensible maximum zoom level for a Nominatim place result.
function getSuggestedMaxZoomForPlace(place) {
    const FALLBACK_ZOOM = 16;
    const ABSOLUTE_MIN_ZOOM = 2;
    const ABSOLUTE_MAX_ZOOM = 18;

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

    const TYPE_CAPS = {
        continent: 4,
        ocean: 4,
        sea: 5,
        archipelago: 7,
        country: 6,
        state: 8,
        province: 8,
        region: 8,
        state_district: 9,
        district: 10,
        county: 10,
        municipality: 11,
        borough: 12,
        city: 12,
        city_district: 13,
        town: 13,
        village: 14,
        hamlet: 15,
        suburb: 15,
        neighbourhood: 16,
        neighborhood: 16,
        locality: 16,
        quarter: 15,
        postcode: 16,
        postal_code: 16,
        road: 17,
        street: 17,
        residential: 17,
        track: 17,
        footway: 17,
        path: 17,
        service: 17,
        motorway: 15,
        trunk: 15,
        primary: 15,
        secondary: 16,
        tertiary: 16,
        airport: 13,
        aerodrome: 13,
        railway: 16,
        station: 16,
        platform: 17,
        bus_stop: 17,
        tram_stop: 17,
        industrial: 17,
        commercial: 17,
        retail: 17,
        farm: 16,
        park: 14,
        forest: 12,
        island: 10,
        lake: 10,
        harbour: 14,
        school: 17,
        university: 17,
        hospital: 17,
        building: 18,
        house: 18,
        apartments: 18,
        detached: 18,
        bungalow: 18,
        address: 18,
        yes: 17
    };

    const CLASS_CAPS = {
        boundary: 9,
        place: 12,
        natural: 10,
        landuse: 13,
        leisure: 14,
        waterway: 12,
        aeroway: 13,
        highway: 17,
        railway: 16,
        amenity: 17,
        tourism: 16,
        shop: 17,
        building: 18,
        man_made: 17,
        office: 17
    };

    let cap = null;
    if (type && Object.prototype.hasOwnProperty.call(TYPE_CAPS, type)) {
        cap = TYPE_CAPS[type];
    } else if (className && Object.prototype.hasOwnProperty.call(CLASS_CAPS, className)) {
        cap = CLASS_CAPS[className];
    }

    const rankZoom = (() => {
        const rank = place.place_rank;
        if (typeof rank !== 'number' || Number.isNaN(rank)) return null;
        if (rank >= 28) return 17;
        if (rank >= 26) return 16;
        if (rank >= 24) return 14;
        if (rank >= 22) return 13;
        if (rank >= 20) return 12;
        if (rank >= 18) return 11;
        if (rank >= 16) return 10;
        if (rank >= 14) return 9;
        if (rank >= 12) return 8;
        if (rank >= 10) return 7;
        if (rank >= 8) return 6;
        if (rank >= 6) return 5;
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

    let minZoom = 2;
    let maxZoom = 18;
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

// Searching for places (Nominatim) with auto-search
$('#placeSearchInput').on('keyup', debounce(function() {
    const searchText = $(this).val().trim();
    const resultsDiv = $('#placeSearchResults');

    // Hide results if search is empty or too short
    if (searchText.length < 2) {
        resultsDiv.empty().hide();
        return;
    }

    // Make a JSONP request to Nominatim
    $.ajax({
        url: "https://nominatim.openstreetmap.org/search",
        dataType: "jsonp",
        jsonp: "json_callback",
        data: {
            q: searchText,
            format: "json",
            limit: 30,
            addressdetails: 1
        },
        success: function(results) {
            resultsDiv.empty(); // Clear previous results
            // Add a results header with inline clear badge
            const $header = $('<div class="results-header"></div>');
            $header.append($('<span class="results-title"></span>').text('Results'));
            const $clear = $('<button type="button" class="results-clear">Clear</button>');
            $clear.on('click', function(e){ e.stopPropagation(); resultsDiv.empty().hide(); });
            $header.append($clear);
            resultsDiv.append($header);

            if (!results || results.length === 0) {
                resultsDiv
                  .append($('<div class="result-item" role="option" tabindex="0"></div>').text('No results found.'))
                  .show();
                const live = document.getElementById('liveRegion');
                if (live) live.textContent = 'No results';
                return;
            }

            // Create a dropdown list of results
            results.forEach(function(result) {
                const resultItem = $('<div class="result-item" role="option" tabindex="0"></div>').text(result.display_name);
                resultItem.on('click', function() {
                    focusMapOnPlaceResult(result);
                    // Keep results visible; just set the input to the selected place
                    $('#placeSearchInput').val(result.display_name);

                    // Highlight the selected item
                    resultsDiv.children().removeClass('selected');
                    resultItem.addClass('selected');
                });
                // Keyboard activation
                resultItem.on('keydown', function(e){ if (e.key === 'Enter') $(this).trigger('click'); });
                resultsDiv.append(resultItem);
            });
            resultsDiv.show(); // Show results container
            const live = document.getElementById('liveRegion');
            if (live) live.textContent = `${results.length} results`;
        },
        error: function(xhr, status, error) {
            resultsDiv.empty().append($('<div class="result-item" role="option" tabindex="0"></div>').text('Error retrieving results.')).show();
            const live = document.getElementById('liveRegion');
            if (live) live.textContent = 'Error retrieving results';
            // console.error("Geocoding error:", status, error);
        }
    });
}, 350)); // A 350ms delay is polite for an external API

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
  infoTooltip.innerHTML = html;
  infoTooltip.style.display = 'block';
  infoTooltip.style.opacity = 1;

  const rect = el.getBoundingClientRect();

  // position above the element, centered
  const topPos = Math.max(8, rect.top - infoTooltip.offsetHeight - 8);
  const leftPos = Math.min(
    window.innerWidth - infoTooltip.offsetWidth - 8,
    Math.max(8, rect.left + rect.width / 2 - infoTooltip.offsetWidth / 2)
  );

  infoTooltip.style.top = `${topPos}px`;
  infoTooltip.style.left = `${leftPos}px`;

  // hide after a short delay or on next tap
  clearTimeout(showMobileTooltip._t);
  showMobileTooltip._t = setTimeout(() => {
    infoTooltip.style.opacity = 0;
    setTimeout(() => (infoTooltip.style.display = 'none'), 200);
  }, 2500);
}

// also hide when user taps elsewhere
document.addEventListener('touchstart', (e) => {
  if (!e.target.closest('[data-tooltip-infopanel]')) {
    infoTooltip.style.opacity = 0;
    setTimeout(() => (infoTooltip.style.display = 'none'), 200);
  }
}, { passive: true });



// --- Info panel history state ---
let infoHistory = [];
let infoHistoryIndex = -1; // -1 means empty
let suppressHistoryPush = false; // used during back/forward navigation

// Persist infobox history across sessions
function saveInfoHistoryToCookie() {
    try {
        const payload = JSON.stringify({ list: infoHistory, index: infoHistoryIndex });
        setCookie('infoHistory', payload, 365);
    } catch (e) {
        // console.warn('Could not save info history to cookie', e);
    }
}

function loadInfoHistoryFromCookie() {
    try {
        const raw = getCookie('infoHistory');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list)) {
            infoHistory = parsed.list.filter(Boolean);
            // Clamp index into valid range, default to last item
            const lastIdx = Math.max(infoHistory.length - 1, 0);
            const idx = (typeof parsed.index === 'number') ? parsed.index : lastIdx;
            infoHistoryIndex = Math.min(Math.max(0, idx), lastIdx);
        }
    } catch (e) {
        // console.warn('Could not load info history cookie', e);
    }
}

function updateInfoBarButtons() {
    const backBtn = document.getElementById('info-back');
    const fwdBtn = document.getElementById('info-forward');
    if (!backBtn || !fwdBtn) return;
    const hasHistory = infoHistory.length > 0 && infoHistoryIndex >= 0;
    backBtn.disabled = !(hasHistory && infoHistoryIndex > 0);
    fwdBtn.disabled = !(hasHistory && infoHistoryIndex < infoHistory.length - 1);
}

function goBack() {
    if (infoHistoryIndex > 0) {
        infoHistoryIndex--;
        const title = infoHistory[infoHistoryIndex];
        const m = findMarkerByTitleNumber(title);
        if (m) {
            suppressHistoryPush = true;
            const panel = document.getElementById('info-panel');
            const keepLeft = panel.style.left;
            const keepTop = panel.style.top;
            showInfoPanel(m.propertyItem, m.myId, null, true);
            if (!isMobile()) { panel.style.left = keepLeft; panel.style.top = keepTop; }
            map.panTo(m.getLatLng());
            suppressHistoryPush = false;
        }
    }
    updateInfoBarButtons();
    saveInfoHistoryToCookie();
}

function goForward() {
    if (infoHistoryIndex < infoHistory.length - 1) {
        infoHistoryIndex++;
        const title = infoHistory[infoHistoryIndex];
        const m = findMarkerByTitleNumber(title);
        if (m) {
            suppressHistoryPush = true;
            const panel = document.getElementById('info-panel');
            const keepLeft = panel.style.left;
            const keepTop = panel.style.top;
            showInfoPanel(m.propertyItem, m.myId, null, true);
            if (!isMobile()) { panel.style.left = keepLeft; panel.style.top = keepTop; }
            map.panTo(m.getLatLng());
            suppressHistoryPush = false;
        }
    }
    updateInfoBarButtons();
    saveInfoHistoryToCookie();
}

function attachInfoBarHandlersOnce() {
    const backBtn = document.getElementById('info-back');
    const fwdBtn = document.getElementById('info-forward');
    const closeBtn = document.getElementById('info-close');
    if (backBtn && !backBtn._wired) { backBtn.addEventListener('click', goBack); backBtn._wired = true; }
    if (fwdBtn && !fwdBtn._wired) { fwdBtn.addEventListener('click', goForward); fwdBtn._wired = true; }
    if (closeBtn && !closeBtn._wired) { closeBtn.addEventListener('click', hideInfoPanel); closeBtn._wired = true; }
}

function hideInfoPanel() {
    const panel = document.getElementById('info-panel');
    // fade out then hide
    panel.classList.remove('showing');
    setTimeout(() => { panel.classList.add('hidden'); }, 180);
    document.body.classList.remove('no-page-scroll');
    
    activeMarker = null;

    // Reset the tracking variable whenever the panel is hidden
    currentPanelPropertyTitle = null;
    if (panel.dataset.propertyTitle) {
        delete panel.dataset.propertyTitle;
    }
    // Remove popup param from URL (if we manage permalinks)
    updatePermalinkParam('popup', null);
    updateInfoBarButtons();
}

/**
 * Show the info panel for a given property marker.
 * @param {object} propertyItem The property object from JSON.
 * @param {number} markerId Internal marker ID for UI state.
 * @param {L.Point} point Screen point for panel positioning.
 * @param {boolean} [fromHistory=false] Whether opened from history navigation.
 * @returns {void}
 */
function showInfoPanel(propertyItem, markerId, point, fromHistory = false) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-panel-content');
    const contentDiv = document.getElementById('info-panel-content');
    activeMarker = findMarkerById(markerId);

    // 1. Set tracking variables and populate content (this is unchanged)
    currentPanelPropertyTitle = propertyItem.property_title_number;
    panel.dataset.propertyTitle = propertyItem.property_title_number;
    contentDiv.innerHTML = generatePanelHtml(propertyItem, markerId);
    panel.classList.remove('hidden');
    // force reflow then fade in
    void panel.offsetWidth;
    panel.classList.add('showing');
    // Nudge logic: count infobox opens
    try {
      const count = parseInt(getCookie('infoboxOpenCount')||'0',10)+1;
      setCookie('infoboxOpenCount', String(count), 365);
      // Keyboard shortcuts nudge
      const kbDismissed = getCookie('kbNudgeDismissed') === 'true';
      const kbUsed = getCookie('usedKeyboardShortcut') === 'true';
      const kbNext = parseInt(getCookie('kbNudgeNext')||'10',10);
      if (!kbDismissed && !kbUsed && count >= kbNext) {
        const o = document.getElementById('kb-nudge-overlay');
        if (o) { o.classList.add('show'); o.classList.remove('hidden'); }
        setCookie('kbNudgeNext', String(count+25), 365);
      }
      // Back/Next nudge
      const navDismissed = getCookie('navNudgeDismissed') === 'true';
      const navUsed = getCookie('navUsed') === 'true';
      const navNext = parseInt(getCookie('navNudgeNext')||'5',10);
      if (!navDismissed && !navUsed && count >= navNext) {
        const o2 = document.getElementById('nav-nudge-overlay');
        if (o2) { o2.classList.add('show'); o2.classList.remove('hidden'); }
        setCookie('navNudgeNext', String(count+15), 365);
      }
    } catch {}
    attachInfoBarHandlersOnce();

    // History push (unless navigating through history)
    if (!suppressHistoryPush && !fromHistory) {
        const last = infoHistory[infoHistoryIndex];
        if (last !== propertyItem.property_title_number) {
            // Truncate any forward history before pushing a new entry
            infoHistory = infoHistory.slice(0, infoHistoryIndex + 1);
            infoHistory.push(propertyItem.property_title_number);
            infoHistoryIndex = infoHistory.length - 1;
        }
    }
    updateInfoBarButtons();
    // Update permalink popup param
    updatePermalinkParam('popup', propertyItem.property_title_number);
    // Persist history state
    saveInfoHistoryToCookie();

    // stop map scrolling when infobox scrolls
    document.body.classList.add('no-page-scroll');

    // 3. Apply positioning logic based on device type
    if (isMobile()) {
        const isLandscape = window.matchMedia("(orientation: landscape)").matches;

        // Apply different widths for portrait vs. landscape
        if (isLandscape) {
            panel.style.width = '40vw'; // 40% width in landscape
            panel.style.left = '30vw';  // Center it (100-40)/2 = 30
        } else {
            panel.style.width = '90vw'; // 90% width in portrait
            panel.style.left = '5vw';   // Center it
        }

        // These styles apply to both mobile orientations
        panel.style.maxHeight = '75vh';
        panel.style.top = '60px'; // Position below header
        panel.style.transform = 'none';

    } else {
        // --- DESKTOP POSITIONING (Your original logic) ---
        // Reset mobile styles and apply desktop logic
        panel.style.width = '320px';
        panel.style.maxHeight = '80vh';
        panel.style.transform = 'none';

        if (!fromHistory && point) {
            const panelWidth = panel.offsetWidth;
            const panelHeight = panel.offsetHeight;
            const mapSize = map.getSize();
            const padding = 15;
            const mapControls = document.getElementById('mapControls');
            const controlsWidth = mapControls ? mapControls.offsetWidth : 0;

            let newLeft = point.x + padding;
            let newTop = point.y - panelHeight / 2;

            if (newLeft + panelWidth + padding > mapSize.x) {
                newLeft = point.x - panelWidth - padding;
            }
            const minLeft = controlsWidth + padding;
            const maxLeft = mapSize.x - panelWidth - padding;
            if (newLeft < minLeft) {
                newLeft = minLeft;
            }
            if (newLeft > maxLeft) {
                newLeft = maxLeft;
            }
            if (newTop < padding) {
                newTop = padding;
            }
            if (newTop + panelHeight + padding > mapSize.y) {
                newTop = mapSize.y - panelHeight - padding;
            }

            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        }
    }
}



// To generate the HTML for the redesigned panel
/**
 * Generate the HTML string for the info panel content.
 * @param {object} propertyItem The property object from JSON.
 * @param {number} markerId Internal marker ID for link context.
 * @returns {string} HTML string for the panel.
 */
function generatePanelHtml(propertyItem, markerId) {
    // Escape for use inside a single-quoted HTML attribute; keep double quotes literal
    const escAttrSingle = (s) => String(s)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;');

    // A map to get tooltip text for the status circle
    const categoryTooltips = {
        green: 'Identifiable owners',
        orange: 'No stated beneficial owner',
        red: 'Suspected hidden ownership',
        grey: 'Failed to register',
        teal: 'Only trustees listed',
        blue: 'Only trustees listed',
        purple: 'Sanctioned owner'
    };

    // --- Helper function to create colored status badges ---
    const createStatusBadge = (status) => {
        if (!status) return '';
        let text = '';
        let colorClass = '';
        switch (status) {
            case "sanctioned":
                text = 'Sanctioned';
                colorClass = 'status-purple';
                break;
            case "trustee":
                text = 'Trustee';
                colorClass = 'status-blue'; 
                break;
            case "listed":
                text = 'Listed';
                colorClass = 'status-green';
                break;
            case "individual":
                text = 'Individual';
                colorClass = 'status-green';
                break;
            case "government-owned":
                text = 'Government owned';
                colorClass = 'status-green';
                break;
            case "UK":
                text = 'UK company';
                colorClass = 'status-green';
                break;
            case "orange":
                text = 'No beneficial owner';
                colorClass = 'status-orange';
                break;
            case "blue":
                text = 'Only trustees listed';
                colorClass = 'status-blue';
                break;
            case "suspect":
                text = 'Company unlawfully registered?';
                colorClass = 'status-red';
                break;
            case "No company found":
                text = 'Failed to register<br>with Companies House';
                colorClass = 'status-grey';
                break;
            default:
                return '';
        }
        return `<div class="status-badge ${colorClass}">${text}</div>`;
    };



    // --- Calculate connection count before building HTML ---
    let connectionCount = 0;
    if (propertyItem.props) {
        connectionCount += propertyItem.props.length; // Add proprietors
        propertyItem.props.forEach(prop => {
            if (prop.BOs) {
                connectionCount += prop.BOs.length; // Add their BOs
            }
        });
    }

    // --- Build the HTML string ---
    let html = ''; 

    // 1. Property Details Section
    const dateStr = propertyItem.date_added ? formatDate(propertyItem.date_added) : 'n/a';
    const priceStr = propertyItem.price_paid ? `£${formatNumber(propertyItem.price_paid)}` : 'n/a';

    // The new address-only HTML block
    const mapIconHtml = createFlyThereIcon(
        propertyItem.lat,
        propertyItem.lon,
        `Property: ${propertyItem.property_title_number}`,
        propertyItem.property_title_number,
        markerId,
        propertyItem.status,
        PROPERTY_FLY_TO_ZOOM
    );
    const googleIconHtml = createGoogleSearchIcon(propertyItem.property_uk_address);
    const googleMapHtml = createGoogleMapIcon(propertyItem.property_uk_address);

    const category = getMarkerColor(propertyItem.status);
    const displayColor = categoryColours[category] || 'gray';
    const categoryTooltipText = categoryTooltips[category] || 'Property status';
    const statusCircleHtml = `<span class="status-circle-indicator" style="color: ${displayColor};" data-tooltip-infopanel="${escapeHtmlAttribute(categoryTooltipText)}">⬤</span>`;
        

    html += `
        <div class="info-item">
            <div class="info-item-content">
                <div class="property-address">
                    
                    ${statusCircleHtml} 
                    <span class="copyable-text" onclick="copyTextOnClick(event)" data-copy-text='${escAttrSingle(propertyItem.property_uk_address || "No address")}'
                          data-tooltip-infopanel='${escAttrSingle(`"${propertyItem.property_uk_address || 'No address'}": copy to clipboard`)}'>
                        ${escapeHtml(truncate(capitalizeFirstLetter(propertyItem.property_uk_address), 90))}
                    </span>
                        <div id="property-icons"> 
                            ${mapIconHtml}
                            ${googleIconHtml}
                            ${googleMapHtml}
                        </div>

                </div>
                <div class="address-text">
                    <span class="copyable-text" onclick="copyTextOnClick(event)" data-tooltip-infopanel="Click to copy date">${dateStr}</span>
                    <span class="copyable-text" onclick="copyTextOnClick(event)" data-tooltip-infopanel="Click to copy price">- ${priceStr}</span>
                    <br>
                    <a href="javascript:void(0);" onclick="searchLandRegistry('${propertyItem.property_title_number}')" data-tooltip-infopanel="Copy title and search Land Registry">
                        🔍
                    </a>
                    <span id="info-panel-title-number" class="copyable-text" onclick="copyTextOnClick(event)" data-tooltip-infopanel="Click to copy title number">${propertyItem.property_title_number}</span>
                    (${propertyItem.property_tenure})
                </div>
            </div>
        </div>
    `;

    // --- Insert the "Draw Connections" button and count here ---
    if (connectionCount > 0) {
        html += `
            <div style="padding-left: 0px; margin-top: 10px;">
                <button id="draw-connections" class="show-link" data-markerid="${markerId}"
                        data-tooltip-infopanel="Draw the connections between the property, proprietor and beneficial owners"
                        style="background: #1133AF; color: white; border: 1px solid #ccc; border-radius: 5px; padding: 5px 10px; cursor: pointer; position: static; box-shadow: none; text-align: left; font-size: 1em;">
                    <i class="material-symbols-outlined" style="vertical-align: middle; font-size: 18px;" aria-hidden="true">link</i>
                    <span style="vertical-align: middle; margin-left: 8px; font-weight: 400; font-size: 1em;">
                        Draw ownership chain
                    </span>
                </button>
            </div>
        `;
    }

    

    // 2. Proprietors and Beneficial Owners Section
    if (propertyItem.props && Array.isArray(propertyItem.props)) {
        html += '<hr class="section-divider">';
        
        propertyItem.props.forEach((prop, propIndex) => {

            html += `<div class="proprietor-block">`; // Group each proprietor and its BOs

            // First, build the string for all status badges for this proprietor
            let proprietorBadges = '';
            const isExcluded = !!(prop && prop.excluded);
            
            // Add the existing badge for a reported failure, if applicable (suppressed when excluded)
            if (!isExcluded) {
                proprietorBadges += createStatusBadge(prop.BO_failure);
            }

            // If the proprietor failed to register, show only that badge and suppress others
            const proprietorNotRegistered = (prop && !prop.excluded && (prop.BO_failure === 'No company found' || prop.status === 'proprietor_not_found'));
            if (!proprietorNotRegistered && !isExcluded) {
                if (prop.trustee) proprietorBadges += createStatusBadge('trustee');

                // Add a badge if no beneficial owners are listed
                if (!prop.BOs || prop.BOs.length === 0) {
                    proprietorBadges += `<div class="status-badge status-orange">No beneficial owner identified</div>`;
                }

                // Add a badge if the address is flagged as wrong
                if (prop.wrong_address) {
                    let badgeText = 'Wrong address';
                    if (prop.country_incorporated) {
                        badgeText += ` - should be ${toTitleCase(prop.country_incorporated)}`;
                    }
                    proprietorBadges += `<div class="status-badge status-red">${escapeHtml(badgeText)}</div>`;
                }
            }
            // Determine the correct proprietor label based on the count
            const proprietorLabel = propertyItem.props.length > 1 ? `Proprietor ${propIndex + 1}` : 'Proprietor';

            // Add Proprietor info, and include the generated badges
            const proprietorMapIcon = createFlyThereIcon(
                prop.lat,
                prop.lon,
                `Proprietor: ${prop.name}`,
                propertyItem.property_title_number,
                markerId,
                (typeof prop.status !== 'undefined' ? prop.status : null) // use proprietor status if present
            );
            const proprietorGoogleIcon = createGoogleSearchIcon(prop.name);
            const proprietorgoogleMapIcon = createGoogleMapIcon(prop.address);
            const proprietorCountBadge = createOwnershipCountBadge(prop.name, 'proprietor', prop.count); 


            html += `<div class="info-item">
                <div class="info-item-content">
                    <div class="entity-title">
                        <b>${proprietorLabel}:</b>
                        <span class="entity-name">
                                <span class="copyable-text" onclick="copyTextOnClick(event)" data-tooltip-infopanel="Click to copy name">${escapeHtml(prop.name)}</span>
                                ${proprietorCountBadge} 
                                ${createCompaniesHouseSearchIcon(prop.name, prop.ch_number)}
                                ${proprietorMapIcon}
                                ${proprietorGoogleIcon}
                                ${proprietorgoogleMapIcon}
                        </span>
                    </div>
                    <div class="address-text copyable-text" onclick="copyTextOnClick(event)" data-copy-text='${escAttrSingle(prop.address || "No address")}' data-tooltip-infopanel='${escAttrSingle(`"${prop.address || 'No address'}": copy to clipboard`)}'>${escapeHtml(prop.address || "No address")}</div>
                    ${proprietorBadges}
                </div>
            </div>`;

            // Loop through and add Beneficial Owners for this proprietor
            if (prop.BOs && prop.BOs.length > 0) {
                prop.BOs.forEach((bo, boIndex) => {
                    
                    // Determine the correct beneficial owner label based on the count for this proprietor
                    const boLabel = prop.BOs.length > 1 ? `Beneficial owner ${boIndex + 1}` : 'Beneficial owner';

                    // --- Generate control icons ---
                    let controlIconsHtml = '';
                    if (bo.control && Array.isArray(bo.control)) {
                        bo.control.forEach(controlCode => {
                            const controlInfo = getControlInfo(controlCode);
                            if (controlInfo) {
                                const formattedKind = (bo.kind || '')
                                    .replace(/-/g, ' ')
                                    .replace(/^\w/, c => c.toUpperCase());
                                const tooltipText = `${formattedKind}\n${controlInfo.description}`;
                            
                                controlIconsHtml += `
                                    <i class="material-symbols-outlined control-icon" aria-hidden="true"
                                        data-tooltip-infopanel="${escapeHtmlAttribute(tooltipText)}">
                                        ${controlInfo.icon}
                                    </i>`;
                            }
                        });
                    }
                    const controlIconsContainer = controlIconsHtml ? `<div class="control-icons">${controlIconsHtml}</div>` : '';

                    // html generation (including the control icons)
                    const boMapIcon = createFlyThereIcon(
                        bo.lat,
                        bo.lon,
                        `BO: ${bo.name}`,
                        propertyItem.property_title_number,
                        markerId
                    );
                    const boGoogleIcon = createGoogleSearchIcon(bo.name);
                    const boGoogleMapIcon = createGoogleMapIcon(bo.address);
                    const boCountBadge = createOwnershipCountBadge(bo.name, 'beneficiary', bo.count);

                    html += `
                    <div class="info-item bo-item">
                        <div class="info-item-content">
                            <div class="entity-title">
                                <b>${boLabel}:</b>
                                <span class="entity-name">
                                        <span class="copyable-text" onclick="copyTextOnClick(event)" data-tooltip-infopanel="Click to copy name">${escapeHtml(bo.name)}</span>
                                        ${boCountBadge} 
                                        ${boMapIcon}
                                        ${boGoogleIcon}
                                        ${boGoogleMapIcon}
                                </span>
                            </div>
                            ${controlIconsContainer}
                            <div class="address-text copyable-text" onclick="copyTextOnClick(event)" data-copy-text='${escAttrSingle(bo.address || "No address")}' data-tooltip-infopanel='${escAttrSingle(`"${bo.address || 'No address'}": copy to clipboard`)}'>${escapeHtml(bo.address || "No address")}</div>
                            ${(!prop.excluded && bo.reg_status === 'suspect' && !prop.has_individual_non_trustee) ? createStatusBadge('suspect') : ''}${(!prop.excluded && bo.sanctioned) ? createStatusBadge('sanctioned') : ''}
                        </div>
                    </div>`;
                });
            }
            html += `</div>`; // End proprietor-block
        });
    }
    
    // 3. Property-level footer badge for trustee-only properties
    // Show a blue badge at the bottom when the property is trustee-only.
    // Support both legacy 'teal' and new 'blue' category names.
    try {
        const propCategory = getMarkerColor(propertyItem.status);
        const normStatus = (propertyItem.status || '').toString().trim().toLowerCase();
        if (propCategory === 'teal' || normStatus === 'blue') {
            html += `
                <div class="info-item">
                    <div class="info-item-content">
                        ${createStatusBadge('blue')}
                    </div>
                </div>
            `;
        }
    } catch (e) {
        // no-op: if status missing, skip footer badge
    }
    
        return html;
}




// Legacy close button removed in favor of #info-close wired via attachInfoBarHandlersOnce().
// No action needed here.


// Draw connections when "Show connections" button in the info panel is clicked
$(document).on("click", ".show-link", function(e) {
    L.DomEvent.stopPropagation(e); // Good practice to stop the click from propagating

    const markerId = $(this).data("markerid");
    const clickedMarker = findMarkerById(markerId);

    if (!clickedMarker || !clickedMarker.propertyItem) {
        // console.warn("Could not find marker or marker is missing property data for ID:", markerId);
        return;
    }

    // --- Hide all other markers ---
    enterFocusMode();
    
    // Determine the underlying property object regardless of marker type
    const propertyObj = (clickedMarker.propertyItem && clickedMarker.propertyItem.property)
        ? clickedMarker.propertyItem.property
        : clickedMarker.propertyItem;

    if (!propertyObj || !propertyObj.property_title_number) return;

    linkedItemIds.push(propertyObj.property_title_number);  // save for sharing

    // Pass the marker itself to the drawing function
    const linkBounds = drawLinksForProperty(propertyObj, clickedMarker);

    // Zoom to fit all the new links
    if (linkBounds && linkBounds.isValid()) {
        map.fitBounds(linkBounds.pad(0.1));
    }
    
    
});

// Clear links button
$(document).on("click", "#clearButton", function() {
    triggerHapticFeedback(this);
    triggerHapticFeedback(document.getElementById('floatingClearButton'));

    // Remove all polylines.
    linkLayers.forEach(function(link) {
      map.removeLayer(link);
    });
    linkLayers = [];

    // Remove all extra (giant) markers.
    giantMarkers.forEach(function(marker) {
      map.removeLayer(marker);
    });
    giantMarkers = [];

     // Also clear temporary pan-to markers
    tempMarkers.forEach(function(marker) {
        map.removeLayer(marker);
    });
    tempMarkers = [];

    // 2. Exit the focus mode UI and restore layers from the legend
    exitFocusMode();

    // Reset the list of items with links drawn for sharing
    linkedItemIds = [];

    hideInfoPanel();
    dismissHamburger(); // Close the menu
    

});



// Draw Selection button and logic
$(document).on("click", "#selectAreaButton", function() {
    // Create and add Draw Control
    let drawControl = new L.Control.Draw({
        draw: {
            polyline: false, polygon: false, circle: false, marker: false, circlemarker: false,
            rectangle: { shapeOptions: { color: 'blue' } }
        },
        edit: { featureGroup: new L.FeatureGroup() }
    });
    map.addControl(drawControl);

    // Activate rectangle drawing tool
    new L.Draw.Rectangle(map, drawControl.options.draw.rectangle).enable();

    // Handle rectangle creation
    map.once(L.Draw.Event.CREATED, function(e) {
        map.removeControl(drawControl);
        if (drawnLayer && map.hasLayer(drawnLayer)) {
            map.removeLayer(drawnLayer);
        }
        drawnLayer = e.layer; 

        const bounds = e.layer.getBounds();

        // Determine which categories of markers are currently visible
        const activeCategories = new Set();
        document.querySelectorAll('.legend-item[data-active="true"]').forEach(item => {
            activeCategories.add(item.getAttribute('data-category'));
        });
        
        // Create a temporary array of all visible markers from the active layers
        let visibleMarkers = [];
        for (const cat of activeCategories) {
            if (modeLayers[currentMode]?.[cat]) {
                visibleMarkers.push(...modeLayers[currentMode][cat].getLayers());
            }
        }

        // Filter the visible markers to find only those within the drawn bounds
        const selectedMarkers = visibleMarkers.filter(marker =>
            bounds.contains(marker.getLatLng())
        );
        
        // Call the new select function to handle the results
        select(selectedMarkers);
    });
});

// Legend minimize/maximize toggle handler
const legendMinToggle = document.getElementById('legendMinToggle');
if (legendMinToggle) {
  legendMinToggle.addEventListener('click', function() {
    const legendBox = document.getElementById('legendBox');
    const minimized = legendBox.classList.toggle('minimized');
    const icon = this.querySelector('i.material-symbols-outlined');
    if (icon) icon.textContent = minimized ? 'add' : 'remove';
  });
}


// On initial load, wire up UI controls and basic behaviors
document.addEventListener("DOMContentLoaded", function() {

    maybeShowIosAddToHomePrompt();
    
    // Update the footer with copyright information.
    updateFooterVersion();

    document.getElementById('reRunTutorialButton').addEventListener('click', function() {
        setupAndStartTutorial();
        dismissHamburger();
     });

     document.getElementById('showValuableButton').addEventListener('click', toggleValuablePropertiesPanel);
    
    document.getElementById('valuable-properties-close').addEventListener('click', () => {
        document.getElementById('valuable-properties-panel').classList.add('hidden');
    });

        

    makeElementDraggable('info-panel');
    // Avoid dragging on mobile to prevent accidental drags/floating UI
    if (!isMobile()) {
        makeElementDraggable('legendBox');
        makeElementDraggable('mapControls');
        makeElementDraggable('navigationSearchContainer');
    } else {
        // console.log("On desktop")
    }
    makeElementDraggable('valuable-properties-panel', '#valuable-properties-bar');

    // Enable scroll for search results container
    L.DomEvent.disableScrollPropagation(
        document.getElementById('searchResults')
    );
    L.DomEvent.disableScrollPropagation(
        document.getElementById('placeSearchResults')
    );
    

  });

// Move controls between on‑map (desktop) and off‑canvas (mobile) containers
/**
 * Move controls between on‑map (desktop) and off‑canvas (mobile) containers.
 * @returns {void}
 */
function updateControlsPlacement() {
    const mobileContainer = document.getElementById('mobileControlsContainer');
    const desktopContainer = document.body;
    const mapControls = document.getElementById('mapControls');
    const legendBox = document.getElementById('legendBox');
    const mapDiv = document.getElementById('map');

    // Reference the new navigation search container
    const navSearchContainer = document.getElementById('navigationSearchContainer');

    if (isMobile()) {
        if (mobileContainer) {
            // Move desktop controls into the off-canvas menu
            if (!mobileContainer.contains(mapControls)) mobileContainer.appendChild(mapControls);
            if (!mobileContainer.contains(legendBox)) mobileContainer.appendChild(legendBox);

            // Move the navigation search bar into the off‑canvas menu on mobile
            if (navSearchContainer) {
                // Ensure it's visible and styled for offcanvas
                navSearchContainer.style.display = 'block';
                navSearchContainer.style.position = 'static';
                navSearchContainer.style.top = '';
                navSearchContainer.style.right = '';
                navSearchContainer.style.width = '100%';
                if (!mobileContainer.contains(navSearchContainer)) mobileContainer.insertBefore(navSearchContainer, mapControls);
            }
        }
    } else {
        // On desktop, move controls back to the main body
        if (mobileContainer && mobileContainer.contains(mapControls)) {
            desktopContainer.insertBefore(legendBox, mapDiv);
            desktopContainer.insertBefore(mapControls, mapDiv);
        }

        // Move the navigation search bar back to its desktop position
        if (navSearchContainer && mobileContainer.contains(navSearchContainer)) {
            // Reset styles so desktop CSS takes effect (floating top-right)
            navSearchContainer.style.display = 'block';
            navSearchContainer.style.position = '';
            navSearchContainer.style.top = '';
            navSearchContainer.style.right = '';
            navSearchContainer.style.width = '';
            desktopContainer.insertBefore(navSearchContainer, mapDiv);
        }
    }
}


// Hide the off‑canvas menu on mobile (no‑op on desktop)
/**
 * Hide the mobile off‑canvas menu if open. No‑op on desktop.
 * @returns {void}
 */
function dismissHamburger() {
    // Check if we are on a mobile screen, otherwise do nothing
    if (!isMobile()) {
        return;
    }
    const offcanvasEl = document.getElementById('mobileControlsOffcanvas');
    if (offcanvasEl) {
        // Use the Bootstrap JavaScript API to get the instance and hide it
        const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl);
        if (bsOffcanvas) {
            bsOffcanvas.hide();
        }
    }
}


updateControlsPlacement();
window.addEventListener('resize', updateControlsPlacement);
window.addEventListener('orientationchange', updateControlsPlacement);
scheduleInvalidateSize(); // Initial call

// Offcanvas listeners (ignore legend clicks so menu stays open)
let offcanvasJustClosed = false;
// Create an aria-live region for announcing result counts
document.addEventListener('DOMContentLoaded', () => {
  let live = document.getElementById('liveRegion');
  if (!live) {
    live = document.createElement('div');
    live.id = 'liveRegion';
    live.setAttribute('aria-live', 'polite');
    live.style.position = 'absolute';
    live.style.left = '-9999px';
    live.style.width = '1px';
    live.style.height = '1px';
    live.style.overflow = 'hidden';
    document.body.appendChild(live);
  }
});
window.addEventListener('load', function() {
    var offcanvas = document.getElementById('mobileControlsOffcanvas');
    if (offcanvas) {
        offcanvas.addEventListener('show.bs.offcanvas', function() {
            // Disable map interactions while menu open
            map.dragging.disable();
            map.scrollWheelZoom.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.boxZoom.disable();
            map.keyboard.disable();
        });
        offcanvas.addEventListener('hidden.bs.offcanvas', function() {
            // Briefly flag that the offcanvas just closed, so outside click handlers don't clear results
            offcanvasJustClosed = true;
            setTimeout(() => { offcanvasJustClosed = false; }, 400);
            // Re-enable map interactions
            map.dragging.enable();
            map.scrollWheelZoom.enable();
            map.touchZoom.enable();
            map.doubleClickZoom.enable();
            map.boxZoom.enable();
            map.keyboard.enable();
            // Invalidate map size in case layout changed
            scheduleInvalidateSize();
        });
        // Optional: keep the offcanvas open on internal clicks unless they target a dismiss element
        offcanvas.addEventListener('click', function(e) {
            // No-op; bootstrap handles this. We avoid custom dismiss logic.
        });
    }

    // Final size invalidation on load
    scheduleInvalidateSize();

    // Overlay helpers
    function showOverlay(el){ if (!el) return; el.dataset.opened = String(Date.now()); el.classList.add('show'); el.classList.remove('hidden'); }
    function hideOverlay(el){ if (!el) return; el.classList.remove('show'); el.classList.add('hidden'); }
    function getTopVisibleOverlay(){
      const ids = ['help-overlay','kb-nudge-overlay','nav-nudge-overlay'];
      const vis = ids.map(id=>document.getElementById(id)).filter(el=>el && el.classList.contains('show'));
      if (vis.length === 0) return null;
      vis.sort((a,b)=> (parseInt(b.dataset.opened||'0',10) - parseInt(a.dataset.opened||'0',10)) );
      return vis[0];
    }

    // Keyboard help overlay toggle with '?' key
    document.addEventListener('keydown', function(e){
      // Ignore when typing in editable fields; allow normal '?' input
      const t = e.target;
      const isEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (isEditable) return;
      if (e.key === '?') {
        const o = document.getElementById('help-overlay');
        if (!o) return;
        if (o.classList.contains('show')) { hideOverlay(o); }
        else { showOverlay(o); }
      }
    });

    const helpClose = document.getElementById('help-close');
    if (helpClose) helpClose.addEventListener('click', () => {
      const o = document.getElementById('help-overlay');
      hideOverlay(o);
    });
    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay) helpOverlay.addEventListener('click', (e)=>{ if (e.target === helpOverlay) hideOverlay(helpOverlay); });
});


  

// Clear search results when clicking outside the search boxes
// Do not auto-clear results on outside clicks anymore; users clear explicitly.
document.addEventListener('click', function(e) {
    if (offcanvasJustClosed) return;
    // Intentionally no automatic clearing here.
});

// Clear search results with Escape key for convenience
document.addEventListener('keydown', function(e) {
  const panel = document.getElementById('info-panel');
  const isPanelOpen = panel && !panel.classList.contains('hidden');
  // Do not hijack arrow keys when typing in inputs/textarea/contenteditable
  const t = e.target;
  const isEditableTarget = (
    (t && (t.tagName === 'INPUT')) ||
    (t && (t.tagName === 'TEXTAREA')) ||
    (t && (t.tagName === 'SELECT')) ||
    (t && t.isContentEditable)
  );
  // If any overlay is visible, close the most recent on Escape
  if (e.key === 'Escape') {
    try {
      const ids = ['help-overlay','kb-nudge-overlay','nav-nudge-overlay'];
      const overlays = ids.map(id=>document.getElementById(id)).filter(el=>el && el.classList.contains('show'));
      if (overlays.length > 0) {
        overlays.sort((a,b)=> (parseInt(b.dataset.opened||'0',10) - parseInt(a.dataset.opened||'0',10)) );
        const top = overlays[0];
        top.classList.remove('show'); top.classList.add('hidden');
        return; // handled Escape
      }
    } catch {}
  }
  if (e.key === 'Escape') {
    // Close any open search results
    const sr = document.getElementById('searchResults');
    if (sr) { sr.innerHTML = ''; sr.style.display = 'none'; }
    const pr = document.getElementById('placeSearchResults');
    if (pr) { pr.innerHTML = ''; pr.style.display = 'none'; }
    // Close info panel if open, otherwise trigger Clear if nothing else visible
    if (isPanelOpen) {
        hideInfoPanel();
    } else {
        const srVisible = sr && sr.style.display !== 'none' && sr.innerHTML.trim() !== '';
        const prVisible = pr && pr.style.display !== 'none' && pr.innerHTML.trim() !== '';
        if (!srVisible && !prVisible) {
            const floating = document.getElementById('floatingClearButton');
            const clearCtl = document.getElementById('clearButton');
            if (floating && floating.style.display === 'block') {
                floating.click();
            } else if (clearCtl) {
                clearCtl.click();
            }
        }
    }
  } else if (isPanelOpen && !isEditableTarget && (e.key === 'ArrowLeft' || e.key === 'Left')) {
    e.preventDefault();
    goBack();
  } else if (isPanelOpen && !isEditableTarget && (e.key === 'ArrowRight' || e.key === 'Right')) {
    e.preventDefault();
    goForward();
  }
});

// Nudge handlers
window.addEventListener('load', function(){
  const kbClose = document.getElementById('kb-nudge-close');
  if (kbClose) kbClose.addEventListener('click', () => {
    const dont = document.getElementById('kb-nudge-dont');
    if (dont && dont.checked) setCookie('kbNudgeDismissed','true',365);
    const o = document.getElementById('kb-nudge-overlay');
    o.classList.remove('show'); o.classList.add('hidden');
  });
  const navClose = document.getElementById('nav-nudge-close');
  if (navClose) navClose.addEventListener('click', () => {
    const dont = document.getElementById('nav-nudge-dont');
    if (dont && dont.checked) setCookie('navNudgeDismissed','true',365);
    const o = document.getElementById('nav-nudge-overlay');
    o.classList.remove('show'); o.classList.add('hidden');
  });

  // Dismiss nudges when clicking outside the content
  const kbOverlay = document.getElementById('kb-nudge-overlay');
  if (kbOverlay) kbOverlay.addEventListener('click', (e)=>{
    if (e.target === kbOverlay) { kbOverlay.classList.remove('show'); kbOverlay.classList.add('hidden'); }
  });
  const navOverlay = document.getElementById('nav-nudge-overlay');
  if (navOverlay) navOverlay.addEventListener('click', (e)=>{
    if (e.target === navOverlay) { navOverlay.classList.remove('show'); navOverlay.classList.add('hidden'); }
  });
});


// --- Event handlers for the custom info-panel tooltip ---
const infoPanel = document.getElementById('info-panel');

infoPanel.addEventListener('click', (e) => {
    // Only run this logic on mobile devices
    if (!isMobile()) return;

    // Check if the clicked element or its parent is a control icon
    const target = e.target.closest('.control-icon');
    
    if (target) {
        // Stop the click from bubbling up and closing the panel
        e.stopPropagation(); 
        
        // Get the tooltip text from the data attribute
        const tooltipText = target.getAttribute('data-tooltip-infopanel');
        
        // Call the existing function to show the tooltip
        showMobileTooltip(target, tooltipText);
    }
});

infoPanel.addEventListener('mouseover', (e) => {

    // disable the function on mobile
    if (isMobile()) return;

    // Find the closest parent with our data-attribute
    const target = e.target.closest('[data-tooltip-infopanel]');
    if (target) {
        const tooltipText = target.getAttribute('data-tooltip-infopanel');
        const rect = target.getBoundingClientRect();

        // Set text and show the tooltip so we can measure its size
        infoTooltip.textContent = tooltipText;
        infoTooltip.style.display = 'block';
        infoTooltip.style.opacity = 1;

        // Position it 8px above the button, centered horizontally
        const topPos = rect.top - infoTooltip.offsetHeight - 8;
        const leftPos = rect.left + (target.offsetWidth / 2) - (infoTooltip.offsetWidth / 2);

        infoTooltip.style.top = `${topPos}px`;
        infoTooltip.style.left = `${leftPos}px`;
    }
});

infoPanel.addEventListener('mouseout', (e) => {
    // Hide the tooltip when the mouse leaves the button
    const target = e.target.closest('[data-tooltip-infopanel]');
    if (target) {
        infoTooltip.style.opacity = 0;
        // Use a short delay to allow the fade-out transition to complete
        setTimeout(() => {
            if (infoTooltip.style.opacity === '0') { // Check if it's still meant to be hidden
                infoTooltip.style.display = 'none';
            }
        }, 200);
    }
});

/**
 * Makes a given DOM element draggable via mouse or touch.
 * @param {HTMLElement|string} elementOrId The element object or the ID of the element to make draggable.
 * @param {string|null} [handleSelector=null] Optional. A CSS selector for a specific child element to act as the drag handle. If null, the entire element is the handle.
 */
/**
 * Make an element draggable by mouse/touch, optionally using a handle selector.
 * @param {HTMLElement|string} elementOrId Element or its ID.
 * @param {string|null} [handleSelector=null] Optional selector for a handle inside the element.
 * @returns {void}
 */
function makeElementDraggable(elementOrId, handleSelector = null) {
  const element = typeof elementOrId === 'string'
      ? document.getElementById(elementOrId)
      : elementOrId;
  if (!element) return;

  const handle = handleSelector ? element.querySelector(handleSelector) : element;
  if (!handle) return;

  handle.style.cursor = 'grab';

  let isDragging = false;
  let offsetX, offsetY;
  let fixedCBRect = { left: 0, top: 0 }; // containing-block rect for fixed elements

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

  function dragStart(e) {
    const ignored = ['A','BUTTON','INPUT','I'];
    if (ignored.includes(e.target.tagName) || e.target.closest('a,button,input')) return;

    isDragging = true;
    handle.style.cursor = 'grabbing';
    element.style.zIndex = 4001;

    const clientX = e.clientX ?? e.touches?.[0].clientX;
    const clientY = e.clientY ?? e.touches?.[0].clientY;

    const rect = element.getBoundingClientRect();
    fixedCBRect = getFixedContainingBlockRect(element);

    // Switch to fixed; position relative to the *transformed ancestor*, not the viewport
    element.style.position = 'fixed';
    element.style.transform = 'none';
    element.style.left = `${rect.left - fixedCBRect.left}px`;
    element.style.top  = `${rect.top  - fixedCBRect.top }px`;

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

    const clientX = e.clientX ?? e.touches?.[0].clientX;
    const clientY = e.clientY ?? e.touches?.[0].clientY;

    element.style.left = `${clientX - fixedCBRect.left - offsetX}px`;
    element.style.top  = `${clientY - fixedCBRect.top  - offsetY}px`;
  }

  function dragEnd() {
    isDragging = false;
    handle.style.cursor = 'grab';
    element.style.zIndex = '';
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('touchmove', dragMove);
  }

  handle.addEventListener('mousedown', dragStart);
  handle.addEventListener('touchstart', dragStart);
}


/**
 * Handles the processing of markers selected by the user via the draw tool.
 * It counts unique properties, displays a status message, and draws links for
 * a limited number of the selected properties.
 *
 * @param {L.Marker[]} selectedMarkers - An array of marker objects within the selection.
 */
/**
 * Handle selection of markers (e.g., from a drawn area) and update UI state.
 * @param {L.Marker[]} selectedMarkers The list of selected markers.
 * @returns {void}
 */
function select(selectedMarkers) {
    // 1. First, clear any links, giant markers, or info panels from previous actions.
    linkLayers.forEach(link => map.removeLayer(link));
    linkLayers = [];
    giantMarkers.forEach(marker => map.removeLayer(marker));
    giantMarkers = [];
    hideInfoPanel();

    // 2. Get a unique list of properties from the selected markers.
    // This prevents drawing the same links multiple times if several markers for one property are selected.
    const uniquePropertyItems = new Map();
    selectedMarkers.forEach(marker => {
        if (marker.propertyItem) {
            uniquePropertyItems.set(marker.propertyItem.property_title_number, marker.propertyItem);
        }
    });

    const selectedCount = uniquePropertyItems.size;
    if (selectedCount === 0) return; // Exit if nothing was selected

    // 3. Prepare the status message based on the current mode and selection count.
    const modeNameMap = {
        properties: 'properties',
        proprietors: 'proprietors',
        beneficial_owners: 'beneficial owners'
    };
    const selectionType = modeNameMap[currentMode] || 'items'; // Fallback to 'items'
    let message = `${selectedCount} ${selectionType} in the selected area`;


    // 4. Display the message at the top of the screen.
    const messageDiv = document.createElement("div");
    messageDiv.innerHTML = message;
    Object.assign(messageDiv.style, {
        position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255, 255, 0, 0.9)', padding: '10px', borderRadius: '5px',
        zIndex: 9999, border: '1px solid black', textAlign: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
    });
    document.body.appendChild(messageDiv);
    setTimeout(() => { document.body.removeChild(messageDiv); }, 4000); // Message disappears after 4 seconds

    dismissHamburger(); // Close the menu
}


/**
 * Pans/zooms the map and adds a temporary, clickable highlight marker.
 * @param {number} lat - The latitude.
 * @param {number} lon - The longitude.
 * @param {string} color - The color for the temporary marker.
 * @param {string} title - The title for the marker's tooltip.
 * @param {Event} event - The initial click event.
 * @param {string} propertyTitleNumber - The unique title number of the original property.
 * @param {string|number} originalMarkerId - The ID of the marker that opened the info-panel.
 */
/**
 * Pan/zoom to a location and optionally create a temporary marker.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {string} color Marker color name.
 * @param {string} title Marker tooltip/title.
 * @param {MouseEvent} event The triggering event.
 * @param {string} propertyTitleNumber Property title number.
 * @param {number} originalMarkerId Source marker ID.
 * @param {number} [zoomLevel] Optional zoom override.
 * @returns {void}
 */
function panToLocation(lat, lon, color, title, event, propertyTitleNumber, originalMarkerId, zoomLevel) {
    if (event) {
        event.stopPropagation(); // Prevents the panel from closing
    }
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
        // Clear any old temporary markers
        tempMarkers.forEach(m => map.removeLayer(m));
        tempMarkers = [];

        // Pan the map
        const z = (typeof zoomLevel === 'number' && !isNaN(zoomLevel)) ? zoomLevel : 12;
        map.flyTo([latNum, lonNum], z, { duration: getFlyDuration() });

        // Create the new temporary marker
        const tempMarker = L.marker([latNum, lonNum], {
            icon: createBigIcon(color),
            title: title,
            zIndexOffset: 1000
        }).addTo(map);

        // Make the temporary marker clickable
        tempMarker.on('click', function(e) {
            L.DomEvent.stopPropagation(e); // Prevent map click from closing the panel

            // Find the original full property item from the master data list
            const propertyItem = allPropertiesData.find(item => item.property_title_number === propertyTitleNumber);

            if (propertyItem) {
                // Get the click position to place the panel correctly
                const point = map.latLngToContainerPoint(e.latlng);
                // Re-show the info panel for the original property
                showInfoPanel(propertyItem, originalMarkerId, point);
            }
        });

        // Store the new marker so it can be cleared later
        tempMarkers.push(tempMarker);
    }
}

/**
 * Handles the click event for a property title number link.
 * Copies the title number to the clipboard and opens the Land Registry search page.
 * @param {string} titleNumber - The property title number to be copied.
 */
function searchLandRegistry(titleNumber) {
    // Stop the event from bubbling up and potentially closing the info panel
    event.stopPropagation();

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

    }).catch(err => {
        // console.error('Failed to copy title to clipboard: ', err);
    });

    // Open the Land Registry search page in a new tab
    const landRegistryUrl = 'https://search-property-information.service.gov.uk/search/search-by-title-number';
    window.open(landRegistryUrl, '_blank');
}


/**
 * Copies the text content of the clicked element to the clipboard.
 * @param {MouseEvent} event - The click event.
 */

/**
 * Copy inner text of an element to clipboard when clicked.
 * @param {MouseEvent} event Click event from a copyable element.
 * @returns {void}
 */
function copyTextOnClick(event) {
    event.stopPropagation();
    const element = event.currentTarget;
    const textToCopy = (element.getAttribute('data-copy-text') || element.innerText).trim();

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

    }).catch(err => {
        // --- Failure Notification ---
        // console.error('Failed to copy text: ', err);
        alert(`Could not copy text.\n\nThis can happen on non-secure (HTTP) pages or if you deny clipboard permissions.`);
    });
}


/**
 * Create clear buttons for search inputs (mobile-friendly) and wire events.
 * @returns {void}
 */
function setupSearchClearButtons() {
    // Detect desktop Safari (which already shows a native clear icon for type=search)
    const ua = navigator.userAgent || "";
    const isDesktopSafari = (
        /Safari/i.test(ua) &&                    // has Safari in UA
        !/Chrome|CriOS|Edg|OPR|Brave/i.test(ua) && // not Chromium-based or Opera/Edge/Brave
        /Mac/i.test(navigator.platform || "")     // running on macOS (desktop)
    );

    if (isDesktopSafari) {
        // Rely on Safari's native clear (cancel) button; don't add a custom one
        return;
    }

    // Detect desktop Chrome which also provides a native clear control
    const isDesktopChrome = (
        /Chrome/i.test(ua) &&                    // Chrome engine
        !/CriOS|Mobile|Android|iPhone|iPad|iPod/i.test(ua) // not iOS Chrome or mobile
    );

    if (isDesktopChrome) {
        // Use Chrome's built-in clear for type=search on desktop
        return;
    }

    ['entitySearchContainer', 'placeSearchContainer'].forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;

        const input = container.querySelector('input[type="search"]');
        const results = container.querySelector('.results');

        // Create the 'x' button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'search-clear-btn';
        clearBtn.innerHTML = '&times;';
        container.querySelector('.input-group').appendChild(clearBtn);
        
        // Show/hide button based on input (use 'input' event for better iOS support)
        const updateVisibility = () => { clearBtn.style.display = input.value ? 'block' : 'none'; };
        input.addEventListener('input', updateVisibility);
        updateVisibility(); // set initial state

        // Clear input and results on click
        clearBtn.addEventListener('click', () => {
            input.value = '';
            input.focus();
            clearBtn.style.display = 'none';
            if (results) {
                results.innerHTML = '';
                results.style.display = 'none';
            }
        });
        // No extra footer; clearing handled via header inline badge
    });
}

// Helper: tuned fly duration so search-driven moves feel deliberate without dragging
function getFlyDuration() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return 0.2;
  return isMobile() ? 1.2 : 1.6;
}


// Smart tooltip positioning
document.body.addEventListener('mouseover', function(e) {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    // Estimate tooltip height; adjust if needed
    const tooltipHeight = 40; 

    // If there's not enough space on top, add a class to flip it
    if (rect.top < tooltipHeight) {
        target.classList.add('tooltip-on-bottom');
    }
});

document.body.addEventListener('mouseout', function(e) {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
        // Clean up the class when the mouse leaves
        target.classList.remove('tooltip-on-bottom');
    }
});


floatingClearButton.addEventListener('click', () => {
    triggerHapticFeedback(floatingClearButton);
    // This button simply triggers a click on the original clear button
    const originalClear = document.getElementById('clearButton');
    if (originalClear) {
        triggerHapticFeedback(originalClear);
        originalClear.click();
    }
});

// Exit focus mode when a user clicks into a search box.
['searchInput', 'placeSearchInput'].forEach(id => {
    document.getElementById(id).addEventListener('focus', () => {
        // Check if we are in focus mode.
        // If the floating clear button is visible, we're in focus mode.
        const clearButton = document.getElementById('floatingClearButton');
        if (clearButton && clearButton.style.display === 'block') {
            clearButton.click();
        }

        // On mobile: scroll the focused input into view within the offcanvas body
        if (isMobile()) {
            const offBody = document.querySelector('#mobileControlsOffcanvas .offcanvas-body');
            const el = document.getElementById(id);
            if (offBody && el) {
                const container = el.closest('.search-container') || el;
                const containerTop = container.offsetTop;
                setTimeout(() => {
                    offBody.scrollTo({ top: Math.max(0, containerTop - 10), behavior: 'smooth' });
                }, 50);
            }
        }
    });
});

function enterFocusMode() {

    focusModeState.mode = currentMode;

    // Hide all currently visible marker layers
    for (const cat in modeLayers[currentMode]) {
        const layer = modeLayers[currentMode][cat];
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    }
    // Show the floating clear button
    document.getElementById('floatingClearButton').style.display = 'block';
}

function exitFocusMode() {
    // Hide the floating clear button
    document.getElementById('floatingClearButton').style.display = 'none';

    // Restore layers based on the legend's state and the SAVED mode
    document.querySelectorAll('.legend-item').forEach(item => {
        const category = item.getAttribute('data-category');
        const isActive = item.getAttribute('data-active') === 'true';
        // USE THE SAVED MODE, NOT THE CURRENT ONE
        const layer = modeLayers[focusModeState.mode]?.[category];

        if (layer && isActive && !map.hasLayer(layer)) {
            map.addLayer(layer);
        }
    });
}

/* context menu stuff */

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
    }).catch(err => {
        // console.error('Failed to copy coordinates: ', err);
        alert('Could not copy coordinates.');
    });
}


// Show lat/lon on right click
map.on('contextmenu', function(e) {
    const lat = e.latlng.lat.toFixed(6);
    const lon = e.latlng.lng.toFixed(6);
    const zoom = map.getZoom();

    const content = `
        <div style="cursor: pointer;" onclick="copyCoordsToClipboard(${lat}, ${lon})">
             Lat: ${lat}
        </div>
        <div style="cursor: pointer;" onclick="copyCoordsToClipboard(${lat}, ${lon})">
             Lon: ${lon}
        </div>
        <div>Zoom: ${zoom}</div>
        <hr style="margin: 4px 0;">
        <div>
            <a href="https://www.google.com/maps?q=${lat},${lon}&z=${zoom}" target="_blank" rel="noopener noreferrer">
                View on Google Maps
            </a>
        </div>
    `;

    L.popup()
        .setLatLng(e.latlng)
        .setContent(content)
        .openOn(map);
});

/**
 * Builds the list of valuable properties (if not already built) and shows the panel.
 */
/**
 * Filters properties based on the active legend, builds the list, and shows the panel.
 */
function showValuablePropertiesPanel() {
    const listContainer = document.getElementById('valuable-properties-list');
    listContainer.innerHTML = ''; // Clear the list to rebuild it dynamically

    // Get the set of currently active legend categories
    const activeCategories = new Set();
    document.querySelectorAll('.legend-item[data-active="true"]').forEach(item => {
        activeCategories.add(item.getAttribute('data-category'));
    });

    // Filter the cached list of top properties
    const filteredProperties = topValuableProperties.filter(prop => {
        const category = getMarkerColor(prop.status);
        return activeCategories.has(category);
    });

    // Build the new list from the filtered data
    filteredProperties.forEach(prop => {
        const itemEl = document.createElement('div');
        itemEl.className = 'valuable-item';
        itemEl.dataset.title = prop.property_title_number;

        const address = prop.property_uk_address || 'No address';

        const category = getMarkerColor(prop.status);
        const color = categoryColours[category] || '#ccc';
        const truncatedAddress = address.length > 25 ? address.substring(0, 25) + '...' : address;

        const safeAddressTitle = escapeHtmlAttribute(toTitleCase(address));
        const safeTruncatedAddress = escapeHtml(toTitleCase(truncatedAddress));

        itemEl.innerHTML = `
            <div class="status-circle" style="background-color: ${color};"></div>
            <div class="price">£${formatPriceShort(prop.price_paid)}</div>
            <div class="address" title="${safeAddressTitle}">${safeTruncatedAddress}</div>
        `;
        itemEl.addEventListener('click', handleValuableItemClick);
        listContainer.appendChild(itemEl);
    });

    document.getElementById('valuable-properties-panel').classList.remove('hidden');
}

/**
 * Handles clicks on an item in the valuable properties list.
 * @param {MouseEvent} event The click event from the list item.
 */
function handleValuableItemClick(event) {
    const titleNumber = event.currentTarget.dataset.title;
    const marker = findMarkerByTitleNumber(titleNumber);

    if (marker) {

        // leave focus mode
        const clearButton = document.getElementById('floatingClearButton');
        if (clearButton && clearButton.style.display === 'block') {
            clearButton.click();

        }
        
        hideInfoPanel(); 
        map.flyTo(marker.getLatLng(), 18, {duration: getFlyDuration() });
        
        // Use 'moveend' event to show the info panel after the map has stopped moving
        map.once('moveend', () => {
            const point = map.latLngToContainerPoint(marker.getLatLng());
            showInfoPanel(marker.propertyItem, marker.myId, point);
        });
    } else {
        alert('Could not find this property on the map. It might be filtered out by the legend.');
    }
}

/**
 * Toggles the visibility of the valuable properties panel.
 */
function toggleValuablePropertiesPanel() {
    const panel = document.getElementById('valuable-properties-panel');
    if (panel.classList.contains('hidden')) {
        // If it's hidden, show it (this also rebuilds the list)
        showValuablePropertiesPanel();
    } else {
        // If it's visible, hide it
        panel.classList.add('hidden');
    }
}
