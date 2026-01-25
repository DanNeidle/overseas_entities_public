/**
 * map-service.js
 * Leaflet map setup and layer management.
 */



const DOM = {
    INFO_TOOLTIP: document.createElement("div"),
};

DOM.INFO_TOOLTIP.id = 'info-tooltip';
document.body.appendChild(DOM.INFO_TOOLTIP);

const CLUSTER_OPTIONS = {
    ...CONFIG.CLUSTERS.OPTIONS,
    iconCreateFunction: createCustomClusterIcon,
};

function createClusterGroup() {
    return L.markerClusterGroup(CLUSTER_OPTIONS);
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
        const color = RUNTIME.CATEGORY_COLORS[category] || 'gray';
        gradientString += `${color} ${currentPercent}% ${currentPercent + percent}%, `;
        currentPercent += percent;
    });

    gradientString = gradientString.slice(0, -2) + ')';

    const { ICON_SIZE_BREAKPOINTS, ICON_SIZE_PIXELS } = CONFIG.CLUSTERS;
    const size = count < ICON_SIZE_BREAKPOINTS.SMALL_MAX
        ? ICON_SIZE_PIXELS.SMALL
        : (count < ICON_SIZE_BREAKPOINTS.MEDIUM_MAX
            ? ICON_SIZE_PIXELS.MEDIUM
            : ICON_SIZE_PIXELS.LARGE);

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

// This will hold our pre-built marker cluster layers for each mode and category
const modeLayersAll = {
    properties: {
        green: createClusterGroup(),
        orange: createClusterGroup(),
        red: createClusterGroup(),
        grey: createClusterGroup(),
        purple: createClusterGroup(),
        blue: createClusterGroup(),
    },
    proprietors: {
        green: createClusterGroup(),
        orange: createClusterGroup(),
        red: createClusterGroup(),
        grey: createClusterGroup(),
        purple: createClusterGroup(),
        blue: createClusterGroup(),
    },
    beneficial_owners: {
        green: createClusterGroup(),
        orange: createClusterGroup(),
        red: createClusterGroup(),
        grey: createClusterGroup(),
        purple: createClusterGroup(),
        blue: createClusterGroup(),
    },
};

const modeLayersFiltered = {
    properties: {
        green: createClusterGroup(),
        orange: createClusterGroup(),
        red: createClusterGroup(),
        grey: createClusterGroup(),
        purple: createClusterGroup(),
        blue: createClusterGroup(),
    },
    proprietors: {
        green: createClusterGroup(),
        orange: createClusterGroup(),
        red: createClusterGroup(),
        grey: createClusterGroup(),
        purple: createClusterGroup(),
        blue: createClusterGroup(),
    },
    beneficial_owners: {
        green: createClusterGroup(),
        orange: createClusterGroup(),
        red: createClusterGroup(),
        grey: createClusterGroup(),
        purple: createClusterGroup(),
        blue: createClusterGroup(),
    },
};

let modeLayers = modeLayersAll;

// We still need a way to find any marker by its ID for popups
let allMarkersById = {};

// Initialize map at a global view initially
const worldBounds = L.latLngBounds(
    CONFIG.MAP.WORLD_BOUNDS.SOUTH_WEST,
    CONFIG.MAP.WORLD_BOUNDS.NORTH_EAST
);
const map = L.map('map', {
    center: CONFIG.MAP.INITIAL_VIEW.CENTER,
    zoom: CONFIG.MAP.INITIAL_VIEW.ZOOM,
    minZoom: CONFIG.MAP.MIN_ZOOM,
    zoomControl: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1.0,
    attributionControl: false
});

// Pane for property highlight rings so they sit above markers.
map.createPane('property-highlight-pane');
map.getPane('property-highlight-pane').style.zIndex = CONFIG.MAP.PANE_ZINDEX.PROPERTY_HIGHLIGHT;

L.tileLayer(CONFIG.MAP.TILE_LAYER_URL, CONFIG.MAP.TILE_LAYER_OPTIONS).addTo(map);

