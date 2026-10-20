(function () {
    'use strict';
    if (window.swisReviewBatchVersion===2) return;
    window.swisReviewBatchLoaded = true;
    window.swisReviewBatchVersion=2;
    const SOURCE_KEY='swisReviewBatchSource', PROGRESS_KEY='swisReviewBatchProgress', RESULT_PREFIX='swisReviewResult:';
    const configTools=window.swisReviewConfig;
    const clean=value=>String(value||'').replace(/\s/g,'');
    const storage={
        get:keys=>new Promise((resolve,reject)=>{try{chrome.storage.local.get(keys,r=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve(r));}catch(e){reject(e);}}),
        set:data=>new Promise((resolve,reject)=>{try{chrome.storage.local.set(data,()=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve());}catch(e){reject(e);}}),
        remove:keys=>new Promise((resolve,reject)=>{try{chrome.storage.local.remove(keys,()=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve());}catch(e){reject(e);}})
    };
    function isReport(doc) {
        const year=Number(doc?.querySelector('[name="qstand_year"]')?.value);
        return doc?.location.pathname==='/socs/jsp/sa/sa1/sa1z020_main.jsp' && doc.querySelector('[name="prog_id"]')?.value==='SA1Z020' && Number.isInteger(year) && year>=100 && year<=199;
    }
    function isCaseList(doc) {
        if (doc?.location.pathname!=='/socs/jsp/sa/sa1/sa12010_list.jsp'||doc.querySelector('[name="prog_id"]')?.value!=='SA12010')return false;
        try {
            const parent=doc.defaultView.parent.document;
            return parent.location.pathname==='/socs/jsp/sa/sa1/sa12010_main.jsp' && [...parent.querySelectorAll('table.title1')].some(t=>clean(t.textContent)==='社會救助／低收入戶生活扶助／案件管理／申請資料維護作業(SA12010)');
        } catch {return false;}
    }
    function reportSource(doc) {
        if(!isReport(doc))return null;
        const form=doc.querySelector('form[name="main"]');
        if(!form)return null;
        const params=new URLSearchParams();
        const allowed=new Set(['login_kind','sys_code','qrpt_kind','qpsn_kind','zipno','qcityno','qtownno','qvillageno','qstand_year','qapp_no','qapp_sdate','qapp_edate','qchk_sdate1','qchk_edate1','qchk_sdate2','qchk_edate2','qid_no','qcname','qchk_status','qpsn_kindah','qapp_type2','qtchk_yn','low_type_s','rpt_ctv','out_type','qbatch_sts']);
        for(const [key,value] of new FormData(form))if(allowed.has(key))params.append(key,value);
        params.set('status','rpt');params.set('prog_id','SA1Z020');params.set('out_type','1');
        const year=Number(params.get('qstand_year'));
        return {payload:params.toString(),year,savedAt:Date.now(),label:`${year}年申請名冊 · ${params.get('qapp_sdate')||'不限起日'}～${params.get('qapp_edate')||'不限迄日'}`};
    }
    function parseReportCases(doc, year = 116) {
        const cases=new Set();
        for(const row of doc.querySelectorAll('tr')) {
            const cells=[...row.cells];
            if(cells.length!==8)continue;
            const app=clean(cells[2].textContent);
            if(configTools.matchesYear(app,year))cases.add(app);
        }
        return [...cases];
    }
    function directReportSource(saved, rawOptions) {
        const options=configTools.normalize(rawOptions);
        // 已從列印實測確認的查詢條件；不依賴申請名冊頁面或其表單。
        const defaults=new URLSearchParams('login_kind=C&sys_code=A1&qrpt_kind=A&qpsn_kind=A&zipno=806&qcityno=6400000000&qtownno=6400009000&qvillageno=&qstand_year=116&qapp_no=&qapp_sdate=1160101&qapp_edate=1160202&qchk_sdate1=&qchk_edate1=&qchk_sdate2=&qchk_edate2=&qid_no=&qcname=&qchk_status=&qpsn_kindah=P&qapp_type2=0&qapp_type2=1&qapp_type2=2&qtchk_yn=&low_type_s=1&low_type_s=2&low_type_s=3&low_type_s=4&low_type_s=M&rpt_ctv=T&out_type=1&qbatch_sts=&status=rpt&prog_id=SA1Z020');
        const stored=new URLSearchParams(saved?.payload||'');
        const params=stored.get('prog_id')==='SA1Z020'?stored:defaults;
        params.set('status','rpt');params.set('out_type','1');params.set('qstand_year',String(options.year));params.set('prog_id','SA1Z020');
        params.set('qapp_sdate',options.startDate);params.set('qapp_edate',options.endDate);
        return {payload:params.toString(),year:options.year,savedAt:Date.now(),label:`${options.year}年清查 · ${options.startDate}～${options.endDate}（直接API）`};
    }
    const format=value=>Number.isFinite(value)?value.toLocaleString('zh-TW',{maximumFractionDigits:2}):'待確認';
    function resultText(result) {
        if(window.swisReviewBatchPresentation)return window.swisReviewBatchPresentation.decision(result).text;
        if(result.error)return `初審失敗：${result.error}`;
        return `低收：${result.low?.text||'待確認'} · 中低收：${result.middle?.text||'待確認'}`;
    }
    function validCacheVersion(result){
        if(result?.skipped)return false;
        if(result?.reviewRuleVersion!==(window.swisReviewEngine?.ruleVersion||11))return false;
        if(result?.assetComparisonVersion!==2&&(result?.flags||[]).some(flag=>/不動產(?:新增|減少)/.test(flag)))return false;
        const version=window.swisReviewEngine?.version||2;
        return result?.version===version||(version===2&&result?.version===1&&!(result.flags||[]).some(flag=>flag.startsWith('車輛')));
    }

    async function startController() {
        if(window!==window.top || location.pathname!=='/socs/index.jsp')return;
        let controller=null, starting=false, clearing=false, task=null;
        const owner=crypto.randomUUID();
        function activePage() {
            try {
                const d=window.frames.main_frm.document;
                return isReport(d) || (['/socs/jsp/sa/sa1/sa12010_main.jsp','/socs/jsp/sa/sa1/sa12010_action.jsp'].includes(d.location.pathname) && d.querySelector('[name="prog_id"]')?.value==='SA12010');
            }catch{return false;}
        }
        async function run() {
            if(controller)return;
            const saved=await storage.get([SOURCE_KEY,PROGRESS_KEY,'swisExtensionSettings']);
            if(clearing)return;
            const other=saved[PROGRESS_KEY];
            if(other?.state==='running'&&Date.now()-other.updatedAt<90000)return;
            const options=configTools.normalize(saved.swisExtensionSettings?.batchReview);
            const CONCURRENCY=options.concurrency;
            const source=directReportSource(saved[SOURCE_KEY],options);
            if(!activePage())throw Error('請在申請名冊或SA12010案件管理啟動');
            if(!window.swisReviewEngine)throw Error('初審引擎尚未載入，請重新整理');
            controller=new AbortController();
            const signal=controller.signal;
            const progress={owner,state:'running',phase:'正在取得名冊',total:0,done:0,failed:0,reused:0,skipped:0,startedAt:Date.now(),updatedAt:Date.now(),source:source.label};
            let lastPublished=0;
            const publish=(force=false)=>{const now=Date.now();if(!force&&now-lastPublished<500)return Promise.resolve();lastPublished=now;return storage.set({[PROGRESS_KEY]:{...progress,updatedAt:now}});};
            const active=()=>!signal.aborted&&activePage();
            const heartbeat=setInterval(()=>{if(!active())controller?.abort();else publish().catch(()=>controller?.abort());},15000);
            try {
                await storage.set({[SOURCE_KEY]:source});await publish();
                const response=await fetch('/socs/jsp/ml/rpt/rpt1030_xls.jsp',{method:'POST',body:new URLSearchParams(source.payload),credentials:'include',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});
                if(!response.ok)throw Error(`名冊 HTTP ${response.status}`);
                const report=new DOMParser().parseFromString(await response.text(),'text/html');
                const cases=parseReportCases(report,options.year);
                if(!cases.length)throw Error(`名冊未取得${options.year}年案號，請確認條件與登入狀態`);
                // 先處理目前列表可見案件，讓姓名下方盡快出現結果。
                const visible=[];
                try {for(const frame of window.frames.main_frm.document.querySelectorAll('iframe,frame')){const doc=frame.contentDocument;if(!isCaseList(doc))continue;for(const row of doc.querySelectorAll('tr.title4')){const app=row.textContent.match(/(?:EA|KA)1\d{8}/)?.[0];if(app&&configTools.matchesYear(app,options.year))visible.push(app);}}}catch{}
                const priority=new Map(visible.map((app,index)=>[app,index]));
                cases.sort((a,b)=>(priority.get(a)??Infinity)-(priority.get(b)??Infinity));
                progress.total=cases.length;progress.phase='正在初審';await publish(true);
                const existing=await storage.get(cases.map(app=>RESULT_PREFIX+app));
                const queue=[...cases];
                let fatal=null;
                const scanOne=async appNo=>{
                    if(!active())throw new DOMException('掃描已停止','AbortError');
                    const lease=(await storage.get(PROGRESS_KEY))[PROGRESS_KEY];
                    if(lease?.owner!==owner)throw new DOMException('掃描已交由其他頁面接手','AbortError');
                    const cache=existing[RESULT_PREFIX+appNo];
                    if(cache&&!cache.error&&configTools.compatible(cache,options)&&validCacheVersion(cache)){
                        if(!cache.previousCategory&&window.swisReviewEngine.lookupPreviousCategory){
                            try {const previousCategory=await window.swisReviewEngine.lookupPreviousCategory(appNo,{year:options.year,isActive:active,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});const latest=(await storage.get(RESULT_PREFIX+appNo))[RESULT_PREFIX+appNo];if(latest&&!latest.previousCategory&&configTools.compatible(latest,options))await storage.set({[RESULT_PREFIX+appNo]:{...latest,previousCategory}});}
                            catch(error){if(signal.aborted)throw error;}
                        }
                        progress.reused++;progress.done++;await publish();return;
                    }
                    let result;const startedAt=Date.now();
                    try {
                        result=await window.swisReviewEngine.scanCase(appNo,{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),isActive:active,year:options.year,standard:options.standardsByYear[options.year]||null});
                    }catch(error){
                        if(signal.aborted||!activePage())throw error;
                        progress.failed++;
                        result={appNo,error:error.message,checkedAt:Date.now(),version:window.swisReviewEngine.version,reviewRuleVersion:window.swisReviewEngine.ruleVersion||11};
                    }
                    if(!active())throw new DOMException('掃描已停止','AbortError');
                    if(result.skipped){progress.skipped++;progress.done++;progress.currentApp=appNo;await publish();return;}
                    result={...result,year:options.year,policyKey:configTools.policyKey(options)};
                    const latest=(await storage.get(RESULT_PREFIX+appNo))[RESULT_PREFIX+appNo];
                    if(latest?.checkedAt>startedAt&&configTools.compatible(latest,options)&&validCacheVersion(latest))result=latest;
                    progress.done++;progress.currentApp=appNo;
                    await storage.set({[RESULT_PREFIX+appNo]:result});await publish();
                    // 登入失效時停止整批，不繼續送出請求。
                    if(result.error&&/登入|權限|HTTP 40[13]/.test(result.error))throw Error(result.error);
                };
                // 多案並行；任一案停止或登入失效，其餘案件立即中止。
                const worker=async()=>{
                    while(queue.length&&!fatal){
                        try{await scanOne(queue.shift());}
                        catch(error){fatal=fatal||error;controller.abort();}
                    }
                };
                await Promise.all(Array.from({length:Math.min(CONCURRENCY,cases.length)},worker));
                if(fatal)throw fatal;
                progress.state='complete';progress.phase='掃描完成';
            }catch(error){progress.state=error.name==='AbortError'?'stopped':'error';progress.phase=error.name==='AbortError'?'已停止，可再次開始接續':error.message;}
            finally {clearInterval(heartbeat);controller=null;await publish(true);}
        }
        window.addEventListener('message',event=>{
            if(event.origin!==location.origin)return;
            if(event.source!==window.frames.main_frm && event.source!==window.frames.menu_frm)return;
            if(event.data?.type==='SWIS_BATCH_REVIEW_START_V2'&&!starting&&!controller&&!clearing){starting=true;task=run().catch(error=>storage.set({[PROGRESS_KEY]:{state:'error',phase:error.message,updatedAt:Date.now()}}).catch(()=>{})).finally(()=>{starting=false;});}
            if(['SWIS_BATCH_REVIEW_STOP','SWIS_BATCH_REVIEW_STOP_V2'].includes(event.data?.type))controller?.abort();
            if(event.data?.type==='SWIS_BATCH_REVIEW_CLEAR'&&!clearing){
                clearing=true;controller?.abort();
                Promise.resolve(task).then(async()=>{
                    const all=await storage.get(null);
                    const keys=Object.keys(all).filter(key=>key.startsWith(RESULT_PREFIX)||key===PROGRESS_KEY);
                    if(keys.length)await storage.remove(keys);
                    await storage.set({[PROGRESS_KEY]:{state:'idle',phase:'已清除初審暫存',done:0,total:0,updatedAt:Date.now()}});
                }).catch(error=>storage.set({[PROGRESS_KEY]:{state:'error',phase:`清除失敗：${error.message}`,updatedAt:Date.now()}})).finally(()=>{clearing=false;});
            }
        });
        window.addEventListener('pagehide',()=>controller?.abort());
    }

    function startListRenderer() {
        if(!isCaseList(document))return;
        const results=new Map(),categoryTried=new Set();let timer, loading=false, reloadPending=false, options=configTools.normalize();
        const categoryController=new AbortController();
        window.addEventListener('pagehide',()=>categoryController.abort());
        async function backfillCategories(apps) {
            const engine=window.swisReviewEngine;
            if(!engine?.lookupPreviousCategory)return;
            const year=options.year;
            const active=()=>!categoryController.signal.aborted&&isCaseList(document)&&options.showResults&&options.year===year;
            const queue=apps.filter(app=>results.get(app)&&!results.get(app).previousCategory&&!categoryTried.has(app));
            const updates={};
            queue.forEach(app=>categoryTried.add(app));
            async function worker(){while(queue.length&&active()){
                const app=queue.shift();
                try {
                    const previousCategory=await engine.lookupPreviousCategory(app,{year,isActive:active,signal:AbortSignal.any([categoryController.signal,AbortSignal.timeout(15000)])});
                    if(!active())return;
                    const key=RESULT_PREFIX+app,latest=(await storage.get(key))[key];
                    if(latest&&!latest.previousCategory&&configTools.compatible(latest,options)){
                        updates[key]={...latest,previousCategory};
                    }
                }catch{/* 保留原試算，重新載入列表或下一輪掃描時重試去年類別。 */}
            }}
            await Promise.all(Array.from({length:Math.min(5,queue.length)},worker));
            if(!active())return;
            // 整頁補齊後一次更新，避免每完成一案就重排列表。
            const keys=Object.keys(updates);
            if(keys.length){
                const latest=await storage.get(keys),merged={};
                for(const key of keys)if(latest[key]&&configTools.compatible(latest[key],options)){
                    merged[key]={...latest[key],previousCategory:latest[key].previousCategory||updates[key].previousCategory};
                    results.set(key.slice(RESULT_PREFIX.length),merged[key]);
                }
                if(Object.keys(merged).length)await storage.set(merged);
            }
        }
        function rows() {
            const header=document.querySelector('tr.title1');
            if(!header)return [];
            const labels=[...header.cells].map(c=>clean(c.textContent));
            const nameIndex=labels.findIndex(t=>t==='戶長姓名');
            const appIndex=labels.findIndex(t=>/申請案號|案號/.test(t));
            const statusIndex=labels.findIndex(t=>t.includes('案件狀態'));
            if(nameIndex<0||appIndex<0)return [];
            return [...document.querySelectorAll('tr.title4')].flatMap(row=>{
                const app=row.cells[appIndex]?.textContent.match(/(?:EA|KA)1\d{8}/)?.[0];
                const transferred=statusIndex>=0&&/財稅已轉入/.test(clean(row.cells[statusIndex]?.textContent));
                return app&&configTools.matchesYear(app,options.year)&&row.cells[nameIndex]?[{row,cell:row.cells[nameIndex],app,transferred}]:[];
            });
        }
        function paint() {
            if(!isCaseList(document))return;
            window.swisReviewBatchActiveYear=options.year;
            for(const box of document.querySelectorAll('[data-swis-batch-result]'))if(!options.showResults||!configTools.matchesYear(box.dataset.swisBatchResult,options.year))box.remove();
            if(!options.showResults)return;
            for(const {cell,app,transferred} of rows()) {
                if(!transferred){cell.querySelector('[data-swis-batch-result]')?.remove();continue;}
                const data=results.get(app);
                if(!data||!validCacheVersion(data)||!configTools.compatible(data,options)){cell.querySelector('[data-swis-batch-result]')?.remove();continue;}
                const stamp=JSON.stringify(data);
                let box=cell.querySelector('[data-swis-batch-result]');
                if(box?.dataset.stamp===stamp)continue;
                if(!box){box=document.createElement('details');box.dataset.swisBatchResult=app;box.className='swis-batch-result';box.addEventListener('click',e=>e.stopPropagation());box.addEventListener('dblclick',e=>e.stopPropagation());cell.appendChild(box);}
                box.dataset.stamp=stamp;box.replaceChildren();
                const summary=document.createElement('summary');
                if(window.swisReviewBatchPresentation?.renderSummary)window.swisReviewBatchPresentation.renderSummary(summary,data);
                else summary.textContent=resultText(data);
                box.appendChild(summary);
                box.dataset.state=window.swisReviewBatchPresentation?window.swisReviewBatchPresentation.decision(data).state:data.error?'error':data.low?.state==='pending'||data.middle?.state==='pending'?'pending':data.low?.state==='exceeded'&&data.middle?.state==='exceeded'?'exceeded':'matched';
                if(!data.error){const values=document.createElement('div');values.textContent=`月所得 ${format(data.values?.income)}／人 · 動產 ${format(data.values?.movable)}／人 · 不動產 ${format(data.values?.immovable)}／戶`;box.appendChild(values);}
                if(data.flags?.length){const flags=document.createElement('div');flags.textContent=data.flags.join('；');box.appendChild(flags);}
                const time=document.createElement('small');time.textContent=`本頁試算 · ${new Date(data.checkedAt).toLocaleString('zh-TW')}`;box.appendChild(time);
            }
        }
        async function load() {
            if(loading){reloadPending=true;return;}
            loading=true;
            try {
            const settings=await storage.get('swisExtensionSettings');
            options=configTools.normalize(settings.swisExtensionSettings?.batchReview);
            const apps=[...new Set(rows().filter(r=>r.transferred).map(r=>r.app))];
            const saved=await storage.get(apps.map(app=>RESULT_PREFIX+app));
            for(const app of apps){if(saved[RESULT_PREFIX+app])results.set(app,saved[RESULT_PREFIX+app]);else results.delete(app);}
            if(options.showResults)await backfillCategories(apps);
            } finally {
            loading=false;
            paint();
            if(reloadPending){reloadPending=false;load().catch(()=>{});}
            }
        }
        chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.swisExtensionSettings){options=configTools.normalize(changes.swisExtensionSettings.newValue?.batchReview);load().catch(()=>{});}for(const [key,change] of Object.entries(changes))if(key.startsWith(RESULT_PREFIX))results.set(key.slice(RESULT_PREFIX.length),change.newValue);if(!loading)paint();});
        new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('[data-swis-batch-result]')||[...r.addedNodes].every(n=>n.nodeType!==1||n.matches?.('[data-swis-batch-result]'))))return;clearTimeout(timer);timer=setTimeout(()=>load().catch(()=>{}),200);}).observe(document.body,{childList:true,subtree:true});
        load().catch(()=>{});
    }

    // 供本機測試驗證純函式；不會自動發出任何查詢。
    window.swisReviewBatchHelpers=Object.freeze({parseReportCases,reportSource,directReportSource,isCaseList,resultText});
    startController().catch(()=>{});
    startListRenderer();
})();



