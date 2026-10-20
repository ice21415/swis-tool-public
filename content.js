(function() {
'use strict';

// 防止重複載入
if (window.contentScriptLoaded) {
    return;
}
window.contentScriptLoaded = true;

// ============================================
// 安全的 Chrome Storage 包裝器
// ============================================
function safeStorageSet(data, callback) {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        return;
    }
    
    try {
        chrome.storage.local.set(data, function() {
            if (chrome.runtime.lastError) {
                // storage error
            } else if (callback) {
                callback();
            }
        });
    } catch (error) {
        // storage exception
    }
}

function safeStorageGet(keys, callback) {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        return;
    }
    
    try {
        chrome.storage.local.get(keys, callback);
    } catch (error) {
        // storage exception
    }
}

function isUtilityFrame() {
    const frameName = String(window.name || '').toLowerCase();
    const path = String(location.pathname || '').toLowerCase();
    const utilityNames = new Set([
        'city_frm',
        'soc_frm',
        'ifm_filter',
        'qdata_ifm',
        'qzap_ifm'
    ]);

    return utilityNames.has(frameName) || /\/socs\/jsp\/comm\/(blank|filter|city_all)\.jsp$/.test(path);
}

if (isUtilityFrame()) {
    return;
}

(function setupPageTransitionHint() {
    if (!location.hostname.includes('swis.mohw.gov.tw')) return;

    const TRANSITION_HINT_KEY = 'swisPageTransitionHint';
    const TRANSITION_SNAPSHOT_KEY = 'swisPageTransitionSnapshot';
    const TRANSITION_SNAPSHOT_MAX_HTML = 700000;

    function isMainFrameTarget(target) {
        return !target || target === '_self' || target === 'main_frm';
    }

    function resolveMainFrameWindow() {
        try {
            if (window.top && window.top.frames && window.top.frames.main_frm && window.top.frames.main_frm.document) {
                return window.top.frames.main_frm;
            }
        } catch (error) {
            // ignore cross-frame access issues
        }
        return window;
    }

    function syncSnapshotFormState(sourceDoc, cloneRoot) {
        const sourceFields = sourceDoc.querySelectorAll('input, textarea, select');
        const cloneFields = cloneRoot.querySelectorAll('input, textarea, select');
        const count = Math.min(sourceFields.length, cloneFields.length);

        for (let i = 0; i < count; i += 1) {
            const sourceField = sourceFields[i];
            const cloneField = cloneFields[i];
            if (!sourceField || !cloneField) continue;

            if (cloneField instanceof HTMLTextAreaElement && sourceField instanceof HTMLTextAreaElement) {
                cloneField.textContent = sourceField.value;
                continue;
            }

            if (cloneField instanceof HTMLSelectElement && sourceField instanceof HTMLSelectElement) {
                Array.from(cloneField.options).forEach((option, optionIndex) => {
                    option.selected = !!sourceField.options[optionIndex]?.selected;
                });
                continue;
            }

            if (cloneField instanceof HTMLInputElement && sourceField instanceof HTMLInputElement) {
                if (sourceField.type === 'checkbox' || sourceField.type === 'radio') {
                    cloneField.checked = sourceField.checked;
                    if (sourceField.checked) {
                        cloneField.setAttribute('checked', 'checked');
                    } else {
                        cloneField.removeAttribute('checked');
                    }
                } else {
                    cloneField.value = sourceField.value;
                    cloneField.setAttribute('value', sourceField.value);
                }
            }
        }
    }

    function sanitizeSnapshotClone(sourceWindow) {
        const sourceDoc = sourceWindow.document;
        if (!sourceDoc?.documentElement || !sourceDoc.body) return null;

        const clone = sourceDoc.documentElement.cloneNode(true);
        if (!(clone instanceof HTMLElement)) return null;

        syncSnapshotFormState(sourceDoc, clone);

        clone.querySelectorAll('script, noscript, object, embed').forEach((node) => node.remove());
        clone.querySelectorAll('#swis-sidebar-settings, #swis-early-overlay, #swis-transition-snapshot-host, #gemini-status-banner').forEach((node) => node.remove());

        clone.querySelectorAll('*').forEach((node) => {
            Array.from(node.attributes).forEach((attr) => {
                if (/^on/i.test(attr.name)) {
                    node.removeAttribute(attr.name);
                }
            });
        });

        const head = clone.querySelector('head');
        if (head && !head.querySelector('base')) {
            const base = sourceDoc.createElement('base');
            base.setAttribute('href', sourceWindow.location.href);
            head.prepend(base);
        }

        return '<!DOCTYPE html>' + clone.outerHTML;
    }

    function captureTransitionSnapshot(source) {
        try {
            const frameWindow = resolveMainFrameWindow();
            const html = sanitizeSnapshotClone(frameWindow);
            if (!html || html.length > TRANSITION_SNAPSHOT_MAX_HTML) {
                sessionStorage.removeItem(TRANSITION_SNAPSHOT_KEY);
                return;
            }

            sessionStorage.setItem(TRANSITION_SNAPSHOT_KEY, JSON.stringify({
                ts: Date.now(),
                source,
                path: frameWindow.location?.pathname || location.pathname,
                html,
                scrollX: frameWindow.scrollX || frameWindow.document?.documentElement?.scrollLeft || 0,
                scrollY: frameWindow.scrollY || frameWindow.document?.documentElement?.scrollTop || 0
            }));
        } catch (error) {
            try {
                sessionStorage.removeItem(TRANSITION_SNAPSHOT_KEY);
            } catch (storageError) {
                // ignore storage cleanup failures
            }
        }
    }

    function writeTransitionHint(source) {
        try {
            if (source !== 'unload') {
                captureTransitionSnapshot(source);
                try {
                    window.top.postMessage({ type: 'SWIS_MAIN_FRAME_TRANSITION_START' }, '*');
                } catch (messageError) {
                    // ignore cross-frame postMessage failures
                }
            }
            sessionStorage.setItem(TRANSITION_HINT_KEY, JSON.stringify({
                ts: Date.now(),
                source,
                path: location.pathname
            }));
        } catch (error) {
            // ignore transition hint write failures
        }
    }

    document.addEventListener('click', function(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const link = target.closest('a[href]');
        if (link) {
            const href = (link.getAttribute('href') || '').trim();
            if (href && !href.startsWith('#') && !/^javascript:/i.test(href) && isMainFrameTarget(link.target)) {
                writeTransitionHint('link');
                return;
            }
        }

        const control = target.closest('button, input[type="submit"], input[type="button"]');
        if (!control) return;

        const form = control.form || control.closest('form');
        if (form && isMainFrameTarget(control.formTarget || form.target)) {
            writeTransitionHint('control');
        }
    }, true);

    document.addEventListener('submit', function(event) {
        const form = event.target;
        if (form && isMainFrameTarget(form.target)) {
            writeTransitionHint('submit');
        }
    }, true);

    window.addEventListener('beforeunload', function() {
        writeTransitionHint('unload');
    });
})();

