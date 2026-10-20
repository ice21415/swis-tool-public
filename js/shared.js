// ============================================
// 共用函式：background.js 與 popup.js 共用
// ============================================

function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    // 使用兩列滾動陣列，減少記憶體使用
    let prev = new Array(a.length + 1);
    let curr = new Array(a.length + 1);
    for (let j = 0; j <= a.length; j++) prev[j] = j;
    for (let i = 1; i <= b.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= a.length; j++) {
            const cost = a[j - 1] === b[i - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[a.length];
}

function processData(inputData) {
    let rawText = inputData;
    if (typeof inputData === 'object' && inputData !== null && inputData.rawText) {
        rawText = inputData.rawText;
    }
    if (!rawText || typeof rawText !== 'string') {
        return [];
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let allResults = [];
    let inInvestmentSection = false;

    for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i];

        if (currentLine.includes('金管會投資資料')) {
            inInvestmentSection = true;
            continue;
        }
        if (!inInvestmentSection) continue;
        if (currentLine.includes('商業司小額投資資料')) break;

        // 多行模式解析
        if (i + 5 < lines.length) {
            const lineIndex = lines[i];
            const lineType = lines[i + 1];
            const lineID = lines[i + 2];
            const lineStock = lines[i + 5];

            if (/^\d+$/.test(lineIndex) && /^[AB]$/.test(lineType)) {
                const idMatch = lineID.match(/[A-Z]\d{9}/);
                if (idMatch) {
                    const stockMatch = lineStock.match(/^(\d+)\s+(.+)$/);
                    if (stockMatch) {
                        const idNumber = idMatch[0];
                        const personName = lineID.substring(idMatch.index + idNumber.length).trim();
                        const securityName = stockMatch[2].trim().replace(/\uf024/g, '碁');
                        allResults.push({ idNumber, personName, securityName });
                        i += 5;
                        continue;
                    }
                }
            }
        }

        // 單行解析（相容舊格式）
        if (/^\d+\s+[AB]/.test(currentLine)) {
            // 合併下一行（如果不是新記錄）
            if (i + 1 < lines.length && !/^\d+\s+[AB]/.test(lines[i + 1])) {
                currentLine += '\t' + lines[i + 1];
                i++;
            }
            const idNumberMatch = currentLine.match(/[A-Z]\d{9}/);
            if (idNumberMatch) {
                const idNumber = idNumberMatch[0];
                const dataString = currentLine.substring(idNumberMatch.index + idNumberMatch[0].length).trim();
                const regexWithSecName = /^(.*?)\s+\d{3}\/\d{2}\/\d{2}\s+[\w\d\s#]+?\s+(?:[A-Z0-9-]+\s+)?([^\d\s].*?)\s+([\d,.]+)/;
                const match = dataString.match(regexWithSecName);
                if (match) {
                    const personName = match[1].trim();
                    const securityName = match[2].trim().replace(/\uf024/g, '碁');
                    allResults.push({ idNumber, personName, securityName });
                }
            }
        }
    }
    return allResults;
}

// 股票名稱別名對照表
const STOCK_ALIAS_MAP = {
    '台新新光金': '新光金融控股',
    '台積電': '台灣積體電路製造',
    '富邦金': '富邦金融控股',
    '兆豐金': '兆豐金融控股',
    '中信金': '中國信託金融控股',
    '玉山金': '玉山金融控股',
    '元大金': '元大金融控股',
    '第一金': '第一金融控股',
    '國泰金': '國泰金融控股',
    '合庫金': '合作金庫金融控股',
    '華南金': '華南金融控股',
    '開發金': '中華開發金融控股',
    '永豐金': '永豐金融控股'
};

const KEYWORDS_TO_REMOVE = /(\d+|股份有限公司|有限公司|控股公司|金融控股|金融|控股|工業|科技)/g;

function crossReference(investmentResults, movableStructuredData) {
    const matchedMovRecords = new Set();

    investmentResults.forEach((invRecord) => {
        movableStructuredData.some((movRecord) => {
            // 1. ID 比對
            const idMatch = invRecord.idNumber && movRecord.idNumber &&
                            invRecord.idNumber === movRecord.idNumber;

            const primaryInvName = (invRecord.personName || '').split(/[-（(]/)[0].trim();
            const primaryMovName = (movRecord.personName || '').split(/[-（(]/)[0].trim();
            const nameMatch = primaryInvName && primaryMovName &&
                              primaryInvName === primaryMovName;

            if (!idMatch && !nameMatch) return false;

            const cleanA = (invRecord.securityName || '').replace(KEYWORDS_TO_REMOVE, '').replace(/\uf024/g, '碁').trim();
            const cleanB = (movRecord.companyName || '').replace(KEYWORDS_TO_REMOVE, '').trim();

            if (cleanA.length < 1 || cleanB.length < 1) return false;

            let matchFound = false;

            // 別名比對（雙向）
            if ((STOCK_ALIAS_MAP[cleanA] && (STOCK_ALIAS_MAP[cleanA] === cleanB || cleanB.includes(STOCK_ALIAS_MAP[cleanA]))) ||
                (STOCK_ALIAS_MAP[cleanB] && (STOCK_ALIAS_MAP[cleanB] === cleanA || cleanA.includes(STOCK_ALIAS_MAP[cleanB])))) {
                matchFound = true;
            }

            // 別名 Key 包含比對
            if (!matchFound) {
                for (const key in STOCK_ALIAS_MAP) {
                    if ((cleanA.includes(key) && cleanB.includes(STOCK_ALIAS_MAP[key])) ||
                        (cleanB.includes(key) && cleanA.includes(STOCK_ALIAS_MAP[key]))) {
                        matchFound = true;
                        break;
                    }
                }
            }

            // 字序比對 + 子字串 + Levenshtein + Jaccard
            if (!matchFound) {
                const [shortStr, longStr] = cleanA.length < cleanB.length
                    ? [cleanA, cleanB] : [cleanB, cleanA];

                let lastIndex = -1;
                const isSequentialMatch = [...shortStr].every(char => {
                    const foundIndex = longStr.indexOf(char, lastIndex + 1);
                    lastIndex = foundIndex;
                    return foundIndex > -1;
                });

                if (isSequentialMatch) {
                    matchFound = true;
                } else if (longStr.includes(shortStr)) {
                    matchFound = true;
                } else {
                    const levenshteinSimilarity = (1 - levenshteinDistance(cleanA, cleanB) / Math.max(cleanA.length, cleanB.length)) * 100;
                    if (levenshteinSimilarity > 40) {
                        matchFound = true;
                    } else {
                        const setA = new Set(cleanA);
                        const setB = new Set(cleanB);
                        const intersection = new Set([...setA].filter(x => setB.has(x)));
                        const jaccardSimilarity = (intersection.size / (setA.size + setB.size - intersection.size)) * 100;
                        if (jaccardSimilarity > 30) {
                            matchFound = true;
                        }
                    }
                }
            }

            if (matchFound) {
                matchedMovRecords.add(movRecord);
                return true;
            }
            return false;
        });
    });

    return { itemsToUncheck: Array.from(matchedMovRecords) };
}

function normalizeScopedAppNo(appNo) {
    return String(appNo || '').trim();
}

function buildScopedStorageKey(baseKey, appNo) {
    const normalizedAppNo = normalizeScopedAppNo(appNo);
    if (!normalizedAppNo) {
        return '';
    }
    return `swis:${baseKey}:${encodeURIComponent(normalizedAppNo)}`;
}

function setScopedStorageValue(baseKey, appNo, value, callback) {
    const storageKey = buildScopedStorageKey(baseKey, appNo);
    if (!storageKey) {
        if (callback) callback();
        return;
    }
    chrome.storage.local.set({ [storageKey]: value }, callback);
}

function removeScopedStorageValue(baseKey, appNo, callback) {
    const storageKey = buildScopedStorageKey(baseKey, appNo);
    if (!storageKey) {
        if (callback) callback();
        return;
    }
    chrome.storage.local.remove([storageKey], callback);
}

function setScopedTaxBundle(appNo, bundle, callback) {
    setScopedStorageValue('tax-state', appNo, bundle, callback);
}

function getScopedTaxBundle(appNo, callback) {
    const normalizedAppNo = normalizeScopedAppNo(appNo);
    if (!normalizedAppNo) {
        callback(null);
        return;
    }

    const storageKey = buildScopedStorageKey('tax-state', normalizedAppNo);
    chrome.storage.local.get([
        storageKey,
        'investmentData',
        'investmentAppNo',
        'personSubtotals',
        'idToNameMap',
        'familyData'
    ], (result) => {
        if (result[storageKey]) {
            callback(result[storageKey]);
            return;
        }

        const legacyAppNo = normalizeScopedAppNo(result.investmentAppNo);
        if (result.investmentData && (!legacyAppNo || legacyAppNo === normalizedAppNo)) {
            callback({
                investmentData: result.investmentData,
                investmentAppNo: result.investmentAppNo || normalizedAppNo,
                personSubtotals: result.personSubtotals || {},
                idToNameMap: result.idToNameMap || {},
                familyData: result.familyData || {}
            });
            return;
        }

        callback(null);
    });
}

function clearScopedTaxBundle(appNo, callback) {
    const storageKey = buildScopedStorageKey('tax-state', appNo);
    const keys = [storageKey, 'investmentData', 'investmentAppNo', 'personSubtotals', 'idToNameMap', 'familyData']
        .filter(Boolean);
    chrome.storage.local.remove(keys, callback);
}

function setScopedImmovableCounts(appNo, counts, callback) {
    const normalizedAppNo = normalizeScopedAppNo(appNo);
    const payload = {
        appNo: normalizedAppNo,
        counts: counts || { landTaxCount: 0, houseCount: 0, landCount: 0 },
        timestamp: Date.now()
    };
    setScopedStorageValue('immovable-counts', normalizedAppNo, payload, callback);
}

function getScopedImmovableCounts(appNo, callback) {
    const normalizedAppNo = normalizeScopedAppNo(appNo);
    if (!normalizedAppNo) {
        callback(null);
        return;
    }

    const storageKey = buildScopedStorageKey('immovable-counts', normalizedAppNo);
    chrome.storage.local.get([storageKey, 'immovableCounts'], (result) => {
        if (result[storageKey]) {
            callback(result[storageKey]);
            return;
        }

        if (result.immovableCounts && normalizeScopedAppNo(result.immovableCounts.appNo) === normalizedAppNo) {
            callback(result.immovableCounts);
            return;
        }

        callback(null);
    });
}

function clearScopedImmovableCounts(appNo, callback) {
    const storageKey = buildScopedStorageKey('immovable-counts', appNo);
    const keys = [storageKey, 'immovableCounts'].filter(Boolean);
    chrome.storage.local.remove(keys, callback);
}
