/**
 * © Tax Policy Associates Ltd 2026, and licensed under the Creative Commons BY-SA 4.0 licence (unless stated otherwise).
 * You may freely use and adapt any of our original material for any purpose, provided you attribute it to Tax Policy Associates Ltd.
 * We’d appreciate it if you let us know, but you don't have to.
 *
 * This script defines the interactive tutorial for the Overseas Entities map.
 * It uses the Intro.js library to guide users through the features of the webapp.
 */

(() => {
  'use strict';

// Helper functions used by the tutorial and UI overlays
let currentHighlightTarget = null;
const setCurrentHighlightTarget = (target) => {
  currentHighlightTarget = target || null;
};
const clearCurrentHighlightTarget = () => {
  currentHighlightTarget = null;
};

/**
 * Toggles legend items so that only the given colour(s) are active.
 * @param {string|string[]} colours A single colour or an array of colours to stay active.
 * @returns {void}
 */
function toggleLegendItems(colours) {
  // Normalize to array
  const targets = Array.isArray(colours) ? colours : [colours];

  document.querySelectorAll('.legend-item').forEach(item => {
    const category = item.getAttribute('data-category');
    const isActive = item.getAttribute('data-active') === 'true';
    const shouldBeActive = targets.includes(category);

    // Activate if in targets but currently inactive
    if (shouldBeActive && !isActive) {
      item.click();
    }
    // Deactivate if not in targets but currently active
    else if (!shouldBeActive && isActive) {
      item.click();
    }
  });
}


/**
 * Reset the map and UI to their default state after the tutorial finishes.
 * @returns {void}
 */
function resetMapAfterTutorial() {

  dismissHamburger();

   // clear any stuck highlights on exit
  removeCustomHighlight();


  // 1. Reset map view to a default location and zoom
  map.flyTo([54.5, -3.4], 6); // Example: Center on the UK

  // 2. Hide the info panel if it's open
  UIService.hidePanel();

  // 3. Clear any drawn connection lines or temporary markers
  document.getElementById('floatingClearButton')?.click();

  // 4. Ensure all legend items are active
  toggleLegendItems(['red', 'orange', 'grey', 'purple']);

  // 5. Switch back to the default "properties" mode if needed
  const propertiesButton = document.querySelector('.mode-toggle-btn[data-value="properties"]');
  if (!propertiesButton.classList.contains('active')) {
      propertiesButton.click();
  }
}

/**
 * Create and display a highlight overlay positioned over the target element.
 * @param {HTMLElement|string} target The element or a selector to highlight.
 * @returns {void}
 */
function addCustomHighlight(target) {

    const el =
        typeof target === 'string'
            ? document.querySelector(target)
            : target;

    if (!el) { return; }

    const rect = el.getBoundingClientRect();
    const highlightOverlay = document.createElement('div');
    highlightOverlay.id = 'custom-highlight-overlay';
    highlightOverlay.className = 'custom-highlight';
    // Decorative ring only; hide from AT
    highlightOverlay.setAttribute('role', 'presentation');
    highlightOverlay.setAttribute('aria-hidden', 'true');
    highlightOverlay.style.position = 'absolute';
    highlightOverlay.style.left = `${rect.left + window.scrollX}px`;
    highlightOverlay.style.top = `${rect.top + window.scrollY}px`;
    highlightOverlay.style.width = `${rect.width}px`;
    highlightOverlay.style.height = `${rect.height}px`;
    highlightOverlay.style.pointerEvents = 'none';

    document.body.appendChild(highlightOverlay);
    
}


/**
 * Remove the highlight overlay from the page (by unique ID).
 * @returns {void}
 */
function removeCustomHighlight(target) {
    document.querySelectorAll('#custom-highlight-overlay').forEach(overlay => {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
    });
}

/**
 * Keep a floating element fully within the viewport.
 * @param {HTMLElement} element The element to keep on-screen.
 * @param {number} [padding=12] Minimum space to keep from edges.
 * @returns {void}
 */
function keepElementWithinViewport(element, padding = 12) {
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  if (!viewportWidth || !viewportHeight) return;

  let left = rect.left;
  let top = rect.top;

  const maxLeft = viewportWidth - rect.width - padding;
  const maxTop = viewportHeight - rect.height - padding;

  left = maxLeft < padding ? padding : Math.min(Math.max(left, padding), maxLeft);
  top = maxTop < padding ? padding : Math.min(Math.max(top, padding), maxTop);

  const computedStyle = window.getComputedStyle(element);
  const isFixed = computedStyle.position === 'fixed';
  const offsetX = isFixed ? 0 : window.scrollX;
  const offsetY = isFixed ? 0 : window.scrollY;

  element.style.left = `${left + offsetX}px`;
  element.style.top = `${top + offsetY}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  element.style.transform = 'none';
  element.style.maxHeight = `calc(100vh - ${padding * 2}px)`;
  element.style.overflowY = 'auto';
}


/**
 * Display a custom modal notification that can be dismissed.
 * @param {string} message The message to display.
 * @param {number} [duration=5000] Duration to display the message in milliseconds.
 * @returns {void}
 */
function showCustomToast(message, duration = 5000) {

  addCustomHighlight("#reRunTutorialButton");
  
  // Create overlay and toast elements
  const overlay = document.createElement('div');
  overlay.className = 'toast-overlay';
  overlay.setAttribute('role', 'presentation');
  overlay.setAttribute('aria-hidden', 'true');

  const toast = document.createElement('div');
  toast.className = 'tutorial-exit-toast';
  toast.setAttribute('role', 'dialog');
  toast.setAttribute('aria-modal', 'true');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-label', 'Tutorial message');
  toast.setAttribute('tabindex', '-1');
  toast.innerHTML = `
    ${message}
    <button class="toast-close-btn" aria-label="Close message">&times;</button>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(toast);

  // Function to dismiss the toast and overlay
  const dismiss = () => {
    // Clear the auto-dismiss timer if closed manually
    clearTimeout(autoDismissTimer);

    removeCustomHighlight();
    
    // Fade out
    overlay.classList.remove('visible');
    toast.classList.remove('visible');

    // Remove from DOM after transition
    setTimeout(() => {
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300); // Must match CSS transition duration
  };

  // Event Listeners
  overlay.addEventListener('click', dismiss);
  toast.querySelector('.toast-close-btn').addEventListener('click', dismiss);

  // Prevent clicking inside the toast from closing it
  toast.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Fade in
  setTimeout(() => {
    overlay.classList.add('visible');
    toast.classList.add('visible');
    // Move focus to dialog for accessibility
    toast.focus();
  }, 10);

  // Auto-dismiss timer
  const autoDismissTimer = setTimeout(dismiss, duration);
}


/**
 * Initialize and start the Intro.js tutorial; wires pre/post step hooks.
 * @returns {void}
 */
// Helper function to create a delay (moved to top level)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let lastBlockedToastAt = 0;
const showBlockedInteractionToast = () => {
    const now = Date.now();
    if (now - lastBlockedToastAt < 2000) return;
    lastBlockedToastAt = now;
    if (document.querySelector('.tutorial-blocked-toast')) return;
    const toast = document.createElement('div');
    toast.className = 'tutorial-blocked-toast';
    toast.textContent = 'Please exit the tutorial before using the app.';
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 250);
    }, 1800);
};

