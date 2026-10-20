const HOUSEHOLD_STATUS_POPUP_PATH = '/socs/jsp/sz/sz3/sz31020_upd.jsp';
const HOUSEHOLD_STATUS_CACHE_MS = 5 * 60 * 1000;
const HOUSEHOLD_MEMO_CACHE_MS = 5 * 60 * 1000;
const HOUSEHOLD_STATUS_INDICATOR_HIDE_MS = 3000;
const householdStatusCache = new Map();
const householdMemoCache = new Map();
const householdMemoRequests = new Map();
const householdMemoQueue = [];
const householdMemoQueuedRequests = new Map();
const HOUSEHOLD_MEMO_MAX_CONCURRENT_REQUESTS = 3;
let householdMemoActiveRequestCount = 0;
let householdStatusIndicatorTimer = null;
let householdMemoHideTimer = null;
let householdMemoShowTimer = null;
let householdMemoHoverToken = 0;
const HOUSEHOLD_MEMO_HOVER_DELAY_MS = 300;

function getHouseholdMemoHoverDelayMs() {
    const value = Number(window.swisExtensionSettings?.householdMemoHoverDelayMs);
    return Number.isFinite(value) ? Math.max(100, Math.min(2000, value)) : HOUSEHOLD_MEMO_HOVER_DELAY_MS;
}

function isHouseholdMemoHoverEnabled() {
    return window.swisExtensionSettings?.householdMemoHoverEnabled === true;
}

function isHouseholdMemoPrefetchEnabled() {
    return true;
}

function normalizeHouseholdStatusText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactHouseholdStatusDate(value) {
    const text = normalizeHouseholdStatusText(value);
    const match = text.match(/(\d{2,3})[\/.-]?(\d{1,2})[\/.-]?(\d{1,2})/);
    if (!match) return text;
    return `${match[1]}${match[2].padStart(2, '0')}${match[3].padStart(2, '0')}`;
}

function getHouseholdStatusFieldValue(name, fallback = '') {
    const urlParams = new URLSearchParams(location.search);
    const urlValue = urlParams.get(name);
    if (urlValue) return urlValue;

    const field = document.querySelector(`[name="${CSS.escape(name)}"], #${CSS.escape(name)}`);
    if (field && 'value' in field && field.value) return field.value;

    return fallback;
}

function getVisibleHouseholdStatusMemberRows() {
    const rows = [];
    const familyRows = document.querySelectorAll('table#list_t tr');
    const candidateRows = familyRows.length
        ? familyRows
        : document.querySelectorAll('table.titleb tr');

    for (const row of candidateRows) {
        const cells = Array.from(row.cells || []);
        if (!cells.length) continue;

        const idCell = cells.find((cell) => /^[A-Z][A-Z0-9]\d{8}$/.test(normalizeHouseholdStatusText(cell.textContent)));
        if (!idCell) continue;

        const idIndex = cells.indexOf(idCell);
        rows.push({
            row,
            idNo: normalizeHouseholdStatusText(idCell.textContent).toUpperCase(),
            idCell,
            name: normalizeHouseholdStatusText(cells[idIndex + 1]?.textContent || '')
        });
    }

    return rows;
}

function getHouseholdStatusCurrentId() {
    const urlParams = new URLSearchParams(location.search);
    return (
        urlParams.get('key') ||
        document.querySelector('input[name="id_no"]')?.value ||
        document.querySelector('input[name="head_id_no"]')?.value ||
        document.querySelector('input[name="key_ary"]')?.value ||
        getVisibleHouseholdStatusMemberRows()[0]?.idNo ||
        ''
    ).trim().toUpperCase();
}

function hasHouseholdStatusFamilyTable() {
    return getVisibleHouseholdStatusMemberRows().length > 0;
}

