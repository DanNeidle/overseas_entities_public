/**
 * © Tax Policy Associates Ltd 2026, and licensed under the Creative Commons BY-SA 4.0 licence (unless stated otherwise).
 * You may freely use and adapt any of our original material for any purpose, provided you attribute it to Tax Policy Associates Ltd.
 * We’d appreciate it if you let us know, but you don't have to.
 *
 * This script defines the interactive tutorial for the Overseas Entities map.
 * It uses the Intro.js library to guide users through the features of the webapp.
 */


// Helper functions used by the tutorial and UI overlays

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
    const highlightOverlay = document.getElementById('custom-highlight-overlay');
    if (highlightOverlay) {
        highlightOverlay.parentElement.removeChild(highlightOverlay);
    }
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
function setupAndStartTutorial() {
    // Helper function to create a delay
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const intro = introJs();
    const tooltipViewportPadding = 12;
    const clampIntroTooltip = () => {
        const tooltip = document.querySelector('.introjs-tooltip');
        if (!tooltip) return;
        keepElementWithinViewport(tooltip, tooltipViewportPadding);
    };
    const centerTooltipInViewport = (tooltip) => {
        if (!tooltip) return;
        const rect = tooltip.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        if (!viewportWidth || !viewportHeight) return;
        const left = Math.max(tooltipViewportPadding, (viewportWidth - rect.width) / 2);
        const top = Math.max(tooltipViewportPadding, (viewportHeight - rect.height) / 2);
        tooltip.style.position = 'fixed';
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.right = 'auto';
        tooltip.style.bottom = 'auto';
        tooltip.style.transform = 'none';
        keepElementWithinViewport(tooltip, tooltipViewportPadding);
    };
    const scheduleTooltipClamp = () => {
        requestAnimationFrame(() => {
            requestAnimationFrame(clampIntroTooltip);
        });
    };

    const handleViewportChange = () => {
        scheduleTooltipClamp();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);

    // 1. Define your steps in a separate array
    const tutorialSteps = [
        // Tutorial step: Disclaimer
        {
            id: 'disclaimer',
            title: 'Please read and agree to this',
            intro: `This webapp presents data on the status of foreign companies owning English and Welsh real estate.<br><br>The analysis is generated automatically and, despite the care taken by our legal and coding team, errors are inevitable.<br><br>Please do not assume that someone has — or has not — broken the law solely on the basis of this webapp. Always investigate further and seek legal advice where needed.<br><br>More information is available in the <a href="https://taxpolicy.org.uk/who-owns-britain-map/" target="_blank" rel="noopener">report that accompanies this webapp</a>.`,
            element: '#intro-center-top-anchor',
            position: 'center',
            tooltipClass: 'introjs-disclaimer-tooltip',
            disableInteraction: true
        },
        // Tutorial step: Welcome
        {
            id: 'welcome', 
            title: 'Welcome!',
            intro: `This app reveals the "<strong>overseas entities</strong>" that own English and Welsh property, and lets us see where the ownership of these entities is hidden (accidentally or intentionally).<br><br>(The tutorial is clearer on desktop but the app should work fine on mobile.)<br><br><small>Version: ${APP_VERSION}</small>`,
            position: 'floating'
        },

        {
            id: 'skippable', 
            title: 'Welcome!',
            intro: 'You can quit this tutorial at any time by pressing the "close" button, and then come back to it later.<br><br>You can use the keyboard to navigate using "enter" or the arrow keys.',
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
            position: 'floating'
        },
        // Tutorial step: Click result
        {
            id: 'click', 
            title: 'Navigation',
            intro: 'Then click on the result and we head there.',
            element: '#placeSearchContainer',
            position: 'floating'
        },

        // Tutorial step: Search
        {
            id: 'search', 
            title: 'Searching',
            intro: 'Alternatively we can search for names of properties, title numbers, or owners here.',
            highlightTarget: '#mapControls > .search-container',
            position: 'right'
        },

        {
            id: 'legend', 
            title: 'Colour and status',
            intro: 'The different colour markers show us the status of the properties. We can make it clearer by clicking on the legend to only see particular categories.',
            element: '#intro-center-anchor',
            position: 'floating',
            highlightTarget: '#legendBox',
        },

        // element: document.querySelector('#legendBox'),            
        // Tutorial step: Green
        {
            id: 'green', 
            title: 'Property disclosed owners',
            intro: '<strong>Green</strong> means property is owned by an overseas entity which is properly registered with Companies House, and the beneficial owners are properly disclosed (either individuals, UK companies or listed companies).',
            element: '#intro-center-anchor',
            position: 'floating'
        },

        // Tutorial step: grey
        {
            id: 'grey', 
            title: 'Failed to register',
            intro: '<strong>Grey</strong> means the overseas entity isn\'t registered with Companies House and so we can\'t see who owns it. This could be because we failed to match the name of the entity holding the property with its Companies House entry (e.g. because of a typo). But in other cases this will usually be unlawful - the overseas entity just failed to register.',
            element: '#intro-center-anchor',
            position: 'floating'
        },

        // Tutorial step: red
        {
            id: 'red', 
            title: 'Suspected hidden ownership',
            intro: '<strong>Red</strong> means the overseas entity declared a foreign company as its beneficial owner, not the individual who really controls it.<br><br>That\'s unlawful unless the company is listed, government owned, or a trustee.',
            element: '#intro-center-anchor',
            position: 'floating'
        },

        // Tutorial step: orange
        {
            id: 'orange', 
            title: 'No declared owners',
            intro: '<strong>Orange</strong> means the overseas entity declared it has no beneficial owners. That can be legitimate, for example if nobody holds 25% (or more) of the company. It can also be a simple failure to comply with the law.',
            element: '#intro-center-anchor',
            position: 'floating'
        },


        // Tutorial step: trust BOs
        {
            id: 'blue', 
            title: 'Only trustees declared',
            intro: '<strong>Blue</strong> properties have only trustees declared as the beneficial owners. We believe in many cases that\'s unlawful - they should declare the real owner.',
            element: '#intro-center-anchor',
            position: 'floating'
        },

        // Tutorial step: sanctioned
        {
            id: 'purple', 
            title: 'Sanctioned',
            intro: 'And <strong>purple</strong> are sanctioned.<br><br>The very small number of purple properties is likely because other sanctioned individuals are hiding their ownership.',
            element: '#intro-center-anchor',
            position: 'floating'
        },


        // Tutorial step: NBS
        {
            id: 'target', 
            title: '£195m hidden ownership',
            intro: "Let's find the biggest red property, a £195m mews property in Kensington.",
            position: 'floating'
            
        },

        // Tutorial step: Click a Marker
        {
            id: 'marker', 
            intro: "Click on the property marker and it brings up an info box.<br><br>(If this message or the info-box is in the way, you can drag it somewhere convenient.)",
            highlightTarget: '#info-panel',
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
            highlightTarget: '#draw-connections'
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
            highlightTarget: '.info-download-btn'
        },


        {
            id: 'infobox-final',
            title: 'The Info Box',
            intro: 'That\'s all the information in the infobox. The app remembers previous properties you\'ve viewed, and you can go back and forth between them using these navigation arrows. Or close the Info Box by clicking the \'x\'',
            highlightTarget: '#info-panel-bar'
        },


        // Tutorial step: Proprietors
        {
            id: 'proprietors',
            title: 'Proprietor mode',
            intro: 'This has all been in the <strong>property</strong> view. But we can also look at the location of <strong>proprietors</strong> - the people whose names are on the land registry as legally owning the property.',
            highlightTarget: '.mode-toggle-btn[data-value="proprietors"]',
            position: 'floating'

        },
        // Tutorial step: BOs
        {
            id: 'BOs',
            title: 'Beneficial owner mode',
            intro: '...or <strong>beneficial owners</strong> - the people who really own the properties',
            highlightTarget: '.mode-toggle-btn[data-value="beneficial_owners"]',
            position: 'floating'
        },

        // Tutorial step: panama
        {
            id: 'panama',
            title: 'Beneficial owner mode',
            intro: '... which can let us see all the beneficial owners in (for example) Panama.',
            highlightTarget: '.mode-toggle-btn[data-value="beneficial_owners"]',
        },
        

        // Tutorial step: resetting
        {
            id: 'reset',
            title: 'Resetting the app',
            intro: 'If you click again on the mode you\'re already in, the app will reset (but will remember your history)',
            highlightTarget: '.mode-toggle-btn[data-value="beneficial_owners"]',
            position: 'floating'
        },

        // Tutorial step: valuable properties
        {
            id: 'valuable',
            title: 'The most £',
            intro: 'Click here to bring up a list of the properties with the highest listed purchase price - then click on each to explore their details.',
            highlightTarget: '#showValuableButton',
            position: 'floating'
        },

        // Tutorial step: rectangle
        {
            id: 'rectangle',
            title: 'Counting',
            intro: 'Other features: click here to draw a rectangle in the map, which counts the number of markers in the rectangle.',
            highlightTarget: '#selectAreaButton',
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
            intro: 'And you can reset the map view by clicking here (but the history will remain stored locally)',
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


    ]

    // 2. Process the array to add default values where needed
    const processedSteps = tutorialSteps.map(step => {
        const elementTarget = step.element || step.highlightTarget || '#intro-center-right-anchor';
        return {
            // Set the defaults first
            element: elementTarget,
            position: 'center',

            // Then, spread the original step to add all its properties.
            ...step
        };
    });

    intro.setOptions({
        exitOnOverlayClick: false,
        showProgress: true,
        showBullets: false,
        showStepNumbers: true,
        scrollToElement: false,
        scrollPadding: 0,
        overlayOpacity: 0,
        nextLabel: 'Next',
        prevLabel: 'Back',
        doneLabel: 'Done',
        steps: processedSteps
    });

    const tutorialControlSelector = '.introjs-nextbutton, .introjs-prevbutton, .introjs-skipbutton, .introjs-donebutton, .introjs-closebutton';
    const captureOptions = true;
    const touchCaptureOptions = { capture: true, passive: false };
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
        const tooltip = document.querySelector('.introjs-tooltip');
        if (!tooltip) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.target.closest('.introjs-tooltip')) {
            return;
        }
        if (event.target.closest('#info-panel, #legendBox, #navigationSearchContainer, #mapControls')) {
            return;
        }
        const isControl = event.target.closest(tutorialControlSelector);
        if (event.type === 'click') {
            if (isControl) return;
            event.preventDefault();
            event.stopPropagation();
            showBlockedInteractionToast();
            return;
        }
        const hasHeader = tooltip.querySelector('.introjs-tooltip-header');
        const dragHandle = hasHeader ? '.introjs-tooltip-header' : '.introjs-tooltip';
        const isDragHandle = event.target.closest(dragHandle);
        if (isControl || isDragHandle) return;
        event.preventDefault();
        event.stopPropagation();
        showBlockedInteractionToast();
    };
    const enableTutorialInteractionGuard = () => {
        document.addEventListener('click', tutorialInteractionBlocker, captureOptions);
        document.addEventListener('mousedown', tutorialInteractionBlocker, captureOptions);
        document.addEventListener('touchstart', tutorialInteractionBlocker, touchCaptureOptions);
    };
    const disableTutorialInteractionGuard = () => {
        document.removeEventListener('click', tutorialInteractionBlocker, captureOptions);
        document.removeEventListener('mousedown', tutorialInteractionBlocker, captureOptions);
        document.removeEventListener('touchstart', tutorialInteractionBlocker, touchCaptureOptions);
    };

    // This event fires before the tour moves to a new step.
    // We use it to trigger actions specific to the upcoming step.
    intro.onbeforechange(async function() {

        
        // 1. Always remove any existing highlight from the previous step.
        removeCustomHighlight();
        window.currentTutorialHighlightTarget = null;
        document.querySelector('.introjs-skipbutton')?.classList.remove('tutorial-skip-highlight');

        const currentStep = this._options.steps[this._currentStep];
        if (!currentStep) return;

        // 2. Add a new highlight ONLY if the upcoming step has a target.
        if (currentStep.highlightTarget) {
            addCustomHighlight(currentStep.highlightTarget);
            window.currentTutorialHighlightTarget = currentStep.highlightTarget;
        }

        

        switch (currentStep.id) {
            case 'disclaimer':
                if (isMobile()) {
                    dismissHamburger();
                }
            case 'welcome':
                if (isMobile()) {
                    dismissHamburger();
                }
                toggleLegendItems(['red', 'orange', 'grey', 'purple']);
                break;
            case 'regent': // Search for Regent Street
                const searchInput = document.getElementById('placeSearchInput');
                searchInput.value = 'Regent Street, London';
                const event = new Event('keyup', { bubbles: true, cancelable: true });
                searchInput.dispatchEvent(event);
                break;

            case 'search': // clear the map search before we explain register search
                if (isMobile()) {
                    showHamburger();
                }

                const resultsDiv = document.getElementById('placeSearchResults');
                if (resultsDiv) {
                    resultsDiv.innerHTML = '';
                    resultsDiv.style.display = 'none';
                }


            case 'green': // Marker Colors
                if (isMobile()) {
                    dismissHamburger();
                }
                toggleLegendItems('green');
                break;
            case 'grey': // Legend Filtering
                toggleLegendItems('grey');
                map.flyTo([51.51146, -0.136664], 15);
                break;
            case 'red': // Legend Filtering
                map.flyTo([51.499874, -0.019655], 14);
                toggleLegendItems('red');
                break;
            case 'orange': // Legend Filtering
                map.flyTo([51.516114, -0.100937], 13);
                toggleLegendItems('orange');
                break;
            case 'blue': // Legend Filtering
                toggleLegendItems(['blue']);
                map.flyTo([51.495145, -0.162520], 15);
                break;
            case 'purple': // Legend Filtering
                toggleLegendItems(['purple']);
                map.flyTo([51.510572, -0.142506], 14);
                break;

            case 'target': // O2
                toggleLegendItems('red');
                break;

            case 'proprietors': //remove clear button
                toggleLegendItems(['red', 'orange', 'grey', 'purple']);
                document.querySelector('#floatingClearButton')?.click();
                UIService.hidePanel();
                break;

            case 'panama': // Panama
                document.querySelector('.mode-toggle-btn[data-value="beneficial_owners"]')?.click();
                await sleep(200);
                map.flyTo([8.97868, -79.528484], 14);
                break;

                

                
        }

    });

    intro.onbeforeexit(function() {
        const currentStep = this._options.steps[this._currentStep];
        if (currentStep?.id === 'disclaimer') {
            return false;
        }
    });


    // This event fires AFTER the tour moves to a new step.
    // We use it to trigger actions specific to the step.
    intro.onafterchange(async function() {
    const currentStep = this._options.steps[this._currentStep];
    const stepId = currentStep?.id;
    const isFirstStep = this._currentStep === 0;
    const tooltipElement = document.querySelector('.introjs-tooltip');
    if (tooltipElement && !tooltipElement.dataset.dragApplied) {
        tooltipElement.dataset.dragApplied = '1';
        const dragHandleSelector = tooltipElement.querySelector('.introjs-tooltip-header')
            ? '.introjs-tooltip-header'
            : null;
        makeElementDraggable(tooltipElement, dragHandleSelector, { suppressClick: true });
        tooltipElement.addEventListener('click', (event) => {
            const isControl = event.target.closest(
                '.introjs-button, .introjs-skipbutton, .introjs-nextbutton, .introjs-prevbutton, .introjs-donebutton'
            );
            if (!isControl) event.stopPropagation();
        });
        // Improve ARIA for the tooltip
        tooltipElement.setAttribute('role', 'dialog');
        tooltipElement.setAttribute('aria-modal', 'true');
        tooltipElement.setAttribute('aria-live', 'polite');
        tooltipElement.setAttribute('tabindex', '-1');
        const titleEl = tooltipElement.querySelector('.introjs-tooltip-title');
        const textEl = tooltipElement.querySelector('.introjs-tooltiptext');
        if (titleEl) {
            if (!titleEl.id) titleEl.id = 'introjs-title';
            tooltipElement.setAttribute('aria-labelledby', titleEl.id);
        }
        if (textEl) {
            if (!textEl.id) textEl.id = 'introjs-text';
            tooltipElement.setAttribute('aria-describedby', textEl.id);
        }
        // Mark the Intro.js overlay as decorative for AT
        const introOverlay = document.querySelector('.introjs-overlay');
        if (introOverlay) {
            introOverlay.setAttribute('aria-hidden', 'true');
            introOverlay.setAttribute('role', 'presentation');
        }

        // Focus it so screen readers announce
        tooltipElement.focus();
    }
    if (tooltipElement) {
        const nextButton = tooltipElement.querySelector('.introjs-nextbutton');
        if (nextButton) {
            nextButton.textContent = stepId === 'disclaimer' ? 'I agree' : 'Next';
        }
        const closeButton = tooltipElement.querySelector('.introjs-skipbutton, .introjs-closebutton');
        if (closeButton) {
            closeButton.style.display = isFirstStep ? 'none' : '';
        }
        if (!tooltipElement.dataset.viewportClamp) {
            tooltipElement.dataset.viewportClamp = '1';
            const clampOnRelease = () => scheduleTooltipClamp();
            tooltipElement.addEventListener('mouseup', clampOnRelease);
            tooltipElement.addEventListener('touchend', clampOnRelease);
        }
        if (isFirstStep) {
            centerTooltipInViewport(tooltipElement);
        }
        scheduleTooltipClamp();
        setTimeout(scheduleTooltipClamp, 80);
        if (stepId === 'skippable') {
            const skipButton = tooltipElement.querySelector('.introjs-skipbutton');
            if (skipButton) {
                skipButton.classList.add('tutorial-skip-highlight');
            }
        }
    }

        // Get the ID of the current step
        if (!stepId) return;

        switch (stepId) {

            
            case 'click': // Click result
                if (isMobile()) {
                    dismissHamburger();
                }
                map.flyTo([51.51146, -0.136664], 17);
                break;

            case 'target': // O2
                await sleep(1000);    
                map.flyTo([51.495369, -0.189954], 18);
                break;

            case 'marker': // Click a Marker
                await sleep(1000);
                const marker = findMarkerByTitleNumber("BGL35514");
                if (marker) {
                    const point = map.latLngToContainerPoint(marker.getLatLng());
                    UIService.showPanel(marker.propertyItem, marker.myId, point);
                }
                break;
                

            case 'proplocation': // Proprietor Location
                
                await sleep(1000);
                map.flyTo([49.18507, -2.110748], 11);
                break;

            case 'BOlocation': // BO Location
                
                await sleep(1000);
                map.flyTo([49.18507, -2.110748], 14);
                break;


            case 'proprietors': //remove clear button and proprietor view
                await sleep(1000);

                document.querySelector('.mode-toggle-btn[data-value="proprietors"]')?.click();

                break;

            case 'BOs': //beneficial owner mode
                await sleep(1000);

                document.querySelector('.mode-toggle-btn[data-value="beneficial_owners"]')?.click();
                break;

            case 'reset': // click active BO button again to reset UI
                await sleep(1000);
                document.querySelector('.mode-toggle-btn[data-value="beneficial_owners"]')?.click();
                break;

            
            case 'valuable': //valuable properties
                document.querySelector('.mode-toggle-btn[data-value="properties"]')?.click();
                await sleep(1000);

                toggleValuablePropertiesPanel();
                break;

            case 'rectangle': // ending
                toggleValuablePropertiesPanel();
                break;

        }
    
    });


    // A flag to track if the user finished the whole tutorial
    let tutorialCompleted = false;

    intro.oncomplete(function() {
        tutorialCompleted = true;
        disableTutorialInteractionGuard();
        window.removeEventListener('resize', handleViewportChange);
        window.removeEventListener('orientationchange', handleViewportChange);
        resetMapAfterTutorial();
    });

    intro.onexit(function() {
        // Only show the alert if the user exited early (i.e., didn't click "Done")
        if (!tutorialCompleted) {
            showCustomToast("You can run the tutorial at any time by pressing the tutorial button ⓘ.");
        }
        disableTutorialInteractionGuard();
        window.removeEventListener('resize', handleViewportChange);
        window.removeEventListener('orientationchange', handleViewportChange);
        resetMapAfterTutorial();
    });

    // Normalize UI before the tutorial starts.
    UIService.hidePanel();
    setPropertyTypeSelection('ALL');

    // Make the tour instance globally available and start it
    window.introJsTour = intro;
    showHamburger();
    enableTutorialInteractionGuard();
    intro.start();


}
