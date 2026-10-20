// 載入共用函式 (levenshteinDistance, processData, crossReference)
importScripts('./js/shared.js');
async function ensureContentScript(tabId) {
    try {

        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {

        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['js/shared.js', 'content.js']
        });

        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
function sendMessageToContentScript(tabId, message, callback) {
    // 只發送給主框架，避免多個 frame 同時回應
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
        if (chrome.runtime.lastError) {
            // 主框架無法回應時，嘗試發送給所有 frame
            chrome.tabs.sendMessage(tabId, message, (fallbackResponse) => {
                if (chrome.runtime.lastError) {
                    if (callback) callback(null);
                    return;
                }
                if (callback) callback(fallbackResponse);
            });
            return;
        }
        if (callback) callback(response);
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    // 建立右鍵選單
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "main-menu", title: "財稅資料整理工具", contexts: ["page"], documentUrlPatterns: ["https://swis.mohw.gov.tw/*"] });
        chrome.contextMenus.create({ id: "clear-storage", parentId: "main-menu", title: "清除暫存資料", contexts: ["page"] });
        chrome.contextMenus.create({ id: "separator2", parentId: "main-menu", type: "separator", contexts: ["page"] });
        chrome.contextMenus.create({ id: "reload-extension", parentId: "main-menu", title: "重新載入擴充功能", contexts: ["page"] });
    });

    // 如果是更新，記錄更新資訊
    if (details.reason === 'update') {
        const previousVersion = details.previousVersion;
        const currentVersion = chrome.runtime.getManifest().version;
        chrome.storage.local.set({
            extensionUpdated: true,
            updateInfo: {
                previousVersion,
                currentVersion,
                updateTime: Date.now()
            }
        });
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
        case "clear-storage": handleClearStorage(tab.id); break;
        case "reload-extension": chrome.runtime.reload(); break;
    }
});
async function handleCaptureInvestment(tabId) {
    await ensureContentScript(tabId);
    sendMessageToContentScript(tabId, { action: 'scrapeInvestmentData' }, (response) => {
        if (response && response.data) {
            const bundle = {
                investmentData: response.data,
                investmentAppNo: response.appNo || '',
                personSubtotals: response.subtotals || {},
                idToNameMap: response.idToNameMap || {},
                familyData: response.familyData || {},
                timestamp: Date.now()
            };
            setScopedTaxBundle(response.appNo || '', bundle, () => {
                // 顯示成功提示
                const personCount = response.subtotals ? Object.keys(response.subtotals).length : 0;
                const totalAmount = response.subtotals ? Object.values(response.subtotals).reduce((sum, val) => sum + val, 0) : 0;
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: (count, amount) => alert(`投資資料擷取成功！\n\n共 ${count} 人，總金額 ${Math.round(amount)} 元\n\n可直接在動產頁面執行「比對並取消勾選」`),
                    args: [personCount, totalAmount]
                });
            });
        } else {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => alert('擷取投資資料失敗。請確認您在財稅資料頁面上。')
            });
        }
    });
}
async function handleCompareAndUncheck(tabId) {
    await ensureContentScript(tabId);

    sendMessageToContentScript(tabId, { action: 'scrapeInvestmentData' }, (investmentResponse) => {
        if (investmentResponse && investmentResponse.data) {
            setScopedTaxBundle(investmentResponse.appNo || '', {
                investmentData: investmentResponse.data,
                investmentAppNo: investmentResponse.appNo,
                personSubtotals: investmentResponse.subtotals || {},
                idToNameMap: investmentResponse.idToNameMap || {},
                familyData: investmentResponse.familyData || {},
                timestamp: Date.now()
            });
            proceedWithComparison(tabId, investmentResponse.data);
            return;
        }

        sendMessageToContentScript(tabId, { action: 'getCurrentAppNo' }, (state) => {
            const currentAppNo = state && state.appNo ? String(state.appNo).trim() : '';
            if (!currentAppNo) {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => alert('?????????????????????')
                });
                return;
            }

            getScopedTaxBundle(currentAppNo, (bundle) => {
                if (bundle && bundle.investmentData) {
                    proceedWithComparison(tabId, bundle.investmentData);
                } else {
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: () => alert('???????????????????')
                    });
                }
            });
        });
    });
}