function isHouseholdStatusSupportedPage() {
    const url = location.href.toLowerCase();
    if (!url.includes('/socs/jsp/sa/sa1/sa12010_action.jsp')) return false;

    const progId = getHouseholdStatusFieldValue('prog_id').toUpperCase();
    const appNo = getHouseholdStatusFieldValue('app_no', getHouseholdStatusFieldValue('appNo'));

    return progId === 'SA12010' && !!appNo && hasHouseholdStatusFamilyTable();
}

function buildHouseholdStatusPopupUrl(appIdOverride = '') {
    const appNo = getHouseholdStatusFieldValue('app_no', getHouseholdStatusFieldValue('appNo'));
    const appId = appIdOverride || getHouseholdStatusCurrentId();
    if (!appNo || !appId) return '';

    const params = new URLSearchParams({
        app_no: appNo,
        chk_status: getHouseholdStatusFieldValue('chk_status', '9'),
        app_id: appId,
        app_tab: getHouseholdStatusFieldValue('app_tab', 'a1d'),
        prog_id: getHouseholdStatusFieldValue('prog_id', 'SA12010'),
        return_url: getHouseholdStatusFieldValue('return_url', ''),
        userkind: getHouseholdStatusFieldValue('userkind', 'C'),
        usercity: getHouseholdStatusFieldValue('grantcity', getHouseholdStatusFieldValue('usercity', '')),
        proj_code: getHouseholdStatusFieldValue('proj_code', 'SOCS'),
        now_sts: getHouseholdStatusFieldValue('now_sts', 'upd'),
        stand_year: getHouseholdStatusFieldValue('stand_year', String(new Date().getFullYear() - 1911))
    });

    return `${location.origin}${HOUSEHOLD_STATUS_POPUP_PATH}?${params.toString()}`;
}

function parseHouseholdStatusResponse(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const records = new Map();
    let inNoHouseholdDataSection = false;

    for (const row of doc.querySelectorAll('tr')) {
        const rowText = normalizeHouseholdStatusText(row.textContent);
        if (!rowText) continue;

        if (rowText.includes('\u4ee5\u4e0b\u70ba\u67e5\u7121\u6236\u653f\u8cc7\u6599')) {
            inNoHouseholdDataSection = true;
        }
        const ids = rowText.match(/[A-Z][A-Z0-9]\d{8}/g);
        if (!ids) continue;

        const deathDateMatch = rowText.match(/\u6b7b\u4ea1\u65e5\u671f[:\uff1a]\s*(\d{2,3}[\/.-]\d{1,2}[\/.-]\d{1,2})/);
        const deathDate = deathDateMatch ? deathDateMatch[1] : '';
        if (!inNoHouseholdDataSection && !deathDate) continue;

        ids.forEach((rawId) => {
            const idNo = rawId.trim().toUpperCase();
            records.set(idNo, {
                idNo,
                type: '\u9664\u6236',
                deathDate: '',
                note: rowText
            });
        });
    }

    return records;
}

async function queryHouseholdStatusRecords(appIdOverride = '') {
    const popupUrl = buildHouseholdStatusPopupUrl(appIdOverride);
    if (!popupUrl) return new Map();

    const cached = householdStatusCache.get(popupUrl);
    if (cached && Date.now() - cached.timestamp < HOUSEHOLD_STATUS_CACHE_MS) {
        return cached.records;
    }

    const response = await fetch(popupUrl, { credentials: 'include' });
    if (!response.ok) throw new Error(`sz31020_upd failed: ${response.status}`);

    const html = await response.text();
    const records = parseHouseholdStatusResponse(html);
    householdStatusCache.set(popupUrl, { records, timestamp: Date.now() });
    return records;
}

function makeHouseholdStatusBadge(record) {
    const badge = document.createElement('span');
    badge.className = 'household-status-badge';
    const dateText = record.deathDate ? compactHouseholdStatusDate(record.deathDate) : '';
    badge.textContent = dateText ? `${record.type} ${dateText}` : record.type;
    badge.title = record.note || record.type;
    return badge;
}