const MapService = {
    map,
    modeLayersAll,
    modeLayersFiltered,
    modeLayers,
    init() {
        return this.map;
    },
    setModeLayers(nextLayers) {
        modeLayers = nextLayers;
        this.modeLayers = nextLayers;
    },
    panTo(lat, lon, zoom) {
        if (!this.map) return;
        const nextZoom = Number.isFinite(zoom) ? zoom : this.map.getZoom();
        this.map.setView([lat, lon], nextZoom);
    },
    addMarker(lat, lon, options = {}) {
        return L.marker([lat, lon], options);
    },
    getLayerGroup(category, mode = STATE.MODE.CURRENT) {
        return modeLayers?.[mode]?.[category] || null;
    },
    isLayerCategoryVisible(category, mode = STATE.MODE.CURRENT) {
        const layerGroup = this.getLayerGroup(category, mode);
        return !!(layerGroup && this.map && this.map.hasLayer(layerGroup));
    },
    showLayerCategory(category, mode = STATE.MODE.CURRENT) {
        const layerGroup = this.getLayerGroup(category, mode);
        if (layerGroup && this.map && !this.map.hasLayer(layerGroup)) {
            this.map.addLayer(layerGroup);
        }
    },
    hideLayerCategory(category, mode = STATE.MODE.CURRENT) {
        const layerGroup = this.getLayerGroup(category, mode);
        if (layerGroup && this.map && this.map.hasLayer(layerGroup)) {
            this.map.removeLayer(layerGroup);
        }
    },
};

MapService.init();

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
 * Draws all lines (Property -> Proprietors -> BOs) for a given property item.
 * @param {object} propertyItem - The complete property object from the JSON.
 * @param {L.Marker} [originalMarker] - The marker that initiated the link drawing.
 */