function proceedWithComparison(tabId, investmentData) {
    const investmentResults = processData(investmentData);

    sendMessageToContentScript(tabId, { action: 'scrapeMovableData' }, (movableResponse) => {
        if (!movableResponse || !movableResponse.structuredData) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => alert('????????????????????')
            });
            return;
        }

        const { itemsToUncheck } = crossReference(investmentResults, movableResponse.structuredData);

        sendMessageToContentScript(tabId, { action: 'uncheckCheckboxes', items: itemsToUncheck }, () => {
            // ??????????????????????
        });
    });
}

function handleClearStorage(tabId) {
    sendMessageToContentScript(tabId, { action: 'getCurrentAppNo' }, (state) => {
        const currentAppNo = state && state.appNo ? String(state.appNo).trim() : '';
        if (currentAppNo) {
            clearScopedTaxBundle(currentAppNo, () => {
                clearScopedImmovableCounts(currentAppNo, () => {
                    chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => alert('?????????????') });
                });
            });
            return;
        }

        chrome.storage.local.remove(['investmentData', 'investmentAppNo', 'personSubtotals', 'idToNameMap', 'familyData', 'immovableCounts'], () => {
            chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => alert('????????') });
        });
    });
}

async function handleViewSubtotals(tabId) {
    await ensureContentScript(tabId);

    sendMessageToContentScript(tabId, { action: 'scrapeInvestmentData' }, (investmentResponse) => {
        const persistAndShow = (appNo, subtotals, idToNameMap, familyData) => {
            setScopedTaxBundle(appNo || '', {
                investmentData: investmentResponse.data,
                investmentAppNo: appNo || investmentResponse.appNo || '',
                personSubtotals: subtotals,
                idToNameMap: idToNameMap,
                familyData: familyData,
                timestamp: Date.now()
            });
            displaySubtotalsDialog(tabId, subtotals, idToNameMap, familyData);
        };

        if (investmentResponse && investmentResponse.subtotals && Object.keys(investmentResponse.subtotals).length > 0) {
            persistAndShow(
                investmentResponse.appNo || '',
                investmentResponse.subtotals,
                investmentResponse.idToNameMap || {},
                investmentResponse.familyData || {}
            );
            return;
        }

        sendMessageToContentScript(tabId, { action: 'getCurrentAppNo' }, (state) => {
            const currentAppNo = state && state.appNo ? String(state.appNo).trim() : '';
            if (!currentAppNo) {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => alert('?????????????????????')
                });
                return;
            }

            getScopedTaxBundle(currentAppNo, (bundle) => {
                if (!bundle || !bundle.personSubtotals || Object.keys(bundle.personSubtotals).length === 0) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        func: () => alert('?????????????')
                    });
                    return;
                }

                displaySubtotalsDialog(tabId, bundle.personSubtotals, bundle.idToNameMap || {}, bundle.familyData || {});
            });
        });
    });
}

