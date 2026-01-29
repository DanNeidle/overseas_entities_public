/**
 * ui.js
 * UI helpers and device detection for Overseas Entities Map.
 */

// Device & PWA detection

// Create and configure the  clear button on page load
const floatingClearButton = document.createElement('button');
floatingClearButton.id = 'floatingClearButton';
floatingClearButton.innerHTML = '<i class="material-symbols-outlined" aria-hidden="true">cancel</i> Clear';
floatingClearButton.setAttribute('aria-label', 'Clear links and exit focus mode');
document.body.appendChild(floatingClearButton);

const goToLocationButton = document.createElement('button');
goToLocationButton.id = 'goToLocationButton';
goToLocationButton.innerHTML = '<i class="material-symbols-outlined" aria-hidden="true">my_location</i>';
goToLocationButton.setAttribute('aria-label', 'Go to my location');
goToLocationButton.setAttribute('data-tooltip', 'Go to my location');
document.body.appendChild(goToLocationButton);

function syncGoToLocationVisibility() {
    if (!goToLocationButton || !floatingClearButton) return;
    const clearDisplay = floatingClearButton.style.display;
    const clearVisible = clearDisplay === 'flex' || clearDisplay === 'block';
    goToLocationButton.style.display = clearVisible ? 'none' : 'flex';
}

goToLocationButton.addEventListener('click', () => {
    if (typeof triggerHapticFeedback === 'function') {
        triggerHapticFeedback(goToLocationButton);
    }
    if (!navigator.geolocation) {
        showTipToast('Location services are not available in this browser.');
        return;
    }
    goToLocationButton.disabled = true;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            const zoom = CONFIG.MAP?.PROPERTY_FLY_TO_ZOOM || 16;
            map.flyTo([lat, lon], zoom, { duration: getFlyDuration() });
            goToLocationButton.disabled = false;
        },
        () => {
            showTipToast('Unable to get your location.');
            goToLocationButton.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
});

syncGoToLocationVisibility();


function clearPropertyHighlight() {
    if (propertyHighlightRing) {
        map.removeLayer(propertyHighlightRing);
        propertyHighlightRing = null;
    }
}

const isMobile = () => window.innerWidth < CONFIG.UI.MOBILE_BREAKPOINT;

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

function hasShownIosAddToHomePrompt() {
    try {
        if (window.localStorage.getItem(CONFIG.STORAGE.IOS_ADD_TO_HOME_PROMPT_KEY) === 'true') {
            return true;
        }
    } catch (err) {
        // ignore lack of localStorage access
    }
    const cookieMatch = document.cookie.split('; ').find(cookie => cookie.startsWith(`${CONFIG.STORAGE.IOS_ADD_TO_HOME_PROMPT_KEY}=`));
    return cookieMatch === `${CONFIG.STORAGE.IOS_ADD_TO_HOME_PROMPT_KEY}=1`;
}

function rememberIosAddToHomePromptShown() {
    try {
        window.localStorage.setItem(CONFIG.STORAGE.IOS_ADD_TO_HOME_PROMPT_KEY, 'true');
    } catch (err) {
        // ignore storage failures
    }
    const oneYear = 365 * 24 * 60 * 60;
    document.cookie = `${CONFIG.STORAGE.IOS_ADD_TO_HOME_PROMPT_KEY}=1; path=/; max-age=${oneYear}; SameSite=Lax`;
}

function maybeShowIosAddToHomePrompt() {
    if (hasShownIosAddToHomePrompt()) return;

    const userAgent = window.navigator.userAgent || '';
    const isIphone = /iPhone/.test(userAgent);

    if (!isIphone || isStandaloneDisplayMode()) return;

    rememberIosAddToHomePromptShown();
    window.alert('To add the Overseas Entities Map to your home screen, tap the share button in Safari and choose \"Add to Home Screen\".');
}

// Notifications & feedback
function showTipToast(text) {
    const t = document.createElement('div');
    t.innerText = text;
    Object.assign(t.style, {
        position: 'fixed', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
        background: '#1133AF', color: '#fff', padding: '8px 12px', borderRadius: '6px', zIndex: 5000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
    });
    document.body.appendChild(t);
    setTimeout(() => { t.remove(); }, 2500);
}


