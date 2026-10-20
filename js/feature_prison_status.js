const PRISON_STATUS_ACTION_URL = 'https://swis.mohw.gov.tw/socs/jsp/sy/sy1/sy11010_action.jsp';
const PRISON_STATUS_MAIN_URL = 'https://swis.mohw.gov.tw/socs/jsp/sy/sy1/sy11010_main.jsp';
const PRISON_STATUS_CACHE_VERSION = '3';
const PRISON_STATUS_CACHE_MS = 5 * 60 * 1000;
const PRISON_STATUS_PARALLEL_LIMIT = 8;
const prisonStatusCache = new Map();

function getPrisonStatusCurrentRocYear() {
    return new Date().getFullYear() - 1911;
}

function normalizePrisonStatusText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactPrisonStatusDate(value) {
    const text = normalizePrisonStatusText(value);
    const match = text.match(/(\d{2,3})[\/.-]?(\d{1,2})[\/.-]?(\d{1,2})/);
    if (!match) return text;
    return `${match[1]}${match[2].padStart(2, '0')}${match[3].padStart(2, '0')}`;
}

function isPrisonStatusCasePage() {
    const url = location.href.toLowerCase();
    const progId = document.querySelector('input[name="prog_id"]')?.value?.toUpperCase() || '';
    const titleText = document.querySelector('td.title1')?.textContent || document.title || '';
    const supportedProgram = ['SA12010', 'SC12010', 'SH12010'].some((id) => progId === id || titleText.includes(id) || url.includes(id.toLowerCase()));
    return supportedProgram && url.includes('_action.jsp') && document.querySelector('input[name="key_ary"]');
}

function isPrisonStatusPersonPage() {
    const url = location.href.toLowerCase();
    const progId = document.querySelector('input[name="prog_id"]')?.value?.toUpperCase() || '';
    const titleText = document.querySelector('td.title1')?.textContent || document.title || document.body?.innerText || '';
    const supportedProgram = ['SA12010', 'SC12010', 'SH12010'].some((id) => progId === id || titleText.includes(id) || url.includes(id.toLowerCase()));
    return supportedProgram && url.includes('_fam_action.jsp') && document.querySelector('input[name="id_no"]');
}

function parsePrisonStatusResponse(html, queryYear = getPrisonStatusCurrentRocYear()) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const records = [];

    for (const row of doc.querySelectorAll('tr')) {
        const cells = Array.from(row.cells || []).map((cell) => normalizePrisonStatusText(cell.textContent));
        if (cells.length < 9) continue;
        if (!cells[0].includes('\u53d7\u5211\u4eba\u76e3\u7ba1\u8cc7\u6599') && !cells.join(' ').includes('\u76e3\u7ba1\u8cc7\u6599')) continue;

        const cutoffDate = cells[7] || '';
        const record = {
            dataType: cells[0],
            city: cells[1],
            idNo: cells[2].toUpperCase(),
            name: cells[3],
            dataMonth: cells[4],
            effectiveDate: cells[5],
            amount: cells[6],
            cutoffDate,
            note: cells[8],
            queryYear,
            isReleased: cutoffDate.length > 0
        };
        records.push(record);
    }

    const sortDate = (value, includeDay = true) => {
        const match = normalizePrisonStatusText(value).match(/^(\d{2,3})[\/.-](\d{1,2})(?:[\/.-](\d{1,2}))?/);
        if (!match) return '000000000';
        return `${match[1].padStart(3, '0')}${match[2].padStart(2, '0')}${includeDay ? (match[3] || '00').padStart(2, '0') : ''}`;
    };

    const recordsByEffectiveDate = new Map();
    for (const record of records) {
        const key = `${record.idNo}|${sortDate(record.effectiveDate)}`;
        const existing = recordsByEffectiveDate.get(key);
        if (!existing ||
            (!existing.isReleased && record.isReleased) ||
            (existing.isReleased === record.isReleased &&
                `${sortDate(record.dataMonth, false)}${sortDate(record.cutoffDate)}` >
                `${sortDate(existing.dataMonth, false)}${sortDate(existing.cutoffDate)}`)) {
            recordsByEffectiveDate.set(key, record);
        }
    }
    records.length = 0;
    records.push(...recordsByEffectiveDate.values());

    // 以最新資料年月為主；同一月份只要有一筆無截止日期，就代表仍在監。
    records.sort((a, b) => {
        const aKey = `${sortDate(a.dataMonth, false)}${a.isReleased ? '0' : '1'}${sortDate(a.effectiveDate)}${sortDate(a.cutoffDate)}`;
        const bKey = `${sortDate(b.dataMonth, false)}${b.isReleased ? '0' : '1'}${sortDate(b.effectiveDate)}${sortDate(b.cutoffDate)}`;
        return bKey.localeCompare(aKey);
    });

    return {
        success: true,
        queryYear,
        records,
        currentRecord: records[0] || null
    };
}

async function queryPrisonStatus(idNo, queryYear = getPrisonStatusCurrentRocYear()) {
    const cleanId = String(idNo || '').trim().toUpperCase();
    const year = Number(queryYear) || getPrisonStatusCurrentRocYear();
    const cacheKey = `${PRISON_STATUS_CACHE_VERSION}:${cleanId}:${year}`;
    const cached = prisonStatusCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PRISON_STATUS_CACHE_MS) {
        return cached.result;
    }

    try {
        const params = new URLSearchParams({
            qid_no: cleanId,
            qcname: '',
            qtype: '',
            qsyr: String(year),
            qeyr: String(year),
            status: 'getData3',
            prog_id: 'SY11010'
        });

        const response = await fetch(PRISON_STATUS_ACTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`SY11010 getData3 failed: ${response.status}`);
        }

        const html = await response.text();
        const result = parsePrisonStatusResponse(html, year);
        prisonStatusCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
    } catch (error) {
        return {
            success: false,
            error: error.message,
            queryYear: year,
            records: [],
            currentRecord: null
        };
    }
}

