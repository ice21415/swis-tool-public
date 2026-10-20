// ============================================
// 核心工具函數模組
// ============================================

// ============================================
// 安全性輔助函數
// ============================================

// HTML 轉義函數 - 防止 XSS 攻擊
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function validateIdNo(idNo) {
    if (!idNo || typeof idNo !== 'string') return false;
    return /^[A-Z][A-Z0-9]\d{8}$/.test(idNo.toUpperCase());
}

// 驗證案號格式
function validateAppNo(appNo) {
    if (!appNo || typeof appNo !== 'string') return false;
    // 案號格式檢查: 允許數字、字母、橫線，長度合理
    return /^[A-Za-z0-9\-]{5,30}$/.test(appNo.trim());
}

// 安全地設置 innerHTML (用於已知的安全 HTML 樣板)
function safeSetInnerHTML(element, html) {
    if (!element) return;
    // 此函數用於標記已審查為安全的 HTML 設置
    // 使用前請確保 html 不包含使用者輸入的未驗證資料
    element.innerHTML = html;
}

function getSwisMemoActionRow(memoTextarea) {
    const shell = memoTextarea.closest('.swis-memo-editor-shell');
    if (shell) {
        let row = shell.nextElementSibling;
        if (!row || !row.classList.contains('swis-memo-action-row')) {
            row = document.createElement('div');
            row.className = 'swis-memo-action-row';
            shell.parentNode.insertBefore(row, shell.nextSibling);
        }
        return row;
    }

    let row = memoTextarea.nextElementSibling;
    if (!row || !row.classList.contains('swis-memo-action-row')) {
        row = document.createElement('div');
        row.className = 'swis-memo-action-row';
        memoTextarea.parentNode.insertBefore(row, memoTextarea.nextSibling);
    }
    return row;
}

// 檢查是否有更新通知
function checkForUpdateNotification() {
    chrome.storage.local.get(['extensionUpdated', 'updateInfo'], (result) => {
        if (result.extensionUpdated && result.updateInfo) {
            const { currentVersion } = result.updateInfo;
            showStatusBanner(`已更新至 v${currentVersion}`, 'success', 1500);
            chrome.storage.local.remove(['extensionUpdated', 'updateInfo']);
        }
    });
}

// 頁面載入時檢查更新通知 (一次性)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForUpdateNotification, { once: true });
} else {
    checkForUpdateNotification();
}

// 顯示狀態橫幅
function showStatusBanner(message, type = 'info', timeout = 3000) {
    const existingBanner = document.getElementById('gemini-status-banner');
    if (existingBanner) {
        existingBanner.remove();
    }
    const banner = document.createElement('div');
    banner.id = 'gemini-status-banner';
    banner.textContent = message;

    let styles = {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        padding: '12px 20px',
        textAlign: 'center',
        fontSize: '16px',
        fontWeight: 'bold',
        zIndex: '99999',
        borderBottom: '1px solid',
        color: '#fff',
    };

    switch (type) {
        case 'success':
            styles.backgroundColor = '#28a745';
            styles.borderColor = '#218838';
            break;
        case 'error':
            styles.backgroundColor = '#dc3545';
            styles.borderColor = '#c82333';
            break;
        case 'warning':
            styles.backgroundColor = '#ffc107';
            styles.borderColor = '#e0a800';
            styles.color = '#333';
            break;
        case 'info':
        default:
            styles.backgroundColor = '#007bff';
            styles.borderColor = '#0069d9';
            break;
    }
    Object.assign(banner.style, styles);
    document.body.prepend(banner);

    if (type !== 'error' && timeout > 0) {
        setTimeout(() => {
            banner.style.transition = 'opacity 0.5s ease';
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 500);
        }, timeout);
    }
}

// 偵測頁面類型
let cachedPageType = null;

