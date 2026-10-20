(function () {
    if (window.swisExtensionSettingsMenuV5Loaded) return;
    window.swisExtensionSettingsMenuV5Loaded = true;
    const configTools=window.swisReviewConfig;
    const SETTINGS_KEY = 'swisExtensionSettings';
    const DEFAULT_SETTINGS = Object.freeze({
        householdMemoHoverEnabled: false,
        householdMemoHoverDelayMs: 300,
        batchReview: configTools.normalize(),
        settingsVersion: 3
    });

    function applySettings(settings) {
        window.swisExtensionSettings = {
            ...DEFAULT_SETTINGS,
            ...(settings || {}),
            batchReview: configTools.normalize(settings?.batchReview)
        };
        window.dispatchEvent(new CustomEvent('swis-extension-settings-changed', {
            detail: window.swisExtensionSettings
        }));
    }

    try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue);
        });
    } catch (error) {}

    function loadSettings() {
        try {
            chrome.storage.local.get(SETTINGS_KEY, (result) => {
                const stored = result?.[SETTINGS_KEY] || {};
                if (stored.settingsVersion !== DEFAULT_SETTINGS.settingsVersion) {
                    const migrated = { ...stored, householdMemoHoverEnabled: stored.householdMemoHoverEnabled??false, batchReview:configTools.normalize(stored.batchReview), settingsVersion: DEFAULT_SETTINGS.settingsVersion };
                    chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
                    applySettings(migrated);
                    return;
                }
                applySettings(stored);
            });
        } catch (error) {
            applySettings();
        }
    }

    function isMenuFrame() {
        return window.name === 'menu_frm' && /\/socs\/menu\.jsp$/i.test(location.pathname);
    }

    function getSettingsDialogDocument() {
        try {
            const mainFrame = Array.from(window.top.frames).find((frame) => frame.name === 'main_frm');
            if (mainFrame?.document?.body) return mainFrame.document;
        } catch (error) {}
        return document;
    }

    function openSettingsDialog(dialogDocument = getSettingsDialogDocument()) {
        if (!dialogDocument?.body) return;
        const existing=dialogDocument.getElementById('swis-extension-settings-dialog');
        if (existing?.querySelector('[data-batch-config]')) return;
        existing?.remove();

        const settings = { ...DEFAULT_SETTINGS, ...(window.swisExtensionSettings || {}) };
        const batch=configTools.normalize(settings.batchReview);
        const overlay = dialogDocument.createElement('div');
        overlay.id = 'swis-extension-settings-dialog';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'swis-extension-settings-title');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483647', 'display:flex',
            'align-items:center', 'justify-content:center', 'padding:20px',
            'background:rgba(24,38,54,.35)', 'box-sizing:border-box'
        ].join(';');

        const panel = dialogDocument.createElement('section');
        panel.style.cssText = [
            'width:min(540px,100%)', 'max-height:calc(100vh - 40px)', 'box-sizing:border-box', 'overflow:auto',
            'border:1px solid #8398ae', 'border-radius:8px', 'background:#f7fafc',
            'box-shadow:0 18px 50px rgba(18,35,52,.28)',
            'font-family:"NotoSansTC-Regular","Microsoft JhengHei",sans-serif', 'color:#243447'
        ].join(';');
        panel.innerHTML = `
            <header style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#2c4d6e;color:#fff;">
                <div>
                    <div id="swis-extension-settings-title" style="font-size:16px;font-weight:700;letter-spacing:.04em;">插件設定</div>
                    <div style="margin-top:2px;font-size:12px;color:#dce9f5;">僅儲存於此瀏覽器</div>
                </div>
                <button type="button" data-action="close" aria-label="關閉插件設定" style="width:30px;height:30px;border:0;border-radius:5px;background:transparent;color:#fff;font-size:23px;line-height:1;cursor:pointer;">×</button>
            </header>
            <div style="padding:16px 18px 6px;">
                <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#526577;">人口顯示與年度清查初審</p>
                <label style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid #d8e1e8;cursor:pointer;">
                    <input name="householdMemoHoverEnabled" type="checkbox" ${settings.householdMemoHoverEnabled ? 'checked' : ''} style="width:16px;height:16px;margin:2px 0 0;accent-color:#2c6aa0;">
                    <span><strong style="display:block;font-size:14px;color:#243447;">人口懸浮資訊</strong><span style="display:block;margin-top:3px;font-size:12px;line-height:1.55;color:#66798b;">滑鼠停留在人口列時顯示備註、工作能力、就學期間與補助資料。</span></span>
                </label>
                <div style="padding:12px 0;border-top:1px solid #d8e1e8;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                        <span><strong style="display:block;font-size:14px;color:#243447;">懸停顯示延遲</strong><span style="display:block;margin-top:3px;font-size:12px;color:#66798b;">滑鼠停留多久後顯示資料</span></span>
                        <output data-delay-output style="min-width:42px;text-align:right;font-size:13px;font-weight:700;color:#2c6aa0;"></output>
                    </div>
                    <input name="householdMemoHoverDelayMs" type="range" min="100" max="2000" step="100" value="${Math.max(100, Math.min(2000, Number(settings.householdMemoHoverDelayMs) || DEFAULT_SETTINGS.householdMemoHoverDelayMs))}" style="display:block;width:100%;margin:11px 0 0;accent-color:#2c6aa0;cursor:pointer;">
                </div>
                <section style="padding:12px 0;border-top:1px solid #d8e1e8;">
                    <strong style="font-size:14px;">年度清查初審</strong>
                    <fieldset data-batch-config style="border:0;padding:0;margin:8px 0;font-size:13px;">
                        <legend style="position:absolute;width:1px;height:1px;overflow:hidden;">掃描設定</legend>
                        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 12px;">
                            <label>清查年度<input name="batchYear" type="number" inputmode="numeric" min="100" max="199" step="1" value="${batch.year}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;"></label>
                            <label>同時掃描件數<input name="batchConcurrency" type="number" min="1" max="10" value="${batch.concurrency}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;"></label>
                            <label>開始日期（民國7碼）<input name="batchStartDate" inputmode="numeric" maxlength="7" value="${batch.startDate}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;"></label>
                            <label>結束日期（民國7碼）<input name="batchEndDate" inputmode="numeric" maxlength="7" value="${batch.endDate}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;"></label>
                            <label style="align-self:center;"><input name="batchShowResults" type="checkbox" ${batch.showResults?'checked':''}> 姓名下方顯示初審結果</label>
                        </div>
                        <div style="margin-top:6px;color:#526577;font-size:12px;">更換年度自動帶入該年01/01～01/02。其他日期可自行調整。</div>
                        <details style="margin-top:8px;"><summary style="cursor:pointer;">初審門檻（元）</summary>
                            <table style="width:100%;font-size:12px;text-align:left;border-collapse:collapse;margin-top:5px;"><thead><tr><th>項目</th><th>低收</th><th>中低收</th></tr></thead><tbody data-batch-standards></tbody></table>
                            <div data-batch-standard-note style="margin-top:4px;font-size:12px;color:#526577;"></div>
                        </details>
                    </fieldset>
                    <div data-batch-source style="margin:5px 0;color:#526577;font-size:12px;line-height:1.5;"></div>
                    <div data-settings-error role="alert" style="color:#a02424;font-size:12px;margin:5px 0;"></div>
                    <div style="display:flex;gap:8px;margin:8px 0;">
                        <button type="button" data-batch-start class="button1">掃描清查案</button>
                        <button type="button" data-batch-stop class="button1" disabled>停止</button>
                        <button type="button" data-batch-clear class="button1">清除暫存</button>
                    </div>
                    <progress data-batch-progress max="1" value="0" aria-label="清查初審進度" style="width:100%;height:10px;"></progress>
                    <div data-batch-status role="status" aria-live="polite" style="margin-top:5px;font-size:12px;line-height:1.5;">尚未掃描</div>
                    <div style="margin-top:5px;font-size:12px;line-height:1.5;color:#526577;">結果永久沿用。清除暫存後重新讀取，保留設定；規則或門檻變更時重新試算。僅本頁試算，不寫入財稅。</div>
                </section>
            </div>
            <footer style="display:flex;justify-content:flex-end;gap:8px;padding:14px 18px 16px;border-top:1px solid #d8e1e8;">
                <button type="button" data-action="close" style="min-width:76px;padding:7px 12px;border:1px solid #9daebb;border-radius:4px;background:#fff;color:#405567;font-size:13px;cursor:pointer;">取消</button>
                <button type="button" data-action="save" style="min-width:92px;padding:7px 12px;border:1px solid #1d5d91;border-radius:4px;background:#2c6aa0;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">儲存設定</button>
            </footer>
        `;
        overlay.appendChild(panel);
        dialogDocument.body.appendChild(overlay);

        const yearInput=panel.querySelector('[name="batchYear"]');
        const standards=structuredClone(batch.standardsByYear);
        let shownYear=batch.year;
        const readStandard=()=>{
            const inputs=[...panel.querySelectorAll('[data-standard-kind]')];
            if(inputs.every(input=>input.value===''))return null;
            const result={low:{},middle:{}};
            for(const input of inputs)result[input.dataset.standardKind][input.dataset.standardKey]=input.value===''?NaN:Number(input.value);
            return result;
        };
        const updateSource=()=>{panel.querySelector('[data-batch-source]').textContent=`${yearInput.value}年清查 · ${panel.querySelector('[name="batchStartDate"]').value}～${panel.querySelector('[name="batchEndDate"]').value}（直接API）`;};
        const renderStandards=()=>{
            const value=standards[shownYear];
            const body=panel.querySelector('[data-batch-standards]');body.replaceChildren();
            for(const [key,label] of [['income','每人月所得'],['movable','每人動產'],['immovable','全家不動產']]){
                const tr=dialogDocument.createElement('tr'),th=dialogDocument.createElement('th');th.textContent=label;th.scope='row';tr.appendChild(th);
                for(const kind of ['low','middle']){const td=dialogDocument.createElement('td'),input=dialogDocument.createElement('input');input.type='number';input.min='0';input.step='1';input.value=value?.[kind]?.[key]??'';input.dataset.standardKind=kind;input.dataset.standardKey=key;input.setAttribute('aria-label',`${shownYear}年${kind==='low'?'低收':'中低收'}${label}`);input.style.cssText='width:100%;max-width:130px;box-sizing:border-box;';td.appendChild(input);tr.appendChild(td);}
                body.appendChild(tr);
            }
            panel.querySelector('[data-batch-standard-note]').textContent=value?'各年度分別儲存；請依該年度公告設定。':'此年度尚無門檻；可先掃描金額，判定會提示年度門檻待確認。';
        };
        const changeYear=()=>{
            const nextYear=Number(yearInput.value);
            if(!Number.isInteger(nextYear)||nextYear<100||nextYear>199||nextYear===shownYear)return;
            standards[shownYear]=readStandard();shownYear=Number(yearInput.value);
            const dates=configTools.dates(shownYear);
            panel.querySelector('[name="batchStartDate"]').value=dates.startDate;
            panel.querySelector('[name="batchEndDate"]').value=dates.endDate;
            renderStandards();updateSource();
        };
        yearInput.addEventListener('input',changeYear);
        yearInput.addEventListener('change',changeYear);
        for(const name of ['batchStartDate','batchEndDate'])panel.querySelector(`[name="${name}"]`).addEventListener('input',updateSource);
        renderStandards();updateSource();

        function saveSettings(){
            standards[shownYear]=readStandard();
            const raw={...batch,year:Number(yearInput.value),startDate:panel.querySelector('[name="batchStartDate"]').value.trim(),endDate:panel.querySelector('[name="batchEndDate"]').value.trim(),concurrency:Number(panel.querySelector('[name="batchConcurrency"]').value),showResults:panel.querySelector('[name="batchShowResults"]').checked,standardsByYear:standards};
            const errors=configTools.validate(raw),errorNode=panel.querySelector('[data-settings-error]');
            errorNode.textContent=errors.join('；');
            if(errors.length)return Promise.reject(Error(errors[0]));
            return new Promise((resolve,reject)=>{
                try{chrome.storage.local.get(SETTINGS_KEY,result=>{
                    if(chrome.runtime.lastError){reject(Error(chrome.runtime.lastError.message));return;}
                    const latest=result?.[SETTINGS_KEY]||{};
                    const nextSettings={...latest,householdMemoHoverEnabled:panel.querySelector('[name="householdMemoHoverEnabled"]').checked,householdMemoHoverDelayMs:Number(panel.querySelector('[name="householdMemoHoverDelayMs"]').value),batchReview:configTools.normalize({...latest.batchReview,...raw,standardsByYear:{...latest.batchReview?.standardsByYear,...standards}}),settingsVersion:DEFAULT_SETTINGS.settingsVersion};
                    chrome.storage.local.set({[SETTINGS_KEY]:nextSettings},()=>{
                        if(chrome.runtime.lastError){reject(Error(chrome.runtime.lastError.message));return;}
                        applySettings(nextSettings);
                        Array.from(window.top.frames).forEach(frame=>frame.postMessage({type:'SWIS_EXTENSION_SETTINGS_UPDATED',settings:nextSettings},location.origin));
                        resolve(nextSettings);
                    });
                });}catch(error){reject(error);}
            }).catch(error=>{errorNode.textContent=error.message;throw error;});
        }

        const delayInput = panel.querySelector('[name="householdMemoHoverDelayMs"]');
        const delayOutput = panel.querySelector('[data-delay-output]');
        const updateDelayOutput = () => { delayOutput.textContent = `${(Number(delayInput.value) / 1000).toFixed(1)} 秒`; };
        delayInput.addEventListener('input', updateDelayOutput);
        updateDelayOutput();

        const refreshBatch = () => {
            try { chrome.storage.local.get(['swisReviewBatchSource','swisReviewBatchProgress'], result => {
                if (!overlay.isConnected) return;
                const status=result?.swisReviewBatchProgress;
                const running=status?.state==='running'&&Date.now()-status.updatedAt<90000;
                panel.querySelector('[data-batch-config]').disabled=running;
                panel.querySelector('[data-batch-start]').disabled=running;
                panel.querySelector('[data-batch-stop]').disabled=!running;
                panel.querySelector('[data-batch-clear]').disabled=running;
                const bar=panel.querySelector('[data-batch-progress]');bar.max=status?.total||1;bar.value=status?.done||0;
                const interrupted=status?.state==='running'&&!running;
                panel.querySelector('[data-batch-status]').textContent=status?`${interrupted?'掃描已中斷，可再次開始接續':status.phase} · ${status.done||0}／${status.total||0} 件${status.failed?` · 失敗 ${status.failed}`:''}${status.reused?` · 沿用 ${status.reused}`:''}${status.skipped?` · 非財稅已轉入略過 ${status.skipped}`:''}`:'尚未掃描';
            }); } catch {}
        };
        const batchTimer=setInterval(refreshBatch,1000);
        refreshBatch();
        const batchAction=type=>window.top.postMessage({type},location.origin);
        panel.querySelector('[data-batch-start]').addEventListener('click',()=>{saveSettings().then(()=>{batchAction('SWIS_BATCH_REVIEW_START_V2');panel.querySelector('[data-batch-status]').textContent='正在啟動掃描…';}).catch(()=>{});});
        panel.querySelector('[data-batch-stop]').addEventListener('click',()=>batchAction('SWIS_BATCH_REVIEW_STOP'));
        panel.querySelector('[data-batch-clear]').addEventListener('click',()=>{batchAction('SWIS_BATCH_REVIEW_CLEAR');panel.querySelector('[data-batch-status]').textContent='正在清除初審暫存…';});
        const close = () => { clearInterval(batchTimer);dialogDocument.removeEventListener('keydown',onKeyDown,true);overlay.remove(); };
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay || event.target.closest('[data-action="close"]')) close();
        });
        panel.querySelector('[data-action="save"]').addEventListener('click', () => {
            saveSettings().then(close).catch(()=>{});
        });
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                close();
                dialogDocument.removeEventListener('keydown', onKeyDown, true);
            }
        };
        dialogDocument.addEventListener('keydown', onKeyDown, true);
        panel.querySelector('[data-action="close"]').focus();
    }

    function injectSettingsMenuItem() {
        if (!isMenuFrame()) return;
        const existing=document.getElementById('swis-extension-settings-menu-item');
        if(existing?.dataset.version==='5')return;
        existing?.remove();
        const systemManagementLink = Array.from(document.querySelectorAll('a')).find((link) => {
            return link.textContent.trim() === '系統管理' && (link.getAttribute('onclick') || '').includes('clickOnFolder');
        });
        const systemManagementTable = systemManagementLink?.closest('table');
        const referenceTable = systemManagementTable?.nextElementSibling;
        if (!referenceTable) return;

        const itemTable = referenceTable.cloneNode(true);
        itemTable.id = 'swis-extension-settings-menu-item';
        itemTable.dataset.version = '5';
        itemTable.style.cursor = 'pointer';
        const cells = itemTable.querySelectorAll('td');
        if (cells.length < 2) return;
        cells[0].innerHTML = '<img src="img/ftv2vertline.gif" width="16" height="22"><img src="img/ftv2mnode.gif" width="16" height="22" border="0"><img src="img/ftv2doc.gif" border="0">';
        const link = cells[cells.length - 1].querySelector('a');
        if (!link) return;
        link.textContent = '插件設定';
        link.setAttribute('href', 'javascript:void(0)');
        link.removeAttribute('target');
        link.removeAttribute('onclick');
        link.title = '開啟插件設定';
        const openFromMenu = (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            try {
                const mainFrame = window.top.frames['main_frm'];
                if (mainFrame) {
                    mainFrame.postMessage({ type: 'SWIS_OPEN_EXTENSION_SETTINGS_V4' }, location.origin);
                    return;
                }
            } catch (error) {}
            openSettingsDialog(document);
        };
        link.addEventListener('click', openFromMenu, true);
        link.onclick = openFromMenu;
        itemTable.addEventListener('click', openFromMenu, true);
        systemManagementTable.parentNode.insertBefore(itemTable, referenceTable);

        const folderIcon = systemManagementTable.querySelector('[id^="folderIcon"]');
        const syncVisibility = () => {
            itemTable.style.display = folderIcon?.src.includes('folderopen') ? 'block' : 'none';
        };
        if (folderIcon) {
            new MutationObserver(syncVisibility).observe(folderIcon, {
                attributes: true,
                attributeFilter: ['src']
            });
        }
        syncVisibility();
    }

    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.origin !== location.origin) return;
        if (event.data.type === 'SWIS_OPEN_EXTENSION_SETTINGS_V4') { event.stopImmediatePropagation();openSettingsDialog(document); }
        if (event.data.type === 'SWIS_EXTENSION_SETTINGS_UPDATED') applySettings(event.data.settings);
    }, true);

    loadSettings();
    injectSettingsMenuItem();
})();
