const SY11010_ACTION_URL = 'https://swis.mohw.gov.tw/socs/jsp/sy/sy1/sy11010_action.jsp';
const SY11010_MAIN_URL = 'https://swis.mohw.gov.tw/socs/jsp/sy/sy1/sy11010_main.jsp';
const WEAK_E_SOURCE = '\u5f31\u52e2E\u7cfb\u7d71';

const eligibilityCache = new Map();
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

function getCurrentRocYear() {
    return new Date().getFullYear() - 1911;
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function classifyWeakEStatus(benefitName) {
    const text = normalizeText(benefitName);

    if (text.includes('\u4e2d\u4f4e\u8001\u4eba')) {
        return { type: '中老', priority: 4, color: '#6a1b9a', border: '#6a1b9a', background: '#f3e5f5' };
    }
    if (text.includes('身障') || text.includes('身心障礙')) {
        return { type: '身障', priority: 3, color: '#1565c0', border: '#1565c0', background: '#e3f2fd' };
    }
    if (text.includes('中低')) {
        return { type: '中低收', priority: 2, color: '#e65100', border: '#e65100', background: '#fff3e0' };
    }
    if (text.includes('低收')) {
        return { type: '低收', priority: 1, color: '#c62828', border: '#c62828', background: '#ffebee' };
    }

    return { type: text || '弱勢E', priority: 50, color: '#455a64', border: '#607d8b', background: '#eceff1' };
}

async function queryEligibilityStatus(idNo, queryYear = getCurrentRocYear()) {
    const currentYear = Number(queryYear) || getCurrentRocYear();
    const cacheKey = `${idNo}:${currentYear}`;
    const cached = eligibilityCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
        return cached.result;
    }

    try {
        const params = new URLSearchParams({
            qid_no: idNo,
            qcname: '',
            qtype: '',
            qsyr: String(currentYear),
            qeyr: String(currentYear),
            status: 'getData1',
            prog_id: 'SY11010'
        });

        const response = await fetch(SY11010_ACTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`SY11010 request failed: ${response.status}`);
        }

        const html = await response.text();
        const result = parseEligibilityResponse(html, currentYear);
        eligibilityCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
    } catch (error) {
        return {
            success: false,
            error: error.message,
            benefits: [],
            currentStatus: null,
            currentYear
        };
    }
}

function parseEligibilityResponse(html, currentYear = getCurrentRocYear()) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr'));
    const benefits = [];

    for (const row of rows) {
        const cells = Array.from(row.cells || []).map((cell) => normalizeText(cell.textContent));
        if (cells.length < 9) continue;

        const benefit = {
            cityTown: cells[0],
            appNo: cells[1],
            idNo: cells[2],
            name: cells[3],
            benefitName: cells[4],
            approvedPeriod: cells[5],
            amount: cells[6],
            cancelledInfo: cells[7],
            source: cells[8]
        };

        if (!benefit.source.includes(WEAK_E_SOURCE)) continue;
        if (!new RegExp(`(^|[^0-9])${currentYear}/`).test(benefit.approvedPeriod)) continue;

        const status = classifyWeakEStatus(benefit.benefitName);
        benefits.push({ ...benefit, statusType: status.type, priority: status.priority });
    }

    benefits.sort((a, b) => a.priority - b.priority || a.benefitName.localeCompare(b.benefitName, 'zh-Hant'));
    const currentStatus = benefits.length > 0 ? {
        type: benefits[0].statusType,
        benefitName: benefits[0].benefitName,
        year: currentYear,
        period: benefits[0].approvedPeriod,
        source: benefits[0].source,
        appNo: benefits[0].appNo,
        amount: benefits[0].amount
    } : null;

    return {
        success: true,
        name: benefits[0]?.name || '',
        benefits,
        currentStatus,
        allStatuses: benefits,
        totalCount: benefits.length,
        currentYear
    };
}