function getPageType() {
    if (cachedPageType) {
        return cachedPageType;
    }

    const dataTypeInput = document.querySelector('input[name="q_data_type"]');
    if (dataTypeInput) {
        const val = dataTypeInput.value;
        if (val === '12') return (cachedPageType = 'investment_page');
        if (val === '2') return (cachedPageType = 'movable_assets_page');
        if (val === '3') return (cachedPageType = 'immovable_assets_page');
        if (val === '4') return (cachedPageType = 'tax_summary_page');
        if (val === '1') return (cachedPageType = 'income_page');
    }

    const bodyText = document.body ? (document.body.textContent || '') : '';

    if (bodyText.includes('金管會投資資料')) {
        return (cachedPageType = 'investment_page');
    }

    if (bodyText.includes('不動產項目')) {
        return (cachedPageType = 'immovable_assets_page');
    }

    if (bodyText.includes('動產項目')) {
        return (cachedPageType = 'movable_assets_page');
    }

    const hasTaxSummaryHeader = Array.from(document.querySelectorAll('.tagselected')).some(td => (td.textContent || '').includes('財稅總計'));
    if (hasTaxSummaryHeader) {
        const hasTaxFields = document.querySelector('input[name="cnt1"]') !== null;
        const hasSummaryLabels = bodyText.includes('所得合計') ||
            bodyText.includes('動產合計') ||
            bodyText.includes('不動產合計');
        if (hasTaxFields && hasSummaryLabels) {
            return (cachedPageType = 'tax_summary_page');
        }
    }
    return (cachedPageType = 'unknown');
}

// 生成唯一 ID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 獲取當前案件資訊
function getCaseInfo() {
    let appNo = '';
    let headIdNo = '';
    let headName = '';

    // 嘗試從頁面取得案號
    const appNoInput = document.querySelector('input[name="app_no"]');
    if (appNoInput) {
        appNo = appNoInput.value;
    }

    const headIdNoInput = document.querySelector('input[name="h_idno"]') ||
        document.querySelector('input[name="head_id_no"]');
    if (headIdNoInput) headIdNo = headIdNoInput.value;

    const headNameInput = document.querySelector('input[name="h_name"]') ||
        document.querySelector('input[name="head_name"]');
    if (headNameInput) headName = headNameInput.value;

    // Fallback: 如果 input 抓不到，嘗試從頁面上的表格抓取「戶長」
    if (!headIdNo || !headName) {
        // 搜尋所有表格列，不限 class (因為有時是 title4, 有時是 listMouOut)
        const allRows = document.querySelectorAll('tr');
        for (const row of allRows) {
            // 檢查這行是否包含「戶長」
            if (row.innerText.includes('戶長')) {
                const cells = row.querySelectorAll('td');
                let foundHeadLabel = false;

                for (let i = 0; i < cells.length; i++) {
                    const text = cells[i].innerText.trim();
                    if (text === '戶長') {
                        foundHeadLabel = true;

                        // 往後找 ID column
                        for (let j = i + 1; j < cells.length; j++) {
                            const cellText = cells[j].innerText.trim();
                            const idMatch = cellText.match(/^[A-Z]\d{9}/);
                            if (idMatch) {
                                if (!headIdNo) headIdNo = idMatch[0];

                                if (!headName && j + 1 < cells.length) {
                                    const nextText = cells[j + 1].innerText.trim();
                                    // 簡單驗證：非空且不含/數字 (且不是日期)
                                    if (nextText && !/[\d\/]/.test(nextText)) {
                                        headName = nextText;
                                    }
                                }
                                break; // 找到 ID 就結束內層迴圈
                            }
                        }
                        break; // 找到戶長標籤就結束這行的處理
                    }
                }
                if (headIdNo) break; // 找到資料就結束 row 迴圈
            }
        }
    }

    // Fallback: 從 URL 取得 (案號)
    if (!appNo) {
        const urlParams = new URLSearchParams(window.location.search);
        appNo = urlParams.get('app_no') || '';
    }

    return { appNo, headIdNo, headName };
}

// 檢查是否為申請資料維護頁面
function isApplicationMaintenancePage() {
    const url = window.location.href.toLowerCase();
    if (url.includes('sa12010_action') || url.includes('sa12010_qry')) {
        return true;
    }
    const pageTitle = document.title || '';
    if (pageTitle.includes('申請資料維護')) {
        return true;
    }
    return false;
}

function isSa12010ApplicationMaintenancePage() {
    const url = window.location.href.toLowerCase();
    const progId = document.querySelector('input[name="prog_id"]')?.value?.toUpperCase() || '';
    const pageText = `${document.title || ''}\n${document.body?.innerText || ''}`;
    const isSa12010 = progId === 'SA12010' || url.includes('sa12010_') || url.includes('prog_id=sa12010');
    if (isSa12010 && url.includes('sa12010_fam_action.jsp') && document.querySelector('textarea[name="memo"]')) {
        return true;
    }

    return isSa12010 && pageText.includes('申請資料維護作業');
}