const tutorialInteractionBlocker = (event) => {
    if (event.isTrusted === false) {
        return;
    }
    // Allow clicks inside the tutorial window
    if (event.target.closest('#custom-tutorial-window')) return;
    
    // Allow clicks on navigation/tutorial controls
    if (event.target.closest('.tutorial-btn')) return;

    // Allow reset controls while tutorial is active
    if (event.target.closest('#clearButton, #floatingClearButton')) return;

    // Allow drag start on movable UI panels (but keep clicks blocked)
    if (
        event.type !== 'click' &&
        event.target.closest('#info-panel-bar, #legendBox, #mapControls, #navigationSearchContainer, #valuable-properties-bar')
    ) {
        return;
    }

    // OPTIONAL: Allow clicks on the specific highlight target of the current step
    // const currentTarget = window.currentTutorialHighlightTarget; 
    // if (currentTarget && event.target.closest(currentTarget)) return;

    // Block everything else
    event.preventDefault();
    event.stopPropagation();
    showBlockedInteractionToast();
};

const enableTutorialInteractionGuard = () => {
    const opts = { capture: true, passive: false };
    document.addEventListener('click', tutorialInteractionBlocker, opts);
    document.addEventListener('mousedown', tutorialInteractionBlocker, opts);
    document.addEventListener('touchstart', tutorialInteractionBlocker, opts);
};

const disableTutorialInteractionGuard = () => {
    const opts = { capture: true, passive: false };
    document.removeEventListener('click', tutorialInteractionBlocker, opts);
    document.removeEventListener('mousedown', tutorialInteractionBlocker, opts);
    document.removeEventListener('touchstart', tutorialInteractionBlocker, opts);
};


/**
 * Custom Tutorial Engine
 * Replaces Intro.js to provide full control over positioning and interactions.
 */