function displayEligibilityBadge(targetElement, status, name) {
    const existingBadge = targetElement.parentElement?.querySelector('.eligibility-badge');
    if (existingBadge) existingBadge.remove();

    const badge = document.createElement('span');
    badge.className = 'eligibility-badge';
    badge.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'margin-left:8px',
        'padding:2px 8px',
        'border-radius:12px',
        'font-size:11px',
        'font-weight:600',
        'cursor:pointer',
        'border:1px solid transparent',
        'transition:all .2s ease',
        'box-shadow:0 1px 2px rgba(0,0,0,.05)',
        'user-select:none',
        'line-height:1.2'
    ].join(';');

    badge.onmouseenter = () => {
        badge.style.transform = 'translateY(-1px)';
        badge.style.boxShadow = '0 2px 4px rgba(0,0,0,.1)';
    };
    badge.onmouseleave = () => {
        badge.style.transform = 'translateY(0)';
        badge.style.boxShadow = '0 1px 2px rgba(0,0,0,.05)';
    };

    if (status?.currentStatus) {
        const current = status.currentStatus;
        const visual = classifyWeakEStatus(current.benefitName || current.type);
        badge.style.color = visual.color;
        badge.style.borderColor = visual.border;
        badge.style.background = visual.background;
        badge.textContent = current.type;
        badge.title = [
            name || status.name || targetElement.value,
            `${current.benefitName} (${current.year})`,
            `期間: ${current.period}`,
            `來源: ${current.source}`,
            `案號: ${current.appNo}`,
            `弱勢E筆數: ${status.totalCount}`
        ].filter(Boolean).join('\n');
    } else if (status?.success === false) {
        badge.style.color = '#ad5f00';
        badge.style.borderColor = '#ffb300';
        badge.style.background = '#fff8e1';
        badge.textContent = '查詢失敗';
        badge.title = status.error || 'SY11010 查詢失敗';
    } else {
        badge.style.color = '#555';
        badge.style.borderColor = '#aaa';
        badge.style.background = '#f5f5f5';
        badge.textContent = '無資格';
        badge.title = [
            name || status?.name || targetElement.value,
            `${status?.currentYear || getCurrentRocYear()} 年度無弱勢E資格資料`,
            `弱勢E筆數: ${status?.totalCount || 0}`
        ].filter(Boolean).join('\n');
    }

    badge.addEventListener('click', () => {
        window.open(SY11010_MAIN_URL, 'eligibilityWindow', 'width=1200,height=700,scrollbars=yes');
    });

    targetElement.parentElement?.appendChild(badge);
}

function shouldBindEligibilityField(field) {
    if (!field || field.dataset.eligibilityBound) return false;
    if (field.offsetParent === null) return false;
    if (field.name !== 'qid_no') return false;

    const url = location.href.toLowerCase();
    if (url.includes('sz31010')) return false;
    return true;
}

function initEligibilityAutoDetect() {
    const idFields = document.querySelectorAll('input[name="qid_no"][type="text"], input[name="qid_no"]:not([type])');

    for (const field of idFields) {
        if (!shouldBindEligibilityField(field)) continue;
        field.dataset.eligibilityBound = 'true';

        let debounceTimer = null;
        const doQuery = async () => {
            const idNo = field.value.trim().toUpperCase();
            if (!idNo || idNo.length !== 10) return;
            if (typeof validateIdNo === 'function' && !validateIdNo(idNo)) return;

            let loadingBadge = field.parentElement?.querySelector('.eligibility-badge');
            if (!loadingBadge) {
                loadingBadge = document.createElement('span');
                loadingBadge.className = 'eligibility-badge';
                loadingBadge.style.cssText = 'margin-left:8px;padding:2px 8px;font-size:12px;color:#666;';
                field.parentElement?.appendChild(loadingBadge);
            }
            loadingBadge.textContent = '查詢中...';

            const result = await queryEligibilityStatus(idNo);
            displayEligibilityBadge(field, result, result.name || '');
        };

        const scheduleQuery = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(doQuery, 100);
        };

        field.addEventListener('blur', scheduleQuery);
        field.addEventListener('change', scheduleQuery);

        if (field.value && field.value.trim().length === 10) {
            if (window.apiConcurrencyManager) {
                window.apiConcurrencyManager.add(doQuery).catch(() => {});
            } else {
                setTimeout(doQuery, 500);
            }
        }
    }
}