function displaySubtotalsDialog(tabId, subtotals, idToNameMap, familyData = {}) {
    const escapeText = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const familyOrder = Object.keys(familyData);
    const personIds = Object.keys(subtotals).sort((a, b) => {
        const ia = familyOrder.indexOf(a.trim());
        const ib = familyOrder.indexOf(b.trim());
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
    let grandTotal = 0;

    const statusConfig = {
        listed:      { label: '列冊', color: '#1a3a5c' },
        counted:     { label: '應計', color: '#1e5c2e' },
        not_counted: { label: '不計', color: '#7a3b00' }
    };

    let htmlContent = '<table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:14px;">';
    personIds.forEach(idNumber => {
        const amount = subtotals[idNumber];
        grandTotal += amount;

        const cleanId = idNumber.trim();
        const escapedId = escapeText(cleanId);
        let foundName = idToNameMap[idNumber] || idToNameMap[cleanId];
        if (!foundName) {
            const matchingKey = Object.keys(idToNameMap).find(k => k.includes(cleanId) || cleanId.includes(k));
            if (matchingKey) {
                foundName = idToNameMap[matchingKey];
            }
        }
        const displayName = foundName || idNumber;
        const amountText = String(Math.round(amount));
        const escapedName = String(displayName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const person = familyData[cleanId];
        const cfg = person ? (statusConfig[person.status] || statusConfig['counted']) : null;
        const statusColor = cfg ? cfg.color : '#888';
        const subText = person
            ? [person.relation, cfg?.label].filter(Boolean).map(escapeText).join('・')
            : '';
        const canFillInvestment = Math.round(amount) !== 0 && person && (person.status === 'listed' || person.status === 'counted');
        const fillButtonHtml = canFillInvestment
            ? `<button type="button" class="fill-investment-btn" data-id="${escapedId}" data-name="${escapedName}" data-amount="${amountText}" style="padding:4px 8px;border:1px solid #0d6efd;border-radius:4px;background:#0d6efd;color:#fff;cursor:pointer;font-size:13px;">帶入</button>`
            : '';

        htmlContent += `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:5px 12px 5px 0;white-space:nowrap;font-size:14px;">${escapedName}</td>
                <td style="padding:5px 0;text-align:right;white-space:nowrap;font-size:14px;"><strong>${Math.round(amount)}</strong> 元</td>
                <td style="padding:5px 0 5px 12px;white-space:nowrap;font-size:14px;">${subText ? `<span style="color:${statusColor};">${subText}</span>` : ''}</td>
                <td style="padding:5px 0 5px 12px;white-space:nowrap;font-size:14px;">${fillButtonHtml}</td>
            </tr>`;
    });
    htmlContent += '</table>';
    htmlContent += `<div style="padding-top:8px;border-top:1px solid #ccc;display:flex;justify-content:space-between;align-items:baseline;">`;
    htmlContent += `<span style="color:#666;">共 ${personIds.length} 人</span>`;
    htmlContent += `<span style="font-weight:bold;font-size:1.05em;">${Math.round(grandTotal)} 元</span></div>`;
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (htmlContent) => {

            const existing = document.getElementById('investment-subtotals-dialog');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'investment-subtotals-dialog';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 999999; display: flex; align-items: center; justify-content: center;';
            overlay.style.setProperty('background', 'rgba(0,0,0,0.5)', 'important');
            const dialog = document.createElement('div');
            dialog.style.cssText = 'background: white; padding: 25px; border-radius: 8px; width: max-content; min-width: 280px; max-width: 90vw; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); user-select: text; -webkit-user-select: text; font-size: 16px !important; line-height: 1.6; font-family: "NotoSansTC-Regular", "Microsoft JhengHei", "Segoe UI", sans-serif;';
            dialog.style.setProperty('background', 'white', 'important');
            const title = document.createElement('h2');
            title.textContent = '投資個人小計';
            title.style.cssText = 'margin: 0 0 15px 0; color: #0056b3; text-align: center; user-select: text; font-size: 1.3em; border-bottom: 2px solid #0056b3; padding-bottom: 10px;';
            const content = document.createElement('div');
            content.innerHTML = htmlContent;
            content.style.cssText = 'user-select: text; -webkit-user-select: text; cursor: text; font-family: "NotoSansTC-Regular", "Microsoft JhengHei", "Segoe UI", sans-serif; line-height: 1.6;';
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '關閉';
            closeBtn.style.cssText = 'margin-top: 20px; width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;';
            closeBtn.style.setProperty('background', '#007bff', 'important');
            closeBtn.onmouseover = () => closeBtn.style.setProperty('background', '#0056b3', 'important');
            closeBtn.onmouseout = () => closeBtn.style.setProperty('background', '#007bff', 'important');
            closeBtn.onclick = () => overlay.remove();
            content.addEventListener('click', (event) => {
                const btn = event.target.closest('.fill-investment-btn');
                if (!btn) return;

                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = '帶入中...';

                chrome.runtime.sendMessage({
                    action: 'fillInvestmentToTaxPopup',
                    idNumber: btn.dataset.id || '',
                    name: btn.dataset.name || '',
                    amount: btn.dataset.amount || ''
                }, (response) => {
                    if (chrome.runtime.lastError || !response || !response.success) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                        alert((response && response.error) || chrome.runtime.lastError?.message || '找不到財稅明細維護彈出視窗');
                        return;
                    }

                    btn.textContent = '已帶入';
                    overlay.remove();
                });
            });
            dialog.appendChild(title);
            dialog.appendChild(content);
            dialog.appendChild(closeBtn);
            overlay.appendChild(dialog);

            overlay.onclick = (e) => {
                if (e.target === overlay) overlay.remove();
            };
            document.body.appendChild(overlay);
        },
        args: [htmlContent]
    });
}