// Layout & menus (responsive)
function showHamburger() {
    if (!isMobile()) {
        return Promise.resolve();
    }

    const offcanvasEl = document.getElementById('mobileControlsOffcanvas');
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
    bsOffcanvas.show();

    return new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Hide the mobile off-canvas menu if open. No-op on desktop.
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

/**
 * Move controls between on-map (desktop) and off-canvas (mobile) containers.
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

            // Move the navigation search bar into the off-canvas menu on mobile
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

function updateFooterVersion() {
    const footerEl = document.getElementById('footerVersion');
    if (!footerEl) return;

    const datasetSuffix = STATE.DATA.DATASET_VERSION_LABEL
        ? `, ${STATE.DATA.DATASET_VERSION_LABEL} data`
        : '';
    const versionSegment = `Version ${APP_VERSION}${datasetSuffix}`;
    const copyright = `${versionSegment}, &copy Tax Policy Associates, 2026, HM Land Registry data Crown copyright 2026.`;
    footerEl.innerHTML = `${copyright} ${CONFIG.MAP.ATTRIBUTION_HTML}`;
}


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
    const filteredProperties = STATE.DATA.TOP_VALUABLE_PROPERTIES.filter(prop => {
        const category = getMarkerColor(prop.status);
        if (!activeCategories.has(category)) return false;
        return propertyTypeMatches(prop);
    });

    // Build the new list from the filtered data
    filteredProperties.forEach(prop => {
        const itemEl = document.createElement('div');
        itemEl.className = 'valuable-item';
        itemEl.dataset.title = prop.property_title_number;

        const address = prop.property_uk_address || 'No address';

        const category = getMarkerColor(prop.status);
        const color = RUNTIME.CATEGORY_COLORS[category] || '#ccc';
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
        
        UIService.hidePanel(); 
        focusMarkerOnMap(marker, { zoom: 18, openPanel: true });
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
            UIService.showPanel(m.propertyItem, m.myId, null, true);
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
            UIService.showPanel(m.propertyItem, m.myId, null, true);
            if (!isMobile()) { panel.style.left = keepLeft; panel.style.top = keepTop; }
            map.panTo(m.getLatLng());
            suppressHistoryPush = false;
        }
    }
    updateInfoBarButtons();
    saveInfoHistoryToCookie();
}

const UIService = {
    panel: document.getElementById('info-panel'),
    templates: {},
};

UIService.hidePanel = function() {
    const panel = document.getElementById('info-panel');
    // fade out then hide
    panel.classList.remove('showing');
    setTimeout(() => { panel.classList.add('hidden'); }, 180);
    document.body.classList.remove('no-page-scroll');
    
    STATE.MARKERS.ACTIVE = null;
    STATE.SELECTION.PANEL_ITEM = null;

    // Reset the tracking variable whenever the panel is hidden
    STATE.SELECTION.PANEL_TITLE = null;
    if (panel.dataset.propertyTitle) {
        delete panel.dataset.propertyTitle;
    }
    clearPropertyHighlight();
    // Remove popup param from URL (if we manage permalinks)
    updatePermalinkParam('popup', null);
    updateInfoBarButtons();
};

/**
 * Show the info panel for a given property marker.
 * @param {object} propertyItem The property object from JSON.
 * @param {number} markerId Internal marker ID for UI state.
 * @param {L.Point} point Screen point for panel positioning.
 * @param {boolean} [fromHistory=false] Whether opened from history navigation.
 * @returns {void}
 */
UIService.showPanel = function(propertyItem, markerId, point, fromHistory = false) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-panel-content');
    const contentDiv = document.getElementById('info-panel-content');
    STATE.MARKERS.ACTIVE = findMarkerById(markerId);

    // 1. Set tracking variables and populate content (this is unchanged)
    STATE.SELECTION.PANEL_TITLE = propertyItem.property_title_number;
    STATE.SELECTION.PANEL_ITEM = propertyItem;
    panel.dataset.propertyTitle = propertyItem.property_title_number;
    contentDiv.innerHTML = UIService.templates.propertyCard(propertyItem, markerId);
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
      if (!isMobile() && !kbDismissed && !kbUsed && count >= kbNext) {
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
    AppController.attachInfoBarHandlersOnce();

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

    // Draw a highlight ring around the visible marker (handles spiderfied clusters).
    showPropertyHighlight(propertyItem, STATE.MARKERS.ACTIVE);

    // 3. Apply positioning logic based on device type
    const panelLayout = CONFIG.PANEL_LAYOUT;
    if (isMobile()) {
        const isLandscape = window.matchMedia("(orientation: landscape)").matches;
        const mobileLayout = panelLayout.MOBILE;

        // Apply different widths for portrait vs. landscape
        if (isLandscape) {
            panel.style.width = mobileLayout.LANDSCAPE.WIDTH; // 40% width in landscape
            panel.style.left = mobileLayout.LANDSCAPE.LEFT;  // Center it (100-40)/2 = 30
        } else {
            panel.style.width = mobileLayout.PORTRAIT.WIDTH; // 90% width in portrait
            panel.style.left = mobileLayout.PORTRAIT.LEFT;   // Center it
        }

        // These styles apply to both mobile orientations
        panel.style.maxHeight = mobileLayout.MAX_HEIGHT;
        panel.style.top = mobileLayout.TOP; // Position below header
        panel.style.transform = mobileLayout.TRANSFORM;

    } else {
        // --- DESKTOP POSITIONING (Your original logic) ---
        // Reset mobile styles and apply desktop logic
        const desktopLayout = panelLayout.DESKTOP;
        panel.style.width = desktopLayout.WIDTH;
        panel.style.maxHeight = desktopLayout.MAX_HEIGHT;
        panel.style.transform = desktopLayout.TRANSFORM;

        if (!fromHistory && point) {
            const panelWidth = panel.offsetWidth;
            const panelHeight = panel.offsetHeight;
            const mapSize = map.getSize();
            const padding = desktopLayout.PADDING_PX;
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
};



// To generate the HTML for the redesigned panel
UIService.templates.propertyCard = function(propertyItem, markerId) {
    return PanelRenderer.generateHtml(propertyItem, markerId);
};




// Legacy close button removed in favor of #info-close wired via attachInfoBarHandlersOnce().
// No action needed here.


function drawLinksFromMarkerId(markerId) {
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

    STATE.LINKED_ITEM_IDS.push(propertyObj.property_title_number);  // save for sharing

    // Pass the marker itself to the drawing function
    const linkBounds = drawLinksForProperty(propertyObj, clickedMarker);

    // Zoom to fit all the new links
    if (linkBounds && linkBounds.isValid()) {
        map.fitBounds(linkBounds.pad(0.1));
    }
}

function clearLinksAndFocus() {
    // Remove all polylines.
    STATE.LAYERS.LINKS.forEach(function(link) {
        map.removeLayer(link);
    });
    STATE.LAYERS.LINKS = [];

    // Remove all extra (giant) markers.
    STATE.MARKERS.GIANT.forEach(function(marker) {
        map.removeLayer(marker);
    });
    STATE.MARKERS.GIANT = [];

    // Also clear temporary pan-to markers
    STATE.MARKERS.TEMP.forEach(function(marker) {
        map.removeLayer(marker);
    });
    STATE.MARKERS.TEMP = [];

    // Exit the focus mode UI and restore layers from the legend
    exitFocusMode();

    // Reset the list of items with links drawn for sharing
    STATE.LINKED_ITEM_IDS = [];

    dismissHamburger(); // Close the menu
}

function resetViewToCleanUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const cleanUrl = url.toString();
    if (cleanUrl === window.location.href) {
        window.location.reload();
        return;
    }
    window.location.replace(cleanUrl);
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
        STATE.MARKERS.TEMP.forEach(m => map.removeLayer(m));
        STATE.MARKERS.TEMP = [];

        const markerIdNum = Number(originalMarkerId);
        const markerFromId = Number.isFinite(markerIdNum) ? findMarkerById(markerIdNum) : null;
        const markerFromTitle = markerFromId ? null : findMarkerByTitleNumber(propertyTitleNumber);
        const targetMarker = markerFromId || markerFromTitle;
        const targetLatLng = targetMarker?.getLatLng ? targetMarker.getLatLng() : null;
        const matchesTarget = targetLatLng
            ? targetLatLng.distanceTo(L.latLng(latNum, lonNum)) < 2
            : false;
        const targetLayerGroup = targetMarker
            ? modeLayers?.[STATE.MODE.CURRENT]?.[targetMarker.category]
            : null;

        if (targetMarker && matchesTarget && targetLayerGroup && targetLayerGroup.hasLayer(targetMarker)) {
            const z = (typeof zoomLevel === 'number' && !isNaN(zoomLevel)) ? zoomLevel : undefined;
            if (Number.isFinite(z)) {
                map.flyTo(targetLatLng, z, { duration: getFlyDuration() });
            } else {
                map.panTo(targetLatLng);
            }
            return;
        }

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
            const propertyItem = STATE.DATA.PROPERTIES.find(item => item.property_title_number === propertyTitleNumber);

            if (propertyItem) {
                // Get the click position to place the panel correctly
                const point = map.latLngToContainerPoint(e.latlng);
                // Re-show the info panel for the original property
                UIService.showPanel(propertyItem, originalMarkerId, point);
            }
        });

        // Store the new marker so it can be cleared later
        STATE.MARKERS.TEMP.push(tempMarker);
    }
}



