/**
 * controller.js
 * Handles user interactions (clicks, keys, search).
 */
const AppController = {
    _wired: false,
    _loadWired: false,
};

// Offcanvas listeners (ignore legend clicks so menu stays open)
let offcanvasJustClosed = false;

AppController.bindMapEvents = function() {
    // make sure info box disappears when clicked
    map.on('click', function() {
        UIService.hidePanel();
    });

    map.on('zoomend', updateNoDataBadgeSizes);
    map.on('moveend', updateLocationParamFromMap);

    // Show lat/lon on right click
    map.on('contextmenu', function(e) {
        const lat = e.latlng.lat.toFixed(6);
        const lon = e.latlng.lng.toFixed(6);
        const zoom = map.getZoom();

        const content = `
            <div style="cursor: pointer;" data-action="copy-coords" data-lat="${lat}" data-lon="${lon}">
                 Lat: ${lat}
            </div>
            <div style="cursor: pointer;" data-action="copy-coords" data-lat="${lat}" data-lon="${lon}">
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
}

/*********************** EVENT LISTENER BINDERS **************************/
AppController.bindModeToggleEvents = function() {
    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
        btn.addEventListener("click", function() {
            const targetMode = this.dataset.value;
            // If user clicks the already active mode, reset to startup defaults
            if (targetMode === STATE.MODE.CURRENT) {
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
            // Call your setMode function with the button's data-value
            MapService.setMode(targetMode);

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
}

AppController.bindPropertyTypeEvents = function() {
    document.querySelectorAll('.property-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.dataset.type || CONFIG.PROPERTY_TYPES.DEFAULT;
            const normalized = String(type || '').trim().toUpperCase();
            const next = (!normalized || normalized === 'ALL') ? CONFIG.PROPERTY_TYPES.DEFAULT : normalized;
            if (next === STATE.SELECTION.PROPERTY_TYPE) return;
            setPropertyTypeSelection(type);
        });
    });
}

AppController.bindEntitySearchEvents = function() {
    this.setupSearchClearButtons();
    const searchInput = document.getElementById("searchInput");
    if (!searchInput) return;
    searchInput.addEventListener("keyup", debounce(function() {
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
        const maxResults = CONFIG.INTERACTION.SEARCH_MAX_RESULTS;

        // Get an array of all markers that are currently visible on the map
        let visibleMarkers = [];
        for (const cat in modeLayers[STATE.MODE.CURRENT]) {
            visibleMarkers.push(...modeLayers[STATE.MODE.CURRENT][cat].getLayers());
        }

        if (STATE.MODE.CURRENT === 'properties') {
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
                    const color = RUNTIME.CATEGORY_COLORS[colorCategory] || '#ccc';
                    const statusDot = document.createElement('span');
                    statusDot.className = 'status-dot';
                    statusDot.style.backgroundColor = color;
                    div.appendChild(statusDot);
                    div.appendChild(document.createTextNode(truncatedAddress));

                    div.addEventListener("click", () => {

                        focusMarkerOnMap(marker, { zoom: 18, openPanel: true });

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
                const color = RUNTIME.CATEGORY_COLORS[colorCategory] || '#ccc';
                const statusDot = document.createElement('span');
                statusDot.className = 'status-dot';
                statusDot.style.backgroundColor = color;
                div.appendChild(statusDot);
                div.appendChild(document.createTextNode(`${toTitleCase(entityName)} `));
                const addressSpan = document.createElement('span');
                addressSpan.style.color = '#6c757d';
                addressSpan.style.fontSize = '0.9em';
                addressSpan.textContent = `(${truncatedAddress})`;
                div.appendChild(addressSpan);

                // The click handler is tied to this specific marker, ensuring the correct info panel opens
                div.addEventListener("click", () => {

                    ensureMarkerLayerIsVisible(marker);

                    const layerGroup = modeLayers[STATE.MODE.CURRENT]?.[marker.category];
                    if (layerGroup) {
                        layerGroup.zoomToShowLayer(marker, () => {
                            const point = map.latLngToContainerPoint(marker.getLatLng());
                            UIService.showPanel(marker.propertyItem, marker.myId, point);
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
    }, CONFIG.INTERACTION.DEBOUNCE_MS.ENTITY_SEARCH));
}

AppController.bindLegendEvents = function() {
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
            const layerToToggle = modeLayers[STATE.MODE.CURRENT]?.[cat];

            if (!layerToToggle) {
                // console.warn(`No layer found for category "${cat}" in mode "${STATE.MODE.CURRENT}"`);
                return;
            }

            triggerHapticFeedback(this);
            triggerHapticFeedback(this.querySelector('.legend-box'));

            // Toggle the layer's visibility on the map and update the UI
            if (active) {
                MapService.hideLayerCategory(cat);
                this.setAttribute("data-active", "false");
                this.classList.add("inactive");
                this.querySelector(".legend-box")?.classList.add("inactive");
                this.setAttribute('aria-checked', 'false');
            } else {
                MapService.showLayerCategory(cat);
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
}

// Enhance legend accessibility: role, states, and keyboard support
AppController.setupLegendAccessibility = function() {
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


// Share view functionality – include IDs of drawn links in the saved state
AppController.bindShareEvents = function() {
    const shareButton = document.getElementById("shareViewButton");
    if (!shareButton) return;
    shareButton.addEventListener("click", function() {
        const center = map.getCenter();
        const zoom = map.getZoom();

        // Warning for too many links
        const maxSharedLinks = CONFIG.INTERACTION.SHARE_MAX_LINKS; // Keep limit
        if (STATE.LINKED_ITEM_IDS.length > maxSharedLinks) {
          const warning = document.createElement("div");
          warning.innerText = `Sharing limit: Only the first ${maxSharedLinks} of the ${STATE.LINKED_ITEM_IDS.length} links drawn can be included in the shared URL.`;
          Object.assign(warning.style, { /* ... existing styles ... */ }); // Keep styles
          document.body.appendChild(warning);
          setTimeout(() => { document.body.removeChild(warning); }, 4000); // Longer timeout
        }

        // Build the state object
        const popupTitle = STATE.SELECTION.PANEL_TITLE
            || (STATE.MARKERS.ACTIVE && STATE.MARKERS.ACTIVE.propertyItem
                ? STATE.MARKERS.ACTIVE.propertyItem.property_title_number
                : null);
        const state = {
            lat: center.lat.toFixed(6),
            lng: center.lng.toFixed(6),
            zoom: zoom,
            mode: STATE.MODE.CURRENT, // record the current display mode
            popup: popupTitle,
    // Store the unique IDs of items with links (up to the limit)
            links: STATE.LINKED_ITEM_IDS.slice(0, maxSharedLinks),
            // Store layer visibility state
            layers: {}
        };
         
        // Store layer visibility state based on the current mode
        state.layers = {};
        Object.keys(modeLayers[STATE.MODE.CURRENT]).forEach(cat => {
            if (Object.prototype.hasOwnProperty.call(modeLayers[STATE.MODE.CURRENT], cat)) {
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
}

// Searching for places (Nominatim) with auto-search
AppController.bindPlaceSearchEvents = function() {
    const placeInput = document.getElementById('placeSearchInput');
    if (!placeInput) return;
    placeInput.addEventListener('keyup', debounce(async function() {
        const searchText = this.value.trim();
        const resultsDiv = document.getElementById('placeSearchResults');
        if (!resultsDiv) return;

        // Hide results if search is empty or too short
        if (searchText.length < 2) {
            resultsDiv.innerHTML = '';
            resultsDiv.style.display = 'none';
            return;
        }

        const url = new URL(CONFIG.URLS.NOMINATIM_SEARCH);
        url.search = new URLSearchParams({
            q: searchText,
            format: 'json',
            limit: '30',
            addressdetails: '1',
        }).toString();

        try {
            const response = await fetch(url.toString(), {
                headers: { 'Accept': 'application/json' },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const results = await response.json();

            resultsDiv.innerHTML = ''; // Clear previous results
            // Add a results header with inline clear badge
            const header = document.createElement('div');
            header.className = 'results-header';
            const title = document.createElement('span');
            title.className = 'results-title';
            title.textContent = 'Results';
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'results-clear';
            clearBtn.textContent = 'Clear';
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resultsDiv.innerHTML = '';
                resultsDiv.style.display = 'none';
            });
            header.appendChild(title);
            header.appendChild(clearBtn);
            resultsDiv.appendChild(header);

            if (!Array.isArray(results) || results.length === 0) {
                const emptyItem = document.createElement('div');
                emptyItem.className = 'result-item';
                emptyItem.setAttribute('role', 'option');
                emptyItem.setAttribute('tabindex', '0');
                emptyItem.textContent = 'No results found.';
                resultsDiv.appendChild(emptyItem);
                resultsDiv.style.display = 'block';
                const live = document.getElementById('liveRegion');
                if (live) live.textContent = 'No results';
                return;
            }

            // Create a dropdown list of results
            results.forEach((result) => {
                const resultItem = document.createElement('div');
                resultItem.className = 'result-item';
                resultItem.setAttribute('role', 'option');
                resultItem.setAttribute('tabindex', '0');
                resultItem.textContent = result.display_name;
                resultItem.addEventListener('click', () => {
                    focusMapOnPlaceResult(result);
                    // Keep results visible; just set the input to the selected place
                    placeInput.value = result.display_name;

                    // Highlight the selected item
                    Array.from(resultsDiv.children).forEach(el => el.classList.remove('selected'));
                    resultItem.classList.add('selected');
                });
                // Keyboard activation
                resultItem.addEventListener('keydown', (e) => { if (e.key === 'Enter') resultItem.click(); });
                resultsDiv.appendChild(resultItem);
            });
            resultsDiv.style.display = 'block'; // Show results container
            const live = document.getElementById('liveRegion');
            if (live) live.textContent = `${results.length} results`;
        } catch (err) {
            resultsDiv.innerHTML = '';
            const errorItem = document.createElement('div');
            errorItem.className = 'result-item';
            errorItem.setAttribute('role', 'option');
            errorItem.setAttribute('tabindex', '0');
            errorItem.textContent = 'Error retrieving results.';
            resultsDiv.appendChild(errorItem);
            resultsDiv.style.display = 'block';
            const live = document.getElementById('liveRegion');
            if (live) live.textContent = 'Error retrieving results';
            // console.error("Geocoding error:", err);
        }
    }, CONFIG.INTERACTION.DEBOUNCE_MS.PLACE_SEARCH)); // A 350ms delay is polite for an external API
}

AppController.attachInfoBarHandlersOnce = function() {
    const backBtn = document.getElementById('info-back');
    const fwdBtn = document.getElementById('info-forward');
    const closeBtn = document.getElementById('info-close');
    if (backBtn && !backBtn._wired) { backBtn.addEventListener('click', goBack); backBtn._wired = true; }
    if (fwdBtn && !fwdBtn._wired) { fwdBtn.addEventListener('click', goForward); fwdBtn._wired = true; }
    if (closeBtn && !closeBtn._wired) { closeBtn.addEventListener('click', UIService.hidePanel); closeBtn._wired = true; }
}

AppController.attachInfoPanelActionHandlersOnce = function() {
    if (document._infoPanelActionHandlersWired) return;
    document._infoPanelActionHandlersWired = true;

    document.addEventListener('click', (event) => {
        const actionEl = event.target.closest('[data-action]');
        if (actionEl) {
            const action = actionEl.getAttribute('data-action');
            if (action === 'visualise-links') {
                event.preventDefault();
                event.stopPropagation();
                const markerId = actionEl.getAttribute('data-markerid');
                if (markerId !== null && markerId !== '') {
                    drawLinksFromMarkerId(markerId);
                }
                return;
            }
            if (action === 'ownership-search') {
                event.preventDefault();
                event.stopPropagation();
                const encodedName = actionEl.getAttribute('data-name') || '';
                const role = actionEl.getAttribute('data-role') || '';
                const name = decodeURIComponent(encodedName);
                personSearch(name, role);
                return;
            }
            if (action === 'fly-to') {
                event.preventDefault();
                event.stopPropagation();
                const lat = Number(actionEl.getAttribute('data-lat'));
                const lon = Number(actionEl.getAttribute('data-lon'));
                const color = actionEl.getAttribute('data-color') || '';
                const title = actionEl.getAttribute('data-title') || '';
                const propertyTitleNumber = actionEl.getAttribute('data-property-title-number') || '';
                const markerId = actionEl.getAttribute('data-marker-id');
                const zoomAttr = actionEl.getAttribute('data-zoom');
                const zoomLevel = (zoomAttr !== null && zoomAttr !== '') ? Number(zoomAttr) : undefined;
                panToLocation(lat, lon, color, title, event, propertyTitleNumber, markerId, zoomLevel);
                return;
            }
            if (action === 'land-registry') {
                event.preventDefault();
                event.stopPropagation();
                const titleNumber = actionEl.getAttribute('data-title-number') || '';
                if (titleNumber) {
                    searchLandRegistry(event, titleNumber);
                }
                return;
            }
            if (action === 'download-info') {
                event.preventDefault();
                event.stopPropagation();
                if (STATE.SELECTION.PANEL_ITEM) {
                    downloadPropertyInfo(STATE.SELECTION.PANEL_ITEM);
                }
                return;
            }
            if (action === 'copy-coords') {
                event.preventDefault();
                event.stopPropagation();
                const lat = Number(actionEl.getAttribute('data-lat'));
                const lon = Number(actionEl.getAttribute('data-lon'));
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    copyCoordsToClipboard(lat, lon);
                }
                return;
            }
        }

        const copyEl = event.target.closest('.copyable-text');
        if (copyEl) {
            copyTextOnClick(event, copyEl);
            return;
        }

        const stopEl = event.target.closest('[data-stop-propagation="true"]');
        if (stopEl) {
            event.stopPropagation();
        }
    });
}

// Draw connections when "Show connections" button in the info panel is clicked
AppController.bindPanelLinkEvents = function() {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('.show-link');
        if (!link) return;
        L.DomEvent.stopPropagation(e); // Good practice to stop the click from propagating
        const markerId = link.getAttribute('data-markerid');
        drawLinksFromMarkerId(markerId);
    });
}

// Reset view button
AppController.bindResetViewEvents = function() {
    document.addEventListener('click', (e) => {
        const clearButton = e.target.closest('#clearButton');
        if (!clearButton) return;
        triggerHapticFeedback(clearButton);
        resetViewToCleanUrl();
    });
}

// Draw Selection button and logic
AppController.bindSelectionEvents = function() {
    document.addEventListener('click', (e) => {
        const selectButton = e.target.closest('#selectAreaButton');
        if (!selectButton) return;
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
            if (STATE.LAYERS.DRAWN && map.hasLayer(STATE.LAYERS.DRAWN)) {
                map.removeLayer(STATE.LAYERS.DRAWN);
            }
            STATE.LAYERS.DRAWN = e.layer; 
            map.addLayer(STATE.LAYERS.DRAWN);

            // Filter the properties within the drawn rectangle
            const bounds = e.layer.getBounds();
            filterPropertiesByBounds(bounds);
        });
    });
}

AppController.bindLegendMinToggleEvents = function() {
    const legendMinToggle = document.getElementById('legendMinToggle');
    if (legendMinToggle) {
      legendMinToggle.addEventListener('click', function() {
        const legendBox = document.getElementById('legendBox');
        const minimized = legendBox.classList.toggle('minimized');
        const icon = this.querySelector('i.material-symbols-outlined');
        if (icon) icon.textContent = minimized ? 'add' : 'remove';
      });
    }
}

// On initial load, wire up UI controls and basic behaviors
AppController.initUiControls = function() {
    maybeShowIosAddToHomePrompt();
    
    // Update the footer with copyright information.
    updateFooterVersion();

    const rerunButton = document.getElementById('reRunTutorialButton');
    if (rerunButton) {
        rerunButton.addEventListener('click', function() {
            setCookie(CONFIG.STORAGE.TUTORIAL_COOKIE_KEY, '', -1);
            resetViewToCleanUrl();
         });
    }

    const valuableButton = document.getElementById('showValuableButton');
    if (valuableButton) {
        valuableButton.addEventListener('click', toggleValuablePropertiesPanel);
    }
    
    const valuableClose = document.getElementById('valuable-properties-close');
    if (valuableClose) {
        valuableClose.addEventListener('click', () => {
            document.getElementById('valuable-properties-panel').classList.add('hidden');
        });
    }

    makeElementDraggable('info-panel', '#info-panel-bar', { longPressMs: 320 });
    
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
}

AppController.bindLayoutEvents = function() {
    updateControlsPlacement();
    window.addEventListener('resize', updateControlsPlacement);
    window.addEventListener('orientationchange', updateControlsPlacement);
    MapService.forceResize(); // Initial call
}

// Create an aria-live region for announcing result counts
AppController.ensureLiveRegion = function() {
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
}

AppController.bindOffcanvasEvents = function() {
    const offcanvas = document.getElementById('mobileControlsOffcanvas');
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
            MapService.forceResize();
        });
        // Optional: keep the offcanvas open on internal clicks unless they target a dismiss element
        offcanvas.addEventListener('click', function(e) {
            // No-op; bootstrap handles this. We avoid custom dismiss logic.
        });
    }

    // Final size invalidation on load
    MapService.forceResize();
}

AppController.bindOverlayEvents = function() {
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
}


// Global click/keydown handlers
AppController.bindGlobalEvents = function() {
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
            top.classList.remove('show');
            top.classList.add('hidden');
            return;
          }
        } catch {}
      }
      if (e.key === 'Escape' && isPanelOpen) {
        UIService.hidePanel();
        return;
      }
      if (e.key === 'Escape' && !isEditableTarget) {
        const results = document.getElementById('searchResults');
        if (results) { results.innerHTML = ''; results.style.display = 'none'; }
        const pResults = document.getElementById('placeSearchResults');
        if (pResults) { pResults.innerHTML = ''; pResults.style.display = 'none'; }
      }
    });
}

AppController.bindNudgeEvents = function() {
  // setup and show keyboard + nav nudges
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
}

// --- Event handlers for the custom info-panel tooltip ---
AppController.bindInfoPanelTooltipEvents = function() {
    const infoPanel = document.getElementById('info-panel');
    if (!infoPanel) return;

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
            DOM.INFO_TOOLTIP.textContent = tooltipText;
            DOM.INFO_TOOLTIP.style.display = 'block';
            DOM.INFO_TOOLTIP.style.opacity = 1;

            // Position it 8px above the button, centered horizontally
            const topPos = rect.top - DOM.INFO_TOOLTIP.offsetHeight - 8;
            const leftPos = rect.left + (target.offsetWidth / 2) - (DOM.INFO_TOOLTIP.offsetWidth / 2);

            DOM.INFO_TOOLTIP.style.top = `${topPos}px`;
            DOM.INFO_TOOLTIP.style.left = `${leftPos}px`;
        }
    });

    infoPanel.addEventListener('mouseout', (e) => {
        // Hide the tooltip when the mouse leaves the button
        const target = e.target.closest('[data-tooltip-infopanel]');
        if (target) {
            DOM.INFO_TOOLTIP.style.opacity = 0;
            // Use a short delay to allow the fade-out transition to complete
            setTimeout(() => {
                if (DOM.INFO_TOOLTIP.style.opacity === '0') { // Check if it's still meant to be hidden
                    DOM.INFO_TOOLTIP.style.display = 'none';
                }
            }, 200);
        }
    });
}

/**
 * Create clear buttons for search inputs (mobile-friendly) and wire events.
 * @returns {void}
 */
AppController.setupSearchClearButtons = function() {
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

// Smart tooltip positioning
AppController.bindTooltipEvents = function() {
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

    document.addEventListener('touchstart', (e) => {
      if (!e.target.closest('[data-tooltip-infopanel]')) {
        DOM.INFO_TOOLTIP.style.opacity = 0;
        setTimeout(() => (DOM.INFO_TOOLTIP.style.display = 'none'), 200);
      }
    }, { passive: true });
}

AppController.bindFocusModeEvents = function() {
    floatingClearButton.addEventListener('click', () => {
        triggerHapticFeedback(floatingClearButton);
        clearLinksAndFocus();
    });

    // Exit focus mode when a user clicks into a search box.
    ['searchInput', 'placeSearchInput'].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('focus', () => {
            // Check if we are in focus mode.
            // If the floating clear button is visible, we're in focus mode.
            const clearButton = document.getElementById('floatingClearButton');
            if (clearButton && clearButton.style.display === 'block') {
                clearButton.click();
            }

            // On mobile: scroll the focused input into view within the offcanvas body
            if (isMobile()) {
                const offBody = document.querySelector('#mobileControlsOffcanvas .offcanvas-body');
                if (offBody) {
                    const rect = input.getBoundingClientRect();
                    const bodyRect = offBody.getBoundingClientRect();
                    if (rect.top < bodyRect.top || rect.bottom > bodyRect.bottom) {
                        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        });
    });
}

AppController.init = function() {
    if (this._wired) return;
    this._wired = true;
    this.bindMapEvents();
    this.bindModeToggleEvents();
    this.bindPropertyTypeEvents();
    this.bindLegendEvents();
    this.bindLegendMinToggleEvents();
    this.setupLegendAccessibility();
    this.bindEntitySearchEvents();
    this.bindPlaceSearchEvents();
    this.bindPanelLinkEvents();
    this.bindResetViewEvents();
    this.bindSelectionEvents();
    this.bindTooltipEvents();
    this.bindInfoPanelTooltipEvents();
    this.bindGlobalEvents();
    this.bindFocusModeEvents();
    this.bindLayoutEvents();
    this.initUiControls();
    this.ensureLiveRegion();
    this.attachInfoPanelActionHandlersOnce();
};

AppController.initOnLoad = function() {
    if (this._loadWired) return;
    this._loadWired = true;
    this.bindShareEvents();
    this.bindOffcanvasEvents();
    this.bindOverlayEvents();
    this.bindNudgeEvents();
};

window.addEventListener('load', () => {
    AppController.initOnLoad();
});