window.isSa12010ApplicationMaintenancePage = isSa12010ApplicationMaintenancePage;

function getApplicantIdNo() {

    // 方法1: 從家戶成員表格中找「申請人」（有「Ｖ」或「V」標記的行）
    // 使用更精確的選擇器，只抓取家戶成員表格，排除財稅資料表格
    const familyTable = document.querySelector('table#list_t');
    if (familyTable) {
        const rows = familyTable.querySelectorAll('tr.title4');

        // 優先找稱謂是「戶長」且有 V 標記的行
        for (const row of rows) {
            const rowText = row.innerText;
            if (rowText.includes('戶長') && (rowText.includes('Ｖ') || rowText.includes('V'))) {
                const cells = row.querySelectorAll('td');
                for (const cell of cells) {
                    const onclickAttr = cell.getAttribute('onclick');
                    if (onclickAttr) {
                        const match = onclickAttr.match(/famGet\('([A-Z]\d{9})'\)/);
                        if (match) return match[1];
                    }
                }
                for (const cell of cells) {
                    const match = cell.innerText.match(/[A-Z]\d{9}/);
                    if (match) return match[0];
                }
            }
        }

        // 找任何有 V 標記的行
        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            let hasVMark = false;
            for (const cell of cells) {
                const text = cell.innerText.trim();
                if (text === 'Ｖ' || text === 'V' || text === '本人' || text.includes('申請人')) {
                    hasVMark = true;
                    break;
                }
            }
            if (hasVMark) {
                for (const cell of cells) {
                    const onclickAttr = cell.getAttribute('onclick');
                    if (onclickAttr) {
                        const match = onclickAttr.match(/famGet\('([A-Z]\d{9})'\)/);
                        if (match) return match[1];
                    }
                }
                for (const cell of cells) {
                    const match = cell.innerText.match(/[A-Z]\d{9}/);
                    if (match) return match[0];
                }
            }
        }
    }

    // 方法2: 從戶長資訊中提取（備用）
    const pageText = document.body.innerText;
    const headMatch = pageText.match(/【戶長：([A-Z]\d{9})/);
    if (headMatch) return headMatch[1];

    // 方法3: 從 input 欄位中找
    const idNoInput = document.querySelector('input[name="id_no"]');
    if (idNoInput && idNoInput.value && /^[A-Z]\d{9}$/.test(idNoInput.value)) return idNoInput.value;

    const qidNoInput = document.querySelector('input[name="qid_no"]');
    if (qidNoInput && qidNoInput.value) return qidNoInput.value;

    // 方法4: 從第一個人口表格行提取
    const firstDataRow = document.querySelector('table#list_t tr.title4');
    if (firstDataRow) {
        const match = firstDataRow.innerText.match(/[A-Z]\d{9}/);
        if (match) return match[0];
    }
    return null;
}

// 獲取當前案號
function getCurrentAppNo() {
    const appNoInput = document.querySelector('input[name="app_no"]');
    if (appNoInput && appNoInput.value) {
        return appNoInput.value;
    }
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('app_no') || '';
}

// 獲取前一年案號
function getPreviousYearAppNo() {
    const prevAppNoInput = document.querySelector('input[name="prev_app_no"]');
    if (prevAppNoInput && prevAppNoInput.value) {
        return prevAppNoInput.value;
    }
    return '';
}

// 複製文字到剪貼簿 (支援 fallback)
function copyToClipboard(text) {
    if (!text) return Promise.reject(new Error('No text to copy'));

    // 優先使用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }

    // Fallback: 使用 textarea + execCommand
    return new Promise((resolve, reject) => {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;

            // 避免影響版面
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";

            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (successful) {
                resolve();
            } else {
                reject(new Error('execCommand copy failed'));
            }
        } catch (err) {
            reject(err);
        }
    });
}


// ============================================
// 主畫面備註排版增強
// ============================================

function autoResizeMainMemoTextarea(textarea) {
    if (!textarea) return;

    const minHeight = 72;
    const extraHeight = 24;
    const maxHeight = Math.max(minHeight, Math.min(620, Math.floor(window.innerHeight * 0.64)));
    textarea.style.setProperty('height', 'auto', 'important');

    const nextHeight = Math.min(Math.max(textarea.scrollHeight + extraHeight, minHeight), maxHeight);
    textarea.style.setProperty('height', `${nextHeight}px`, 'important');
    textarea.style.setProperty('overflow-y', nextHeight >= maxHeight ? 'auto' : 'hidden', 'important');
}