function enterFocusMode() {

    STATE.MODE.FOCUS.SAVED = STATE.MODE.CURRENT;

    // Hide all currently visible marker layers
    for (const cat in modeLayers[STATE.MODE.CURRENT]) {
        const layer = modeLayers[STATE.MODE.CURRENT][cat];
        MapService.hideLayerCategory(cat, STATE.MODE.CURRENT);
    }
    // Show the floating clear button
    document.getElementById('floatingClearButton').style.display = 'flex';
    syncGoToLocationVisibility();
}

function exitFocusMode() {
    // Hide the floating clear button
    document.getElementById('floatingClearButton').style.display = 'none';
    syncGoToLocationVisibility();

    // Restore layers based on the legend's state and the SAVED mode
    document.querySelectorAll('.legend-item').forEach(item => {
        const category = item.getAttribute('data-category');
        const isActive = item.getAttribute('data-active') === 'true';
        // USE THE SAVED MODE, NOT THE CURRENT ONE
        const layer = modeLayers[STATE.MODE.FOCUS.SAVED]?.[category];

        if (layer && isActive) {
            MapService.showLayerCategory(category, STATE.MODE.FOCUS.SAVED);
        }
    });
}


function clearPropertyHighlight() {
    if (propertyHighlightRing) {
        map.removeLayer(propertyHighlightRing);
        propertyHighlightRing = null;
    }
}




