// feature_single_tab.js
// 目的：實作「頁面內多分頁 (In-Page Tabs)」系統
// 策略：在 main_frm 內注入 overlay iframe，用浮動面板管理

(function () {
    if (window.hasInitializedSwisTabs) return;
    window.hasInitializedSwisTabs = true;

    const PANEL_ID = 'swis-tab-panel';
    const TAB_LIST_ID = 'swis-tab-list';
    const OVERLAY_CONTAINER_ID = 'swis-overlay-container';
    const FRAME_TRANSITION_OVERLAY_ID = 'swis-main-frame-transition';
    const FRAME_TRANSITION_STYLE_ID = 'swis-main-frame-transition-style';
    const TRANSITION_SNAPSHOT_KEY = 'swisPageTransitionSnapshot';
    const FRAME_TRANSITION_FALLBACK_HIDE_MS = 900;

    let mainFrameTransitionFallbackTimer = null;
    let swisHouseholdCursorId = '';

    // 判斷是否為最頂層頁面 (index.jsp)
    const isTopPage = window === window.top && window.location.href.includes('index.jsp');

    // 判斷是否為 main_frm (主要內容框架)
    const isMainFrm = window.name === 'main_frm';

    // 判斷是否為案件列表頁 (需要攔截點擊)
    // 改用延遲偵測，因為需要檢查 DOM 中是否有可點擊的列表行
    var isListPage = false;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        if (isTopPage) {
            setTimeout(initTopPage, 500);
        }

        // 只有特定的列表頁才啟用分頁系統 (SA12010, SC12010, SH12010)
        // 其他頁面如 SA16120 等不使用分頁系統
        var allowedProgIds = ['SA12010', 'SC12010', 'SH12010'];
        var currentProgId = '';

        // 從 URL 或隱藏欄位取得 prog_id
        var urlMatch = window.location.href.match(/prog_id=([A-Z0-9]+)/i);
        if (urlMatch) {
            currentProgId = urlMatch[1].toUpperCase();
        } else {
            var progIdInput = document.querySelector('input[name="prog_id"]');
            if (progIdInput) {
                currentProgId = progIdInput.value.toUpperCase();
            }
        }

        // 檢查是否為允許的列表頁
        if (allowedProgIds.includes(currentProgId) && window.location.href.includes('_list.jsp')) {
            isListPage = true;
        }

        if (isListPage) {
            setupClickInterceptor();
        }

        window.addEventListener('message', handleMessage);
        setupKeyboardShortcuts();
    }

    function initTopPage() {
        createFloatingPanel();
        setupMainFrameTransitionMonitor();
        // 初始化 tabs 儲存
        window.swisTabs = window.swisTabs || {
            tabs: [],           // { id, title, url, method, formData }
            activeTabId: 'home'
        };
    }

    function getMainFrameElement() {
        return document.querySelector('frame[name="main_frm"], iframe[name="main_frm"]');
    }

    function ensureMainFrameTransitionStyle() {
        if (document.getElementById(FRAME_TRANSITION_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = FRAME_TRANSITION_STYLE_ID;
        style.textContent = `
            #${FRAME_TRANSITION_OVERLAY_ID} {
                position: fixed;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                overflow: hidden;
                background: #eee6dc;
                transform: translate3d(0, 6px, 0) scale(0.997);
                transform-origin: 50% 0;
                transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 180ms;
                box-shadow: 0 8px 22px rgba(0, 0, 0, 0.06);
                z-index: 2147483646;
            }
            #${FRAME_TRANSITION_OVERLAY_ID}.active {
                opacity: 1;
                visibility: visible;
                transform: translate3d(0, 0, 0) scale(1);
                transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            #${FRAME_TRANSITION_OVERLAY_ID} iframe,
            #${FRAME_TRANSITION_OVERLAY_ID} .swis-main-frame-transition-fallback {
                width: 100%;
                height: 100%;
                border: 0;
                display: block;
                background: #eee6dc;
                pointer-events: none;
            }
            #${FRAME_TRANSITION_OVERLAY_ID} .swis-main-frame-transition-fallback {
                background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 30%), #eee6dc;
            }
        `;
        document.documentElement.appendChild(style);
    }

    function getOrCreateMainFrameTransitionOverlay() {
        ensureMainFrameTransitionStyle();

        let overlay = document.getElementById(FRAME_TRANSITION_OVERLAY_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = FRAME_TRANSITION_OVERLAY_ID;
            document.documentElement.appendChild(overlay);
        }
        return overlay;
    }

    function readStoredTransitionSnapshot() {
        try {
            const raw = sessionStorage.getItem(TRANSITION_SNAPSHOT_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.html) return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function updateMainFrameTransitionBounds() {
        const overlay = document.getElementById(FRAME_TRANSITION_OVERLAY_ID);
        const mainFrame = getMainFrameElement();
        if (!overlay || !mainFrame || typeof mainFrame.getBoundingClientRect !== 'function') return;

        const rect = mainFrame.getBoundingClientRect();
        overlay.style.top = `${rect.top}px`;
        overlay.style.left = `${rect.left}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
    }

    function renderMainFrameTransitionSnapshot(snapshot) {
        const overlay = getOrCreateMainFrameTransitionOverlay();
        overlay.innerHTML = '';

        if (snapshot && snapshot.html) {
            const frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('scrolling', 'no');
            frame.setAttribute('sandbox', 'allow-same-origin');
            frame.srcdoc = snapshot.html;
            frame.addEventListener('load', function () {
                try {
                    frame.contentWindow.scrollTo(snapshot.scrollX || 0, snapshot.scrollY || 0);
                    if (frame.contentDocument && frame.contentDocument.body) {
                        frame.contentDocument.body.style.pointerEvents = 'none';
                    }
                } catch (error) {
                    // ignore snapshot iframe access failures
                }
            });
            overlay.appendChild(frame);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'swis-main-frame-transition-fallback';
            overlay.appendChild(fallback);
        }

        updateMainFrameTransitionBounds();
        return overlay;
    }

    function showMainFrameTransitionOverlay() {
        if (!isTopPage) return;

        const overlay = renderMainFrameTransitionSnapshot(readStoredTransitionSnapshot());
        if (!overlay) return;

        if (mainFrameTransitionFallbackTimer) {
            clearTimeout(mainFrameTransitionFallbackTimer);
            mainFrameTransitionFallbackTimer = null;
        }

        updateMainFrameTransitionBounds();
        window.requestAnimationFrame(() => {
            overlay.classList.add('active');
        });
    }

    function hideMainFrameTransitionOverlay() {
        const overlay = document.getElementById(FRAME_TRANSITION_OVERLAY_ID);
        if (!overlay) return;

        if (mainFrameTransitionFallbackTimer) {
            clearTimeout(mainFrameTransitionFallbackTimer);
            mainFrameTransitionFallbackTimer = null;
        }

        overlay.classList.remove('active');
        setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.innerHTML = '';
                overlay.style.visibility = 'hidden';
            }
        }, 220);
    }

    function setupMainFrameTransitionMonitor() {
        const mainFrame = getMainFrameElement();
        if (!mainFrame || mainFrame.dataset.swisTransitionBound === 'true') return;

        mainFrame.dataset.swisTransitionBound = 'true';
        mainFrame.addEventListener('load', function () {
            window.requestAnimationFrame(() => {
                updateMainFrameTransitionBounds();

                if (mainFrameTransitionFallbackTimer) {
                    clearTimeout(mainFrameTransitionFallbackTimer);
                }
                mainFrameTransitionFallbackTimer = setTimeout(() => {
                    hideMainFrameTransitionOverlay();
                }, FRAME_TRANSITION_FALLBACK_HIDE_MS);
            });
        });

        window.addEventListener('resize', updateMainFrameTransitionBounds);
    }

    function createFloatingPanel() {
        if (document.getElementById(PANEL_ID)) return;

        // 方案：在 h_frm 內，將右側區域改為嵌套 frameset，上方放分頁面板
        const hFrm = document.querySelector('frameset#h_frm');
        const mainFrm = document.querySelector('frame[name="main_frm"]');
        
        if (hFrm && mainFrm) {
            // 取得 main_frm 的原始屬性
            const mainSrc = mainFrm.getAttribute('src');
            const mainScrolling = mainFrm.getAttribute('scrolling') || 'auto';
            
            // 創建新的嵌套 frameset 來取代 main_frm
            const newFrameset = document.createElement('frameset');
            newFrameset.setAttribute('rows', '34,*');
            newFrameset.setAttribute('framespacing', '0');
            newFrameset.setAttribute('frameborder', 'no');
            newFrameset.setAttribute('border', '0');
            
            // 創建分頁面板 frame（使用 about:blank，由 JS 動態填充）
            const tabFrame = document.createElement('frame');
            tabFrame.setAttribute('name', 'swis_tab_bar');
            tabFrame.setAttribute('src', 'about:blank');
            tabFrame.setAttribute('scrolling', 'no');
            tabFrame.setAttribute('noresize', '');
            tabFrame.setAttribute('marginheight', '0');
            tabFrame.setAttribute('marginwidth', '0');
            
            // 創建新的 main_frm
            const newMainFrm = document.createElement('frame');
            newMainFrm.setAttribute('name', 'main_frm');
            newMainFrm.setAttribute('src', mainSrc);
            newMainFrm.setAttribute('scrolling', mainScrolling);
            newMainFrm.setAttribute('target', '_self');
            newMainFrm.setAttribute('noresize', '');
            
            newFrameset.appendChild(tabFrame);
            newFrameset.appendChild(newMainFrm);
            
            // 替換原本的 main_frm
            mainFrm.parentNode.replaceChild(newFrameset, mainFrm);
            setupMainFrameTransitionMonitor();
            
            // 等待 frame 載入後注入分頁面板內容
            setTimeout(() => {
                const tabFrameWindow = window.frames['swis_tab_bar'];
                if (tabFrameWindow) {
                    _writeTabBarAndSetup(tabFrameWindow);
                }
            }, 200);
        } else {
            // 降級方案：使用固定定位
            createFallbackPanel();
        }
    }

    function _writeTabBarAndSetup(tabFrameWindow) {
        const doc = tabFrameWindow.document;

        // 深色/淺色主題 CSS 變數
        const lightVars = `
            --bg-color: #f0f0f0;
            --border-color: #ccc;
            --item-hover: #e0e0e0;
            --active-bg: #fff;
            --active-border-top: #000000;
            --text-color: #333;
            --text-sub: #666;
            --close-hover-bg: #d0d0d0;
            --close-hover-color: #d13438;
            --close-all-color: #d13438;
            --close-all-hover-bg: #a80000;
            --drag-bg: #ffe;
            --scroll-btn-hover: #e0e0e0;
            --tab-inactive-bg: #e0e0e0;
            --tab-inactive-hover: #e6e6e6;
        `;
        doc.open();
        doc.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <style>
                                :root {
                                    ${lightVars}
                                }
                                body {
                                    margin: 0; padding: 0;
                                    background: var(--bg-color);
                                    font-family: 'NotoSansTC-Regular', 'Microsoft JhengHei', 'Segoe UI', system-ui, sans-serif;
                                    font-size: 13px;
                                    height: 100vh;
                                    overflow: hidden;
                                    user-select: none;
                                    border-bottom: 1px solid var(--border-color);
                                }
                                .toolbar {
                                    display: flex;
                                    height: 100%;
                                    align-items: stretch;
                                }
                                .fixed-btn {
                                    /* width: 36px; Removed fixed width */
                                    padding: 0 12px;
                                    min-width: 60px;
                                    display: flex; align-items: center; justify-content: center;
                                    cursor: pointer;
                                    background: var(--bg-color);
                                    color: var(--text-sub);
                                    border-right: 1px solid transparent;
                                    transition: background 0.1s;
                                    flex-shrink: 0;
                                    font-size: 13px;
                                    font-weight: 500;
                                }
                                .fixed-btn:hover { background: var(--item-hover); color: var(--text-color); }
                                .fixed-btn.home-item.active {
                                    background: var(--active-bg);
                                    border-top: 2px solid var(--active-border-top);
                                    color: var(--active-border-top);
                                    font-weight: 600;
                                }
                                .fixed-btn.close-all-item {
                                    color: var(--close-all-color);
                                    border-left: 1px solid var(--border-color);
                                }
                                .fixed-btn.close-all-item:hover {
                                    background: var(--close-all-hover-bg);
                                    color: #fff;
                                }
                                
                                /* Scroll Buttons */
                                .scroll-container {
                                    flex: 1;
                                    display: flex;
                                    overflow: hidden;
                                    position: relative;
                                    align-items: stretch;
                                }
                                .scroll-btn {
                                    width: 20px;
                                    background: var(--bg-color);
                                    color: var(--text-sub);
                                    border: none;
                                    cursor: pointer;
                                    font-weight: bold;
                                    font-size: 16px;
                                    display: none; /* hidden by default */
                                    align-items: center; justify-content: center;
                                    z-index: 2;
                                    transition: opacity 0.2s, background 0.1s;
                                }
                                .scroll-btn:hover { background: var(--scroll-btn-hover); color: var(--text-color); }
                                .scroll-btn.show { display: flex; }
                                .scroll-btn.disabled { 
                                    opacity: 0.2; 
                                    pointer-events: none; 
                                    cursor: default;
                                    background: transparent;
                                }
                                .scroll-left { border-right: 1px solid var(--border-color); }
                                .scroll-right { border-left: 1px solid var(--border-color); }

                                /* Tab List */
                                #${TAB_LIST_ID} {
                                    flex: 1;
                                    display: flex;
                                    overflow-x: scroll;
                                    overflow-y: hidden;
                                    scrollbar-width: none; /* Firefox */
                                    align-items: flex-end; /* Align tabs to bottom */
                                    padding-top: 2px;
                                    scroll-behavior: smooth;
                                }
                                #${TAB_LIST_ID}::-webkit-scrollbar { display: none; }

                                /* Individual Tab */
                                .tab-item {
                                    flex: 0 0 auto;
                                    max-width: 180px;
                                    min-width: 80px;
                                    height: 30px; /* slightly shorter than container */
                                    margin-right: 1px;
                                    padding: 0 10px;
                                    background: var(--tab-inactive-bg);
                                    border-top-left-radius: 4px;
                                    border-top-right-radius: 4px;
                                    display: flex;
                                    align-items: center;
                                    cursor: pointer;
                                    color: var(--text-sub);
                                    border: 1px solid transparent;
                                    position: relative;
                                }
                                .tab-item:hover { background: var(--tab-inactive-hover); }
                                .tab-item.active {
                                    background: var(--active-bg);
                                    color: var(--text-color);
                                    z-index: 1;
                                    height: 32px; /* Active tab is taller */
                                    border-top: 2px solid var(--active-border-top);
                                    box-shadow: 0 0 5px rgba(0,0,0,0.1);
                                }
                                .tab-title {
                                    flex: 1;
                                    white-space: nowrap;
                                    overflow: hidden;
                                    text-overflow: ellipsis;
                                    margin-right: 6px;
                                }
                                .tab-close {
                                    width: 16px; height: 16px;
                                    border-radius: 50%;
                                    display: flex; align-items: center; justify-content: center;
                                    font-size: 12px;
                                    opacity: 0;
                                    transition: opacity 0.2s, background 0.2s;
                                }
                                .tab-item:hover .tab-close { opacity: 1; }
                                .tab-close:hover { background: var(--close-hover-bg); color: var(--close-hover-color); }
                                .tab-item.active .tab-close { opacity: 1; }

                                /* Dragging */
                                .tab-item.dragging { opacity: 0.5; background: var(--drag-bg); }
                                .tab-item.drag-over { border-left: 2px solid var(--active-border-top); }
                            </style>
                        </head>
                        <body>
                            <div class="toolbar">
                                <div class="fixed-btn home-item active" data-id="home" title="回查詢頁">
                                    <span>首頁</span>
                                </div>
                                <div class="scroll-container">
                                    <div class="scroll-btn scroll-left">‹</div>
                                    <div id="${TAB_LIST_ID}">
                                        <!-- Tabs will be injected here -->
                                    </div>
                                    <div class="scroll-btn scroll-right">›</div>
                                </div>
                                <div class="fixed-btn close-all-item" data-id="close-all" title="全部關閉">
                                    <span>全部關閉</span>
                                </div>
                            </div>
                        </body>
                        </html>
                    `);
                    doc.close();

                    // 設定滾動按鈕功能
                    const tabList = doc.getElementById(TAB_LIST_ID);
                    const scrollLeftBtn = doc.querySelector('.scroll-left');
                    const scrollRightBtn = doc.querySelector('.scroll-right');
                    
                    function updateScrollButtons() {
                        if (!tabList) return;
                        
                        const maxScroll = tabList.scrollWidth - tabList.clientWidth;
                        const hasOverflow = maxScroll > 0;
                        
                        if (scrollLeftBtn && scrollRightBtn) {
                            if (hasOverflow) {
                                scrollLeftBtn.classList.add('show');
                                scrollRightBtn.classList.add('show');
                                
                                // Left button disabled check
                                scrollLeftBtn.classList.toggle('disabled', tabList.scrollLeft <= 1);
                                
                                // Right button disabled check
                                scrollRightBtn.classList.toggle('disabled', tabList.scrollLeft >= maxScroll - 1);
                            } else {
                                scrollLeftBtn.classList.remove('show');
                                scrollRightBtn.classList.remove('show');
                            }
                        }
                    }
                    
                    if (tabList) {
                        // 智能滾動 amount
                        const getScrollAmount = () => Math.max(150, tabList.clientWidth / 2);

                        if (scrollLeftBtn) {
                            scrollLeftBtn.onclick = function() {
                                tabList.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
                                setTimeout(updateScrollButtons, 300);
                            };
                        }
                        if (scrollRightBtn) {
                            scrollRightBtn.onclick = function() {
                                tabList.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
                                setTimeout(updateScrollButtons, 300);
                            };
                        }

                        // 支援滑鼠滾輪水平捲動 (Smart Wheel)
                        tabList.addEventListener('wheel', (e) => {
                            if (e.deltaY !== 0) {
                                e.preventDefault();
                                // 將垂直滾動轉換為水平滾動
                                tabList.scrollLeft += e.deltaY;
                                updateScrollButtons();
                            }
                        });
                        
                        // 監聽滾動與變化
                        tabList.addEventListener('scroll', () => {
                             // 使用 requestAnimationFrame 優化效能
                             window.requestAnimationFrame(updateScrollButtons);
                        });
                        
                        // 監聽內容變化 (新增/刪除 tab 時)
                        const observer = new MutationObserver(() => {
                            updateScrollButtons();
                            // 確保新 tab 可見
                            if (window.swisTabs.activeTabId && window.swisTabs.activeTabId !== 'home') {
                                const activeItem = tabList.querySelector('.tab-item.active');
                                if (activeItem) {
                                     // 簡單的 scrollIntoView 可能會被 smooth behavior 影響，這裡只要確保更新按鈕即可
                                     setTimeout(updateScrollButtons, 300);
                                }
                            }
                        });
                        observer.observe(tabList, { childList: true, subtree: true });
                        
                        // 初始化
                        setTimeout(updateScrollButtons, 200);
                        // 視窗大小改變時也要檢查
                        window.addEventListener('resize', updateScrollButtons);
                    }
                    
                    // 綁定事件 - 使用 postMessage 與父視窗通訊
                    const homeItem = doc.querySelector('.home-item');
                    if (homeItem) {
                        homeItem.onclick = function () {
                            window.parent.postMessage({ type: 'SWIS_ACTIVATE_TAB', tabId: 'home' }, '*');
                        };
                    }
                    
                    const closeAllItem = doc.querySelector('.close-all-item');
                    if (closeAllItem) {
                        closeAllItem.onclick = function () {
                            window.parent.postMessage({ type: 'SWIS_CLOSE_ALL_TABS' }, '*');
                        };
                    }
                    
                    // 儲存 tab frame 的 document 參考
                    window.swisTabBarDoc = doc;
    }
    
    function createFallbackPanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <style>
                #${PANEL_ID} {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: white;
                    border: 1px solid #84acdd;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 2147483647;
                    font-family: 'NotoSansTC-Regular', 'Microsoft JhengHei', system-ui, -apple-system, sans-serif;
                    font-size: 13px;
                    min-width: 200px;
                    max-width: 350px;
                }
                #${PANEL_ID} .panel-header {
                    background: linear-gradient(to bottom, #dcecfb, #bbdcfb);
                    padding: 8px 12px;
                    border-radius: 8px 8px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #84acdd;
                }
                #${PANEL_ID} .panel-title { font-weight: bold; color: #333; }
                #${PANEL_ID} .panel-toggle { cursor: pointer; color: #666; padding: 0 4px; }
                #${PANEL_ID} #${TAB_LIST_ID} { max-height: 300px; overflow-y: auto; }
                #${PANEL_ID} .tab-item {
                    padding: 8px 12px;
                    border-bottom: 1px solid #eee;
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                }
                #${PANEL_ID} .tab-item:hover { background: #f5f9fd; }
                #${PANEL_ID} .tab-item.active { background: #e8f4fc; font-weight: bold; }
                #${PANEL_ID} .tab-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                #${PANEL_ID} .tab-close {
                    width: 18px; height: 18px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    color: #999; margin-left: 8px;
                }
                #${PANEL_ID} .tab-close:hover { background: #ffcccc; color: red; }
                #${PANEL_ID} .home-item { color: #0066cc; }
                #${PANEL_ID}.collapsed #${TAB_LIST_ID} { display: none; }
                /* 拖移動畫效果 */
                #${PANEL_ID} .tab-item {
                    transition: all 0.2s ease, transform 0.15s ease;
                }
                #${PANEL_ID} .tab-item.dragging {
                    opacity: 0.6;
                    transform: scale(1.02);
                    background: #fffacd !important;
                    border: 2px dashed #f0ad4e !important;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                    cursor: grabbing;
                }
                #${PANEL_ID} .tab-item.drag-over {
                    border-top: 3px solid #0066cc !important;
                    background: #e0f0ff !important;
                    transform: translateY(2px);
                }
                #${PANEL_ID} .tab-item[draggable="true"] {
                    cursor: grab;
                }
                #${PANEL_ID} .tab-item[draggable="true"]:active {
                    cursor: grabbing;
                }
                @keyframes pulse {
                    0% { box-shadow: 0 0 0 0 rgba(0, 102, 204, 0.4); }
                    70% { box-shadow: 0 0 0 6px rgba(0, 102, 204, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(0, 102, 204, 0); }
                }
                #${PANEL_ID} .tab-item.drag-over {
                    animation: pulse 0.8s ease-in-out infinite;
                }
            </style>
            <div class="panel-header">
                <span class="panel-title">📂 開啟的案件</span>
                <span class="panel-toggle" title="收合/展開">▼</span>
            </div>
            <div id="${TAB_LIST_ID}">
                <div class="tab-item home-item active" data-id="home">
                    <span class="tab-title">🏠 原本頁面</span>
                </div>
                <div class="tab-item close-all-item" data-id="close-all" style="color:#cc6666;">
                    <span class="tab-title">❌ 關閉全部</span>
                </div>
            </div>
        `;

        document.documentElement.appendChild(panel);

        const header = panel.querySelector('.panel-header');
        const toggle = panel.querySelector('.panel-toggle');
        header.style.cursor = 'pointer';
        header.onclick = function () {
            panel.classList.toggle('collapsed');
            toggle.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
        };

        const homeItem = panel.querySelector('.home-item');
        homeItem.onclick = function () {
            activateTab('home');
        };

        const closeAllItem = panel.querySelector('.close-all-item');
        closeAllItem.onclick = function () {
            closeAllTabs();
        };
    }

    // 輔助函數：獲取 tab list 元素（可能在 iframe 中或主文檔中）
    function getTabList() {
        // 優先從 iframe 中獲取
        if (window.swisTabBarDoc) {
            var list = window.swisTabBarDoc.getElementById(TAB_LIST_ID);
            if (list) return list;
        }
        // 降級：從主文檔獲取
        return document.getElementById(TAB_LIST_ID);
    }

    function handleMessage(event) {
        if (event.origin !== location.origin) return;
        if (!event.data || typeof event.data !== 'object') return;

        if (event.data.type === 'SWIS_HOUSEHOLD_CURSOR') {
            swisHouseholdCursorId = String(event.data.idNo || '').toUpperCase();
            return;
        }

        if (event.data.type === 'SWIS_KEYBOARD_SHORTCUT') {
            if (isTopPage) {
                handleShortcutAction(event.data.key);
            }
            return;
        }

        if (event.data.type === 'OPEN_SWIS_TAB') {
            if (isTopPage) {
                openNewTab(event.data);
            } else if (window.top) {
                window.top.postMessage(event.data, '*');
            }
        }

        // 處理來自 tab bar iframe 的訊息
        if (isTopPage) {
            if (event.data.type === 'SWIS_ACTIVATE_TAB') {
                activateTab(event.data.tabId);
            } else if (event.data.type === 'SWIS_CLOSE_ALL_TABS') {
                closeAllTabs();
            } else if (event.data.type === 'SWIS_CLOSE_TAB') {
                closeTab(event.data.tabId);
            } else if (event.data.type === 'SWIS_MAIN_FRAME_TRANSITION_START') {
                showMainFrameTransitionOverlay();
            } else if (event.data.type === 'SWIS_MAIN_FRAME_TRANSITION_READY' && event.data.frameName === 'main_frm') {
                hideMainFrameTransitionOverlay();
            }
        }

        // main_frm 接收指令來顯示/隱藏 overlay
        if (isMainFrm) {
            if (event.data.type === 'SWIS_SHOW_OVERLAY') {
                showOverlay(event.data.tabId, event.data.url, event.data.method, event.data.formData);
            } else if (event.data.type === 'SWIS_HIDE_ALL_OVERLAYS') {
                hideAllOverlays();
            } else if (event.data.type === 'SWIS_REMOVE_OVERLAY') {
                removeOverlay(event.data.tabId);
            }
        }
    }

    function setupClickInterceptor() {
        var columnMap = detectColumns();
        document.addEventListener('click', function (e) {
            var tr = e.target;
            while (tr && tr.tagName !== 'TR') {
                tr = tr.parentElement;
            }

            if (!tr) return;

            var onclick = tr.getAttribute('onclick');
            if (!onclick) return;

            var match = onclick.match(/send\s*\(.+?,\s*'get'\s*,\s*'(sa\d+|sc\d+|sh\d+|app\d+)'\s*,\s*'([^']+)'\s*\)/);

            if (match && match[2]) {
                var progId = match[1];
                var appNo = match[2];
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                var originalOnclick = tr.getAttribute('onclick');
                tr.removeAttribute('onclick');
                setTimeout(function () { tr.setAttribute('onclick', originalOnclick); }, 100);

                var title = extractTitle(tr, columnMap, appNo);
                var baseUrl = window.location.href.split('?')[0];

                if (progId.match(/^app\d+$/)) {
                    var formData = collectFormData();
                    formData.key = appNo;
                    formData.status = 'get';
                    var actionUrl = baseUrl.replace(/_list\.jsp$/, '_action.jsp');
                    var pId = getHiddenValue('p_id') || getHiddenValue('prog_id') || 'SC12010';

                    var payload = {
                        type: 'OPEN_SWIS_TAB',
                        url: actionUrl + '?prog_id=' + pId,
                        title: title,
                        appNo: appNo,
                        method: 'POST',
                        formData: formData
                    };
                    window.top.postMessage(payload, '*');
                } else {
                    var actionUrl = baseUrl.replace(/_list\.jsp$/, '_action.jsp');
                    var url = actionUrl + '?app_no=' + encodeURIComponent(appNo) + '&status=get';
                    var payload = {
                        type: 'OPEN_SWIS_TAB',
                        url: url,
                        title: title,
                        appNo: appNo,
                        method: 'GET'
                    };
                    window.top.postMessage(payload, '*');
                }
            }
        }, true);
    }

    function detectColumns() {
        var map = { name: -1, appNo: -1 };
        var headerRow = document.querySelector('tr.title1');
        if (!headerRow) return map;

        var cells = headerRow.cells;
        for (var i = 0; i < cells.length; i++) {
            var text = cells[i].textContent.trim();
            if (text.includes('戶長姓名')) {
                map.name = i;
            } else if (text.includes('申請人') && map.name === -1) {
                map.name = i;
            } else if (text.includes('姓名') && !text.includes('受補助') && map.name === -1) {
                map.name = i;
            }
            if (text.includes('申請案號') || text.includes('案號')) {
                map.appNo = i;
            }
            // 找款類別欄位 (低收: 款類別/核定款, 中老: 核定倍數)
            if (text.includes('款類別') || text.includes('核定款') || text.includes('核定倍數')) {
                map.category = i;
            }
        }
        return map;
    }

    function collectFormData() {
        var data = {};
        var inputs = document.querySelectorAll('input[type="hidden"]');
        inputs.forEach(function (input) {
            if (input.name) {
                data[input.name] = input.value || '';
            }
        });
        return data;
    }

    function getHiddenValue(name) {
        var input = document.querySelector('input[name="' + name + '"]');
        return input ? input.value : null;
    }

    function extractTitle(tr, columnMap, appNo) {
        var name = '';
        var category = '';

        if (tr.cells && columnMap.name >= 0 && tr.cells[columnMap.name]) {
            var nameCell = tr.cells[columnMap.name].cloneNode(true);
            nameCell.querySelectorAll('[data-swis-batch-result]').forEach(function (result) { result.remove(); });
            name = nameCell.textContent.trim();
        }

        // 取得款類別
        if (tr.cells && columnMap.category >= 0 && tr.cells[columnMap.category]) {
            category = tr.cells[columnMap.category].textContent.trim();
        }

        // 解析案號資訊
        var caseInfo = parseCaseNumber(appNo);

        var parts = [];
        if (name) parts.push(name);

        var infoStr = caseInfo.type + caseInfo.year;
        if (category) {
            if (category === 'Z' || category.includes('不符')) {
                infoStr += '-不符';
            } else if (caseInfo.type === '中老') {
                // 中老：1.5倍~2.5倍 → 1.5-2.5，1.5倍以下 → 1.5倍以下
                if (category.includes('1.5') && category.includes('2.5')) {
                    infoStr += '-1.5-2.5';
                } else if (category.includes('1.5倍以下') || category.includes('1.5 倍以下')) {
                    infoStr += '-1.5倍以下';
                } else {
                    infoStr += '-' + category.replace(/[（）\(\)]/g, '').substring(0, 10);
                }
            } else if (caseInfo.type === '身障') {
                // 身障：9=符合2.5倍以下，1-3款=低1-低3，M=中低收
                if (category === '9' || category.includes('符合') || category.includes('2.5')) {
                    infoStr += '-符合';
                } else if (category === 'M' || category.includes('中低')) {
                    infoStr += '-中低收';
                } else if (category.match(/[1-3]/)) {
                    infoStr += '-低' + category.match(/[1-3]/)[0];
                } else {
                    infoStr += '-' + category.substring(0, 5);
                }
            } else {
                // 低收：1-4款，M=中低收
                if (category === 'M' || category.includes('中低')) {
                    infoStr += '-中低收';
                } else if (category.match(/[1-4]/)) {
                    infoStr += '-低' + category.match(/[1-4]/)[0];
                } else {
                    infoStr += '-' + category.substring(0, 5);
                }
            }
        } else {
            infoStr += '-未核';
        }

        if (parts.length > 0) {
            return parts[0] + ' [' + infoStr + ']';
        }
        return '[' + infoStr + ']';
    }

    // 解析案號取得類型和年度
    function parseCaseNumber(appNo) {
        var result = { type: '', year: '' };
        if (!appNo || appNo.length < 5) return result;

        // 前兩碼判斷類型: EA=低收, EC=中老, EH=身障
        var prefix = appNo.substring(0, 2).toUpperCase();
        if (prefix === 'EA' || prefix === 'KA') {
            result.type = '低收';
        } else if (prefix === 'EC' || prefix === 'KC') {
            result.type = '中老';
        } else if (prefix === 'EH' || prefix === 'KH') {
            result.type = '身障';
        } else {
            result.type = prefix;
        }

        // 年度: 第3-6碼（4位數），如 EC1115... → 1115 → 顯示 115
        // 案號格式: 前綴(2) + 年度(4位，如1115表示115年) + 序號
        var yearCode = appNo.substring(2, 6);
        if (yearCode.length >= 3) {
            // 1115 → 115, 1114 → 114
            if (yearCode.startsWith('1')) {
                result.year = yearCode.substring(1); // 取後3碼
            } else {
                result.year = yearCode;
            }
        }

        return result;
    }

    // ==================== Top Page Functions ====================

    function openNewTab(data) {
        var list = getTabList();
        if (!list) return;

        var tabId = 'tab_' + data.appNo;

        // 檢查是否已存在相同案件
        var existingTab = window.swisTabs.tabs.find(function (t) {
            return t.id === tabId;
        });

        if (existingTab) {
            activateTab(tabId);
            return;
        }

        // 新增標籤資料
        window.swisTabs.tabs.push({
            id: tabId,
            title: data.title,
            url: data.url,
            method: data.method,
            formData: data.formData
        });

        // 建立標籤項目
        var item = document.createElement('div');
        item.className = 'tab-item';
        item.setAttribute('data-id', tabId);
        item.setAttribute('draggable', 'true');
        item.innerHTML = `
            <span class="tab-title">${escapeHtml(data.title)}</span>
            <span class="tab-close" title="關閉">×</span>
        `;

        // 拖曳事件
        item.ondragstart = function (e) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tabId);
            item.classList.add('dragging');
        };
        item.ondragend = function () {
            item.classList.remove('dragging');
            list.querySelectorAll('.tab-item').forEach(function (t) {
                t.classList.remove('drag-over');
            });
        };
        item.ondragover = function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };
        item.ondragenter = function (e) {
            e.preventDefault();
            if (!item.classList.contains('dragging') && !item.classList.contains('home-item') && !item.classList.contains('close-all-item')) {
                item.classList.add('drag-over');
            }
        };
        item.ondragleave = function () {
            item.classList.remove('drag-over');
        };
        item.ondrop = function (e) {
            e.preventDefault();
            item.classList.remove('drag-over');
            var draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== tabId) {
                reorderTabs(draggedId, tabId);
            }
        };

        item.querySelector('.tab-title').onclick = function () {
            activateTab(tabId);
        };

        item.querySelector('.tab-close').onclick = function (e) {
            e.stopPropagation();
            closeTab(tabId);
        };

        list.appendChild(item);

        // 啟動這個標籤
        activateTab(tabId);
    }

    function activateTab(tabId) {
        var list = getTabList();
        if (!list) return;

        // 更新 active 狀態
        list.querySelectorAll('.tab-item').forEach(function (t) {
            t.classList.remove('active');
        });

        var item = list.querySelector('[data-id="' + tabId + '"]');
        if (item) {
            item.classList.add('active');
            // 自動捲動到可見範圍
            setTimeout(function() {
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }, 50);
        }

        window.swisTabs.activeTabId = tabId;

        // 發送指令給 main_frm
        try {
            var mainFrm = window.frames['main_frm'];
            if (!mainFrm) return;

            if (tabId === 'home') {
                mainFrm.postMessage({ type: 'SWIS_HIDE_ALL_OVERLAYS' }, '*');
            } else {
                var tab = window.swisTabs.tabs.find(function (t) { return t.id === tabId; });
                if (tab) {
                    mainFrm.postMessage({
                        type: 'SWIS_SHOW_OVERLAY',
                        tabId: tabId,
                        url: tab.url,
                        method: tab.method,
                        formData: tab.formData
                    }, '*');
                }
            }
        } catch (e) {
        }
    }

    function closeTab(tabId) {
        // 從陣列移除
        window.swisTabs.tabs = window.swisTabs.tabs.filter(function (t) {
            return t.id !== tabId;
        });

        // 從 DOM 移除
        var list = getTabList();
        var item = list ? list.querySelector('[data-id="' + tabId + '"]') : null;
        if (item) item.remove();

        // 發送移除 overlay 指令
        try {
            var mainFrm = window.frames['main_frm'];
            if (mainFrm) {
                mainFrm.postMessage({ type: 'SWIS_REMOVE_OVERLAY', tabId: tabId }, '*');
            }
        } catch (e) { }

        // 如果關閉的是當前標籤，回到首頁
        if (window.swisTabs.activeTabId === tabId) {
            activateTab('home');
        }
    }

    function closeAllTabs() {
        var list = getTabList();
        if (!list) return;

        // 複製一份陣列來迭代，避免在刪除時出問題
        var tabIds = window.swisTabs.tabs.map(function (t) { return t.id; });

        tabIds.forEach(function (tabId) {
            closeTab(tabId);
        });

        // 確保回到首頁
        activateTab('home');
    }

    function reorderTabs(draggedId, targetId) {
        var list = getTabList();
        if (!list) return;

        var draggedItem = list.querySelector('[data-id="' + draggedId + '"]');
        var targetItem = list.querySelector('[data-id="' + targetId + '"]');

        if (!draggedItem || !targetItem) return;

        // 在 DOM 中移動元素
        list.insertBefore(draggedItem, targetItem);

        // 更新 tabs 陣列順序
        var tabs = window.swisTabs.tabs;
        var draggedIndex = tabs.findIndex(function (t) { return t.id === draggedId; });
        var targetIndex = tabs.findIndex(function (t) { return t.id === targetId; });

        if (draggedIndex > -1 && targetIndex > -1) {
            var draggedTab = tabs.splice(draggedIndex, 1)[0];
            // 重新計算插入位置
            var newTargetIndex = tabs.findIndex(function (t) { return t.id === targetId; });
            tabs.splice(newTargetIndex, 0, draggedTab);
        }
    }

    // ==================== main_frm Functions (Overlay Management) ====================

    function getOrCreateOverlayContainer() {
        var container = document.getElementById(OVERLAY_CONTAINER_ID);
        if (!container) {
            container = document.createElement('div');
            container.id = OVERLAY_CONTAINER_ID;
            container.innerHTML = `
                <style>
                    #${OVERLAY_CONTAINER_ID} {
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        z-index: 99999;
                        pointer-events: none;
                    }
                    #${OVERLAY_CONTAINER_ID} .case-overlay {
                        position: absolute;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background: white;
                        opacity: 0;
                        visibility: hidden;
                        transform: translate3d(0, 18px, 0) scale(0.992);
                        transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 300ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 300ms;
                        pointer-events: none;
                        will-change: opacity, transform;
                    }
                    #${OVERLAY_CONTAINER_ID} .case-overlay::before {
                        content: "載入中...";
                        position: absolute;
                        top: 12px;
                        right: 16px;
                        z-index: 2;
                        padding: 4px 10px;
                        border-radius: 4px;
                        background: rgba(255,255,255,0.88);
                        color: #5f4d3f;
                        border: 1px solid rgba(160,140,120,0.35);
                        font-size: 12px;
                        font-family: "NotoSansTC-Regular", "Microsoft JhengHei", "PingFang TC", "Segoe UI", sans-serif;
                        opacity: 1;
                        transition: opacity 120ms ease;
                        pointer-events: none;
                    }
                    #${OVERLAY_CONTAINER_ID} .case-overlay.active {
                        opacity: 1;
                        visibility: visible;
                        transform: translate3d(0, 0, 0) scale(1);
                        transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
                        pointer-events: auto;
                    }
                    #${OVERLAY_CONTAINER_ID} .case-overlay.loaded::before {
                        opacity: 0;
                    }
                    #${OVERLAY_CONTAINER_ID} .case-overlay iframe {
                        width: 100%;
                        height: 100%;
                        border: none;
                        display: block;
                        background: #fff;
                    }
                </style>
            `;
            document.body.appendChild(container);
        }
        return container;
    }

    function activateCaseOverlay(container, overlay) {
        if (!container || !overlay) return;

        container.querySelectorAll('.case-overlay').forEach(function (o) {
            if (o !== overlay) {
                o.classList.remove('active');
            }
        });
        overlay.classList.add('active');
    }

    function armOverlayLoadState(overlay, iframe) {
        iframe.addEventListener('load', function () {
            if (iframe.dataset.swisNavigationStarted !== 'true') return;
            overlay.dataset.swisLoaded = 'true';
            overlay.classList.add('loaded');
        });
    }

    function showOverlay(tabId, url, method, formData) {
        var container = getOrCreateOverlayContainer();

        // 隱藏所有 overlay
        // 查找或建立這個 overlay
        var overlay = container.querySelector('#overlay_' + tabId);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'case-overlay';
            overlay.id = 'overlay_' + tabId;

            if (method === 'POST' && formData) {
                // 用隱藏 iframe + form 提交
                var iframe = document.createElement('iframe');
                iframe.name = 'iframe_' + tabId;
                armOverlayLoadState(overlay, iframe);
                overlay.appendChild(iframe);
                container.appendChild(overlay);
                activateCaseOverlay(container, overlay);

                // 建立 form 並提交到 iframe
                var form = document.createElement('form');
                form.method = 'POST';
                form.action = url;
                form.target = iframe.name;
                form.style.display = 'none';
                for (var key in formData) {
                    if (formData.hasOwnProperty(key)) {
                        var input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = key;
                        input.value = formData[key];
                        form.appendChild(input);
                    }
                }
                document.body.appendChild(form);
                iframe.dataset.swisNavigationStarted = 'true';
                form.submit();
                document.body.removeChild(form);
            } else {
                // GET 請求
                var iframe = document.createElement('iframe');
                armOverlayLoadState(overlay, iframe);
                iframe.dataset.swisNavigationStarted = 'true';
                iframe.src = url;
                overlay.appendChild(iframe);
                container.appendChild(overlay);
                activateCaseOverlay(container, overlay);
            }
            return;
        }

        activateCaseOverlay(container, overlay);
    }

    function hideAllOverlays() {
        var container = document.getElementById(OVERLAY_CONTAINER_ID);
        if (container) {
            container.querySelectorAll('.case-overlay').forEach(function (o) {
                o.classList.remove('active');
            });
        }
    }

    function removeOverlay(tabId) {
        var container = document.getElementById(OVERLAY_CONTAINER_ID);
        if (container) {
            var overlay = container.querySelector('#overlay_' + tabId);
            if (overlay) {
                overlay.remove();
            }
        }
    }

    function setupKeyboardShortcuts() {
        // 在 global 綁定，支援 top 和一般頁面
        document.addEventListener('keydown', function(e) {
            // 目前只支援 Alt 組合鍵
            if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
                const k = e.key.toLowerCase();
                const isDigit = /^[1-9]$/.test(k);
                
                // w=關閉, q=關閉全部, h=回首頁, arrowright=下一個, arrowleft=上一個, 1-9=指定分頁
                if (['a', 'c', 'd', 'x', 'q', 'h'].includes(k) || isDigit) {
                    e.preventDefault();
                    if (isTopPage) {
                        handleShortcutAction(e.key);
                    } else {
                        // 子頁面傳遞給 top
                        window.top.postMessage({ type: 'SWIS_KEYBOARD_SHORTCUT', key: e.key }, '*');
                    }
                }
            }
        });
    }

    function handleShortcutAction(key) {
        if (!window.swisTabs) return;
        
        key = key.toLowerCase();
        
        if (key === 'a') {
            navigateTab(-1);
        } else if (key === 'c') {
            openWelfareDataForActiveTab();
        } else if (key === 'd') {
            navigateTab(1);
        } else if (key === 'x') {
            openHouseholdDataForActiveTab();
        } else if (key === 'q') {
            // Close all
            closeAllTabs();
        } else if (key === 'h') {
            // Home
            activateTab('home');
        } else if (key === 'arrowright') {
            navigateTab(1);
        } else if (key === 'arrowleft') {
            navigateTab(-1);
        } else if (/^[1-9]$/.test(key)) {
            // Jump to tab index (1-based index in the case list)
            jumpToTab(parseInt(key, 10));
        }
    }

    function openWelfareDataForActiveTab() {
        const activeId = window.swisTabs?.activeTabId;
        const activeTab = window.swisTabs?.tabs?.find((tab) => tab.id === activeId);
        const appNo = activeTab?.appNo || activeId?.replace(/^tab_/, '');
        const idNo = swisHouseholdCursorId;
        if (!appNo || appNo === 'home' || !idNo) return;
        const params = new URLSearchParams({ qid_no: idNo, qapp_no: appNo, qsoc_type: 'A111', qcity: '6400000000', qprog_id: 'SA12010' });
        window.open(`${location.origin}/socs/jsp/sy/sy1/sy11010_soc.jsp?${params.toString()}`, `swis_welfare_${idNo}`, 'popup=yes,width=1200,height=820,resizable=yes,scrollbars=yes');
    }

    function openHouseholdDataForActiveTab() {
        const activeId = window.swisTabs?.activeTabId;
        const activeTab = window.swisTabs?.tabs?.find((tab) => tab.id === activeId);
        const appNo = activeTab?.appNo || activeId?.replace(/^tab_/, '');
        if (!appNo || appNo === 'home') return;
        const idNo = swisHouseholdCursorId;
        if (!idNo) return;
        const url = `${location.origin}/socs/jsp/sz/sz3/sz31020_upd.jsp?app_no=${encodeURIComponent(appNo)}&chk_status=0&app_id=${encodeURIComponent(idNo)}&app_tab=a1d&prog_id=SA12010&return_url=&userkind=C&usercity=6400000000&proj_code=SOCS&now_sts=upd&stand_year=115`;
        window.open(url, `swis_household_${idNo}`, 'popup=yes,width=1100,height=760,resizable=yes,scrollbars=yes');
    }
    
    function getOrderedTabIds() {
        var ids = ['home'];
        var list = getTabList();
        
        if (list) {
            var items = list.querySelectorAll('.tab-item:not(.home-item):not(.close-all-item)');
            items.forEach(function(item) {
                var id = item.getAttribute('data-id');
                if (id) ids.push(id);
            });
        } else if (window.swisTabs.tabs.length > 0) {
            // Fallback
            ids = ids.concat(window.swisTabs.tabs.map(function(t){ return t.id; }));
        }
        return ids;
    }
    
    function jumpToTab(index) {
        var ids = getOrderedTabIds();
        // index 1 corresponds to home (index 0)
        // index 2 corresponds to first case (index 1)
        var targetIndex = index - 1;
        
        if (targetIndex >= 0 && targetIndex < ids.length) {
            activateTab(ids[targetIndex]);
        }
    }

    // 1=Next, -1=Prev
    function navigateTab(direction) {
        if (!window.swisTabs) return;
        
        var currentId = window.swisTabs.activeTabId;
        var ids = getOrderedTabIds();
        
        var currentIndex = ids.indexOf(currentId);
        if (currentIndex === -1) currentIndex = 0; // default to home
        
        var newIndex = currentIndex + direction;
        
        // Stop at ends
        if (newIndex >= 0 && newIndex < ids.length) {
            activateTab(ids[newIndex]);
        }
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

})();

