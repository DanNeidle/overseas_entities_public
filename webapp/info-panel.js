

// --- Info panel history state ---
let infoHistory = [];
let infoHistoryIndex = -1; // -1 means empty
let suppressHistoryPush = false; // used during back/forward navigation
let propertyHighlightRing = null;

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
    const encodedName = encodeURIComponent(name);

    // The badge is now a clickable link (<a> tag) that executes the search.
    // We encode the name to safely handle names with quotes or special characters.
    return `
        <a href="#"
           class="ownership-count-badge"
           role="button"
           data-action="ownership-search"
           data-name="${escapeHtmlAttribute(encodedName)}"
           data-role="${escapeHtmlAttribute(role)}"
           data-tooltip-infopanel="${escapeHtmlAttribute(tooltipText)}"
           data-stop-propagation="true">
           ${count}
        </a>`;
}

function getPropertyTypeLabel(value) {
    if (value === undefined || value === null) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();

    if (upper === 'O' || lower === 'other' || lower === 'o/other') return '';

    const codeMap = {
        D: 'detached house',
        S: 'semi-detached house',
        T: 'terraced house',
        F: 'flat',
    };
    if (codeMap[upper]) return codeMap[upper];

    if (lower.includes('semi') && lower.includes('detached')) return 'semi-detached house';
    if (lower.includes('detached')) return 'detached house';
    if (lower.includes('terrace') || lower.includes('terraced')) return 'terraced house';
    if (lower.includes('flat') || lower.includes('maisonette')) return 'flat';
    return '';
}

function createFlyThereIcon(lat, lon, title, propertyTitleNumber, markerId, categoryForColor = null, zoomLevel = null) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return '';

    const safeTitleAttr = escapeHtmlAttribute(title);
    // Determine the highlight color: prefer an explicit category/status if provided; otherwise fall back
    // to the previous behavior (deriving via getMarkerColor on the title, which defaults to green).
    const color = categoryForColor
        ? RUNTIME.CATEGORY_COLORS[getMarkerColor(categoryForColor)]
        : RUNTIME.CATEGORY_COLORS[getMarkerColor(title)];
    const zoom = (typeof zoomLevel === 'number' && !isNaN(zoomLevel)) ? zoomLevel : 12;

    return `
        <a href="#"
            data-tooltip-infopanel="Fly to location"
            aria-label="Fly to location"
            data-action="fly-to"
            data-lat="${latNum}"
            data-lon="${lonNum}"
            data-color="${escapeHtmlAttribute(color)}"
            data-title="${safeTitleAttr}"
            data-property-title-number="${escapeHtmlAttribute(propertyTitleNumber)}"
            data-marker-id="${escapeHtmlAttribute(markerId)}"
            data-zoom="${zoom}"
            data-stop-propagation="true"
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
        <a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="Google search" data-stop-propagation="true">
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
        <a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="Google Maps search" data-stop-propagation="true">
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
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="${ariaLabel}" data-stop-propagation="true">
            <i class="material-symbols-outlined" aria-hidden="true">factory</i>
        </a>
    `;
}

function createCompaniesHouseUkSearchIcon(name) {
    if (!name) return '';
    const encoded = encodeURIComponent(String(name).trim()).replace(/%20/g, '+');
    const url = `https://find-and-update.company-information.service.gov.uk/search?q=${encoded}`;
    const tooltipText = 'Companies House search';
    const ariaLabel = 'Companies House search';
    return `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="search-icon" data-tooltip-infopanel="${tooltipText}" aria-label="${ariaLabel}" data-stop-propagation="true">
            <i class="material-symbols-outlined" aria-hidden="true">factory</i>
        </a>
    `;
}

function truncateWithTooltip(str, limit) {
    // Use the custom data attribute instead of the native `title` attribute
    // for a consistent look and feel with the rest of the application's tooltips.
    return `<span data-tooltip-infopanel="${str}">${truncate(str, limit)}</span>`;
}