function showHouseholdStatusIndicator(message, state = 'loading') {
    if (!document.body) return null;
    if (householdStatusIndicatorTimer) {
        clearTimeout(householdStatusIndicatorTimer);
        householdStatusIndicatorTimer = null;
    }

    let indicator = document.getElementById('household-status-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'household-status-indicator';
        document.body.appendChild(indicator);
    }

    indicator.className = `household-status-indicator is-${state}`;
    indicator.textContent = message;

    if (state !== 'loading') {
        householdStatusIndicatorTimer = window.setTimeout(() => {
            indicator.classList.add('is-hiding');
            window.setTimeout(() => indicator.remove(), 250);
        }, HOUSEHOLD_STATUS_INDICATOR_HIDE_MS);
    }

    return indicator;
}

function hasHouseholdStatusCheckMark(cell) {
    if (!cell) return false;
    if (cell.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked')) return true;

    const text = normalizeHouseholdStatusText(cell.textContent).toUpperCase();
    return /(^|[\s\u3000])([V\uff36\u2713\u2714\u221a])($|[\s\u3000])/.test(text) || text === 'V' || text === '\uff36';
}

function findHouseholdStatusHeaderCells(row) {
    const table = row?.closest('table');
    if (!table) return [];

    const rows = Array.from(table.rows || []);
    const rowIndex = rows.indexOf(row);
    if (rowIndex <= 0) return [];

    for (let i = rowIndex - 1; i >= 0; i -= 1) {
        const cells = Array.from(rows[i].cells || []);
        const headerText = cells.map((cell) => normalizeHouseholdStatusText(cell.textContent)).join(' ');
        if (headerText.includes('\u4e0d\u8a08\u4eba\u53e3') || headerText.includes('\u4e0d\u8a08')) {
            return cells;
        }
    }

    return [];
}

function isHouseholdStatusNotCountedRow(row) {
    const cells = Array.from(row?.cells || []);
    if (!cells.length) return false;

    const headerCells = findHouseholdStatusHeaderCells(row);
    const notCountedHeaderIndex = headerCells.findIndex((cell) => {
        const text = normalizeHouseholdStatusText(cell.textContent);
        return text.includes('\u4e0d\u8a08\u4eba\u53e3') || text.includes('\u4e0d\u8a08');
    });

    if (notCountedHeaderIndex >= 0) {
        return hasHouseholdStatusCheckMark(cells[notCountedHeaderIndex]);
    }

    const famGetIndex = cells.findIndex((cell) => (cell.getAttribute('onclick') || '').includes('famGet'));
    if (famGetIndex >= 0) {
        return hasHouseholdStatusCheckMark(cells[famGetIndex + 3]);
    }

    return false;
}

function collectHouseholdStatusFamilyRows() {
    const summary = {
        rows: [],
        total: 0,
        skippedNotCounted: 0
    };
    const candidates = new Map();

    const collectCandidate = (item) => {
        if (!item?.idNo) return;
        const idNo = item.idNo.trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9]\d{8}$/.test(idNo)) return;

        const notCounted = isHouseholdStatusNotCountedRow(item.row);
        const existing = candidates.get(idNo);
        if (!existing) {
            candidates.set(idNo, { item: { ...item, idNo }, allNotCounted: notCounted });
        } else if (!notCounted) {
            existing.allNotCounted = false;
            existing.item = { ...item, idNo };
        }
    };

    Array.from(document.querySelectorAll('input[name="key_ary"]')).forEach((keyInput) => {
        const idNo = keyInput.value?.trim().toUpperCase() || '';
        if (!/^[A-Z][A-Z0-9]\d{8}$/.test(idNo)) return;

        const row = keyInput.closest('tr');
        if (!row) return;
        const cells = Array.from(row.cells || []);
        const idCell = cells.find((cell) => normalizeHouseholdStatusText(cell.textContent).includes(idNo));
        if (idCell) collectCandidate({ row, idNo, idCell });
    });

    getVisibleHouseholdStatusMemberRows().forEach((item) => {
        collectCandidate(item);
    });

    candidates.forEach(({ item, allNotCounted }) => {
        summary.total += 1;
        if (allNotCounted) summary.skippedNotCounted += 1;
        else summary.rows.push(item);
    });

    return summary;
}