function ensureMemoFontFace() {
    if (document.getElementById('swis-memo-font-face')) return;
    if (!chrome?.runtime?.getURL) return;

    const style = document.createElement('style');
    style.id = 'swis-memo-font-face';
    const regularUrl = chrome.runtime.getURL('assets/fonts/NotoSansTC-Regular.ttf');
    const semiBoldUrl = chrome.runtime.getURL('assets/fonts/NotoSansTC-SemiBold.ttf');
    style.textContent = `
@font-face {
    font-family: "NotoSansTC-Regular";
    src: url("${regularUrl}") format("truetype");
    font-style: normal;
    font-weight: 400;
    font-display: swap;
}
@font-face {
    font-family: "NotoSansTC-Regular";
    src: url("${semiBoldUrl}") format("truetype");
    font-style: normal;
    font-weight: 600;
    font-display: swap;
}`;
    document.head.appendChild(style);
}

function enhanceMainMemoTextarea() {
    if (!isSa12010ApplicationMaintenancePage()) return false;
    ensureMemoFontFace();

    const memoTextareas = document.querySelectorAll('textarea[name="memo"]');
    if (!memoTextareas.length) return false;

    memoTextareas.forEach((textarea) => {
        if (!(textarea instanceof HTMLTextAreaElement)) return;

        const memoRow = textarea.closest('tr');
        const memoCell = textarea.closest('td');
        const memoLabel = memoRow?.querySelector('td.title2, td.must');

        if (memoRow) memoRow.classList.add('swis-main-memo-row');
        if (memoCell) memoCell.classList.add('swis-main-memo-cell');
        if (memoLabel) memoLabel.classList.add('swis-main-memo-label');

        if (textarea.dataset.swisMemoEnhanced === 'true') {
            if (typeof textarea._swisMemoRefresh === 'function') {
                textarea._swisMemoRefresh();
            }
            return;
        }

        textarea.dataset.swisMemoEnhanced = 'true';
        textarea.classList.add('swis-main-memo-textarea');

        const legacyEnhancer = textarea.nextElementSibling;
        if (legacyEnhancer && legacyEnhancer.classList.contains('swis-memo-enhancer')) {
            legacyEnhancer.remove();
        }

        let shell = textarea.parentElement;
        if (!shell || !shell.classList.contains('swis-memo-editor-shell')) {
            shell = document.createElement('div');
            shell.className = 'swis-memo-editor-shell';

            textarea.parentNode.insertBefore(shell, textarea);
            shell.appendChild(textarea);
        }

        let actions = shell.nextElementSibling;
        if (!actions || !actions.classList.contains('swis-memo-action-row')) {
            actions = document.createElement('div');
            actions.className = 'swis-memo-action-row';
            shell.parentNode.insertBefore(actions, shell.nextSibling);
        }

        const currentRows = parseInt(textarea.getAttribute('rows') || '0', 10);
        if (!currentRows || currentRows < 3) {
            textarea.setAttribute('rows', '2');
        }
        textarea.removeAttribute('cols');

        const refreshTextarea = () => {
            autoResizeMainMemoTextarea(textarea);
        };

        textarea.addEventListener('input', refreshTextarea);
        textarea.addEventListener('change', refreshTextarea);
        textarea.addEventListener('focus', refreshTextarea);
        window.addEventListener('resize', refreshTextarea);

        textarea._swisMemoRefresh = refreshTextarea;
        refreshTextarea();
    });

    return true;
}

window.enhanceMainMemoTextarea = enhanceMainMemoTextarea;

// ============================================
// 併發處理管理器 (類多執行緒)
// ============================================
class ConcurrencyManager {
    constructor(concurrency = 3) {
        this.concurrency = concurrency;
        this.queue = [];
        this.activeCount = 0;
    }

    // 加入任務
    add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    // 處理佇列
    async process() {
        if (this.activeCount >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.activeCount++;
        const { task, resolve, reject } = this.queue.shift();

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.activeCount--;
            this.process(); // 繼續處理下一個
        }
    }
}
// 建立全域實例 (預設 3 個併發請求)
window.apiConcurrencyManager = new ConcurrencyManager(3);