// Helper: get control type info from either a long code key or a compact numeric ID
function getControlInfo(code) {
    if (!STATE.DATA.CONTROL_TYPES_MAP) return null;
    // Direct lookup by long code
    if (typeof code === 'string' && STATE.DATA.CONTROL_TYPES_MAP[code]) return STATE.DATA.CONTROL_TYPES_MAP[code];
    // Numeric or numeric-like code → map via _ids
    const idStr = String(code);
    const idsMap = STATE.DATA.CONTROL_TYPES_MAP._ids;
    if (idsMap && Object.prototype.hasOwnProperty.call(idsMap, idStr)) {
        const longCode = idsMap[idStr];
        return STATE.DATA.CONTROL_TYPES_MAP[longCode] || null;
    }
    return null;
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

function sanitizeFilename(value) {
    const base = String(value || 'property').trim();
    return base.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function collectProprietorStatusText(prop) {
    if (!prop || prop.excluded) return '';
    const statuses = [];
    if (prop.BO_failure) {
        statuses.push(prop.BO_failure === 'No company found'
            ? 'Failed to register with Companies House'
            : prop.BO_failure);
    }
    if (prop.trustee) statuses.push('Trustee');
    if (!prop.BOs || prop.BOs.length === 0) statuses.push('No beneficial owner identified');
    if (prop.wrong_address) {
        const country = prop.country_incorporated ? ` (should be ${toTitleCase(prop.country_incorporated)})` : '';
        statuses.push(`Wrong address${country}`);
    }
    return statuses.join('; ');
}

function collectBeneficialOwnerStatusText(bo, prop) {
    if (!bo || (prop && prop.excluded)) return '';
    const statuses = [];
    if (bo.reg_status === 'suspect' && !(prop && prop.has_individual_non_trustee)) {
        statuses.push('Company unlawfully registered?');
    }
    if (bo.sanctioned) statuses.push('Sanctioned');
    return statuses.join('; ');
}

function formatInfoPanelText(propertyItem) {
    if (!propertyItem) return '';
    const lines = [];
    lines.push('Overseas entities webapp (c) Tax Policy Associates, 2026.')
    lines.push('whoowns.taxpolicy.org.uk');
    lines.push('');
    const titleNumber = propertyItem.property_title_number || 'n/a';
    const address = propertyItem.property_uk_address || 'n/a';
    const tenure = propertyItem.property_tenure || 'n/a';
    const dateStr = propertyItem.date_added ? formatDate(propertyItem.date_added) : 'n/a';
    const priceStr = propertyItem.price_paid ? `£${formatNumber(propertyItem.price_paid)}` : 'n/a';
    const status = propertyItem.status || 'n/a';
    const lat = (propertyItem.lat !== undefined && propertyItem.lat !== null) ? propertyItem.lat : 'n/a';
    const lon = (propertyItem.lon !== undefined && propertyItem.lon !== null) ? propertyItem.lon : 'n/a';
    const statusCategory = getMarkerColor(propertyItem.status);
    const statusLabelMap = {
        green: 'Identifiable owner',
        orange: 'No beneficial owner',
        red: 'Ownership hidden',
        grey: 'Failed to register',
        teal: 'Only trustees listed',
        blue: 'Only trustees listed',
        purple: 'Sanctioned owner'
    };
    const statusLabel = statusLabelMap[statusCategory];

    lines.push('Property');
    lines.push(`Title number: ${titleNumber}`);
    lines.push(`Address: ${address}`);
    lines.push(`Tenure: ${tenure}`);
    lines.push(`Date added: ${dateStr}`);
    lines.push(`Price paid: ${priceStr}`);
    lines.push(`Status: ${status}`);
    if (statusLabel) {
        lines.push(`Status detail: ${statusLabel}`);
    }
    lines.push(`Coordinates: ${lat}, ${lon}`);

    if (propertyItem.property_type) {
        lines.push(`Property type: ${propertyItem.property_type}`);
    }

    if (propertyItem.props && Array.isArray(propertyItem.props)) {
        lines.push('');
        lines.push('Proprietors');
        propertyItem.props.forEach((prop, propIndex) => {
            const propLabel = propertyItem.props.length > 1 ? `Proprietor ${propIndex + 1}` : 'Proprietor';
            lines.push(`${propLabel}: ${prop.name || 'n/a'}`);
            if (prop.address) lines.push(`  Address: ${prop.address}`);
            if (prop.ch_number) lines.push(`  Companies House number: ${prop.ch_number}`);
            if (prop.count !== undefined && prop.count !== null) lines.push(`  Property count: ${prop.count}`);
            if (prop.trustee) lines.push('  Trustee: yes');
            if (prop.excluded) lines.push('  Excluded: yes');

            const propStatuses = collectProprietorStatusText(prop);
            if (propStatuses) lines.push(`  Status: ${propStatuses}`);

            if (prop.BOs && Array.isArray(prop.BOs) && prop.BOs.length > 0) {
                lines.push('  Beneficial owners:');
                prop.BOs.forEach((bo, boIndex) => {
                    const boLabel = prop.BOs.length > 1 ? `  ${boIndex + 1}.` : '  1.';
                    lines.push(`${boLabel} ${bo.name || 'n/a'}`);
                    if (bo.address) lines.push(`     Address: ${bo.address}`);
                    const kindLong = decodeKind(bo.kind);
                    if (kindLong) lines.push(`     Kind: ${kindLong}`);
                    if (bo.count !== undefined && bo.count !== null) {
                        lines.push(`     Associated properties: ${bo.count}`);
                    }
                    if (bo.control && Array.isArray(bo.control) && bo.control.length > 0) {
                        const controlText = bo.control.map(code => {
                            const info = getControlInfo(code);
                            return info ? `${code}: ${info.description}` : String(code);
                        }).join('; ');
                        lines.push(`     Control: ${controlText}`);
                    }
                    const boStatuses = collectBeneficialOwnerStatusText(bo, prop);
                    if (boStatuses) lines.push(`     Status: ${boStatuses}`);
                });
            } else {
                lines.push('  Beneficial owners: none listed');
            }
        });
    }

    lines.push('');
    lines.push('Underlying information produced by HM Land Registry © Crown copyright 2025 and used under licence.');
    return lines.join('\n');
}

function downloadPropertyInfo(propertyItem) {
    const text = formatInfoPanelText(propertyItem);
    if (!text) return;

    const titleNumber = propertyItem && propertyItem.property_title_number
        ? propertyItem.property_title_number
        : 'property';
    const filename = `${sanitizeFilename(`property_${titleNumber}`)}.txt`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
const PanelRenderer = {
    // Escape for use inside a single-quoted HTML attribute; keep double quotes literal
    escAttrSingle: (s) => String(s)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;'),
    categoryTooltips: {
        green: 'Identifiable owners',
        orange: 'No stated beneficial owner',
        red: 'Suspected hidden ownership',
        grey: 'Failed to register',
        teal: 'Only trustees listed',
        blue: 'Only trustees listed',
        purple: 'Sanctioned owner'
    },
    badges: {
        sanctioned: { text: 'Sanctioned', color: 'status-purple' },
        trustee: { text: 'Trustee', color: 'status-blue' },
        listed: { text: 'Listed', color: 'status-green' },
        individual: { text: 'Individual', color: 'status-green' },
        'government-owned': { text: 'Government owned', color: 'status-green' },
        UK: { text: 'UK company', color: 'status-green' },
        orange: { text: 'No beneficial owner', color: 'status-orange' },
        blue: { text: 'Only trustees listed', color: 'status-blue' },
        suspect: { text: 'Company unlawfully registered?', color: 'status-red' },
        'No company found': { text: 'Failed to register<br>with Companies House', color: 'status-grey' }
    },
    renderBadge: (status) => {
        if (!status) return '';
        const config = PanelRenderer.badges[status];
        if (!config) return '';
        return `<div class="status-badge ${config.color}">${config.text}</div>`;
    },
    renderHeaderIcons: (item, markerId, connectionCount) => {
        const visualiseIconHtml = connectionCount > 0
            ? `<a href="#" class="search-icon" data-action="visualise-links" data-markerid="${markerId}"
                   data-tooltip-infopanel="Visualise links between entities" aria-label="Visualise links between entities"
                   data-stop-propagation="true">
                    <i class="material-symbols-outlined" aria-hidden="true">link</i>
                </a>`
            : '';
        return `
            <div id="property-icons">
                ${createFlyThereIcon(
                    item.lat,
                    item.lon,
                    `Property: ${item.property_title_number}`,
                    item.property_title_number,
                    markerId,
                    item.status,
                    CONFIG.MAP.PROPERTY_FLY_TO_ZOOM
                )}
                ${createGoogleSearchIcon(item.property_uk_address)}
                ${createGoogleMapIcon(item.property_uk_address)}
                ${visualiseIconHtml}
            </div>
        `;
    },
    renderPropertyDetails: (item, markerId, connectionCount) => {
        const dateStr = item.date_added ? formatDate(item.date_added) : 'n/a';
        const priceStr = item.price_paid ? `£${formatNumber(item.price_paid)}` : 'n/a';
        const category = getMarkerColor(item.status);
        const displayColor = RUNTIME.CATEGORY_COLORS[category] || 'gray';
        const categoryTooltipText = PanelRenderer.categoryTooltips[category] || 'Property status';
        const statusCircleHtml = `<span class="status-circle-indicator" style="color: ${displayColor};" data-tooltip-infopanel="${escapeHtmlAttribute(categoryTooltipText)}">⬤</span>`;
        const addressTooltip = `"${item.property_uk_address || 'No address'}": copy to clipboard`;
        const propertyTypeLabel = getPropertyTypeLabel(
            item.property_type ?? item.property_type_name ?? item.propertyType
        );
        const tenureLabel = item.property_tenure || '';
        const tenureSuffix = tenureLabel
            ? `(${tenureLabel}${propertyTypeLabel ? `, ${propertyTypeLabel}` : ''})`
            : (propertyTypeLabel ? `(${propertyTypeLabel})` : '');
        return `
            <div class="info-item">
                <div class="info-item-content">
                    <div class="property-address">
                        ${statusCircleHtml}
                        <span class="copyable-text" data-copy-text='${PanelRenderer.escAttrSingle(item.property_uk_address || "No address")}'
                              data-tooltip-infopanel='${PanelRenderer.escAttrSingle(addressTooltip)}'>
                            ${escapeHtml(truncate(capitalizeFirstLetter(item.property_uk_address), 90))}
                        </span>
                        ${PanelRenderer.renderHeaderIcons(item, markerId, connectionCount)}
                    </div>
                    <div class="address-text">
                        <span class="copyable-text" data-tooltip-infopanel="Click to copy date">${dateStr}</span>
                        <span class="copyable-text" data-tooltip-infopanel="Click to copy price">- ${priceStr}</span>
                        <br>
                        <a href="#" data-action="land-registry" data-title-number="${escapeHtmlAttribute(item.property_title_number)}" data-tooltip-infopanel="Copy title and search Land Registry" data-stop-propagation="true">
                            🔍
                        </a>
                        <span id="info-panel-title-number" class="copyable-text" data-tooltip-infopanel="Click to copy title number">${item.property_title_number}</span>
                        ${tenureSuffix}
                    </div>
                </div>
            </div>
        `;
    },
    getProprietorBadges: (prop) => {
        if (prop && prop.excluded) return '';

        let badges = '';
        badges += PanelRenderer.renderBadge(prop.BO_failure);
        const proprietorNotRegistered = (prop && (prop.BO_failure === 'No company found' || prop.status === 'proprietor_not_found'));
        if (!proprietorNotRegistered) {
            if (prop.trustee) badges += PanelRenderer.renderBadge('trustee');
            if (!prop.BOs || prop.BOs.length === 0) {
                badges += '<div class="status-badge status-orange">No beneficial owner identified</div>';
            }
            if (prop.wrong_address) {
                let badgeText = 'Wrong address';
                if (prop.country_incorporated) {
                    badgeText += ` - should be ${toTitleCase(prop.country_incorporated)}`;
                }
                badges += `<div class="status-badge status-red">${escapeHtml(badgeText)}</div>`;
            }
        }
        return badges;
    },
    renderProprietor: (prop, index, totalProps, itemTitle, markerId) => {
        const label = totalProps > 1 ? `Proprietor ${index + 1}` : 'Proprietor';
        const proprietorMapIcon = createFlyThereIcon(
            prop.lat,
            prop.lon,
            `Proprietor: ${prop.name}`,
            itemTitle,
            markerId,
            (typeof prop.status !== 'undefined' ? prop.status : null)
        );
        const proprietorCountBadge = createOwnershipCountBadge(prop.name, 'proprietor', prop.count);
        const addressTooltip = `"${prop.address || 'No address'}": copy to clipboard`;
        const boList = Array.isArray(prop.BOs) ? prop.BOs : [];
        const boHtml = boList.map((bo, boIndex) => (
            PanelRenderer.renderBeneficialOwner(bo, boIndex, boList.length, prop, itemTitle, markerId)
        )).join('');

        return `
            <div class="proprietor-block">
                <div class="info-item">
                    <div class="info-item-content">
                        <div class="entity-title">
                            <b>${label}:</b>
                            <span class="entity-name">
                                <span class="copyable-text" data-tooltip-infopanel="Click to copy name">${escapeHtml(prop.name)}</span>
                                ${proprietorCountBadge}
                                ${createCompaniesHouseSearchIcon(prop.name, prop.ch_number)}
                                ${proprietorMapIcon}
                                ${createGoogleSearchIcon(prop.name)}
                                ${createGoogleMapIcon(prop.address)}
                            </span>
                        </div>
                        <div class="address-text copyable-text" data-copy-text='${PanelRenderer.escAttrSingle(prop.address || "No address")}' data-tooltip-infopanel='${PanelRenderer.escAttrSingle(addressTooltip)}'>${escapeHtml(prop.address || "No address")}</div>
                        ${PanelRenderer.getProprietorBadges(prop)}
                    </div>
                </div>
                ${boHtml}
            </div>
        `;
    },
    renderControlIcons: (bo) => {
        if (!bo.control || !Array.isArray(bo.control)) return '';
        let controlIconsHtml = '';
        bo.control.forEach(controlCode => {
            const controlInfo = getControlInfo(controlCode);
            if (controlInfo) {
                const formattedKind = (bo.kind || '')
                    .replace(/-/g, ' ')
                    .replace(/^\w/, c => c.toUpperCase());
                const tooltipText = `${formattedKind}\n${controlInfo.description}`;
                const isTrustIcon = /trust/i.test(tooltipText);
                controlIconsHtml += `
                    <i class="material-symbols-outlined control-icon${isTrustIcon ? ' trust-highlight' : ''}" aria-hidden="true"
                        data-tooltip-infopanel="${escapeHtmlAttribute(tooltipText)}">
                        ${controlInfo.icon}
                    </i>`;
            }
        });
        return controlIconsHtml ? `<div class="control-icons">${controlIconsHtml}</div>` : '';
    },
    renderBeneficialOwner: (bo, index, totalBOs, prop, itemTitle, markerId) => {
        const label = totalBOs > 1 ? `Beneficial owner ${index + 1}` : 'Beneficial owner';
        const boCountBadge = createOwnershipCountBadge(bo.name, 'beneficiary', bo.count);
        const isUkCompany = String(bo.reg_status || '').trim().toLowerCase() === 'uk';
        const ukCompanyIcon = isUkCompany ? createCompaniesHouseUkSearchIcon(bo.name) : '';
        const boMapIcon = createFlyThereIcon(
            bo.lat,
            bo.lon,
            `BO: ${bo.name}`,
            itemTitle,
            markerId
        );
        const addressTooltip = `"${bo.address || 'No address'}": copy to clipboard`;
        const badges = [
            (!prop.excluded && bo.reg_status === 'suspect' && !prop.has_individual_non_trustee) ? PanelRenderer.renderBadge('suspect') : '',
            (!prop.excluded && bo.sanctioned) ? PanelRenderer.renderBadge('sanctioned') : '',
            (isUkCompany) ? PanelRenderer.renderBadge('UK') : ''
        ].join('');

        return `
            <div class="info-item bo-item">
                <div class="info-item-content">
                    <div class="entity-title">
                        <b>${label}:</b>
                        <span class="entity-name">
                            <span class="copyable-text" data-tooltip-infopanel="Click to copy name">${escapeHtml(bo.name)}</span>
                            ${boCountBadge}
                            ${ukCompanyIcon}
                            ${boMapIcon}
                            ${createGoogleSearchIcon(bo.name)}
                            ${createGoogleMapIcon(bo.address)}
                        </span>
                    </div>
                    ${PanelRenderer.renderControlIcons(bo)}
                    <div class="address-text copyable-text" data-copy-text='${PanelRenderer.escAttrSingle(bo.address || "No address")}' data-tooltip-infopanel='${PanelRenderer.escAttrSingle(addressTooltip)}'>${escapeHtml(bo.address || "No address")}</div>
                    ${badges}
                </div>
            </div>
        `;
    },
    generateHtml: (propertyItem, markerId) => {
        let connectionCount = 0;
        if (propertyItem.props) {
            connectionCount += propertyItem.props.length;
            propertyItem.props.forEach(prop => {
                if (prop.BOs) connectionCount += prop.BOs.length;
            });
        }

        const headerHtml = PanelRenderer.renderPropertyDetails(propertyItem, markerId, connectionCount);
        let proprietorsHtml = '';
        if (propertyItem.props && Array.isArray(propertyItem.props)) {
            proprietorsHtml = '<hr class="section-divider">';
            proprietorsHtml += propertyItem.props.map((prop, index) => (
                PanelRenderer.renderProprietor(prop, index, propertyItem.props.length, propertyItem.property_title_number, markerId)
            )).join('');
        }

        // Property-level footer badge for trustee-only properties.
        let footerHtml = '';
        try {
            const propCategory = getMarkerColor(propertyItem.status);
            const normStatus = (propertyItem.status || '').toString().trim().toLowerCase();
            if (propCategory === 'teal' || normStatus === 'blue') {
                footerHtml = `
                    <div class="info-item">
                        <div class="info-item-content">
                            ${PanelRenderer.renderBadge('blue')}
                        </div>
                    </div>
                `;
            }
        } catch (e) {
            // no-op: if status missing, skip footer badge
        }

        return headerHtml + proprietorsHtml + footerHtml;
    }
};


function showPropertyHighlight(propertyItem, marker) {
    clearPropertyHighlight();
    if (!propertyItem && !marker) return;

    let lat = null;
    let lon = null;
    if (marker && typeof marker.getLatLng === 'function') {
        const latlng = marker.getLatLng();
        lat = latlng?.lat;
        lon = latlng?.lng;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        lat = Number(propertyItem?.lat);
        lon = Number(propertyItem?.lon);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const highlightStyle = CONFIG.STYLES.PROPERTY_HIGHLIGHT;
    propertyHighlightRing = L.circleMarker([lat, lon], {
        radius: highlightStyle.RADIUS, // twice the previous diameter (48px total)
        color: highlightStyle.COLOR,
        weight: highlightStyle.WEIGHT,
        fill: false,
        opacity: 0.9,
        pane: 'property-highlight-pane',
        interactive: false,
        className: 'property-highlight-ring'
    }).addTo(map);
}


/**
 * Create a big marker icon (for endpoints of a link).
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
