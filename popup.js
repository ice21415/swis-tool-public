document.addEventListener('DOMContentLoaded', () => {
    const actionBtn = document.getElementById('action-btn');
    const statusText = document.getElementById('status-text');
    const hintText = document.getElementById('hint-text');
    const mainUI = document.getElementById('main-ui');
    const resultsUI = document.getElementById('results-ui');
    const errorUI = document.getElementById('error-ui');
    const errorMessage = document.getElementById('error-message');
    const clearStorageBtn = document.getElementById('clear-storage-btn');
    const viewDetailsBtn = document.getElementById('view-details-btn');
    const viewSubtotalsBtn = document.getElementById('view-subtotals-btn');

    function showError(message) {
        mainUI.style.display = 'none';
        resultsUI.style.display = 'none';
        errorMessage.textContent = message;
        errorUI.style.display = 'block';
    }

    function sendMessageToContentScript(message, callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                showError('找不到目前分頁。');
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
                if (chrome.runtime.lastError) {
                    showError('無法連線到 SWIS 頁面，請確認目前分頁是 SWIS 並重新整理。');
                    return;
                }
                if (callback) callback(response);
            });
        });
    }

    function getCurrentAppNo(callback) {
        sendMessageToContentScript({ action: 'getCurrentAppNo' }, (response) => {
            callback(response && response.appNo ? String(response.appNo).trim() : '');
        });
    }

    function showStoredDetailsButton() {
        getCurrentAppNo((appNo) => {
            if (!appNo) return;

            getScopedTaxBundle(appNo, (bundle) => {
                if (!bundle || !bundle.personSubtotals || Object.keys(bundle.personSubtotals).length === 0) {
                    return;
                }

                viewDetailsBtn.style.display = 'block';
                viewDetailsBtn.onclick = () => {
                    window.location.href = `details.html?appNo=${encodeURIComponent(appNo)}`;
                };
            });
        });
    }

    function setupGenericTaxPageUI() {
        statusText.textContent = '目前是財稅資料頁';
        hintText.textContent = '請切到動產頁執行比對，或查看已擷取的投資小計。';
        actionBtn.textContent = '請在動產頁執行';
        actionBtn.disabled = true;
        showStoredDetailsButton();
    }

    function setupMovableAssetsPageUI() {
        statusText.textContent = '目前是動產頁';
        hintText.textContent = '自動擷取投資資料後，和動產投資項目比對並標示重複項目。';
        actionBtn.textContent = '比對並取消勾選';
        actionBtn.disabled = false;
        actionBtn.onclick = handleCompareAndUncheck;
        showStoredDetailsButton();
    }

    function setupTaxSummaryPageUI() {
        statusText.textContent = '目前是財稅總計頁';
        hintText.textContent = '載入前一年財稅資料並顯示差異。';
        actionBtn.textContent = '載入去年財稅資料';
        actionBtn.disabled = false;
        actionBtn.onclick = handleLoadPreviousYearData;
    }

    function handleLoadPreviousYearData() {
        actionBtn.textContent = '載入中...';
        actionBtn.disabled = true;
        sendMessageToContentScript({ action: 'loadPreviousYearTaxData' }, (response) => {
            if (response && response.success) {
                mainUI.style.display = 'none';
                resultsUI.style.display = 'block';
                document.querySelector('#results-ui h2').textContent = '載入完成';
                document.querySelector('#results-ui p').textContent = '已載入並比對去年財稅資料。';
                clearStorageBtn.textContent = '關閉';
                clearStorageBtn.onclick = () => window.close();
            } else {
                showError(response && response.error ? response.error : '載入去年財稅資料失敗。');
            }
        });
    }

    function handleCompareAndUncheck() {
        actionBtn.textContent = '擷取投資資料中...';
        actionBtn.disabled = true;

        sendMessageToContentScript({ action: 'scrapeInvestmentData' }, (investmentResponse) => {
            if (!investmentResponse || !investmentResponse.data) {
                showError('擷取投資資料失敗，請確認目前案件有財稅資料。');
                return;
            }

            const bundle = {
                investmentData: investmentResponse.data,
                investmentAppNo: investmentResponse.appNo || '',
                personSubtotals: investmentResponse.subtotals || {},
                idToNameMap: investmentResponse.idToNameMap || {},
                familyData: investmentResponse.familyData || {},
                timestamp: Date.now()
            };
            setScopedTaxBundle(investmentResponse.appNo || '', bundle);

            actionBtn.textContent = '擷取動產資料中...';
            const investmentResults = processData(investmentResponse.data);

            sendMessageToContentScript({ action: 'scrapeMovableData' }, (movableResponse) => {
                if (!movableResponse || !movableResponse.structuredData) {
                    showError('擷取動產資料失敗，請確認目前在動產頁。');
                    return;
                }

                const { itemsToUncheck } = crossReference(investmentResults, movableResponse.structuredData);
                const displayResults = (count) => {
                    mainUI.style.display = 'none';
                    resultsUI.style.display = 'block';
                    let subtotalInfo = '';
                    if (investmentResponse.subtotals && Object.keys(investmentResponse.subtotals).length > 0) {
                        const totalAmount = Object.values(investmentResponse.subtotals).reduce((sum, val) => sum + val, 0);
                        const personCount = Object.keys(investmentResponse.subtotals).length;
                        subtotalInfo = `<br><small style="color:#0056b3;">投資小計：${personCount} 人，合計 ${Math.round(totalAmount)} 元</small>`;

                        viewSubtotalsBtn.style.display = 'block';
                        viewSubtotalsBtn.onclick = () => {
                            window.location.href = `details.html?appNo=${encodeURIComponent(investmentResponse.appNo || '')}`;
                        };
                    }

                    document.querySelector('#results-ui h2').textContent = '比對完成';
                    document.querySelector('#results-ui p').innerHTML = `共處理 <span id="match-count">${count}</span> 筆重複項目${subtotalInfo}`;
                    clearStorageBtn.textContent = '關閉';
                    clearStorageBtn.onclick = () => window.close();
                };

                if (itemsToUncheck.length > 0) {
                    sendMessageToContentScript({ action: 'uncheckCheckboxes', items: itemsToUncheck }, (uncheckResponse) => {
                        if (uncheckResponse) {
                            displayResults(uncheckResponse.count);
                        } else {
                            showError('取消勾選或標示重複項目失敗。');
                        }
                    });
                } else {
                    displayResults(0);
                }
            });
        });
    }

    clearStorageBtn.onclick = () => {
        getCurrentAppNo((appNo) => {
            if (appNo) {
                clearScopedTaxBundle(appNo, () => {
                    window.close();
                });
                return;
            }

            chrome.storage.local.remove(['investmentData', 'investmentAppNo', 'personSubtotals', 'idToNameMap', 'familyData'], () => {
                window.close();
            });
        });
    };

    sendMessageToContentScript({ action: 'getPageType' }, (response) => {
        if (response && response.type === 'movable_assets_page') {
            setupMovableAssetsPageUI();
        } else if (response && response.type === 'tax_summary_page') {
            setupTaxSummaryPageUI();
        } else if (response && (response.type === 'investment_page' || response.type === 'income_page' || response.type === 'immovable_assets_page')) {
            setupGenericTaxPageUI();
        } else {
            showError('目前頁面不是支援的 SWIS 財稅頁面。');
        }
    });
});