function markHouseholdStatusIdCell(idCell, record) {
    if (!idCell || !record) return false;

    idCell.classList.add('household-status-id-cell');
    idCell.querySelectorAll('.household-status-badge').forEach((badge) => badge.remove());
    idCell.appendChild(makeHouseholdStatusBadge(record));
    return true;
}

function buildHouseholdMemoUrl(idNo) {
    const appNo = getHouseholdStatusFieldValue('app_no', getHouseholdStatusFieldValue('appNo'));
    if (!appNo || !idNo) return '';

    const params = new URLSearchParams();
    const form = document.querySelector('form[name="main"]') || document.querySelector('form');
    Array.from(form?.elements || []).forEach((el) => {
        if (!el.name || el.disabled || ['button', 'submit', 'reset'].includes(el.type)) return;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
        params.append(el.name, el.value || '');
    });
    params.set('status', 'get');
    params.set('key', idNo);
    params.set('app_no', appNo);
    params.set('prog_id', getHouseholdStatusFieldValue('prog_id', 'SA12010'));
    return `${location.origin}/socs/jsp/sa/sa1/sa12010_fam_action.jsp?${params.toString()}`;
}

function getSelectedHouseholdField(doc, name) {
    const select = doc.querySelector(`select[name="${name}"]`);
    if (select) return normalizeHouseholdStatusText(select.selectedOptions?.[0]?.textContent || select.querySelector('option[selected]')?.textContent || select.value || '');
    return normalizeHouseholdStatusText(doc.querySelector(`[name="${name}"]`)?.value || '');
}