// 處理下載檔案請求 (從 content script 發送)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    let trustedSource = false;
    try {
        const source = new URL(sender.url || sender.tab?.url || '');
        trustedSource = source.origin === 'https://swis.mohw.gov.tw' ||
            (source.protocol === 'chrome-extension:' && source.hostname === chrome.runtime.id);
    } catch { /* Invalid sender URLs are rejected. */ }
    if (!trustedSource) return;
    if (!request || typeof request !== 'object') return;
    if (request.action === 'downloadFile') {
        const { base64Data, fileName } = request;
        if (typeof base64Data !== 'string' || !/^data:[^,]*;base64,[A-Za-z0-9+/=\r\n]+$/.test(base64Data) ||
            typeof fileName !== 'string' || /(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)/.test(fileName)) {
            sendResponse({ success: false, error: 'Invalid download data or file name' });
            return;
        }

        // 使用 Chrome downloads API 下載檔案
        chrome.downloads.download({
            url: base64Data, // 直接使用 data URL
            filename: fileName,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });

        return true; // 保持消息通道開啟以等待異步響應
    }

    // Legacy student integration is disabled; never expose cookies or proxy arbitrary requests.
    if (request.action === 'fetchApi' || request.action === 'getCookies') {
        sendResponse({ success: false, error: 'Legacy API access is disabled' });
        return;
    }

    // ping 測試
    if (request.action === 'ping') {
        sendResponse({ success: true, message: 'pong' });
        return;
    }

    if (request.action === 'runInvestmentCompareFromPage') {
        const tabId = sender.tab && sender.tab.id;
        if (!tabId) {
            sendResponse({ success: false, error: '找不到目前分頁' });
            return;
        }
        handleCompareAndUncheck(tabId);
        sendResponse({ success: true });
        return;
    }

    if (request.action === 'viewInvestmentSubtotalsFromPage') {
        const tabId = sender.tab && sender.tab.id;
        if (!tabId) {
            sendResponse({ success: false, error: '找不到目前分頁' });
            return;
        }
        handleViewSubtotals(tabId);
        sendResponse({ success: true });
        return;
    }

    // 側邊欄設定面板中繼廣播
    if (request.action === 'fillInvestmentToTaxPopup') {
        chrome.tabs.query({ url: 'https://swis.mohw.gov.tw/socs/jsp/sz/sz3/sz310*' }, (tabs) => {
            const popupTab = tabs && tabs.find(t =>
				t.url && (t.url.includes('sz31010_upd.jsp') || t.url.includes('sz31010_action.jsp'))
			);
            if (!popupTab) {
                sendResponse({ success: false, error: '找不到已開啟的財稅明細維護彈出視窗' });
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId: popupTab.id, frameIds: [0] },
                func: (payload) => {
                    const dispatchFormEvents = (el) => {
                        if (!el) return;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    };
                    const normalizeAmountValue = (value) => {
                        const normalized = String(value || '').replace(/[^\d.-]/g, '');
                        const num = Number(normalized);
                        return Number.isFinite(num) ? String(Math.round(num)) : '';
                    };
                    const validPaths = ['sz31010_upd.jsp', 'sz31010_action.jsp'];
					if (!validPaths.some(p => location.pathname.includes(p))) {
						return { success: false, error: '目前視窗不是財稅明細維護作業' };
					}
                    const select = document.querySelector('select[name="sel_cname"]');
                    if (!select) return { success: false, error: '找不到姓名下拉欄位' };
                    const cleanId = String(payload.idNumber || '').trim().toUpperCase();
                    const cleanName = String(payload.name || '').trim();
                    const option = Array.from(select.options).find((opt) => cleanId && String(opt.value || '').toUpperCase().includes(cleanId))
                        || Array.from(select.options).find((opt) => cleanName && opt.text.trim().includes(cleanName));
                    if (!option) {
                        return { success: false, error: `找不到對應姓名：${cleanName || cleanId}` };
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

                    const taxType = document.querySelector('select[name="tax_type"]');
                    const amount = document.querySelector('input[name="tax_mny"]');
                    const memo = document.querySelector('textarea[name="memo"]');
                    const unitName = document.querySelector('input[name="unit_name"]');
                    const amountValue = normalizeAmountValue(payload.amount);
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
                    return { success: true, selectedName: option.text.trim(), amount: amountValue };
                },
                args: [{
                    idNumber: request.idNumber || '',
                    name: request.name || '',
                    amount: request.amount || ''
                }]
            }, (results) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                const response = results && results[0] && results[0].result;
                if (response && response.success) {
                    chrome.windows.update(popupTab.windowId, { focused: true }, () => {});
                    chrome.tabs.update(popupTab.id, { active: true }, () => {});
                }
                sendResponse(response || { success: false, error: '彈出視窗未回應' });
            });
        });
        return true;
    }

});