function makePrisonStatusBadge(result, fallbackName) {
    const record = result?.currentRecord;
    if (!record) return null;

    const badge = document.createElement('span');
    badge.className = `prison-status-badge ${record.isReleased ? 'is-released' : 'is-active'}`;
    const effectiveDateText = compactPrisonStatusDate(record.effectiveDate);
    const cutoffDateText = compactPrisonStatusDate(record.cutoffDate);
    badge.textContent = record.isReleased
        ? `${effectiveDateText}-${cutoffDateText} 出監`
        : `${effectiveDateText} 入監`;
    badge.title = [
        fallbackName || record.name,
        record.dataType,
        `資料年月: ${record.dataMonth}`,
        `生效日期: ${record.effectiveDate}`,
        record.cutoffDate ? `截止日期: ${record.cutoffDate}` : '截止日期: 無',
        record.note ? `備註: ${record.note}` : '',
        `查詢年度: ${result.queryYear}`
    ].filter(Boolean).join('\n');

    return badge;
}

function appendPrisonStatusBadgeOnNewLine(targetElement, badge) {
    if (!targetElement || !badge) return;

    const host = document.createElement('div');
    host.className = 'prison-status-badge-line';
    host.appendChild(badge);

    if (targetElement instanceof HTMLTableCellElement) {
        targetElement.appendChild(host);
    } else {
        targetElement.insertAdjacentElement('afterend', host);
    }
}

function getFamilyRowsForPrisonStatus() {
    return Array.from(document.querySelectorAll('input[name="key_ary"]')).map((keyInput) => {
        const row = keyInput.closest('tr');
        if (!row) return null;
        const idNo = keyInput?.value?.trim().toUpperCase() || '';
        if (!/^[A-Z][A-Z0-9]\d{8}$/.test(idNo)) return null;

        const cells = Array.from(row.cells || []);
        const idCell = cells.find((cell) => normalizePrisonStatusText(cell.textContent).includes(idNo));
        const idIndex = idCell ? cells.indexOf(idCell) : -1;
        const nameCell = idIndex >= 0 ? cells[idIndex + 1] : null;
        if (!nameCell) return null;

        return {
            row,
            idNo,
            nameCell,
            name: normalizePrisonStatusText(nameCell.textContent)
        };
    }).filter(Boolean);
}

async function applyPrisonStatusToFamilyRow(item) {
    if (!item || item.row.dataset.prisonStatusChecked === 'true') return;
    item.row.dataset.prisonStatusChecked = 'true';

    const result = await queryPrisonStatus(item.idNo);
    if (!result?.success || !result.currentRecord) return;

    item.nameCell.querySelectorAll('.prison-status-badge').forEach((badge) => badge.remove());
    item.nameCell.querySelectorAll('.prison-status-badge-line').forEach((line) => line.remove());
    const badge = makePrisonStatusBadge(result, item.name);
    if (badge) {
        appendPrisonStatusBadgeOnNewLine(item.nameCell, badge);
    }
}

async function applyPrisonStatusToPersonPage() {
    const idInput = document.querySelector('input[name="id_no"]');
    if (!idInput || idInput.dataset.prisonStatusChecked === 'true') return false;

    const idNo = idInput.value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]\d{8}$/.test(idNo)) return false;
    idInput.dataset.prisonStatusChecked = 'true';

    const result = await queryPrisonStatus(idNo);
    if (!result?.success || !result.currentRecord) return false;

    const nameInput = document.querySelector('input[name="cname"]');
    const targetCell = nameInput?.closest('td') || idInput.closest('td') || idInput.parentElement;
    if (!targetCell) return false;

    targetCell.querySelectorAll('.prison-status-badge').forEach((badge) => badge.remove());
    targetCell.querySelectorAll('.prison-status-badge-line').forEach((line) => line.remove());
    const badge = makePrisonStatusBadge(result, nameInput?.value || idNo);
    if (!badge) return false;

    if (nameInput) {
        appendPrisonStatusBadgeOnNewLine(nameInput, badge);
    } else {
        appendPrisonStatusBadgeOnNewLine(targetCell, badge);
    }
    return true;
}

async function applyPrisonStatusToFamilyRowsInParallel(rows) {
    for (let i = 0; i < rows.length; i += PRISON_STATUS_PARALLEL_LIMIT) {
        const batch = rows.slice(i, i + PRISON_STATUS_PARALLEL_LIMIT);
        await Promise.all(batch.map((item) => applyPrisonStatusToFamilyRow(item).catch(() => {})));
    }
}

function initPrisonStatusCaseBadges() {
    if (isPrisonStatusPersonPage()) {
        const task = () => applyPrisonStatusToPersonPage();
        if (window.apiConcurrencyManager) {
            window.apiConcurrencyManager.add(task).catch(() => {});
        } else {
            task().catch(() => {});
        }
        return true;
    }

    if (!isPrisonStatusCasePage()) return false;

    const rows = getFamilyRowsForPrisonStatus();
    if (!rows.length) return false;

    applyPrisonStatusToFamilyRowsInParallel(rows).catch(() => {});

    return true;
}

window.initPrisonStatusCaseBadges = initPrisonStatusCaseBadges;
