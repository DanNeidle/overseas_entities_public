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


// Major change in v0.94 - msgpack and local storage added
// minor change in v0.95 - optimised marker creation, startup improved, refactored
const APP_VERSION = "0.95";
const debug_limit = CONFIG.DEBUG.LIMIT;

const STATE = {
    DATA: {
        PROPERTIES_URL: "overseas_entities_properties.msgpack",
        PROPRIETORS_URL: "overseas_entities_proprietors.msgpack",
        DATASET_VERSION_LABEL: null,
        PROPERTIES: [],
        PROPRIETORS_BY_ID: null,
        CONTROL_TYPES_MAP: {},
        TOP_VALUABLE_PROPERTIES: [],
    },
    MODE: {
        CURRENT: "properties",
        FOCUS: { SAVED: "" },
    },
    MARKERS: {
        ACTIVE: null,
        TEMP: [],
        GIANT: [],
    },
    LAYERS: {
        LINKS: [],
        DRAWN: null,
    },
    LINKED_ITEM_IDS: [],
    SELECTION: {
        PANEL_TITLE: null,
        PANEL_ITEM: null,
        PROPERTY_TYPE: "all",
    },
    INDEX: {
        MARKERS: {
            properties: {},
            proprietors: {},
            beneficial_owners: {},
        },
    },
    STARTUP: {
        TIMING: null,
        PROPERTY_READY_PROMISE: null,
        PROPERTY_READY_RESOLVE: null,
        OWNER_READY_PROMISE: null,
        OWNER_READY_RESOLVE: null,
    },
    TUTORIAL: {
        DATA_READY: false,
        STARTED: false,
        START_RETRY_TIMER: null,
        PENDING: true,
    },
    URL: {
        SUPPRESS_UPDATES: false,
    },
};

const RUNTIME = {
    CATEGORY_COLORS: Object.fromEntries(
        Object.entries(CONFIG.COLORS.CATEGORY).map(([key, value]) => [key.toLowerCase(), value])
    ),
    ICON_HTML_CACHE: {},
    IS_EMBEDDED: (() => {
        try {
            return window.self !== window.top;
        } catch (err) {
            return true;
        }
    })(),
};

const App = {
    init: function() {
        console.log('Who secretly owns Britain?');
        console.log(`Webapp version ${APP_VERSION}, © Tax Policy Associates, 2026, HM Land Registry data Crown copyright 2026.`);

        // CACHE HTML STRINGS
        Object.keys(RUNTIME.CATEGORY_COLORS).forEach(category => {
            const color = RUNTIME.CATEGORY_COLORS[category];
            RUNTIME.ICON_HTML_CACHE[category] = `<div style="background-color:${color}; width:12px; height:12px; border-radius:50%; border:1px solid black;"></div>`;
        });

        if (RUNTIME.IS_EMBEDDED) {
            document.documentElement.classList.add('embedded');
        };

        STATE.DATA.PROPERTIES_URL = CONFIG.FILES.PROPERTIES_DEFAULT;
        STATE.DATA.PROPRIETORS_URL = CONFIG.FILES.PROPRIETORS_DEFAULT;
        STATE.SELECTION.PROPERTY_TYPE = CONFIG.PROPERTY_TYPES.DEFAULT;

        try {
            STATE.TUTORIAL.PENDING = getCookie(CONFIG.STORAGE.TUTORIAL_COOKIE_KEY) !== 'true';
        } catch (err) {
            STATE.TUTORIAL.PENDING = true;
        }

        // Initialize controllers and UI
        AppController.init();

        // Load data
        initializeDataLoad();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