// ============================================
// 精簡初始化橋接（改由 js/core.js 與 js/feature_* 模組負責主要功能）
// ============================================

function highlightPropertyIncomeRowsLite() {
    const rows = document.querySelectorAll('tr.title4');
    rows.forEach(row => {
        if (row.textContent.includes('財產所得(76)')) {
            const hiddenInput = row.querySelector('input[name="a_count_yn_ori"]');
            if (hiddenInput && hiddenInput.value === 'Y') {
                row.style.setProperty('background-color', '#fff59d', 'important');
            }
        }
    });
}

function scheduleDeferredInit(task, retryDelay) {
    const run = () => {
        let result;
        try {
            result = task();
        } catch (error) {
            return;
        }

        if (result === false && retryDelay) {
            window.setTimeout(() => {
                window.requestAnimationFrame(() => {
                    try {
                        task();
                    } catch (retryError) {
                        // ignore deferred retry failures
                    }
                });
            }, retryDelay);
        }
    };

    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 220 });
    } else {
        window.setTimeout(run, 120);
    }
}

function runDeferredExtensionFeatures() {
    const hasMemoTextarea = document.querySelector('textarea[name="memo"]') !== null;
    const hasQueryIdInput = document.querySelector('input[name="qid_no"]') !== null;
    if (typeof window.injectCertificateButton === 'function') {
        scheduleDeferredInit(() => window.injectCertificateButton(), 0);
    }

    if (typeof window.safeInjectHistoricalNotes === 'function' && (hasMemoTextarea || hasQueryIdInput)) {
        scheduleDeferredInit(() => window.safeInjectHistoricalNotes(), 260);
    }

    if (typeof window.safeInjectPassbookButton === 'function' && hasMemoTextarea) {
        scheduleDeferredInit(() => window.safeInjectPassbookButton(), 320);
    }

    if (typeof window.initEligibilityAutoDetect === 'function' && hasQueryIdInput) {
        scheduleDeferredInit(() => window.initEligibilityAutoDetect(), 0);
    }

    if (typeof window.initPrisonStatusCaseBadges === 'function') {
        scheduleDeferredInit(() => window.initPrisonStatusCaseBadges(), 420);
    }

    if (typeof window.initHouseholdStatusBadges === 'function') {
        scheduleDeferredInit(() => window.initHouseholdStatusBadges(), 520);
    }

    if (typeof window.enhanceMainMemoTextarea === 'function' && hasMemoTextarea) {
        scheduleDeferredInit(() => window.enhanceMainMemoTextarea(), 360);
    }
}