const TutorialService = {
        steps: [],
        currentStepIndex: 0,
        isActive: false,
        _boundHandleKey: null,
        _navLockUntil: 0,

        _boundReposition: null, // Add storage for bound function
        _highlightTimer: null,

        start: function() {
            // ... existing setup ...
            
            // Bind the reposition function to 'this' context
            this._boundReposition = () => {
                if (this.isActive && this.steps[this.currentStepIndex]) {
                    this._positionWindow(this.steps[this.currentStepIndex]);
                    // Also update the highlight box if needed
                    if (this.steps[this.currentStepIndex].highlightTarget) {
                        removeCustomHighlight();
                        addCustomHighlight(this.steps[this.currentStepIndex].highlightTarget);
                    }
                }
            };
            
            window.addEventListener('resize', this._boundReposition);
            window.addEventListener('scroll', this._boundReposition); // helpful for mobile address bars
        },

        end: function(completed = false) {
            // ... existing cleanup ...
            if (this._boundReposition) {
                window.removeEventListener('resize', this._boundReposition);
                window.removeEventListener('scroll', this._boundReposition);
            }
        },
        
        // --- Configuration (Pasted from your original file) ---
        getSteps: function() {
            // Steps may define onEnter (pre-render) and onLeave (post-render) hooks.
            return [
        
        // Tutorial step: Welcome
        {
            id: 'welcome', 
            title: 'Welcome!',
            intro: `This app reveals "<strong>overseas entities</strong>" that own English/Welsh property but may not have properly disclosed their true beneficial owners. Please read our <a href="https://taxpolicy.org.uk/who-owns-britain-map/" target="_blank" rel="noopener">report</a> before reaching any conclusions about any particular property/person.<br><br>(You may find the tutorial clearer on desktop)<br><br><small>Version: ${APP_VERSION}</small>`,
            onEnter: () => {
                if (isMobile()) {
                    dismissHamburger();
                }
                toggleLegendItems(['red', 'orange', 'grey', 'purple']);
            },
            position: 'floating'
        },

        {
            id: 'skipping', 
            title: 'Welcome!',
            intro: 'You can quit this tutorial at any time by pressing the "close" button, and then come back to it later.<br><br>You can use the keyboard to navigate using "enter" or the arrow keys.',
            onLeave: () => {
                document.querySelector('.tutorial-close')?.classList.add('tutorial-skip-highlight');
            },
            position: 'floating'

        },
        // Tutorial step: Property Mode
        {
            id: 'property', 
            title: 'Property Mode',
            intro: 'We start off in <strong>property mode</strong>, showing the location of properties owned by "overseas entities".<br><br>NB you can grab these tutorial windows by clicking the title at the top, and then drag them around if you want to see what\'s underneath them.',
            highlightTarget: '.mode-toggle-btn[data-value="properties"]',
            position: 'floating'
        },
        {
            id: 'property', 
            title: 'Property Mode',
            intro: 'Initially it shows all properties, but you can click here to focus on different types of residential property e.g. detached houses..',
            highlightTarget: '.property-type-selector',
            position: 'floating'
        },
        // Tutorial step: Map Navigation
        {
            id: 'navigation', 
            title: 'Navigation',
            intro: 'You can move around the map and zoom in/out with the mouse (desktop) or touch (mobile).<br><br>And if this box, or anything else, gets in your way, just drag it around.',
            position: 'floating'
        },

        // Tutorial step: Search for Regent Street
        {
            id: 'regent', 
            title: 'Navigation',
            intro: "Or we can search the map for locations. Let's fly to Regent Street.",
            highlightTarget: '#placeSearchContainer',
            onEnter: () => {
                const searchInput = document.getElementById('placeSearchInput');
                if (!searchInput) return;
                searchInput.value = 'Regent Street, London';
                const event = new Event('keyup', { bubbles: true, cancelable: true });
                searchInput.dispatchEvent(event);
            },
            position: 'floating'
        },
        // Tutorial step: Click result
        {
            id: 'click', 
            title: 'Navigation',
            intro: 'Then click on the result and we head there.',
            element: '#placeSearchContainer',
            onLeave: () => {
                if (isMobile()) {
                    dismissHamburger();
                }
                map.flyTo([51.51146, -0.136664], 17);
            },
            position: 'floating'
        },

        // Tutorial step: Search
        {
            id: 'search', 
            title: 'Searching',
            intro: 'Alternatively we can search for names of properties, title numbers, or owners here.',
            highlightTarget: '#mapControls > .search-container',
            onEnter: () => {
                if (isMobile()) {
                    showHamburger();
                }

                const resultsDiv = document.getElementById('placeSearchResults');
                if (resultsDiv) {
                    resultsDiv.innerHTML = '';
                    resultsDiv.style.display = 'none';
                }
            },
            position: 'right'
        },

        {
            id: 'legend', 
            title: 'Colour and status',
            intro: 'The different colour markers show us the status of the properties. We can make it clearer by clicking on the legend to only see particular categories.',
            
            position: 'floating',
            highlightTarget: '#legendBox',
        },

        // element: document.querySelector('#legendBox'),            
        // Tutorial step: Green
        {
            id: 'green', 
            title: 'Property disclosed owners',
            intro: '<strong>Green</strong> means property is owned by an overseas entity which is properly registered with Companies House, and the beneficial owners are properly disclosed (either individuals, UK companies or listed companies).',
            onEnter: () => {
                if (isMobile()) {
                    dismissHamburger();
                }
                toggleLegendItems('green');
            },
            
            position: 'floating'
        },

        // Tutorial step: grey
        {
            id: 'grey', 
            title: 'Failed to register',
            intro: '<strong>Grey</strong> means the overseas entity isn\'t registered with Companies House and so we can\'t see who owns it. This could be because we failed to match the name of the entity holding the property with its Companies House entry (e.g. because of a typo). But in other cases this will usually be unlawful - the overseas entity just failed to register.',
            onEnter: () => {
                toggleLegendItems('grey');
                map.flyTo([51.51146, -0.136664], 15);
            },
            
            position: 'floating'
        },

        // Tutorial step: red
        {
            id: 'red', 
            title: 'Suspected hidden ownership',
            intro: '<strong>Red</strong> means the overseas entity declared a foreign company as its beneficial owner, not the individual who really controls it.<br><br>That\'s unlawful unless the company is listed, government owned, or a trustee.',
            onEnter: () => {
                map.flyTo([51.499874, -0.019655], 14);
                toggleLegendItems('red');
            },
            
            position: 'floating'
        },

        // Tutorial step: orange
        {
            id: 'orange', 
            title: 'No declared owners',
            intro: '<strong>Orange</strong> means the overseas entity declared it has no beneficial owners. That can be legitimate, for example if nobody holds 25% (or more) of the company. It can also be a simple failure to comply with the law.',
            onEnter: () => {
                map.flyTo([51.516114, -0.100937], 13);
                toggleLegendItems('orange');
            },
            
            position: 'floating'
        },


        // Tutorial step: trust BOs
        {
            id: 'blue', 
            title: 'Only trustees declared',
            intro: '<strong>Blue</strong> properties have only trustees declared as the beneficial owners. We believe in many cases that\'s unlawful - they should declare the real owner.',
            onEnter: () => {
                toggleLegendItems(['blue']);
                map.flyTo([51.495145, -0.162520], 15);
            },
            
            position: 'floating'
        },

        // Tutorial step: sanctioned
        {
            id: 'purple', 
            title: 'Sanctioned',
            intro: 'And <strong>purple</strong> are sanctioned.<br><br>The very small number of purple properties is likely because other sanctioned individuals are hiding their ownership.',
            onEnter: () => {
                toggleLegendItems(['purple']);
                map.flyTo([51.510572, -0.142506], 14);
            },
            
            position: 'floating'
        },


        // Tutorial step: NBS
        {
            id: 'target', 
            title: '£195m hidden ownership',
            intro: "Let's find the biggest red property, a £195m mews property in Kensington.",
            onEnter: () => {
                toggleLegendItems('red');
            },
            onLeave: async () => {
                await sleep(1000);
                map.flyTo([51.495369, -0.189954], 18);
            },
            position: 'floating'
            
        },

        // Tutorial step: Click a Marker
        {
            id: 'marker', 
            title: 'Viewing the detail',
            intro: "Click on the property marker and it brings up an info box.<br><br>(If this message or the info-box is in the way, you can drag it somewhere convenient.)",
            onLeave: async () => {
                await sleep(1000);
                const marker = findMarkerByTitleNumber("BGL35514");
                if (marker) {
                    const point = map.latLngToContainerPoint(marker.getLatLng());
                    UIService.showPanel(marker.propertyItem, marker.myId, point);
                }
            },
            position: 'left'
            
        },

        {
            id: 'infobox-start',
            title: 'The Info Box',
            intro: 'This box contains all the details for the selected property. Let\'s go through it section by section. You can drag this tutorial window if it gets in the way.',
            highlightTarget: '#info-panel',
            position: 'left'
        },
        

            {
            id: 'infobox-property-header',
            title: 'Property Details',
            intro: 'The first section at the top always describes the property itself.',
            highlightTarget: '#info-panel .info-item:first-of-type',
            position: 'bottom'
        },
        {
            id: 'infobox-status-circle',
            title: 'Status Indicator',
            intro: 'This coloured circle shows the property\'s overall status, matching the colours in the legend. Hover over it for a brief description.<br><br>Here it\'s red - we suspect the true beneficial owner is not disclosed.',
            highlightTarget: '#info-panel .status-circle-indicator',
            position: 'left'
        },
        {
            id: 'infobox-property-icons',
            title: 'Investigation Icons',
            intro: 'These icons are for exploring further. 🚀 flies to the property on this map, G searches Google for the address, and 🌎 opens the location in Google Maps.',
            highlightTarget: '#property-icons',
            position: 'left'
        },
        {
            id: 'infobox-land-registry-details',
            title: 'Purchase Details',
            intro: 'Below the address, you can find the date the property was acquired and the price paid, according to the Land Registry.',
            highlightTarget: '#info-panel .info-item:first-of-type .address-text',
            position: 'left'
        },
        {
            id: 'infobox-title-number',
            title: 'Land Registry Title',
            intro: 'This is the unique title number for the property. Click the 🔍 icon to automatically copy the title and open the official Land Registry search page in a new tab.',
            highlightTarget: '#info-panel-title-number',
            position: 'left'
        },

        // --- CONNECTIONS BUTTON ---
        {
            id: 'infobox-connections-button',
            title: 'Visualise Connections',
            intro: 'Click this button to draw lines on the map connecting the property to its owner (the proprietor) and the proprietor to its ultimate beneficial owner(s). It\'s a great way to see the ownership chain visually.',
            highlightTarget: '#property-icons [data-action="visualise-links"]'
        },

        // --- PROPRIETOR SECTION ---
        {
            id: 'infobox-proprietor-header',
            title: 'The Proprietor',
            intro: 'Next up is the <strong>proprietor</strong>: this is the company officially registered at the Land Registry as the legal owner of the property.',
            highlightTarget: '#info-panel .proprietor-block .entity-title'
        },
        {
            id: 'infobox-proprietor-name',
            title: 'Proprietor Name',
            intro: 'This is the proprietor\'s name - i.e. the name of the overseas entity that owns the property.',
            highlightTarget: '#info-panel .proprietor-block .entity-name'
        },
        {
            id: 'infobox-proprietor-badge',
            title: 'Proprietor\'s Portfolio',
            intro: 'This badge shows how many other UK properties this same proprietor owns. Click on it to find all of them on the map!',
            highlightTarget: '#info-panel .proprietor-block .ownership-count-badge'
        },
        {
            id: 'infobox-proprietor-icons',
            title: 'Investigate the Proprietor',
            intro: 'Use these icons to dig deeper: the factory icon (🏭) searches Companies House for the proprietor\'s registration details. The others are as before - 🚀 flies to the property on this map, G searches Google for the address, and 🌎 opens the location in Google Maps.',
            highlightTarget: '#info-panel .proprietor-block .entity-name' // Highlight parent
        },
        {
            id: 'infobox-proprietor-address',
            title: 'Proprietor Address',
            intro: 'This is the official registered address for the proprietor company.',
            highlightTarget: '#info-panel .proprietor-block > .info-item:first-of-type .address-text'
        },

        // --- BENEFICIAL OWNER SECTION ---
        {
            id: 'infobox-bo-header',
            title: 'The beneficial owner',
            intro: 'Finally, we have the <strong>beneficial owners</strong>. These are the real people who are meant to ultimately own or control the proprietor company.',
            highlightTarget: '#info-panel .bo-item .entity-title'
        },
        {
            id: 'infobox-bo-name',
            title: 'The beneficial owner',
            intro: 'In most cases, this should be an individual person\'s name. Here it isn\'t - it\'s a company. That is likely unlawful.',
            highlightTarget: '#info-panel .bo-item .entity-name'
        },

        {
            id: 'infobox-proprietor-status',
            title: 'The beneficial owner',
            intro: 'That\'s why this is a "<strong>red</strong>" property, and the reason is explained in the status badge.<br><br>(Although this is a bona fide company and we expect a mistake rather than something sinister.)',
            highlightTarget: '#info-panel .proprietor-block .status-badge'
        },
        {
            id: 'infobox-bo-badge',
            title: 'The beneficial owner',
            intro: 'Just like with the proprietor, this badge shows how many other properties are ultimately owned by this same beneficial owner. Click it to explore their full portfolio.',
            highlightTarget: '#info-panel .bo-item .ownership-count-badge'
        },
        {
            id: 'infobox-bo-icons',
            title: 'The beneficial owner',
            intro: 'Again the icons will dig deeper: 🚀 flies to the property on this map, G searches Google for the address, and 🌎 opens the location in Google Maps.',
            highlightTarget: '#info-panel .bo-item .entity-name' // Highlight parent
        },
        {
            id: 'infobox-bo-control',
            title: 'Nature of Control',
            intro: 'These icons explain how this person controls the company. Hover over each one for a detailed explanation of their control (e.g., through shares, voting rights, or the right to appoint directors).',
            highlightTarget: '#info-panel .bo-item .control-icons'
        },
        {
            id: 'infobox-bo-address',
            title: 'Beneficial Owner Address',
            intro: 'This is the registered address for the beneficial owner.',
            highlightTarget: '#info-panel .bo-item .address-text'
        },
        {
            id: 'infobox-download',
            title: 'Infobox',
            intro: 'You can download all the data in the infobox by clicking here.',
            highlightTarget: '#info-download'
        },


        {
            id: 'infobox-final',
            title: 'The Info Box',
            intro: 'That\'s all the information in the infobox. The app remembers previous properties you\'ve viewed, and you can go back and forth between them using the two navigation arrows. Or close the Info Box by clicking the \'x\'',
            highlightTarget: '#info-panel-bar'
        },


        // Tutorial step: Proprietors
        {
            id: 'proprietors',
            title: 'Proprietor mode',
            intro: 'This has all been in the <strong>property</strong> view. But we can also look at the location of <strong>proprietors</strong> - the people whose names are on the land registry as legally owning the property.',
            highlightTarget: '.mode-toggle-btn[data-value="proprietors"]',
            onEnter: () => {
                toggleLegendItems(['red', 'orange', 'grey', 'purple']);
                document.querySelector('#floatingClearButton')?.click();
                UIService.hidePanel();
            },
            onLeave: async () => {
                await sleep(1000);
                document.querySelector('.mode-toggle-btn[data-value="proprietors"]')?.click();
            },
            position: 'floating'

        },
        // Tutorial step: BOs
        {
            id: 'BOs',
            title: 'Beneficial owner mode',
            intro: '...or <strong>beneficial owners</strong> - the people who really own the properties',
            highlightTarget: '.mode-toggle-btn[data-value="beneficial_owners"]',
            onLeave: async () => {
                await sleep(1000);
                document.querySelector('.mode-toggle-btn[data-value="beneficial_owners"]')?.click();
            },
            position: 'floating'
        },

        // Tutorial step: panama
        {
            id: 'panama',
            title: 'Beneficial owner mode',
            intro: '... which can let us see all the beneficial owners in (for example) Panama.',
            highlightTarget: '.mode-toggle-btn[data-value="beneficial_owners"]',
            onEnter: async () => {
                map.flyTo([8.97868, -79.528484], 14);
            }
        },
        

        // Tutorial step: resetting
        {
            id: 'reset',
            title: 'Resetting the app',
            intro: 'If you click again on the mode you\'re already in, the view will reset (but will remember your history)',
            highlightTarget: '.mode-toggle-btn[data-value="beneficial_owners"]',
            onLeave: async () => {
                await sleep(1000);
                document.querySelector('.mode-toggle-btn[data-value="beneficial_owners"]')?.click();
            },
            position: 'floating'
        },

        // Tutorial step: valuable properties
        {
            id: 'valuable',
            title: 'The most £',
            intro: 'Click here to bring up a list of the properties with the highest listed purchase price - then click on each to explore their details.',
            highlightTarget: '#showValuableButton',
            onLeave: async () => {
                document.querySelector('.mode-toggle-btn[data-value="properties"]')?.click();
                await sleep(1000);
                toggleValuablePropertiesPanel();
            },
            position: 'floating'
        },

        // Tutorial step: rectangle
        {
            id: 'rectangle',
            title: 'Counting',
            intro: 'Other features: click here to draw a rectangle in the map, which counts the number of markers in the rectangle.',
            highlightTarget: '#selectAreaButton',
            onLeave: () => {
                toggleValuablePropertiesPanel();
            },
            position: 'floating'
        },

        {
            id: 'mylocation',
            title: 'What\'s near me?',
            intro: 'Or click here to pan and zoom to your current location.',
            highlightTarget: '#goToLocationButton',
            position: 'floating'
        },

        // Tutorial step: share
        {
            id: 'share',
            title: 'Sharing',
            intro: 'If you find something interesting, click here to generate a unique link (copied to clipboard) that you can share with others. If they click that url, they\'ll go to the exact same view that you found.',
            highlightTarget: '#shareViewButton',
            position: 'floating'
        },

        // Tutorial step: clear
        {
            id: 'clearbutton',
            title: 'Resetting the view',
            intro: 'And you can reset the map view completely by clicking here (but the history of properties you viewed will remain stored locally)',
            highlightTarget: '#clearButton',
            position: 'floating'
        },


        // Tutorial step: logo
        {
            id: 'logo',
            title: 'More information',
            intro: 'That\'s the introduction to the interface. More in the article - which you can jump to by clicking the logo at the top-left of the screen.<br><br>And please never draw conclusions about a property/company without reviewing its position in detail.',
            position: 'floating'
        },

        // Tutorial step: re-run
        {
            id: 'rerun',
            title: 'Thank you!',
            intro: 'Thanks for watching this tutorial.<br><br>You can re-run the tutorial at any time.',
            highlightTarget: '#reRunTutorialButton',
            position: 'floating'
        },


    ];
    },

    /**
     * Start the tutorial
     */
    /**
     * Start the tutorial
     */
    start: function() {
        if (this.isActive) return;
        
        this.steps = this.getSteps();
        this.currentStepIndex = 0;
        this.isActive = true;

        // --- UI Initialization (Restored) ---
        UIService.hidePanel();
        setPropertyTypeSelection('ALL');
        showHamburger(); 
        // ------------------------------------

        // Ensure UI is ready
        if (isMobile()) dismissHamburger();
        
        // Render the container once
        this._createWindow();

        enableTutorialInteractionGuard();
        
        // Show first step
        this.goToStep(0);
        
        // Add keyboard listeners
        if (!this._boundHandleKey) {
            this._boundHandleKey = this._handleKey.bind(this);
        }
        document.addEventListener('keydown', this._boundHandleKey);
    },

    /**
     * Clean up and exit
     * @param {boolean} completed - true if the user finished the last step
     */
    end: function(completed = false) {
        
        disableTutorialInteractionGuard();
        // Show toast only if exiting early
        if (!completed) {
            showCustomToast("You can run the tutorial at any time by pressing the tutorial button ⓘ.");
        }

        this.isActive = false;
        this._removeWindow();
        removeCustomHighlight();
        clearCurrentHighlightTarget();
        if (this._boundHandleKey) {
            document.removeEventListener('keydown', this._boundHandleKey);
        }
        
        // Run your existing cleanup logic
        resetMapAfterTutorial();
    },

    next: function() {
        if (Date.now() < this._navLockUntil) return;
        this._navLockUntil = Date.now() + 300;
        if (this.currentStepIndex < this.steps.length - 1) {
            this.goToStep(this.currentStepIndex + 1);
        } else {
            // Pass true to indicate natural completion
            this.end(true);
        }
    },

    prev: function() {
        if (Date.now() < this._navLockUntil) return;
        this._navLockUntil = Date.now() + 300;
        if (this.currentStepIndex > 0) {
            this.goToStep(this.currentStepIndex - 1);
        }
    },

    /**
     * Core logic to switch steps
     */
    goToStep: async function(index) {
        document.querySelector('.tutorial-close')?.classList.remove('tutorial-skip-highlight');

        const step = this.steps[index];
        this.currentStepIndex = index;
        setCurrentHighlightTarget(step.highlightTarget || null);

        if (step.onEnter) {
            await step.onEnter();
        }

        // 2. Handle Highlights
        if (this._highlightTimer) {
            clearTimeout(this._highlightTimer);
            this._highlightTimer = null;
        }
        removeCustomHighlight();
        if (step.highlightTarget) {
            const targetId = step.id;
            // Wait a tick for UI to update if needed (e.g. menu opening)
            this._highlightTimer = setTimeout(() => {
                if (this.steps[this.currentStepIndex]?.id !== targetId) return;
                removeCustomHighlight();
                addCustomHighlight(step.highlightTarget);
            }, 50);
        }

        // 3. Render Content
        this._updateWindowContent(step);

        // 4. Position Window
        // We do this AFTER content update so we know the window size
        requestAnimationFrame(() => {
            this._positionWindow(step);
        });

        // Post-render hook for the current step
        if (step.onLeave) {
            await step.onLeave();
        }
    },

    /**
     * Logic to position the window
     * - 'center' (or missing target): Centers on screen
     * - target exists: Positions near target, clamps to viewport
     */
    _positionWindow: function(step) {
        const win = document.getElementById('custom-tutorial-window');
        if (!win) return;

        // Reset transform for calculations
        win.style.transform = 'none';
        
        const winRect = win.getBoundingClientRect();
        const padding = 15;
        
        let targetRect = null;
        if (step.highlightTarget) {
            const el = document.querySelector(step.highlightTarget);
            if (el) targetRect = el.getBoundingClientRect();
        }

        let top, left;

        // Case A: No target (dock or center)
        if (!targetRect || step.position === 'center') {
            if (!targetRect && step.position === 'bottom') {
                top = window.innerHeight - winRect.height - padding;
                left = (window.innerWidth - winRect.width) / 2;
            } else if (!targetRect && step.position === 'top') {
                top = padding;
                left = (window.innerWidth - winRect.width) / 2;
            } else {
                top = (window.innerHeight - winRect.height) / 2;
                left = (window.innerWidth - winRect.width) / 2;
            }
        } 
        // Case B: Position relative to target
        else {
            // Default: place below
            top = targetRect.bottom + padding;
            left = targetRect.left + (targetRect.width / 2) - (winRect.width / 2);

            // Simple collision detection
            // If goes off bottom, put on top
            if (top + winRect.height > window.innerHeight - padding) {
                top = targetRect.top - winRect.height - padding;
            }
        }

        // Final Clamp to Viewport (Your robust logic)
        const maxLeft = window.innerWidth - winRect.width - padding;
        const maxTop = window.innerHeight - winRect.height - padding;
        
        left = Math.max(padding, Math.min(left, maxLeft));
        top = Math.max(padding, Math.min(top, maxTop));

        win.style.top = `${top}px`;
        win.style.left = `${left}px`;
    },

    /**
     * Create the DOM element for the window
     */
    _createWindow: function() {
        if (document.getElementById('custom-tutorial-window')) return;

        const win = document.createElement('div');
        win.id = 'custom-tutorial-window';
        win.className = 'tutorial-window';
        
        // Structure
        win.innerHTML = `
            <div class="tutorial-header">
                <span id="tut-title"></span>
                <button class="tutorial-btn tutorial-close" onclick="TutorialService.end()" aria-label="Close">&times;</button>
            </div>
            <div class="tutorial-content" id="tut-content"></div>
            <div class="tutorial-footer">
                <button class="tutorial-btn" id="tut-prev" onclick="TutorialService.prev()">Back</button>
                <div class="tutorial-step-dots" id="tut-dots"></div>
                <button class="tutorial-btn primary" id="tut-next" onclick="TutorialService.next()">Next</button>
            </div>
        `;

        document.body.appendChild(win);
        
        // Add drag capability
        makeElementDraggable(win, '.tutorial-header', { suppressClick: true });

        // Trigger fade in
        requestAnimationFrame(() => win.classList.add('visible'));
    },

    _removeWindow: function() {
        const win = document.getElementById('custom-tutorial-window');
        if (win) win.remove();
    },

    _updateWindowContent: function(step) {
        const titleEl = document.getElementById('tut-title');
        const contentEl = document.getElementById('tut-content');
        const dotsEl = document.getElementById('tut-dots');
        const prevBtn = document.getElementById('tut-prev');
        const nextBtn = document.getElementById('tut-next');
        const win = document.getElementById('custom-tutorial-window');

        if (win) {
            win.classList.add('is-transitioning');
        }

        if (titleEl) titleEl.innerText = step.title || 'Tutorial';
        if (contentEl) contentEl.innerHTML = step.intro;

        // Update buttons
        if (prevBtn) prevBtn.disabled = this.currentStepIndex === 0;
        if (nextBtn) nextBtn.innerText = (this.currentStepIndex === this.steps.length - 1) ? 'Finish' : 'Next';

        // Update dots (progress indicator, not 1:1 with steps)
        if (dotsEl) {
            dotsEl.innerHTML = '';

            const totalSteps = this.steps.length;
            const maxDots = 7;
            const dotCount = Math.min(totalSteps, maxDots);
            const progressRatio = totalSteps <= 1 ? 0 : this.currentStepIndex / (totalSteps - 1);
            const activeDotIndex = Math.round(progressRatio * (dotCount - 1));

            for (let i = 0; i < dotCount; i += 1) {
                const dot = document.createElement('div');
                const isActive = i === activeDotIndex;
                const isCompleted = i < activeDotIndex;
                dot.className = `tutorial-dot${isActive ? ' active' : ''}${isCompleted ? ' completed' : ''}`;
                dotsEl.appendChild(dot);
            }
        }

        if (win) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => win.classList.remove('is-transitioning'));
            });
        }
    },

    _handleKey: function(e) {
        if (e.key === 'ArrowRight' || e.key === 'Enter') this.next();
        if (e.key === 'ArrowLeft') this.prev();
        if (e.key === 'Escape') this.end();
    }
    };

    TutorialService.addCustomHighlight = addCustomHighlight;
    TutorialService.removeCustomHighlight = removeCustomHighlight;
    TutorialService.getCurrentHighlightTarget = () => currentHighlightTarget;

    // Make it global so HTML buttons can access it
    window.TutorialService = TutorialService;
})();