async function fetchHouseholdMemberMemoUncached(idNo) {
    const url = buildHouseholdMemoUrl(idNo);
    if (!url) return '';

    const requestUrl = new URL(url);
    const response = await fetch(requestUrl.origin + requestUrl.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: requestUrl.searchParams.toString(),
        credentials: 'include'
    });
    if (!response.ok) throw new Error(`人口備註查詢失敗：${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const textareaMemo = doc.querySelector('textarea[name="memo"]')?.value?.trim() || '';
    let memo = textareaMemo;
    if (!memo) {
        for (const row of doc.querySelectorAll('tr')) {
            const cells = Array.from(row.cells || []);
            for (let i = 0; i < cells.length - 1; i += 1) {
                if (normalizeHouseholdStatusText(cells[i].textContent) === '\u5099\u8a3b') {
                    memo = normalizeHouseholdStatusText(cells[i + 1].textContent);
                    break;
                }
            }
            if (memo) break;
        }
    }
    const age = Number.parseInt(doc.querySelector('[name="age"]')?.value || '', 10);
    const schoolName = normalizeHouseholdStatusText(doc.querySelector('[name="school_name"]')?.value || '');
    const studyStart = normalizeHouseholdStatusText(doc.querySelector('[name="scstart_ym"]')?.value || '');
    const studyEnd = normalizeHouseholdStatusText(doc.querySelector('[name="scuntil_ym"]')?.value || '');
    const subsidy = Array.from(doc.querySelectorAll('#aid_data tr')).map((row) => {
        const cells = Array.from(row.cells || []).map((cell) => normalizeHouseholdStatusText(cell.textContent));
        if (cells.length < 2 || !/^\d+$/.test(cells[0])) return '';
        return [cells[1], cells[3], cells[4], cells[5] ? `註銷：${cells[5]}` : ''].filter(Boolean).join('｜');
    }).filter(Boolean);
    const cancellationReasons = Array.from(doc.querySelectorAll('#aid_data tr')).map((row) => {
        const cells = Array.from(row.cells || []).map((cell) => normalizeHouseholdStatusText(cell.textContent));
        return cells.length >= 7 && /^\d+$/.test(cells[0]) && cells[6] ? cells[6] : '';
    }).filter(Boolean);
    cancellationReasons.forEach((reason, index) => {
        if (subsidy[index] && !subsidy[index].includes(reason)) subsidy[index] += `｜註銷原因：${reason}`;
    });
    const subsidyDetailed = Array.from(doc.querySelectorAll('#aid_data tr')).map((row) => {
        const cells = Array.from(row.cells || []).map((cell) => normalizeHouseholdStatusText(cell.textContent));
        if (cells.length < 2 || !/^\d+$/.test(cells[0])) return '';
        const cancellation = cells[5] || cells[6] || cells[7] ? `註銷：${[cells[5], cells[6], cells[7]].filter(Boolean).join(' / ')}` : '';
        return [cells[1], cells[3], cells[4], cancellation].filter(Boolean).join('｜');
    }).filter(Boolean);
    const result = {
        memo,
        workAbility: getSelectedHouseholdField(doc, 'work_ablt'),
        schoolStatus: age >= 14 && age <= 25 ? (getSelectedHouseholdField(doc, 'learn_code') || getSelectedHouseholdField(doc, 'ts_learn_code')) : '',
        schoolName,
        studyPeriod: studyStart || studyEnd ? `${studyStart} ~ ${studyEnd}` : '',
        age: Number.isFinite(age) ? age : null,
        subsidy: subsidyDetailed.length ? subsidyDetailed : subsidy
    };
    return result;
}

function getHouseholdMemoCacheKey(idNo) {
    const appNo = getHouseholdStatusFieldValue('app_no', getHouseholdStatusFieldValue('appNo'));
    return `${appNo}|${String(idNo || '').trim().toUpperCase()}`;
}

function runNextHouseholdMemoRequest() {
    while (householdMemoActiveRequestCount < HOUSEHOLD_MEMO_MAX_CONCURRENT_REQUESTS && householdMemoQueue.length) {
        householdMemoQueue.sort((left, right) => right.priority - left.priority);
        const task = householdMemoQueue.shift();
        if (!task || householdMemoRequests.get(task.cacheKey) !== task.promise) continue;

        householdMemoQueuedRequests.delete(task.cacheKey);
        householdMemoActiveRequestCount += 1;
        fetchHouseholdMemberMemoUncached(task.idNo)
            .then((result) => {
                householdMemoCache.set(task.cacheKey, { result, timestamp: Date.now() });
                task.resolve(result);
            })
            .catch(task.reject)
            .finally(() => {
                if (householdMemoRequests.get(task.cacheKey) === task.promise) {
                    householdMemoRequests.delete(task.cacheKey);
                }
                householdMemoActiveRequestCount -= 1;
                runNextHouseholdMemoRequest();
            });
    }
}

function queueHouseholdMemoRequest(idNo, cacheKey, priority) {
    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
    });
    const task = { idNo, cacheKey, priority, promise, resolve: resolveRequest, reject: rejectRequest };
    householdMemoRequests.set(cacheKey, promise);
    householdMemoQueuedRequests.set(cacheKey, task);
    householdMemoQueue.push(task);
    runNextHouseholdMemoRequest();
    return promise;
}

async function fetchHouseholdMemberMemo(idNo, priority = 0) {
    const cacheKey = getHouseholdMemoCacheKey(idNo);
    const cached = householdMemoCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < HOUSEHOLD_MEMO_CACHE_MS) {
        return cached.result;
    }

    const activeRequest = householdMemoRequests.get(cacheKey);
    if (activeRequest) {
        const queuedTask = householdMemoQueuedRequests.get(cacheKey);
        if (queuedTask && priority > queuedTask.priority) {
            queuedTask.priority = priority;
            runNextHouseholdMemoRequest();
        }
        return activeRequest;
    }

    return queueHouseholdMemoRequest(idNo, cacheKey, priority);
}

function getHouseholdMemoTooltip() {
    let tooltip = document.getElementById('household-member-memo-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'household-member-memo-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

function positionHouseholdMemoTooltip(tooltip, row, pointer = null) {
    const rect = row.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - tooltip.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - tooltip.offsetHeight - margin);
    const left = pointer ? pointer.x + 14 : rect.right + margin;
    const top = pointer ? pointer.y + 14 : rect.bottom + margin;
    tooltip.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`;
    tooltip.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`;
}

function renderHouseholdMemoTooltipFinal(tooltip, item, result) {
    tooltip.replaceChildren();
    const title = document.createElement('div'); title.className = 'household-member-memo-title';
    title.textContent = `${item.name || item.idNo}（${item.idNo}）`; tooltip.appendChild(title);
    const addLine = (label, value) => {
        const line = document.createElement('div'); line.className = 'household-member-memo-line';
        const labelEl = document.createElement('span'); labelEl.className = 'household-member-memo-label'; labelEl.textContent = `${label}：`;
        line.append(labelEl, document.createTextNode(value || '無資料')); tooltip.appendChild(line);
    };
    addLine('工作能力', result.workAbility);
    if (result.schoolName) addLine('學校名稱', result.schoolName);
    if (result.studyPeriod) addLine('就學期間', result.studyPeriod);
    addLine('備註', result.memo);
    addLine('補助資料', result.subsidy?.length ? result.subsidy.join('\n') : '無補助資料');
}

async function applyHouseholdStatusMarkers() {
    if (!isHouseholdStatusSupportedPage()) return false;
    if (document.body?.dataset.householdStatusChecked === 'true') return true;
    document.body.dataset.householdStatusChecked = 'true';

    const familySummary = collectHouseholdStatusFamilyRows();
    const checkCount = familySummary.rows.length;
    const skippedText = familySummary.skippedNotCounted ? `\uff0c\u7565\u904e\u4e0d\u8a08\u4eba\u53e3 ${familySummary.skippedNotCounted} \u4eba` : '';

    showHouseholdStatusIndicator(`\u6236\u653f\u6a19\u793a\u6aa2\u67e5\u4e2d... \u6aa2\u67e5 ${checkCount} \u4eba${skippedText}`, 'loading');

    let records;
    try {
        records = await queryHouseholdStatusRecords();
    } catch (error) {
        document.body.dataset.householdStatusChecked = 'error';
        showHouseholdStatusIndicator('\u6236\u653f\u6a19\u793a\u5931\u6557\uff1a\u7121\u6cd5\u53d6\u5f97\u6236\u653f\u4eba\u53e3\u8cc7\u6599', 'error');
        return false;
    }

    let marked = 0;
    for (const item of familySummary.rows) {
        let record = records.get(item.idNo);
        if (!record) {
            try {
                record = (await queryHouseholdStatusRecords(item.idNo)).get(item.idNo);
            } catch (error) {
                record = null;
            }
        }
        if (record && markHouseholdStatusIdCell(item.idCell, record)) marked += 1;
    }

    const emptyText = familySummary.total === 0 ? '\uff0c\u672a\u627e\u5230\u53ef\u6aa2\u67e5\u4eba\u53e3' : '';
    showHouseholdStatusIndicator(`\u6236\u653f\u6a19\u793a\u5b8c\u6210\uff1a\u6aa2\u67e5 ${checkCount} \u4eba\uff0c\u6a19\u793a ${marked} \u4eba${skippedText}${emptyText}`, marked > 0 ? 'done' : 'empty');
    return marked > 0;
}

function initHouseholdStatusBadges() {
    initHouseholdMemoHover();
    if (!document.body?.dataset.householdPopupShortcutBound) {
        document.body.dataset.householdPopupShortcutBound = 'true';
        document.addEventListener('keydown', (event) => {
            if (!(event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === 'x')) return;
            const hovered = getVisibleHouseholdStatusMemberRows().find((item) => item.row.matches(':hover'));
            const appNo = getHouseholdStatusFieldValue('app_no', getHouseholdStatusFieldValue('appNo')) || (() => {
                try { return window.top.document.querySelector('[name="app_no"], [name="appNo"]')?.value || window.top.swisTabs?.activeTabId?.replace(/^tab_/, '') || ''; } catch { return ''; }
            })();
            if (!hovered?.idNo || !appNo) return;
            event.preventDefault();
            const params = new URLSearchParams({ app_no: appNo, chk_status: getHouseholdStatusFieldValue('chk_status', '0'), app_id: hovered.idNo, app_tab: 'a1d', prog_id: 'SA12010', return_url: '', userkind: 'C', usercity: getHouseholdStatusFieldValue('grantcity', '6400000000'), proj_code: 'SOCS', now_sts: 'upd', stand_year: getHouseholdStatusFieldValue('stand_year', '115') });
            window.open(`${location.origin}${HOUSEHOLD_STATUS_POPUP_PATH}?${params.toString()}`, `swis_household_${hovered.idNo}`, 'popup=yes,width=1100,height=760,resizable=yes,scrollbars=yes');
            return;
        }, true);
    }
    applyHouseholdStatusMarkers().catch(() => {});
    return true;
}

function attachHouseholdMemoHover(item) {
    if (!item?.row || item.row.dataset.householdMemoHover === 'true') return;
    item.row.dataset.householdMemoHover = 'true'; item.row.classList.add('household-memo-hover-target');
    item.row.addEventListener('mousemove', (event) => {
        const tooltip = document.getElementById('household-member-memo-tooltip');
        if (tooltip?.classList.contains('is-visible')) positionHouseholdMemoTooltip(tooltip, item.row, event);
    });
    item.row.addEventListener('mouseenter', (event) => {
        if (!isHouseholdMemoHoverEnabled()) return;
        window.top?.postMessage({ type: 'SWIS_HOUSEHOLD_CURSOR', idNo: item.idNo }, location.origin);
        clearTimeout(householdMemoHideTimer); clearTimeout(householdMemoShowTimer);
        const token = ++householdMemoHoverToken;
        const dataPromise = fetchHouseholdMemberMemo(item.idNo, 1); dataPromise.catch(() => {});
        householdMemoShowTimer = window.setTimeout(async () => {
            if (token !== householdMemoHoverToken) return;
            const tooltip = getHouseholdMemoTooltip(); tooltip.textContent = '資料讀取中…'; tooltip.classList.add('is-visible'); positionHouseholdMemoTooltip(tooltip, item.row, event);
            try { const result = await dataPromise; if (token !== householdMemoHoverToken) return; renderHouseholdMemoTooltipFinal(tooltip, item, result); positionHouseholdMemoTooltip(tooltip, item.row, event); }
            catch { if (token === householdMemoHoverToken) tooltip.textContent = '資料讀取失敗'; }
        }, getHouseholdMemoHoverDelayMs());
    });
    item.row.addEventListener('mouseleave', () => {
        clearTimeout(householdMemoShowTimer);
        ++householdMemoHoverToken;
        clearTimeout(householdMemoHideTimer);
        getHouseholdMemoTooltip().classList.remove('is-visible');
    });
}

function initHouseholdMemoHover() {
    if (!isHouseholdStatusSupportedPage()) return false;
    const rows = getVisibleHouseholdStatusMemberRows();
    rows.forEach(attachHouseholdMemoHover);
    if (isHouseholdMemoPrefetchEnabled()) {
        rows.forEach((item) => fetchHouseholdMemberMemo(item.idNo).catch(() => {}));
    }
}

window.addEventListener('swis-extension-settings-changed', (event) => {
    const settings = event.detail || {};
    clearTimeout(householdMemoShowTimer);
    clearTimeout(householdMemoHideTimer);
    ++householdMemoHoverToken;
    if (settings.householdMemoHoverEnabled === false) {
        document.getElementById('household-member-memo-tooltip')?.classList.remove('is-visible');
    }
});

window.initHouseholdStatusBadges = initHouseholdStatusBadges;