window.runDeferredExtensionFeatures = runDeferredExtensionFeatures;

function initializeLeanExtensionPage() {
    if (window.hasInitializedExtension) {
        return;
    }
    window.hasInitializedExtension = true;

    const getPageTypeFn = typeof window.getPageType === 'function' ? window.getPageType : null;
    const pageType = getPageTypeFn ? getPageTypeFn() : 'unknown';

    if ((pageType === 'movable_assets_page' || pageType === 'immovable_assets_page' || pageType === 'tax_summary_page') && typeof window.runTaxDiffFlow === 'function') {
        scheduleDeferredInit(() => window.runTaxDiffFlow(), 0);
    }

    if (typeof window.injectInvestmentActionButtons === 'function') {
        scheduleDeferredInit(() => window.injectInvestmentActionButtons(), 0);
    }

    if (pageType === 'immovable_assets_page' && typeof window.countCurrentImmovableItems === 'function') {
        window.countCurrentImmovableItems();
    }

    if (pageType === 'tax_summary_page' && typeof window.initTaxSummaryPage === 'function') {
        window.initTaxSummaryPage();
    }

    if (pageType === 'income_page') {
        highlightPropertyIncomeRowsLite();
    }

    runDeferredExtensionFeatures();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLeanExtensionPage, { once: true });
} else {
    initializeLeanExtensionPage();
}

let leanObserverTimeout = null;
let leanObserverDebounce = null;
const leanObserver = new MutationObserver(() => {
    clearTimeout(leanObserverDebounce);
    leanObserverDebounce = setTimeout(() => {
        if (window.hasInitializedExtension) {
            leanObserver.disconnect();
            clearTimeout(leanObserverTimeout);
            return;
        }

        const getPageTypeFn = typeof window.getPageType === 'function' ? window.getPageType : null;
        const pageType = getPageTypeFn ? getPageTypeFn() : 'unknown';
        if (pageType !== 'unknown') {
            initializeLeanExtensionPage();
            leanObserver.disconnect();
            clearTimeout(leanObserverTimeout);
        }
    }, 100);
});

leanObserverTimeout = setTimeout(() => leanObserver.disconnect(), 3000);

leanObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
});

// 舊版重複實作已移除；功能由 js/core.js 與 js/feature_tax.js 提供。

})(); // 結束 IIFE