function setPropertyTypeSelection(type, options = {}) {
    let next = String(type || '').trim().toUpperCase();
    if (!next || next === 'ALL') next = CONFIG.PROPERTY_TYPES.DEFAULT;
    if (next !== CONFIG.PROPERTY_TYPES.DEFAULT && !CONFIG.PROPERTY_TYPES.CODES.has(next)) return;
    STATE.SELECTION.PROPERTY_TYPE = next;

    document.querySelectorAll('.property-type-btn').forEach(btn => {
        const btnType = (btn.dataset.type || '').toUpperCase();
        const isActive = next === CONFIG.PROPERTY_TYPES.DEFAULT
            ? btn.dataset.type === CONFIG.PROPERTY_TYPES.DEFAULT
            : btnType === next;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (options.applyFilter !== false) {
        applyPropertyTypeFilter();
    }
}

function updateLegendCounts(mode = STATE.MODE.CURRENT) {
    const layers = modeLayers[mode];
    if (!layers) return;
    Object.keys(layers).forEach(category => {
        const legendItem = document.querySelector(`.legend-item[data-category="${category}"]`);
        if (!legendItem) return;
        const count = layers[category].getLayers().length;
        let countElement = legendItem.querySelector('.legend-count');
        if (!countElement) {
            countElement = document.createElement('span');
            countElement.className = 'legend-count';
            legendItem.appendChild(countElement);
        }
        countElement.textContent = `(${formatNumber(count)})`;
    });
}

function applyPropertyTypeFilter(mode = STATE.MODE.CURRENT) {
    const targetMode = mode || STATE.MODE.CURRENT;
    const activeCategories = new Set();
    document.querySelectorAll('.legend-item[data-active="true"]').forEach(item => {
        activeCategories.add(item.getAttribute('data-category'));
    });

    if (STATE.SELECTION.PROPERTY_TYPE === CONFIG.PROPERTY_TYPES.DEFAULT) {
        if (modeLayers !== modeLayersAll) {
            Object.keys(modeLayers[targetMode] || {}).forEach(category => {
                MapService.hideLayerCategory(category, targetMode);
            });
            MapService.setModeLayers(modeLayersAll);
        }

        Object.keys(modeLayers[targetMode] || {}).forEach(category => {
            if (activeCategories.has(category)) {
                MapService.showLayerCategory(category, targetMode);
            } else {
                MapService.hideLayerCategory(category, targetMode);
            }
        });
    } else {
        const layers = modeLayersFiltered[targetMode];
        if (!layers) return;

        Object.keys(layers).forEach(category => {
            const layerGroup = layers[category];
            const bucket = STATE.INDEX.MARKERS[targetMode]?.[category];
            const markers = bucket?.[STATE.SELECTION.PROPERTY_TYPE] || [];
            layerGroup.clearLayers();
            if (markers.length) {
                layerGroup.addLayers(markers);
            }
        });

        if (modeLayers !== modeLayersFiltered) {
            Object.keys(modeLayers[targetMode] || {}).forEach(category => {
                MapService.hideLayerCategory(category, targetMode);
            });
            MapService.setModeLayers(modeLayersFiltered);
        }

        Object.keys(modeLayers[targetMode] || {}).forEach(category => {
            if (activeCategories.has(category)) {
                MapService.showLayerCategory(category, targetMode);
            } else {
                MapService.hideLayerCategory(category, targetMode);
            }
        });
    }

    updateLegendCounts(targetMode);

    const panel = document.getElementById('valuable-properties-panel');
    if (panel && !panel.classList.contains('hidden')) {
        showValuablePropertiesPanel();
    }
}