function drawLinksForProperty(propertyItem, originalMarker) {
    const propertyCoords = [propertyItem.lat, propertyItem.lon];
    if (!propertyCoords[0] || !propertyCoords[1]) return null;

    let bounds = L.latLngBounds([propertyCoords, propertyCoords]);
    const category = getMarkerColor(propertyItem.status);
    const displayColor = RUNTIME.CATEGORY_COLORS[category] || category;
    const linkStyles = CONFIG.STYLES.LINK_LINES;

    /**
     * This is the new, intelligent click handler for the big "link" markers.
     * It checks if the relevant info panel is already open before doing anything.
     */
    const giantMarkerClickHandler = function(e) {
        // Stop the click from propagating to the map
        L.DomEvent.stopPropagation(e);

        // Check if the currently displayed panel belongs to this set of links.
        // If it does, do nothing.
        if (STATE.SELECTION.PANEL_TITLE === propertyItem.property_title_number) {
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
            UIService.showPanel(propObj, originalMarker.myId, point);
        }
    };

    // Add a role-specific marker at the property's location
    const extraProperty = L.marker(propertyCoords, { icon: createRoleIcon(displayColor, 'property') }).addTo(map);
    extraProperty.on('click', giantMarkerClickHandler); // Use the click handler
    STATE.MARKERS.GIANT.push(extraProperty);

    if (propertyItem.props) {
        propertyItem.props.forEach(prop => {
            const proprietorCoords = [prop.lat, prop.lon];
            if (!proprietorCoords[0] || !proprietorCoords[1]) return; // Skip if no coords

            // Rule: Property-to-Proprietor Line
            const propLineColor = (prop.BOs && prop.BOs.length > 0)
                ? linkStyles.PROPERTY_TO_PROPRIETOR.WITH_BOS_COLOR
                : linkStyles.PROPERTY_TO_PROPRIETOR.WITHOUT_BOS_COLOR;
            const propLine = L.polyline([propertyCoords, proprietorCoords], {
                color: propLineColor,
                weight: linkStyles.PROPERTY_TO_PROPRIETOR.WEIGHT
            }).addTo(map);
            STATE.LAYERS.LINKS.push(propLine);
            bounds.extend(proprietorCoords);

            // Add role-specific marker for proprietor
            const extraProp = L.marker(proprietorCoords, { icon: createRoleIcon(displayColor, 'proprietor') }).addTo(map);
            extraProp.on('click', giantMarkerClickHandler); // Use the click handler
            STATE.MARKERS.GIANT.push(extraProp);

            // Rule: Proprietor-to-Beneficial-Owner Lines
            if (prop.BOs) {
                prop.BOs.forEach(bo => {
                    const boCoords = [bo.lat, bo.lon];
                    if (!boCoords[0] || !boCoords[1]) return;

                    let boLineColor = linkStyles.PROPRIETOR_TO_BO.DEFAULT_COLOR;
                    // Only draw suspect links as red if the proprietor lacks any individual non-trustee BO
                    if (bo.reg_status === "suspect" && !prop.has_individual_non_trustee) {
                        boLineColor = linkStyles.PROPRIETOR_TO_BO.SUSPECT_COLOR;
                    }

                    const boLine = L.polyline([proprietorCoords, boCoords], { 
                        color: boLineColor, 
                        weight: linkStyles.PROPRIETOR_TO_BO.WEIGHT,
                        dashArray: linkStyles.PROPRIETOR_TO_BO.DASH_ARRAY // This creates a dashed line
                    }).addTo(map);
                    STATE.LAYERS.LINKS.push(boLine);
                    bounds.extend(boCoords);

                    // Add role-specific marker for BO
                    const extraBo = L.marker(boCoords, { icon: createRoleIcon(displayColor, 'bo') }).addTo(map);
                    extraBo.on('click', giantMarkerClickHandler); // Use the click handler
                    STATE.MARKERS.GIANT.push(extraBo);
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

/**
 * Switches the map's display mode (properties, proprietors, or beneficial_owners).
 * @param {string} newMode - the mode to switch to.
 * @param {boolean} [dont_change_view=false] - if true, skip resetting the map view.
 */
MapService.setMode = function(newMode, dont_change_view = false) {
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
    STATE.MODE.CURRENT = newMode;

    // 4a. Only show Scotland/NI no-data badges in properties mode
    if (typeof setNoDataMarkersVisible === 'function') {
        setNoDataMarkersVisible(STATE.MODE.CURRENT === 'properties');
    }

    // 5. Optionally reset map center/zoom based on mode defaults
    if (!dont_change_view) {
        if (STATE.MODE.CURRENT === 'properties') {
            map.setView(CONFIG.MAP.DEFAULT_CENTER, getPropertyDefaultZoom());
        } else {
            map.setView(CONFIG.MAP.INITIAL_VIEW.CENTER, CONFIG.MAP.INITIAL_VIEW.ZOOM);
        }
    }

    // 6. Update the search-box placeholder to match the active mode
    const searchInput = document.getElementById('searchInput');
    const placeholderMap = {
        properties: 'Search address/title',
        proprietors: 'Search proprietor',
        beneficial_owners: 'Search BO names/addresses'
    };
    if (searchInput) {
        searchInput.placeholder = placeholderMap[newMode] || 'Search...';
    }
    // Update permalink with mode
    if (typeof updatePermalinkParam === 'function') {
        updatePermalinkParam('mode', STATE.MODE.CURRENT);
    }

    if (typeof applyPropertyTypeFilter === 'function') {
        applyPropertyTypeFilter(STATE.MODE.CURRENT);
    }
};

MapService.switchMode = MapService.setMode;

// Repeatedly invalidate size to ensure the map positions correctly on mobile
// This is a horrible hack which we really should replace at some point with a ResizeObserver or a single requestAnimationFrame.
MapService.forceResize = function() {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 200);
    setTimeout(() => map.invalidateSize(), 400);
    setTimeout(() => map.invalidateSize(), 600);
};

MapService.buildPropertyMarkers = function() {
    ensurePropertyMarkersPromise();
    if (STATE.STARTUP.TIMING && STATE.STARTUP.TIMING.propertyBuildStart == null) {
        STATE.STARTUP.TIMING.propertyBuildStart = performance.now();
    }
    STATE.INDEX.MARKERS.properties = {};
    let markerIdCounter = 0;

    const processProperty = (item) => {
        if (!item.property_title_number) return;

        const lat = Number(item.lat);
        const lon = Number(item.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const uniqueId = markerIdCounter++;
        const category = getMarkerColor(item.status);
        // Use Cached HTML (Fast)
        const iconHtml = RUNTIME.ICON_HTML_CACHE[category] || RUNTIME.ICON_HTML_CACHE['green'];

        const marker = L.marker([lat, lon], {
            title: item.property_title_number,
            icon: L.divIcon({ html: iconHtml, className: '' })
        });

        // Attach Click Handler
        marker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (STATE.SELECTION.PANEL_TITLE === item.property_title_number) return;
            const point = map.latLngToContainerPoint(e.latlng);
            UIService.showPanel(item, uniqueId, point);
        });

        // Metadata
        marker.propertyItem = item;
        marker.specificEntity = item;
        marker.category = category;
        marker.myId = uniqueId;
        allMarkersById[uniqueId] = marker;

        // Add directly to layer (Original faster method)
        modeLayersAll.properties[category].addLayer(marker);
        indexMarkerByPropertyType(marker, 'properties');
    };

    const onComplete = () => {
        applyPropertyTypeFilter('properties');
        if (STATE.STARTUP.TIMING && STATE.STARTUP.TIMING.propertyBuildDurationMs == null && STATE.STARTUP.TIMING.propertyBuildStart != null) {
            STATE.STARTUP.TIMING.propertyBuildEnd = performance.now();
            STATE.STARTUP.TIMING.propertyBuildDurationMs = STATE.STARTUP.TIMING.propertyBuildEnd - STATE.STARTUP.TIMING.propertyBuildStart;
            console.log(`buildPropertyMarkers time: ${formatDurationMs(STATE.STARTUP.TIMING.propertyBuildDurationMs)}`);
            logStartupTotalIfReady();
        }
        if (STATE.STARTUP.PROPERTY_READY_RESOLVE) {
            STATE.STARTUP.PROPERTY_READY_RESOLVE();
            STATE.STARTUP.PROPERTY_READY_RESOLVE = null;
            console.log('buildPropertyMarkers complete');
        }
    };

    processInChunks(STATE.DATA.PROPERTIES, processProperty, onComplete, {
        chunkSize: 2000,
        timeBudgetMs: 15
    });

    return waitForPropertyMarkersReady();
};

MapService.buildOwnerMarkers = function() {
    if (!STATE.DATA.PROPRIETORS_BY_ID) return;
    ensureOwnerMarkersPromise();
    if (STATE.STARTUP.TIMING && STATE.STARTUP.TIMING.ownerBuildStart == null) {
        STATE.STARTUP.TIMING.ownerBuildStart = performance.now();
    }

    STATE.INDEX.MARKERS.proprietors = {};
    STATE.INDEX.MARKERS.beneficial_owners = {};
    let markerIdCounter = 1000000;

    const processOwnerProperty = (item) => {
        if (!item.props) return;

        const category = getMarkerColor(item.status);
        // Use Cached HTML
        const iconHtml = RUNTIME.ICON_HTML_CACHE[category] || RUNTIME.ICON_HTML_CACHE['green'];
        const usedIcon = L.divIcon({ html: iconHtml, className: '' });

        item.props.forEach(prop => {
            const propLat = Number(prop.lat);
            const propLon = Number(prop.lon);

            if (Number.isFinite(propLat) && Number.isFinite(propLon)) {
                const uniqueId = markerIdCounter++;
                const pMarker = L.marker([propLat, propLon], { title: prop.name, icon: usedIcon });

                pMarker.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    const point = map.latLngToContainerPoint(e.latlng);
                    UIService.showPanel(item, uniqueId, point);
                });

                pMarker.propertyItem = item;
                pMarker.specificEntity = prop;
                pMarker.category = category;
                pMarker.myId = uniqueId;
                allMarkersById[uniqueId] = pMarker;

                modeLayersAll.proprietors[category].addLayer(pMarker);
                indexMarkerByPropertyType(pMarker, 'proprietors');
            }

            if (prop.BOs) {
                prop.BOs.forEach(bo => {
                    const boLat = Number(bo.lat);
                    const boLon = Number(bo.lon);
                    if (Number.isFinite(boLat) && Number.isFinite(boLon)) {
                        const uniqueId = markerIdCounter++;
                        const boMarker = L.marker([boLat, boLon], { title: bo.name, icon: usedIcon });

                        boMarker.on('click', function(e) {
                            L.DomEvent.stopPropagation(e);
                            const point = map.latLngToContainerPoint(e.latlng);
                            UIService.showPanel(item, uniqueId, point);
                        });

                        boMarker.propertyItem = item;
                        boMarker.specificEntity = bo;
                        boMarker.category = category;
                        boMarker.myId = uniqueId;
                        allMarkersById[uniqueId] = boMarker;

                        modeLayersAll.beneficial_owners[category].addLayer(boMarker);
                        indexMarkerByPropertyType(boMarker, 'beneficial_owners');
                    }
                });
            }
        });
    };

    const onComplete = () => {
        applyPropertyTypeFilter(STATE.MODE.CURRENT);
        if (STATE.STARTUP.TIMING && STATE.STARTUP.TIMING.ownerBuildDurationMs == null && STATE.STARTUP.TIMING.ownerBuildStart != null) {
            STATE.STARTUP.TIMING.ownerBuildEnd = performance.now();
            STATE.STARTUP.TIMING.ownerBuildDurationMs = STATE.STARTUP.TIMING.ownerBuildEnd - STATE.STARTUP.TIMING.ownerBuildStart;
            console.log(`buildOwnerMarkers time: ${formatDurationMs(STATE.STARTUP.TIMING.ownerBuildDurationMs)}`);
            logStartupTotalIfReady();
        }
        if (STATE.STARTUP.OWNER_READY_RESOLVE) {
            STATE.STARTUP.OWNER_READY_RESOLVE();
            STATE.STARTUP.OWNER_READY_RESOLVE = null;
            console.log('buildOwnerMarkers complete');
        }
    };

    processInChunks(STATE.DATA.PROPERTIES, processOwnerProperty, onComplete, {
        chunkSize: 2000,
        timeBudgetMs: 15
    });

    return waitForOwnerMarkersReady();
};



function ensureMarkerIndexBucket(mode, category) {
    if (!STATE.INDEX.MARKERS[mode]) {
        STATE.INDEX.MARKERS[mode] = {};
    }
    if (!STATE.INDEX.MARKERS[mode][category]) {
        STATE.INDEX.MARKERS[mode][category] = {
            all: [],
            D: [],
            S: [],
            T: [],
            F: [],
            O: [],
        };
    }
    return STATE.INDEX.MARKERS[mode][category];
}

function indexMarkerByPropertyType(marker, mode) {
    if (!marker || !marker.category) return;
    const bucket = ensureMarkerIndexBucket(mode, marker.category);
    bucket.all.push(marker);
    const itemType = normalizePropertyType(marker.propertyItem?.property_type);
    if (itemType && bucket[itemType]) {
        bucket[itemType].push(marker);
    }
}

// Search clear buttons are wired during AppController.init via bindEntitySearchEvents().



// --- Add prominent no-data markers for Scotland and Northern Ireland ---
const noDataMarkers = [];

function addNoDataMarkers() {
    // Create a dedicated high-z pane so badges stay above clusters
    const pane = map.createPane('no-data-pane');
    pane.style.zIndex = CONFIG.MAP.PANE_ZINDEX.NO_DATA;
    pane.style.pointerEvents = 'auto';

    // Helper to build the DivIcon with accessible markup
    const makeNoDataIcon = () => L.divIcon({
        className: 'no-data-icon',
        html: '<div class="no-data-badge" role="button" aria-label="No data available" tabindex="0">?</div>',
        iconSize: null
    });

    // Country centroids (visual/geographic centres)
    const markers = CONFIG.MAP.NO_DATA_MARKERS.map(({ LAT, LON }) =>
        L.marker([LAT, LON], { pane: 'no-data-pane', icon: makeNoDataIcon() }).addTo(map)
    );

    const openNoDataPopup = (latlng) => {
        L.popup({ className: 'no-data-popup', autoPan: true })
         .setLatLng(latlng)
         .setContent('No data available; see article for more details')
         .openOn(map);
    };

    markers.forEach((m) => {
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




/**
 * Checks if a marker's layer is active and, if not, enables it and updates the legend.
 * @param {L.Marker} marker - The marker whose layer needs to be checked.
 */
function ensureMarkerLayerIsVisible(marker) {
    // Safety check in case a marker or its category is missing
    if (!marker || !marker.category) return;

    const category = marker.category;
    const layerGroup = modeLayers[STATE.MODE.CURRENT]?.[category];

    // Check if the layer group exists and is NOT currently on the map
    if (layerGroup && !MapService.isLayerCategoryVisible(category)) {
        // 1. Add the layer to the map
        MapService.showLayerCategory(category);

        // 2. Find the corresponding legend item and update its UI to match
        const legendItem = document.querySelector(`.legend-item[data-category="${category}"]`);
        if (legendItem) {
            legendItem.setAttribute("data-active", "true");
            legendItem.classList.remove("inactive");
            legendItem.querySelector(".legend-box")?.classList.remove("inactive");
        }
    }
}