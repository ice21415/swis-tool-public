// ============================================
// 財稅資料比較與擷取功能模組
// ============================================

// 模組變數
let lastScrapedRows = null;

// ============================================
// 投資資料擷取
// ============================================

function scrapeInvestmentData() {
    for (let table of document.querySelectorAll('table')) {
        const header = table.querySelector("font[color='deeppink']");
        if (header && header.innerText.includes('金管會投資資料')) {
            return table.innerText;
        }
    }
    return null;
}

function calculatePersonSubtotals(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return { subtotals: {}, idToNameMap: {} };
    }

    const subtotals = {};
    const idToNameMap = {};

    // 先過濾空行並trim
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let inInvestmentSection = false;
    let recordsProcessed = 0;

    // 檢測是否為多行格式 (每個欄位獨立一行)
    const isMultiLineFormat = lines.some((line, idx) => {
        return /^\d+$/.test(line) && idx + 1 < lines.length && /^[AB]$/.test(lines[idx + 1]);
    });


    if (isMultiLineFormat) {
        // 多行格式處理
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('金管會投資資料')) {
                inInvestmentSection = true;
                continue;
            }
            if (line.includes('商業司小額投資資料')) {
                break;
            }
            if (!inInvestmentSection) continue;

            // 尋找序號行 (純數字)
            if (/^\d+$/.test(line)) {
                // 下一行應該是 A 或 B
                if (i + 1 < lines.length && /^[AB]$/.test(lines[i + 1])) {
                    if (i + 2 < lines.length) {
                        const idLine = lines[i + 2];
                        const idMatch = idLine.match(/[A-Z]\d{9}/);

                        if (idMatch) {
                            const idNumber = idMatch[0];
                            const afterId = idLine.substring(idMatch.index + 10).trim();
                            const name = afterId.replace(/[\(（].*/, '').trim();

                            // 向後搜尋等值金額 (通常在後面幾行)
                            // 尋找數字格式的行 (等值金額通常是較大的數字)
                            let equivalentValue = null;
                            for (let j = i + 3; j < Math.min(i + 20, lines.length); j++) {
                                // 如果遇到下一筆記錄就停止
                                if (/^\d+$/.test(lines[j]) && j + 1 < lines.length && /^[AB]$/.test(lines[j + 1])) {
                                    break;
                                }
                                // 尋找等值金額 (格式：數字,數字.數字 或純數字)
                                const amountMatch = lines[j].match(/^[\d,]+\.?\d*$/);
                                if (amountMatch && lines[j].length > 0) {
                                    // 跳過小數字 (可能是餘額、收盤價等)，等值金額通常較大
                                    const val = parseFloat(lines[j].replace(/,/g, ''));
                                    if (!isNaN(val)) {
                                        equivalentValue = lines[j].replace(/,/g, '');
                                    }
                                }
                            }

                            if (name && equivalentValue) {
                                const amount = parseFloat(equivalentValue);
                                if (!isNaN(amount)) {
                                    if (!subtotals[idNumber]) {
                                        subtotals[idNumber] = 0;
                                    }
                                    subtotals[idNumber] += amount;
                                    if (!idToNameMap[idNumber]) {
                                        idToNameMap[idNumber] = name;
                                    }
                                    recordsProcessed++;
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        // 原本的單行格式處理
        for (let i = 0; i < lines.length; i++) {
            let currentLine = lines[i];
            if (currentLine.includes('◎金管會投資資料')) {
                inInvestmentSection = true;
                continue;
            }
            if (currentLine.includes('◎商業司小額投資資料')) {
                break;
            }
            if (!inInvestmentSection) continue;

            if (/^\d+\s+[AB]/.test(currentLine)) {
                if (i + 1 < lines.length && !/^\d+\s+[AB]/.test(lines[i + 1])) {
                    currentLine += '\t' + lines[i + 1];
                    i++;
                }
                const idNumberMatch = currentLine.match(/[A-Z]\d{9}/);
                if (!idNumberMatch) continue;
                const idNumber = idNumberMatch[0];

                let name = '';
                const afterIdNumber = currentLine.substring(idNumberMatch.index + idNumberMatch[0].length);
                const nameAfterMatch = afterIdNumber.match(/^\s*\n?\s*([^\s\t\n]+(?:\([^)]+\))?)/);
                if (nameAfterMatch) {
                    name = nameAfterMatch[1].trim();
                }
                const dataString = afterIdNumber.trim();
                let match, equivalentValue;
                if (currentLine.includes('\tB\t')) {
                    const regexTypeB = /^(.*?)\s+\d{3}\/\d{2}\/\d{2}\s+(#?\s*[\w\d\s]+?)\s+(.+?)\s+([\d,.]+)\s+([\d,.]+)\s+(?:(\d{3}\/\d{2}\/\d{2})\s+)?([\d,.]+)/;
                    match = dataString.match(regexTypeB);
                    if (match) {
                        if (!name) name = match[1].trim();
                        equivalentValue = match[7].replace(/,/g, '');
                    }
                } else {
                    const regexWithSecName = /^(.*?)\s+\d{3}\/\d{2}\/\d{2}\s+([\w\d\s#]+?)\s+(?:[A-Z0-9-]+\s+)?([^\d\s].*?)\s+([\d,.]+)\s+([\d,.]+)\s+(?:(\d{3}\/\d{2}\/\d{2})\s+)?([\d,.]+)/;
                    match = dataString.match(regexWithSecName);
                    if (match) {
                        if (!name) name = match[1].trim();
                        equivalentValue = match[7].replace(/,/g, '');
                    } else {
                        const regexNoSecName = /^(.*?)\s+\d{3}\/\d{2}\/\d{2}\s+(#?\s*[\w\d\s]+?)\s+([\d,.]+)\s+([\d,.]+)(?:\s+(\d{3}\/\d{2}\/\d{2}))?\s+([\d,.]+)/;
                        match = dataString.match(regexNoSecName);
                        if (match) {
                            if (!name) name = match[1].trim();
                            equivalentValue = match[6].replace(/,/g, '');
                        }
                    }
                }
                if (match && name && equivalentValue) {
                    const amount = parseFloat(equivalentValue);
                    if (idNumber && !isNaN(amount)) {
                        if (!subtotals[idNumber]) {
                            subtotals[idNumber] = 0;
                        }
                        subtotals[idNumber] += amount;
                        if (!idToNameMap[idNumber]) {
                            idToNameMap[idNumber] = name;
                        }
                        recordsProcessed++;
                    }
                }
            }
        }
    }

    return { subtotals, idToNameMap };
}

async function fetchInvestmentPageByForm(investmentFormDoc, appNo, pageNum, totalPage) {
    try {
        const params = new URLSearchParams();

        // 從投資頁 response 的 form 讀取所有欄位（含正確的 status、prog_id 等）
        const form = investmentFormDoc.querySelector('form[name="main"]') || investmentFormDoc.querySelector('form');
        if (form) {
            form.querySelectorAll('input, select, textarea').forEach(el => {
                const name = el.name;
                if (!name) return;
                if (el.tagName === 'SELECT') {
                    const opt = el.selectedOptions?.[0];
                    params.append(name, opt ? opt.value : el.value);
                    return;
                }
                if (el.tagName === 'TEXTAREA') {
                    params.append(name, el.value || '');
                    return;
                }
                if (el.type === 'checkbox' || el.type === 'radio') {
                    if (!el.checked) return;
                    params.append(name, el.value || 'on');
                    return;
                }
                params.append(name, el.value || '');
            });
        }

        // 覆寫換頁必要欄位
        params.set('app_no', appNo);
        params.set('chk_case', appNo);
        params.set('q_data_type', '12');
        params.set('now_page', String(pageNum));
        params.set('total_page', String(totalPage));
        params.set('run_page', 'rp');

        const url = `${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });
        if (!response.ok) return null;
        return await response.text();
    } catch (error) {
        return null;
    }
}

async function fetchAndProcessInvestmentData(appNo) {
    // Step 1: 抓第一頁
    const firstHtml = await fetchPageData(appNo, '12');
    if (!firstHtml) return null;

    const parser = new DOMParser();

    // Step 2: 從第一頁解析 total_page，並保留 firstDoc 供後續換頁用
    const firstDoc = parser.parseFromString(firstHtml, 'text/html');
    const totalPageInput = firstDoc.querySelector('input[name="total_page"]');
    const totalPage = totalPageInput ? (parseInt(totalPageInput.value) || 1) : 1;

    // Step 3: 收集所有頁面的 HTML（page 2+ 用投資頁自己的 form）
    const allHtmls = [firstHtml];
    if (totalPage > 1) {
        const pageRequests = [];
        for (let p = 2; p <= totalPage; p++) {
            pageRequests.push(fetchInvestmentPageByForm(firstDoc, appNo, p, totalPage));
        }
        const moreHtmls = await Promise.all(pageRequests);
        allHtmls.push(...moreHtmls.filter(Boolean));
    }

    // Step 4: 解析所有頁面的資料
    const subtotals = {};
    const idToNameMap = {};
    let rawText = '';
    let recordsProcessed = 0;

    for (const pageHtml of allHtmls) {
        const doc = parser.parseFromString(pageHtml, 'text/html');

        for (let table of doc.querySelectorAll('table')) {
            const header = table.querySelector("font[color='deeppink']");
            if (header && header.innerText.includes('金管會投資資料')) {
                rawText += table.innerText + '\n';

                const rows = table.querySelectorAll('tr.title4');
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 10) continue;

                    const firstCellText = cells[0].innerText.trim();
                    if (firstCellText === '' || cells[0].getAttribute('colspan')) continue;

                    const idNameCell = cells[2];
                    if (!idNameCell) continue;

                    const idNameHtml = idNameCell.innerHTML;
                    const idNameText = idNameCell.innerText.trim();

                    const idMatch = idNameText.match(/[A-Z]\d{9}/);
                    if (!idMatch) continue;

                    const idNumber = idMatch[0];

                    let name = '';
                    const brIndex = idNameHtml.indexOf('<br>');
                    if (brIndex !== -1) {
                        const afterBr = idNameHtml.substring(brIndex + 4).replace(/<[^>]+>/g, '').trim();
                        name = afterBr.replace(/（[^）]+）/g, '').replace(/\([^)]+\)/g, '').trim();
                    }

                    let equivalentValueCell = cells[9];
                    if (!equivalentValueCell) continue;

                    let valueText = equivalentValueCell.innerText.trim().replace(/,/g, '');
                    let amount = parseFloat(valueText);

                    if (isNaN(amount)) amount = 0;

                    if (idNumber) {
                        if (!subtotals[idNumber]) {
                            subtotals[idNumber] = 0;
                        }
                        subtotals[idNumber] += amount;

                        if (!idToNameMap[idNumber] && name) {
                            idToNameMap[idNumber] = name;
                        }
                        recordsProcessed++;
                    }
                }
                break;
            }
        }
    }

    // 計算總金額
    const totalAmount = Object.values(subtotals).reduce((sum, val) => sum + val, 0);

    if (rawText || recordsProcessed > 0) {
        const dataToStore = {
            appNo: appNo,
            rawText: rawText,
            subtotals: subtotals,
            idToNameMap: idToNameMap,
            timestamp: Date.now()
        };
        await new Promise(resolve => setScopedTaxBundle(appNo, dataToStore, resolve));
        return dataToStore;
    }
    return null;
}

// ============================================
// 人口資料擷取（稱謂、列冊/應計/不計）
// ============================================

async function fetchFamilyData(appNo) {
    try {
        const url = `${location.origin}/socs/jsp/sa/sa1/sa12010_action.jsp?app_no=${encodeURIComponent(appNo)}&status=get`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
            credentials: 'include'
        });
        if (!response.ok) return {};

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const table = doc.querySelector('input[name="chk_all"]')?.closest('table');
        if (!table) return {};

        const familyMap = {};

        for (const row of table.querySelectorAll('tr.title4')) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 11) continue;

            const seqText = (cells[1]?.textContent || '').trim();
            if (!seqText || !/^\d+$/.test(seqText)) continue;

            const idRaw = (cells[9]?.textContent || '').replace(/\s/g, '');
            const idMatch = idRaw.match(/[A-Z]\d{9}/);
            if (!idMatch) continue;

            const idNumber = idMatch[0];
            const name     = (cells[10]?.textContent || '').trim().replace(/\u00a0/g, '');
            const relation = (cells[8]?.textContent  || '').trim();

            const cellV = (idx) => (cells[idx]?.textContent || '').trim() === 'V';
            const isApplicant     = cellV(2);
            const isRecipient     = cellV(3);
            const isNonRegistered = cellV(4);
            const isNotCounted    = cellV(6);

            let status;
            if (isNotCounted) {
                status = 'not_counted';
            } else if (isNonRegistered) {
                status = 'counted';
            } else {
                status = 'listed';
            }

            familyMap[idNumber] = { name, relation, status };
        }
        return familyMap;
    } catch (e) {
        return {};
    }
}

// ============================================
// 動產/不動產資料擷取
// ============================================

function scrapeMovableData() {
    const tables = document.querySelectorAll('table.titleb');
    const targetTable = tables[tables.length - 1];
    if (!targetTable) {
        return null;
    }
    const structuredData = [];
    const rows = targetTable.querySelectorAll('tr.title4');

    lastScrapedRows = rows;
    rows.forEach((row, index) => {
        const cells = row.querySelectorAll('td');
        if (cells.length > 7) {
            const itemType = cells[6].innerText.trim();
            const personName = cells[3].innerText.trim();
            const idNumber = cells[4].innerText.trim();
            const companyName = cells[7].innerText.trim();

            if (itemType === '投資') {
                structuredData.push({ personName, idNumber, companyName, originalIndex: index });
            }
        }
    });

    return { structuredData };
}

function countCurrentImmovableItems() {

    const appNoInput = document.querySelector('input[name="app_no"]');
    const currentAppNo = appNoInput ? appNoInput.value : '';

    const taxTypeInputs = document.querySelectorAll('input[name="a_tax_type"]');
    const countYnInputs = document.querySelectorAll('input[name="a_count_yn_ori"]');

    let landTaxCount = 0;
    let houseCount = 0;
    let landCount = 0;
    taxTypeInputs.forEach((input, index) => {
        const countYn = countYnInputs[index] ? countYnInputs[index].value : '';
        if (countYn !== 'Y') return;

        const value = input.value.trim();
        if (value === 'F') {
            landTaxCount++;
        } else if (value === 'H') {
            houseCount++;
        } else if (value === 'L') {
            landCount++;
        }
    });
    const counts = { landTaxCount, houseCount, landCount };

    const dataToStore = {
        appNo: currentAppNo,
        counts: counts
    };
    setScopedImmovableCounts(currentAppNo, counts, () => {
    });
    return counts;
}

function processDuplicateItems(itemsToProcess) {
    if (!itemsToProcess || itemsToProcess.length === 0) {
        return { uncheckedCount: 0, highlightedCount: 0 };
    }

    const rows = lastScrapedRows;
    if (!rows) {

        return { uncheckedCount: 0, highlightedCount: 0 };
    }
    let uncheckedCount = 0;
    let highlightedCount = 0;

    function applyMatchedHighlight(row) {
        if (!row) return;
        row.style.setProperty('background-color', '#fff59d', 'important');
        row.style.setProperty('outline', '2px solid #f0c419', 'important');
        row.querySelectorAll('td').forEach(cell => {
            cell.style.setProperty('background-color', '#fff59d', 'important');
        });
    }

    itemsToProcess.forEach(item => {
        const row = rows[item.originalIndex];
        if (row) {
            applyMatchedHighlight(row);
            highlightedCount++;
            const checkbox = row.querySelector('td input[type="checkbox"]');

            if (checkbox && checkbox.checked) {
                checkbox.click();
                uncheckedCount++;
                requestAnimationFrame(() => applyMatchedHighlight(row));
                setTimeout(() => applyMatchedHighlight(row), 80);
            }
        }
    });
    return { uncheckedCount, highlightedCount };
}

async function fetchAndParseCurrentImmovableCounts(appNo) {
    const html = await fetchPageData(appNo, '3');
    if (!html) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const taxTypeInputs = doc.querySelectorAll('input[name="a_tax_type"]');
    const countYnInputs = doc.querySelectorAll('input[name="a_count_yn_ori"]');

    let landTaxCount = 0;
    let houseCount = 0;
    let landCount = 0;

    taxTypeInputs.forEach((input, index) => {
        const countYn = countYnInputs[index] ? countYnInputs[index].value : '';
        if (countYn !== 'Y') return;

        const value = input.value.trim();
        if (value === 'F') {
            landTaxCount++;
        } else if (value === 'H') {
            houseCount++;
        } else if (value === 'L') {
            landCount++;
        }
    });

    return { landTaxCount, houseCount, landCount };
}

// ============================================
// 通用財稅 API 請求工具
// ============================================

async function fetchPageData(appNo, dataType, extraParams = {}) {
    try {
        const form = document.querySelector('form[name="main"]') || document.querySelector('form');
        const params = new URLSearchParams();

        const fields = form.querySelectorAll('input, select, textarea');
        fields.forEach(el => {
            const name = el.name;
            if (!name) return;
            if (el.tagName === 'SELECT') {
                const opt = el.selectedOptions?.[0];
                params.append(name, opt ? opt.value : el.value);
                return;
            }
            if (el.tagName === 'TEXTAREA') {
                params.append(name, el.value || '');
                return;
            }
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (!el.checked) return;
                params.append(name, el.value || 'on');
                return;
            }
            params.append(name, el.value || '');
        });

        params.set('app_no', appNo);
        params.set('q_data_type', dataType);
        params.set('chk_case', appNo);
        params.set('status', 'list');

        // 覆寫分頁相關參數（例如 now_page、total_page、run_page）
        for (const [key, value] of Object.entries(extraParams)) {
            params.set(key, value);
        }

        const payloadString = params.toString();
        const url = `${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: payloadString,
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Network response was not ok');
        return await response.text();
    } catch (error) {
        return null;
    }
}

// ============================================
// 去年財稅資料載入與比較
// ============================================

function taxExclusionNumber(value) {
    const number = Number(String(value || '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(number) ? number : 0;
}

function findTaxExclusionSummaryInput(keyword, excludeKeyword = '') {
    return Array.from(document.querySelectorAll('input[name="cnt1"]')).find((input) => {
        const label = input.closest('td')?.previousElementSibling?.textContent || '';
        return label.includes(keyword) && (!excludeKeyword || !label.includes(excludeKeyword));
    }) || null;
}

function getTaxExclusionPersonId(value) {
    return String(value || '').match(/[A-Z][A-Z0-9]\d{8}/)?.[0]?.toUpperCase() || '';
}

function parseTaxExclusionTotals(html, amountCellIndex = 8) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const totals = {};
    doc.querySelectorAll('tr.title4').forEach((row) => {
        const cells = Array.from(row.cells || []);
        const counted = (row.querySelector('input[name="a_count_yn_ori"]')?.value || '').trim().toUpperCase();
        if (counted !== 'Y' || cells.length <= amountCellIndex) return;
        const idNo = (row.querySelector('input[name="a_id_no"]')?.value || '').trim().toUpperCase()
            || (cells[4]?.textContent || '').replace(/\s/g, '').match(/[A-Z][A-Z0-9]\d{8}/)?.[0] || '';
        if (!idNo) return;
        const amount = taxExclusionNumber(String(cells[amountCellIndex]?.textContent || '').split(/[（(]/)[0]);
        totals[idNo] = (totals[idNo] || 0) + amount;
    });
    return totals;
}

const taxExclusionTotalsCache = new Map();

async function getTaxExclusionPersonTotals(appNo) {
    if (!appNo) return { income: {}, movable: {} };
    if (taxExclusionTotalsCache.has(appNo)) return taxExclusionTotalsCache.get(appNo);
    const [incomeHtml, movableHtml] = await Promise.all([fetchPageData(appNo, '1'), fetchPageData(appNo, '2')]);
    const totals = { income: parseTaxExclusionTotals(incomeHtml), movable: parseTaxExclusionTotals(movableHtml) };
    taxExclusionTotalsCache.set(appNo, totals);
    return totals;
}

function injectTaxPopulationExclusion() {
    if (document.getElementById('tax-population-exclusion')) return;
    const sourceSelect = document.querySelector('select[name="sel_cname"]');
    if (!sourceSelect) return;

    const select = sourceSelect.cloneNode(true);
    select.id = 'tax-population-exclusion';
    select.name = 'tax_population_exclusion';
    select.removeAttribute('onchange');
    select.removeAttribute('oninput');
    select.value = '';
    if (select.options[0]) select.options[0].textContent = '選擇扣除人口';
    select.style.marginLeft = '8px';
    const result = document.createElement('span');
    result.id = 'tax-population-exclusion-result';
    result.style.cssText = 'display:none;margin-left:8px;padding:3px 7px;border:1px solid #d8c28a;background:#fff8dc;color:#7a4b00;font-size:12px;font-weight:bold;line-height:1.5;white-space:normal;';

    select.addEventListener('change', async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const idNo = getTaxExclusionPersonId(select.value);
        if (!idNo) { result.style.display = 'none'; return; }
        result.style.display = 'inline-block';
        result.textContent = '計算中…';
        try {
            const appNo = getCurrentAppNo();
            const totals = await getTaxExclusionPersonTotals(appNo);
            const income = taxExclusionNumber(findTaxExclusionSummaryInput('\u6240\u5f97\u5408\u8a08')?.value);
            const movable = taxExclusionNumber(findTaxExclusionSummaryInput('\u52d5\u7522\u5408\u8a08')?.value);
            const population = Math.max(1, taxExclusionNumber(document.querySelector('input[name="count_fmt"]')?.value) - 1);
            const monthlyIncome = Math.max(0, income - (totals.income[idNo] || 0)) / 12 / population;
            const movableAverage = Math.max(0, movable - (totals.movable[idNo] || 0)) / population;
            result.textContent = `扣除後：所得月平均 ${monthlyIncome.toLocaleString('zh-TW', { maximumFractionDigits: 2 })} 元／動產平均 ${movableAverage.toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 元（列計 ${population} 人）`;
        } catch (error) {
            result.textContent = '扣除人口計算失敗';
        }
    }, true);
    sourceSelect.insertAdjacentElement('afterend', select);
    select.insertAdjacentElement('afterend', result);
}

async function initTaxSummaryPage() {
    const inputs = document.querySelectorAll('input[name="cnt1"]');
    if (inputs.length === 0) {
        return;
    }

    let hasSummaryFields = false;
    inputs.forEach(input => {
        const prevTd = input.closest('td')?.previousElementSibling;
        if (prevTd) {
            const label = prevTd.textContent.trim();
            if (label.includes('所得合計') || label.includes('動產合計') || label.includes('不動產合計')) {
                hasSummaryFields = true;
            }
        }
    });
    if (!hasSummaryFields) {
        return;
    }

    injectTaxPopulationExclusion();

    const currentAppNo = getCurrentAppNo();
    let previousYearAppNo = getPreviousYearAppNo();

    // Fallback: 如果 getPreviousYearAppNo() 沒找到，嘗試用 pickPrevYearCase 找
    if (!previousYearAppNo && typeof pickPrevYearCase === 'function') {
        previousYearAppNo = pickPrevYearCase(document, currentAppNo);
    }

    // 1. 準備 Current Counts (優先讀取 Cache)
    let currentCountsPromise = Promise.resolve(null);
    if (currentAppNo) {
        currentCountsPromise = new Promise(resolve => {
            getScopedImmovableCounts(currentAppNo, (cached) => {
                if (cached && cached.counts) {
                    // Cache Hit
                    resolve(cached.counts);
                } else {
                    // Cache Miss: Fetch and Store
                    fetchAndParseCurrentImmovableCounts(currentAppNo).then(counts => {
                        if (counts) {
                            setScopedImmovableCounts(currentAppNo, counts, () => resolve(counts));
                        } else {
                            resolve(null);
                        }
                    });
                }
            });
        });
    }

    if (!previousYearAppNo) {
        return;
    }

    // 2. 平行執行所有請求
    const [currentCounts, previousData, previousCounts] = await Promise.all([
        currentCountsPromise,
        fetchPreviousYearData(previousYearAppNo),
        fetchAndParseCurrentImmovableCounts(previousYearAppNo)
    ]);

    // 3. 顯示比較結果
    displayPreviousYearComparison(previousData, previousCounts);
}

async function fetchPreviousYearData(previousAppNo) {
    try {
        const form = document.querySelector('form[name="main"]') || document.querySelector('form');
        const params = new URLSearchParams();

        const fields = form.querySelectorAll('input, select, textarea');
        fields.forEach(el => {
            const name = el.name;
            if (!name) return;
            if (el.tagName === 'SELECT') {
                const opt = el.selectedOptions?.[0];
                params.append(name, opt ? opt.value : el.value);
                return;
            }
            if (el.tagName === 'TEXTAREA') {
                params.append(name, el.value || '');
                return;
            }
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (!el.checked) return;
                params.append(name, el.value || 'on');
                return;
            }
            params.append(name, el.value || '');
        });

        params.set('app_no', previousAppNo);
        params.set('q_data_type', '4');
        params.set('chk_case', previousAppNo);
        params.set('status', 'list');
        const payloadString = params.toString();
        const url = `${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: payloadString,
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Network response was not ok: ' + response.status);
        }
        const html = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const inputs = doc.querySelectorAll('input[name="cnt1"]');
        let incomeTotal = null;
        let movableTotal = null;
        let immovableTotal = null;
        let landTax = null;
        let house = null;
        let land = null;
        inputs.forEach((input, index) => {
            const prevTd = input.closest('td')?.previousElementSibling;
            if (prevTd) {
                const label = prevTd.textContent.trim();

                if (label.includes('所得合計') && label.includes('（年）')) {
                    incomeTotal = input.value.replace(/,/g, '');
                } else if (label.includes('不動產合計') && label.includes('（年）')) {
                    immovableTotal = input.value.replace(/,/g, '');
                } else if (label.includes('動產合計') && label.includes('（年）')) {
                    movableTotal = input.value.replace(/,/g, '');
                } else if (label.includes('田賦') && label.includes('（年）')) {
                    landTax = input.value.replace(/,/g, '');
                } else if (label.includes('房屋') && label.includes('（年）')) {
                    house = input.value.replace(/,/g, '');
                } else if (label.includes('土地') && label.includes('（年）')) {
                    land = input.value.replace(/,/g, '');
                }
            }
        });
        return {
            incomeTotal,
            movableTotal,
            immovableTotal,
            landTax,
            house,
            land
        };
    } catch (error) {
        return null;
    }
}

function displayPreviousYearComparison(previousData, previousCounts) {
    if (!previousData) return;

    const appNoInput = document.querySelector('input[name="app_no"]');
    const currentAppNo = appNoInput ? appNoInput.value : '';

    getScopedImmovableCounts(currentAppNo, (result) => {
        let immovableCounts = {
            landTaxCount: 0,
            houseCount: 0,
            landCount: 0
        };

        if (result && result.counts) {
            immovableCounts = result.counts || immovableCounts;
        }

        const inputs = document.querySelectorAll('input[name="cnt1"]');
        inputs.forEach(input => {
            const currentTd = input.closest('td');
            if (!currentTd) return;
            const prevTd = currentTd.previousElementSibling;
            if (!prevTd) return;
            const label = prevTd.textContent.trim();
            let previousValue = null;
            let fieldName = '';

            if (label.includes('所得合計')) {
                previousValue = previousData.incomeTotal;
                fieldName = '所得合計';
            } else if (label.includes('不動產合計')) {
                previousValue = previousData.immovableTotal;
                fieldName = '不動產合計';
            } else if (label.includes('動產合計')) {
                previousValue = previousData.movableTotal;
                fieldName = '動產合計';
            } else if (label.includes('田賦')) {
                previousValue = previousData.landTax;
                fieldName = '田賦';
            } else if (label.includes('房屋')) {
                previousValue = previousData.house;
                fieldName = '房屋';
            } else if (label.includes('土地')) {
                previousValue = previousData.land;
                fieldName = '土地';
            }
            if (previousValue !== null) {
                const prevValue = parseFloat(previousValue);

                const existingComparison = currentTd.querySelector('.previous-year-comparison');
                if (existingComparison) {
                    existingComparison.remove();
                }

                const comparisonSpan = document.createElement('span');
                comparisonSpan.className = 'previous-year-comparison';
                comparisonSpan.style.marginLeft = '10px';
                comparisonSpan.style.fontSize = '12px';
                comparisonSpan.style.fontWeight = 'normal';

                const formattedPrevYear = prevValue.toLocaleString('zh-TW');

                let monthHtml = '';
                if (fieldName === '所得合計') {
                    const prevMonthValue = prevValue / 12;
                    const formattedPrevMonth = Math.round(prevMonthValue).toLocaleString('zh-TW');
                    monthHtml = `<br><font color="brown">【月： ${formattedPrevMonth} 元】</font>`;
                }

                let countsHtml = '';
                if (fieldName === '不動產合計') {
                    const countTexts = [];
                    if (immovableCounts.landTaxCount > 0) {
                        countTexts.push(`田賦: ${immovableCounts.landTaxCount}筆`);
                    }
                    if (immovableCounts.houseCount > 0) {
                        countTexts.push(`房屋: ${immovableCounts.houseCount}筆`);
                    }
                    if (immovableCounts.landCount > 0) {
                        countTexts.push(`土地: ${immovableCounts.landCount}筆`);
                    }
                    if (countTexts.length > 0) {
                        countsHtml += `<br><font color="purple">【今年筆數：${countTexts.join(' | ')}】</font>`;
                    }

                    if (previousCounts) {
                        const prevCountTexts = [];
                        if (previousCounts.landTaxCount > 0) {
                            prevCountTexts.push(`田賦: ${previousCounts.landTaxCount}筆`);
                        }
                        if (previousCounts.houseCount > 0) {
                            prevCountTexts.push(`房屋: ${previousCounts.houseCount}筆`);
                        }
                        if (previousCounts.landCount > 0) {
                            prevCountTexts.push(`土地: ${previousCounts.landCount}筆`);
                        }
                        if (prevCountTexts.length > 0) {
                            countsHtml += `<br><font color="brown">【去年筆數：${prevCountTexts.join(' | ')}】</font>`;
                        }
                    }
                }
                comparisonSpan.innerHTML = `
                <br><font color="blue">【去年: ${formattedPrevYear} 元】</font>${monthHtml}${countsHtml}
            `;

                const fontElements = currentTd.querySelectorAll('font');
                if (fontElements.length > 0) {
                    fontElements[fontElements.length - 1].parentNode.appendChild(comparisonSpan);
                } else {
                    input.parentNode.appendChild(comparisonSpan);
                }
            }
        });
    });
}

function extractTaxSummaryData() {
    const inputs = document.querySelectorAll('input[name="cnt1"]');
    let incomeTotal = null;
    let movableTotal = null;
    let immovableTotal = null;
    inputs.forEach((input, index) => {
        const prevTd = input.closest('td')?.previousElementSibling;
        if (prevTd) {
            const label = prevTd.textContent.trim();
            if (label.includes('所得合計')) {
                incomeTotal = input.value.replace(/,/g, '');
            } else if (label.includes('動產合計')) {
                movableTotal = input.value.replace(/,/g, '');
            } else if (label.includes('不動產合計')) {
                immovableTotal = input.value.replace(/,/g, '');
            }
        }
    });
    return { incomeTotal, movableTotal, immovableTotal };
}

// ============================================
// 自動化財稅比對 (Auto Diff)
// ============================================

async function runTaxDiffFlow() {
    if (!location.pathname.includes('sz31010_upd.jsp')) return;

    const chkCaseSelect = document.querySelector("select[name='chk_case']");
    if (!chkCaseSelect) return;

    const hasTaxTable = document.querySelector('tr.title4');
    if (!hasTaxTable) return;
    try {
        const params = new URLSearchParams(location.search);
        const urlAppNo = (params.get('app_no') || params.get('appNo') || '').trim();
        let payloadAppNo = '';
        const appNoInputs = Array.from(document.querySelectorAll('input[name="app_no"], input[name="appNo"], input[id="app_no"], input[id="appNo"]'));
        const distinct = new Set();
        appNoInputs.forEach(i => { if (i.value) distinct.add(i.value.trim()); });
        const candidates = Array.from(distinct);
        payloadAppNo = candidates.find(v => v && v !== urlAppNo) || candidates[0] || urlAppNo;
        const chkSelect = document.querySelector("select[name='chk_case']");
        const selectedCase = chkSelect?.value?.trim();
        if (selectedCase) {
            payloadAppNo = selectedCase;
        }
        const baseAppNo = payloadAppNo || urlAppNo;
        if (!baseAppNo) return;
        const prevAppNo = pickPrevYearCase(document, baseAppNo) || payloadAppNo || urlAppNo;
        const payloadString = buildPayloadString(document, baseAppNo, prevAppNo);
        const record = {
            value: payloadAppNo,
            url: location.href,
            urlAppNo,
            payloadAppNo,
            capturedAt: new Date().toISOString(),
            payloadString
        };
        chrome.storage.local.set({ latestAppNo: record }, () => {
            chrome.runtime.sendMessage({ action: 'appNoCaptured', data: record }, () => chrome.runtime.lastError);
        });
        const targetAppNo = prevAppNo || payloadAppNo || urlAppNo;
        const targetUrl = `${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp?app_no=${encodeURIComponent(targetAppNo)}`;

        const fetchOptions = payloadString ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payloadString,
            credentials: 'include'
        } : {
            method: 'GET',
            credentials: 'include'
        };
        const resp = await fetch(targetUrl, fetchOptions);
        if (!resp.ok) return;
        const targetHtml = await resp.text();
        const carsA = parseAssetRows(document, true);
        const carsB = parseAssetRows(targetHtml, true);
        const carDiff = diffRows(carsA, carsB);
        const realEstateA = parseRealEstateRows(document, true);
        const realEstateB = parseRealEstateRows(targetHtml, true);
        const realEstateDiff = diffRealEstateRows(realEstateA, realEstateB);
        const summary = formatDiffSummary(carDiff, realEstateDiff);
        if (summary) {
            renderInlineNotice(summary);
        }
    } catch (err) {
        // Silent error
    }
}

// Diff Helpers
function buildPayloadString(doc, currentAppNo, prevAppNo) {
    const form = doc.querySelector('form') || doc;
    const params = new URLSearchParams();
    const fields = form.querySelectorAll('input, select, textarea');
    fields.forEach(el => {
        const name = el.name;
        if (!name) return;
        if (el.tagName === 'SELECT') {
            const opt = el.selectedOptions?.[0];
            params.append(name, opt ? opt.value : el.value);
            return;
        }
        if (el.tagName === 'TEXTAREA') {
            params.append(name, el.value || '');
            return;
        }
        if (el.type === 'checkbox' || el.type === 'radio') {
            if (!el.checked) return;
            params.append(name, el.value || 'on');
            return;
        }
        params.append(name, el.value || '');
    });
    const appNoForPost = prevAppNo || currentAppNo;
    if (appNoForPost) {
        params.set('app_no', appNoForPost);
        params.set('q_app_no', '');
    }
    if (prevAppNo) params.set('chk_case', prevAppNo);
    return params.toString();
}

function pickPrevYearCase(doc, currentAppNo) {
    if (!doc || !currentAppNo) return '';
    const options = Array.from(doc.querySelectorAll("select[name='chk_case'] option"));
    if (!options.length) return '';
    const yearPart = currentAppNo.slice(2, 6);
    const prevYearNum = parseInt(yearPart, 10) - 1;
    const prevPrefix = isNaN(prevYearNum) ? '' : `EA${prevYearNum}`;
    const exactPrev = options.map(o => o.value?.trim()).find(v => v && prevPrefix && v.startsWith(prevPrefix));
    if (exactPrev) return exactPrev;
    const notCurrent = options.map(o => o.value?.trim()).find(v => v && v !== currentAppNo);
    return notCurrent || '';
}

function parseAssetRows(html, requireOriY = true) {
    const rows = [];
    if (!html) return rows;
    const doc = typeof html === 'string' ? new DOMParser().parseFromString(html, 'text/html') : html;
    const trs = doc.querySelectorAll('tr.title4');
    trs.forEach((tr, idx) => {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 12) return;
        const row = {
            序號: textContent(tds[0]),
            列計: checkboxValue(tr.querySelector('input[name="a_count_yn"]')),
            財稅年度: textContent(tds[2]),
            姓名: textContent(tds[3]),
            身分證號: textContent(tds[4]),
            稱謂: textContent(tds[5]),
            動產項目: textContent(tds[6]),
            '公司名稱/車廠牌': textContent(tds[7]),
            金額: textContent(tds[8]),
            轉入日期: textContent(tds[9]),
            登錄日期: textContent(tds[10]),
            備註: textContent(tds[11]),
            _rowIndex: idx + 1
        };
        const isCarRow = row['動產項目'] && row['動產項目'].includes('汽車');
        if (!isCarRow) return;
        const hiddenCountOri = (tr.querySelector('input[name="a_count_yn_ori"]')?.value || '').trim().toUpperCase();
        row['a_count_yn_ori'] = hiddenCountOri;
        if (requireOriY) {
            if (hiddenCountOri === 'Y') rows.push(row);
        } else {
            rows.push(row);
        }
    });
    return rows;
}

function parseRealEstateRows(htmlString, requireOriY) {
    const doc = typeof htmlString === 'string' ? new DOMParser().parseFromString(htmlString, 'text/html') : htmlString;
    const trs = doc.querySelectorAll('tr.title4');
    const rows = [];
    trs.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 12) return;
        const taxType = tds[6]?.textContent?.trim() || '';
        if (!taxType.includes('田賦') && !taxType.includes('房屋') && !taxType.includes('土地')) return;
        const hiddenCountOri = tr.querySelector('input[name="a_count_yn_ori"]')?.value?.trim() || '';
        if (requireOriY && hiddenCountOri.toUpperCase() !== 'Y') return;
        const location = tds[7]?.textContent?.trim() || '';
        if (!location || location === '查無資料') return;
        const name = tds[3]?.textContent?.trim() || '';
        const idNo = tds[4]?.textContent?.trim() || '';
        const taxYear = tds[2]?.textContent?.trim() || '';
        const area = tds[8]?.textContent?.trim() || '';
        const value = tds[9]?.textContent?.trim() || '';
        rows.push({
            '財稅年度': taxYear,
            '姓名': name,
            '身分證號': idNo,
            '不動產項目': taxType,
            '座落': location,
            '面積': area,
            '公告現值': value,
            'a_count_yn_ori': hiddenCountOri
        });
    });
    return rows;
}

function diffRealEstateRows(rowsA, rowsB) {
    const used=new Set(),onlyA=[];
    const clean=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').replace(/臺/g,'台');
    const county=row=>clean(row['座落']).match(/^(.{2,3}[縣市])/)?.[1];
    const key=row=>[clean(row['身分證號']),clean(row['不動產項目']),buildRealEstateKey(row)].join('|');
    rowsA.forEach(row=>{
        if(!buildRealEstateKey(row))return;
        const index=rowsB.findIndex((old,i)=>!used.has(i)&&key(old)===key(row)&&(!county(old)||!county(row)||county(old)===county(row)));
        if(index<0)onlyA.push(row);else used.add(index);
    });
    const onlyB=rowsB.filter((row,i)=>!used.has(i)&&buildRealEstateKey(row));
    return { onlyA, onlyB };
}

function textContent(el) {
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
}

function checkboxValue(el) {
    if (!el) return '';
    return el.checked ? 'Y' : '';
}

function diffRows(rowsA, rowsB) {
    const clean=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').replace(/臺/g,'台');
    const key=row=>[clean(row['身分證號']),clean(buildKey(row))].join('|');
    const used=new Set(),onlyA=[],changed=[];
    rowsA.forEach(row=>{
        const index=rowsB.findIndex((old,i)=>!used.has(i)&&key(old)===key(row));
        if(index<0)onlyA.push(row);else used.add(index);
    });
    const onlyB=rowsB.filter((row,i)=>!used.has(i));
    return { onlyA, onlyB, changed };
}

function buildKey(row) {
    const company = (row['公司名稱/車廠牌'] || row['公司名稱'] || '').trim();
    return company;
}

function buildRealEstateKey(row) {
    const location = (row['座落'] || '').trim();
    if (!location || location === '查無資料') return '';
    const normalized = normalizeAddress(location);
    return normalized;
}

function normalizeAddress(address) {
    if (!address) return '';
    let normalized = String(address).normalize('NFKC').replace(/\s/g,'');
    normalized = normalized.replace(/臺/g, '台');
    normalized = normalized.replace(/^(?:台北市|新北市|桃園市|台中市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣)/, '');
    return normalized;
}

function compareRowFields(a, b) {
    const fields = ['公司名稱/車廠牌'];
    const diffs = [];
    fields.forEach(f => {
        const va = (a[f] || '').trim();
        const vb = (b[f] || '').trim();
        if (va !== vb) diffs.push({ field: f, a: va, b: vb });
    });
    return diffs;
}

function formatDiffSummary(carDiff, realEstateDiff) {
    if (!carDiff && !realEstateDiff) return '無法取得比對結果';
    const sections = [];
    if (carDiff) {
        const uniqueMissing = carDiff.onlyB;
        const uniqueAdded = carDiff.onlyA;
        const totalMissing = uniqueMissing.length;
        const totalAdded = uniqueAdded.length;

        const pickKeys = (rows) => {
            const grouped = new Map();
            rows.forEach(r => {
                const idNo = (r['身分證號'] || '').trim();
                const key = buildKey(r) || '(未填鍵值)';
                if (!grouped.has(idNo)) {
                    grouped.set(idNo, {
                        name: (r['姓名'] || '').trim(),
                        keys: []
                    });
                }
                grouped.get(idNo).keys.push(key);
            });
            const results = [];
            grouped.forEach((data, idNo) => {
                const keyStr = data.keys.join('、');
                results.push(data.name ? `${keyStr} ${data.name}` : keyStr);
            });
            return results.join('｜');
        };

        if (totalMissing > 0 || totalAdded > 0) {
            const parts = [];
            if (totalMissing > 0) parts.push(`缺少：${pickKeys(uniqueMissing)}`);
            if (totalAdded > 0) parts.push(`新增：${pickKeys(uniqueAdded)}`);
            sections.push(`動產${parts.join('｜')}`);
        }
    }
    if (realEstateDiff) {
        const totalMissing = realEstateDiff.onlyB.length;
        const totalAdded = realEstateDiff.onlyA.length;

        const pickRealEstateKeys = (rows) => {
            const grouped = new Map();
            rows.forEach(r => {
                const idNo = (r['身分證號'] || '').trim();
                const location = (r['座落'] || '').trim();
                if (!grouped.has(idNo)) {
                    grouped.set(idNo, {
                        name: (r['姓名'] || '').trim(),
                        locations: []
                    });
                }
                grouped.get(idNo).locations.push(location);
            });
            const results = [];
            grouped.forEach((data, idNo) => {
                const locationStr = data.locations.join('、');
                results.push(data.name ? `${locationStr} ${data.name}` : locationStr);
            });
            return results.join('｜');
        };

        if (totalMissing > 0 || totalAdded > 0) {
            const parts = [];
            if (totalMissing > 0) parts.push(`缺少：${pickRealEstateKeys(realEstateDiff.onlyB)}`);
            if (totalAdded > 0) parts.push(`新增：${pickRealEstateKeys(realEstateDiff.onlyA)}`);
            sections.push(`不動產${parts.join('｜')}`);
        }
    }
    if (sections.length === 0) return '';
    return `前一年 vs 目前差異｜${sections.join('｜')}`;
}

function renderInlineNotice(text) {
    const id = 'taxDiffInlineNotice';
    if (!text) {
        const old = document.getElementById(id);
        if (old) old.remove();
        return;
    }
    let box = document.getElementById(id);
    if (!box) {
        const memoCell = Array.from(document.querySelectorAll('td.title2')).find(td => td.textContent.trim() === '備註');
        const memoRow = memoCell?.closest('tr');
        if (memoRow) {
            const table = memoRow.closest('table');
            box = document.createElement('div');
            box.id = id;
            if (table && table.parentElement) {
                table.parentElement.insertBefore(box, table.nextSibling);
            } else {
                (document.body || document.documentElement).appendChild(box);
            }
        } else {
            box = document.createElement('div');
            box.id = id;
            (document.body || document.documentElement).appendChild(box);
        }
    }
    box.textContent = text;
    box.style.background = '#f8fafc';
    box.style.color = '#0f172a';
    box.style.padding = '8px 10px';
    box.style.margin = '0';
    box.style.borderRadius = '0';
    box.style.border = '1px solid #cbd5e1';
    box.style.opacity = '0.9';
    box.style.width = '100%';
}

function dispatchFormEvents(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizeAmountValue(value) {
    const normalized = String(value || '').replace(/[^\d.-]/g, '');
    const num = Number(normalized);
    if (!Number.isFinite(num)) return '';
    return String(Math.round(num));
}

function selectPersonById(idNumber, fallbackName) {
    const select = document.querySelector('select[name="sel_cname"]');
    if (!select) return { ok: false, error: '找不到姓名下拉欄位' };

    const cleanId = String(idNumber || '').trim().toUpperCase();
    const cleanName = String(fallbackName || '').trim();
    const options = Array.from(select.options);
    const option = options.find((opt) => cleanId && String(opt.value || '').toUpperCase().includes(cleanId))
        || options.find((opt) => cleanName && opt.text.trim().includes(cleanName));

    if (!option) {
        return { ok: false, error: `找不到對應姓名：${cleanName || cleanId}` };
    }

    select.value = option.value;
    dispatchFormEvents(select);

    const parts = String(option.value || '').split('｜');
    const idInput = document.querySelector('input[name="id_no"]');
    const nameInput = document.querySelector('input[name="cname"]');
    if (idInput && parts[1]) {
        idInput.value = parts[1];
        dispatchFormEvents(idInput);
    }
    if (nameInput) {
        nameInput.value = option.text.replace(/\s+-\s+不計所得財產$/, '').trim();
        dispatchFormEvents(nameInput);
    }

    return { ok: true, selectedText: option.text.trim() };
}

function fillInvestmentEntryForm(request) {
    if (!location.pathname.includes('sz31010_upd.jsp')) {
        return { success: false, error: '目前視窗不是財稅明細維護作業' };
    }

    const person = selectPersonById(request.idNumber, request.name);
    if (!person.ok) {
        return { success: false, error: person.error };
    }

    const taxType = document.querySelector('select[name="tax_type"]');
    const amount = document.querySelector('input[name="tax_mny"]');
    const memo = document.querySelector('textarea[name="memo"]');
    const unitName = document.querySelector('input[name="unit_name"]');
    const amountValue = normalizeAmountValue(request.amount);

    if (!taxType) return { success: false, error: '找不到動產項目欄位' };
    if (!amount) return { success: false, error: '找不到動產金額欄位' };
    if (!memo) return { success: false, error: '找不到備註欄位' };
    if (!amountValue) return { success: false, error: '投資金額格式不正確' };

    taxType.value = 'I';
    dispatchFormEvents(taxType);

    if (unitName) {
        unitName.value = '';
        dispatchFormEvents(unitName);
    }

    amount.value = amountValue;
    dispatchFormEvents(amount);

    memo.value = '投資現值';
    dispatchFormEvents(memo);

    const countYn = document.querySelector('input[name="count_yn"]');
    if (countYn && !countYn.checked) {
        countYn.checked = true;
        dispatchFormEvents(countYn);
    }

    return {
        success: true,
        selectedName: person.selectedText,
        amount: amountValue
    };
}

function dedupeByKey(rows) {
    const seen = new Set();
    const result = [];
    rows.forEach(r => {
        const k = buildKey(r);
        if (!k || seen.has(k)) return;
        seen.add(k);
        result.push(r);
    });
    return result;
}

// ============================================
// 初始化
// ============================================

// 自動偵測並執行財稅比對
// 由 content.js 統一調度
// if (document.readyState === 'complete') {
//     runTaxDiffFlow();
// } else {
//     window.addEventListener('load', runTaxDiffFlow, { once: true });
// }

// 監聽來自 background 或其他模組的訊息 (用於擷取資料按鈕)
function createInvestmentActionButton(id, label, action, accentColor) {
    const btn = document.createElement('input');
    btn.type = 'button';
    btn.id = id;
    btn.value = label;
    btn.className = 'button1';
    btn.style.cssText = [
        'margin-left:5px',
        `background:${accentColor}`,
        'color:white',
        'border:none',
        'padding:3px 8px',
        'cursor:pointer',
        'border-radius:3px'
    ].join(';');

    btn.addEventListener('click', (event) => {
        event.preventDefault();
        const originalValue = btn.value;
        btn.disabled = true;
        btn.value = '執行中...';
        chrome.runtime.sendMessage({ action }, (response) => {
            btn.disabled = false;
            btn.value = originalValue;
            if (chrome.runtime.lastError) {
                showStatusBanner(chrome.runtime.lastError.message || '操作失敗', 'error', 3000);
                return;
            }
            if (!response || response.success === false) {
                showStatusBanner((response && response.error) || '操作失敗', 'error', 3000);
            }
        });
    });

    return btn;
}

function injectInvestmentActionButtons() {
    if (document.getElementById('swis-investment-compare-btn') || document.getElementById('swis-investment-subtotal-btn')) {
        return;
    }

    const pageType = typeof getPageType === 'function' ? getPageType() : 'unknown';
    if (pageType !== 'movable_assets_page') {
        return;
    }

    const anchor = document.querySelector('input[name="b_return"], input[name="b_qryS"], input[name="b_qry"], input[type="button"].button1, input[type="submit"].button1');
    const host = document.createElement('span');
    host.id = 'swis-investment-action-buttons';
    host.style.cssText = 'display:inline-flex;align-items:center;gap:0;margin-left:4px;';

    host.appendChild(createInvestmentActionButton('swis-investment-compare-btn', '投資比對', 'runInvestmentCompareFromPage', '#198754'));
    host.appendChild(createInvestmentActionButton('swis-investment-subtotal-btn', '投資小計', 'viewInvestmentSubtotalsFromPage', '#0d6efd'));

    if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(host, anchor.nextSibling);
        return;
    }

    const fallback = document.querySelector('form, table, body');
    if (fallback) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin:6px 0;text-align:left;';
        wrapper.appendChild(host);
        fallback.parentNode ? fallback.parentNode.insertBefore(wrapper, fallback) : fallback.prepend(wrapper);
    }
}

window.injectInvestmentActionButtons = injectInvestmentActionButtons;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 對於投資和動產擷取，檢查是否在正確的 frame
    const isMainTaxFrame = document.querySelector('input[name="app_no"]') ||
        document.querySelector('select[name="chk_case"]') ||
        document.querySelector('input[name="q_data_type"]');

    switch (request.action) {
        case 'ping':
            sendResponse({ status: 'ready' });
            break;
        case 'fillInvestmentEntry': {
            const result = fillInvestmentEntryForm(request);
            sendResponse(result);
            break;
        }
        case 'getCurrentAppNo':
            sendResponse({ appNo: getCurrentAppNo() });
            break;
        case 'getPageType':
            // 轉發給 core.js 的 getPageType (如果已經載入)
            if (typeof getPageType === 'function') {
                sendResponse({ type: getPageType() });
            } else {
                sendResponse({ type: 'unknown' });
            }
            break;
        case 'scrapeInvestmentData': {
            if (!isMainTaxFrame) return false;

            const appNo = getCurrentAppNo();
            if (!appNo) {
                sendResponse({ data: null, subtotals: null });
                break;
            }
            showStatusBanner('正在透過 API 擷取投資資料...', 'info', 0);
            Promise.all([
                fetchAndProcessInvestmentData(appNo),
                fetchFamilyData(appNo)
            ]).then(([result, familyData]) => {
                if (result && result.rawText) {
                    const personCount = result.subtotals ? Object.keys(result.subtotals).length : 0;
                    const totalAmount = result.subtotals ? Object.values(result.subtotals).reduce((sum, val) => sum + val, 0) : 0;

                    if (personCount > 0) {
                        showStatusBanner(`成功擷取! ${personCount} 人，總金額 ${Math.round(totalAmount)} 元`, 'success', 2000);
                    } else {
                        showStatusBanner('已擷取投資資料，但未解析到投資記錄', 'info', 2000);
                    }
                    sendResponse({
                        data: result.rawText,
                        subtotals: result.subtotals || {},
                        idToNameMap: result.idToNameMap || {},
                        familyData: familyData || {},
                        appNo: result.appNo || appNo
                    });
                } else {
                    showStatusBanner('未找到投資資料表格 (金管會投資資料)', 'error', 5000);
                    sendResponse({ data: null, subtotals: null });
                }
            }).catch(error => {
                showStatusBanner('擷取投資資料失敗: ' + error.message, 'error', 5000);
                sendResponse({ data: null, subtotals: null });
            });
            return true;
        }
        case 'scrapeMovableData': {
            if (!isMainTaxFrame) return false;
            const response = scrapeMovableData();
            if (response && response.structuredData.length > 0) {
                showStatusBanner(`成功擷取 ${response.structuredData.length} 筆動產投資項目。`, 'success', 800);
            }
            sendResponse(response);
            break;
        }
        case 'uncheckCheckboxes': {
            if (!isMainTaxFrame) return false;
            showStatusBanner(`比對完成，正在處理 ${request.items.length} 個重複項目...`, 'info', 500);
            const result = processDuplicateItems(request.items);
            showStatusBanner(`操作完成！共標記 ${result.highlightedCount} 個重複項目，其中 ${result.uncheckedCount} 個被點擊取消勾選。`, 'success', 1000);
            sendResponse({ count: result.highlightedCount });
            break;
        }
        case 'loadPreviousYearTaxData': {
            if (!isMainTaxFrame) return false;
            showStatusBanner('正在載入去年財稅數據...', 'info', 0);
            initTaxSummaryPage().then(() => {
                sendResponse({ success: true });
            }).catch((error) => {
                showStatusBanner('載入去年財稅數據失敗', 'error', 3000);
                sendResponse({ success: false, error: '無法載入去年財稅數據' });
            });
            return true;
        }
    }
    // 讓其他 listener 有機會處理 (如果 return undefined)
    // 但在 chrome.runtime.onMessage 如果要 async 必須 return true
    // return true 只有在 async 時需要
});
