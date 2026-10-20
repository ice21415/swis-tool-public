(function () {
    'use strict';
    // 共用引擎可供使用者啟動的批次工作使用；案件面板仍在文末獨立檢查範圍。
    if (!['/socs/index.jsp','/socs/jsp/sa/sa1/sa12010_main.jsp','/socs/jsp/sa/sa1/sa12010_list.jsp','/socs/jsp/sa/sa1/sa12010_action.jsp','/socs/jsp/sa/sa1/sa1z020_main.jsp'].includes(location.pathname)) return;
    try { if (window.top.location.pathname !== '/socs/index.jsp') return; }
    catch (error) { return; }

    const DATA_TYPES = [
        { key: 'income', label: '所得', type: '1' },
        { key: 'movable', label: '動產', type: '2' },
        { key: 'immovable', label: '不動產', type: '3' },
        { key: 'summary', label: '財稅總計', type: '4' },
        { key: 'investment', label: '投資資料', type: '12' },
        { key: 'external', label: '外單位參考收入', type: '13' }
    ];
    const REVIEW_RULE_VERSION=11;
    const numberValue = (value) => {
        const text = String(value ?? '').trim().replace(/,/g, '');
        if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
        return Number(text);
    };
    const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    function extensionContextValid() {
        try { return !!(chrome?.runtime?.id && chrome.storage?.local); }
        catch (error) { return false; }
    }

    function getPanelDocument() {
        return document;
    }

    function isActiveReviewFrame() {
        try {
            const main = window.top.frames.main_frm;
            let frame = window;
            for (let depth = 0; depth < 6 && frame !== window.top; depth++) {
                const overlay = frame.frameElement?.closest('.case-overlay');
                if (overlay && !overlay.classList.contains('active')) return false;
                if (frame === main) return true;
                frame = frame.parent;
            }
        } catch (error) { /* frame 正在切換 */ }
        return false;
    }

    function findActiveCase(host = getPanelDocument(), depth = 0) {
        if (!isActiveReviewFrame()) return null;
        if (!host || depth > 5) return null;
        // 多案件模式只讀 active overlay，絕不掃到背景案件或查詢結果列表。
        const overlay = host.querySelector('.case-overlay.active');
        if (overlay) {
            try { return findActiveCase(overlay.querySelector('iframe')?.contentDocument, depth + 1); }
            catch (error) { return null; }
        }
        if (isEligibleReviewDocument(host, selectedReviewYear())&&host.querySelector('[name="case_status"]')?.value==='3') return { appNo: host.querySelector('input[name="app_no"]').value.trim(), doc: host };
        return null;
    }
    // 最高優先級：路徑、作業代碼、完整功能路徑、設定年度案號必須同時符合。
    function isEligibleReviewDocument(doc, year = 116) {
        if (doc?.location?.pathname !== '/socs/jsp/sa/sa1/sa12010_action.jsp') return false;
        if (doc.querySelector('input[name="prog_id"]')?.value.trim().toUpperCase() !== 'SA12010') return false;
        const breadcrumb = [...doc.querySelectorAll('table.title1')].map(e => e.textContent).join('').replace(/\s/g, '');
        if (breadcrumb !== '社會救助／低收入戶生活扶助／案件管理／申請資料維護作業(SA12010)') return false;
        const appNo=doc.querySelector('input[name="app_no"]')?.value.trim() || '';
        return /^(?:EA|KA)1\d{8}$/.test(appNo) && Number(appNo.slice(2,6))===1000+Number(year);
    }
    let activeRequest = null;
    let requestVersion = 0;
    let lastCaseDocument = null;
    let lastAppNo = '';
    let mountedPanel = null;
    const reviewCache = new Map();
    let nextInvestmentRefresh = 0;

    function readReviewPopulation(doc) {
        const clean = text => String(text || '').replace(/\s/g, '').normalize('NFKC').toUpperCase();
        const header = [...doc.querySelectorAll('tr')].find(row => [...row.cells].some(cell => clean(cell.textContent) === '不計人口') && [...row.cells].some(cell => clean(cell.textContent) === '序號'));
        if (!header) return { count: null, total: null, excluded: null, found: false };
        const labels = [...header.cells].map(c => clean(c.textContent));
        const excludedIndex = labels.indexOf('不計人口');
        const sequenceIndex = labels.indexOf('序號');
        const rows = [...header.closest('table').querySelectorAll('tr')].filter(row => row.cells.length === header.cells.length && /^\d+$/.test(clean(row.cells[sequenceIndex]?.textContent)));
        if (!rows.length) return { count: null, total: 0, excluded: 0, found: false };
        const excluded = rows.filter(row => clean(row.cells[excludedIndex].textContent) === 'V').length;
        const idIndex = labels.findIndex(label => /身[分份]證[字號]/.test(label));
        const relationIndex=labels.findIndex(label=>label==='稱謂');
        const nonRegisteredIndex=labels.findIndex(label=>label==='非列冊');
        const memberDetails={},members = {};
        if (idIndex >= 0) for (const row of rows) {
            const id = clean(row.cells[idIndex].textContent).match(/[A-Z][A-Z0-9]\d{8}/)?.[0];
            if (id) {
                members[id] = clean(row.cells[excludedIndex].textContent) !== 'V';
                memberDetails[id]={relationship:relationIndex>=0?row.cells[relationIndex].textContent.trim():'',registration:!members[id]?'不計':nonRegisteredIndex<0?'':clean(row.cells[nonRegisteredIndex].textContent)==='V'?'應計':'列冊'};
            }
        }
        return { count: rows.length - excluded, total: rows.length, excluded, found: true, members, memberDetails };
    }

    function classifyExternalRecords(details, members = {}) {
        const rank = counted => counted === true ? 0 : counted === false ? 1 : 2;
        return details.map((record, index) => {
            const label = String(record.label || '').normalize('NFKC').replace(/\s/g, '');
            const pension = /勞(?:工保險|保).*老年.*年金/.test(label);
            // 勞保老年一次給付不論金額一律列動產。
            const movableBenefit=/^(?:國民年金生育(?:補助|給付)|軍人(?:補償金|補助金|一次退伍金)|一次退伍金)/.test(label)||/勞(?:工保險|保).*老年.*一次/.test(label);
            const grant = record.grantAmount ?? record.amount;
            const category = pension ? 'income' : movableBenefit ? 'movable' : !Number.isFinite(grant) || grant < 0 || grant === 40000 ? null : grant > 40000 ? 'movable' : 'income';
            return { ...record, index, category,
                counted: record.previousExclusion || record.unconvertible ? false : Object.prototype.hasOwnProperty.call(members, record.idNo) ? members[record.idNo] : null };
        }).sort((a,b) => rank(a.counted) - rank(b.counted) || a.index - b.index);
    }

    function sortReviewRecords(records) {
        const rank = counted => counted === true ? 0 : counted === false ? 1 : 2;
        return records.map((r,index) => ({ ...r, index })).sort((a,b) => rank(a.counted)-rank(b.counted) || a.index-b.index);
    }

    function findReviewBenefitMatches(record,assets) {
        const normalize=value=>String(value||'').normalize('NFKC').replace(/\s/g,'');
        const id=normalize(record.idNo).toUpperCase(),amount=record.grantAmount??record.amount;
        if(!id||!Number.isFinite(amount))return [];
        // 身分證＋備註中的原核付金額是主鍵，不能拿已扣抵後的財產金額比對。
        return (assets||[]).filter(asset=>{
            if(normalize(asset.idNo).toUpperCase()!==id||!Number.isFinite(asset.amount)||asset.amount<0)return false;
            // 逗號只在千分位格式才算數字，避免「核付金額:1895116,106年複查」被讀成 1895116106。
            const original=normalize(asset.memo).match(/核付金額[:：](\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?)/)?.[1];
            return original!==undefined&&numberValue(original)===amount;
        });
    }
    function reviewBenefitNameConflict(record,asset) {
        const normalize=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').replace(/勞工保險/g,'勞保');
        const name=normalize(asset.memo).match(/資料類別[:：]([^,，;；\n]+)/)?.[1];
        const expected=normalize(record.label);
        return !!(name&&expected&&!name.includes(expected));
    }
    function findReviewIncomeMatches(record, currentIncome) {
        if (record.category !== 'income' || !record.idNo || !Number.isFinite(record.amount)) return [];
        const normalize = value => String(value || '').normalize('NFKC').replace(/\s/g,'').replace(/勞工保險/g,'勞保');
        const parseAmount = value => Number(String(value || '').replace(/,/g,''));
        const expectedLabel = normalize(record.label);
        const expectedAmount = Number(record.amount);
        return (currentIncome?.details || []).filter(row => {
            if (row.counted !== true || normalize(row.idNo).toUpperCase() !== normalize(record.idNo).toUpperCase() || !Number.isFinite(row.amount)) return false;
            const memo = normalize(row.memo);
            const category = memo.match(/資料類別[:：]([^,，;；\n]+)/)?.[1] || '';
            const payout = memo.match(/核付金額[:：](\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/)?.[1];
            const multiplier = memo.match(/系統設定倍數[:：](\d+(?:\.\d+)?)/)?.[1];
            if (!category || !payout || !multiplier || !expectedLabel || !normalize(category).includes(expectedLabel)) return false;
            return parseAmount(payout) === expectedAmount && row.amount === expectedAmount * parseAmount(multiplier);
        });
    }
    function externalContribution(external, members, currentMovable, currentIncome) {
        const normalize = value => String(value || '').normalize('NFKC').replace(/\s/g,'');
        const seen = new Set();
        const details = sortReviewRecords(classifyExternalRecords(external?.details || [], members).map(row=>{
            if (!row.idNo || !Number.isFinite(row.grantAmount ?? row.amount)) return row;
            const identity = [row.idNo,normalize(row.label),row.grantAmount ?? row.amount,normalize(row.note)].join('|');
            const repeated = seen.has(identity);
            seen.add(identity);
            const matches=row.category==='movable'&&currentMovable?.found&&!currentMovable.partial?findReviewBenefitMatches(row,currentMovable.details):[];
            const registered=matches.length===1&&matches[0].counted===true&&!reviewBenefitNameConflict(row,matches[0]);
            const incomeMatches=row.category==='income'&&currentIncome?.found&&!currentIncome.partial?findReviewIncomeMatches(row,currentIncome):[];
            const registeredIncome=incomeMatches.length===1;
            return repeated || registered || registeredIncome ? {...row,counted:false,externalDuplicate:registered?'動產已有同筆給付':registeredIncome?'所得已有同筆給付':'外單位重複資料'} : row;
        }));
        let monthlyIncome = 0, movable = 0;
        let unresolved = !!external?.error || !external?.found || !!external?.partial || !!external?.unresolved;
        for (const row of details) {
            if (row.counted === false) continue;
            if (row.counted === null || !row.category || !Number.isFinite(row.amount) || row.amount < 0) { unresolved = true; continue; }
            if (row.category === 'income') monthlyIncome += row.amount;
            else movable += row.amount;
        }
        return { details, monthlyIncome, movable, unresolved };
    }

    function appliedExternalDetails(external, category) {
        return external.details.filter(row => row.counted === true && row.category === category && Number.isFinite(row.amount) && row.amount >= 0);
    }

    function perPersonValue(amount, population, months = 1) {
        return Number.isFinite(amount) && Number.isInteger(population) && population > 0 ? amount / months / population : null;
    }

    function reviewPersonText(row,population) {
        const member=population?.memberDetails?.[String(row.idNo||'').trim().toUpperCase()];
        const suffix=[member?.relationship,member?.registration].filter(Boolean).join('・');
        return `${row.name||''}${suffix?`（${suffix}）`:''}`;
    }
    const REVIEW_STANDARD = Object.freeze({
        year: 116,
        url: 'https://orgws.kcg.gov.tw/001/KcgOrgUploadFiles/288/RelFile/66837/540424/0cabe6f9-fe53-4921-8a23-7d34583049ce.pdf',
        low: { income: 17890, movable: 105000, immovable: 4020000 },
        middle: { income: 26835, movable: 157500, immovable: 6030000 }
    });

    function assessReviewThresholds(values, limits, pending = []) {
        if (![values.income,values.movable,values.immovable].every(Number.isFinite)) return { state: 'pending', text: '資料不足' };
        const exceeded = [];
        if (values.income > limits.income) exceeded.push('所得');
        if (values.movable > limits.movable) exceeded.push('動產');
        if (values.immovable > limits.immovable) exceeded.push('不動產');
        if (exceeded.length) return { state: 'exceeded', text: `${exceeded.join('、')}超過${pending.length ? '（試算）' : ''}` };
        return pending.length ? { state: 'pending', text: `暫符門檻 · ${pending.join('、')}` } : { state: 'matched', text: '金額符合' };
    }

    function reviewAssessment(results, population, external, standard = REVIEW_STANDARD) {
        const disqualifying=[];
        const propertyIncome=(results.income?.details||[]).filter(row=>row.counted===true&&population.members?.[row.idNo]!==false&&/財產所得\(76\)/.test(String(row.label||'').normalize('NFKC').replace(/\s/g,'')));
        if(propertyIncome.length){
            const names=[...new Set(propertyIncome.map(row=>reviewPersonText(row,population)).filter(Boolean))];
            disqualifying.push(`有財產所得(76)${names.length?`：${names.join('、')}`:''}`);
        }
        for(const [key,label] of [['movable','車輛'],['immovable','不動產']]){
            const removed=(results[key]?.removedPrevious||[]).filter(row=>population.members?.[row.idNo]===true&&(key!=='movable'||row.label==='汽車')).length;
            if(removed)disqualifying.push(`${label}減少${removed}`);
        }
        if(disqualifying.length){
            const disqualified={state:'exceeded',text:`不符：${disqualifying.join('；')}`};
            return {low:disqualified,middle:disqualified};
        }
        const summary = results.summary || {};
        const pending = [];
        for (const key of ['income','movable','immovable','summary','investment','external']) {
            const data = results[key];
            if(key==='investment'&&data?.pending&&!data.error)continue;
            if (!data?.found || data.error || data.partial || data.unresolved) pending.push(`${DATA_TYPES.find(t => t.key === key).label}待核`);
        }
        if (results.investment?.pending) pending.push('投資待回覆');
        else if (!results.investment?.reconciled && results.investment?.details?.some(r => r.amount > 0)) pending.push('投資待核');
        if (external.unresolved && !pending.includes('外單位參考收入待核')) pending.push('外單位待核');
        if (results.movable?.details?.some(r => r.previousAmount && r.counted)) pending.push('汽車採去年金額');
        const values = {
            income: Number.isFinite(summary.income) ? perPersonValue(summary.income / 12 + external.monthlyIncome, population.count) : null,
            movable: Number.isFinite(summary.movable) ? perPersonValue(summary.movable + external.movable, population.count) : null,
            immovable: summary.immovable
        };
        if(!standard?.low||!standard?.middle){const unknown={state:'pending',text:'未設定此年度初審門檻，待確認'};return {low:unknown,middle:unknown};}
        const assessment={low:assessReviewThresholds(values,standard.low,pending),middle:assessReviewThresholds(values,standard.middle,pending)};
        const addedCars=(results.movable?.details||[]).filter(row=>row.label==='汽車'&&row.change?.kind==='added'&&row.counted===true&&population.members?.[row.idNo]===true).length;
        if(addedCars)for(const kind of ['low','middle'])if(assessment[kind].state!=='exceeded')assessment[kind]={state:'pending',text:`待確認：車輛新增${addedCars}${pending.some(reason=>!['投資待回覆','汽車採去年金額'].includes(reason))?` · ${assessment[kind].text}`:''}`};
        return assessment;
    }

    function findReviewPreviousCase(doc, appNo) {
        const prefix = appNo.slice(0,2) + (Number(appNo.slice(2,6)) - 1);
        const candidates = [...doc.querySelectorAll('select[name="chk_case"] option')].map(o => o.value.trim()).filter(v => v.startsWith(prefix));
        const unique = [...new Set(candidates)];
        return unique.length === 1 ? unique[0] : '';
    }

    function readPreviousReviewCategory(doc, appNo) {
        const previousYear=Number(appNo.slice(2,6))-1001;
        const empty={found:true,year:previousYear,appNo:'',label:'無資料',kind:'missing'};
        const rows=[...doc.querySelectorAll('input[type="button"][onclick*="link_predata"]')].filter(button=>/上年度清查案號/.test(button.closest('tr')?.textContent||''));
        if(!rows.length)return empty;
        const matches=rows.map(button=>{
            const value=String(button.value||'').normalize('NFKC').replace(/\s/g,'');
            const previous=value.match(/^(?:EA|KA)1\d{8}/)?.[0];
            const handler=button.getAttribute('onclick')?.match(/link_predata\(['"]((?:EA|KA)1\d{8})['"]\)/)?.[1];
            if(!previous||previous!==handler||Number(previous.slice(2,6))!==1000+previousYear)return null;
            const category=value.slice(previous.length).match(/^\((.+)\)$/)?.[1]||'';
            const level=category.match(/^第([1-4])類$/)?.[1];
            return {found:true,year:previousYear,appNo:previous,label:level?`低收第${level}類`:category==='中低收入戶'?'中低收':'待確認',kind:level?'low':category==='中低收入戶'?'middle':'unknown',...(level?{level:Number(level)}:{})};
        }).filter(Boolean);
        const unique=[...new Map(matches.map(item=>[`${item.appNo}|${item.label}`,item])).values()];
        return unique.length===1?unique[0]:{...empty,label:'待確認',kind:'unknown'};
    }

    async function lookupPreviousReviewCategory(appNo,{signal,isActive,year=116}={}) {
        if(!/^(?:EA|KA)1\d{8}$/.test(appNo)||Number(appNo.slice(2,6))!==1000+year||typeof isActive!=='function'||!isActive())throw Error('案件不符合所選清查年度');
        const response=await fetch(`/socs/jsp/sa/sa1/sa12010_action.jsp?app_no=${encodeURIComponent(appNo)}&status=get`,{credentials:'include',signal});
        if(!response.ok)throw Error(`HTTP ${response.status}`);
        const doc=new DOMParser().parseFromString(await response.text(),'text/html');
        const checked={location:{pathname:'/socs/jsp/sa/sa1/sa12010_action.jsp'},querySelector:s=>doc.querySelector(s),querySelectorAll:s=>doc.querySelectorAll(s)};
        if(!isActive()||!isEligibleReviewDocument(checked,year)||doc.querySelector('[name="app_no"]')?.value!==appNo)throw Error('案件或年度回應不符');
        return readPreviousReviewCategory(doc,appNo);
    }

    function usePreviousAssetAmounts(current, previous, appNo, kind, members) {
        if (kind !== 'movable') return current;
        if (!current?.found || current.partial || !previous?.found || previous.partial || previous.error) return current;
        const normalize = value => String(value || '').normalize('NFKC').replace(/\s/g,'').replace(/臺/g,'台');
        const key = row => row.idNo && row.source ? [row.idNo,normalize(row.label),normalize(row.source),kind === 'immovable' ? normalize(row.area) : ''].join('|') : '';
        const index = new Map();
        const assetKey = row => row.source ? [normalize(row.label),normalize(row.source),kind === 'immovable' ? normalize(row.area) : ''].join('|') : '';
        const assetIndex = new Map();
        for (const row of previous.details || []) {
            const asset = assetKey(row);
            if (asset) { const matches=assetIndex.get(asset)||[];matches.push(row);assetIndex.set(asset,matches); }
            const identity = key(row);
            if (!identity || !Number.isFinite(row.amount) || row.amount <= 0) continue;
            const matches = index.get(identity) || [];
            matches.push(row);index.set(identity,matches);
        }
        const currentCounts = new Map();
        const assetCounts = new Map();
        for (const row of current.details || []) { const k=key(row);currentCounts.set(k,(currentCounts.get(k)||0)+1); }
        for (const row of current.details || []) { const k=assetKey(row);assetCounts.set(k,(assetCounts.get(k)||0)+1); }
        let adjustment = 0;
        let unresolved = !!current.unresolved;
        const details = (current.details || []).map(row => {
            if (normalize(row.label) !== '汽車' || row.counted === false || members?.[row.idNo]===false) return row;
            const identity = key(row);
            let matches = index.get(identity);
            if (!matches && assetCounts.get(assetKey(row)) === 1) matches = assetIndex.get(assetKey(row));
            if (!matches?.length) return row;
            if (matches.length !== 1 || currentCounts.get(identity) !== 1 || row.counted !== true || matches[0].counted !== true || (members && members[row.idNo]!==true)) {
                unresolved = true;
                return {...row,reviewNote:'去年列計設定或車輛比對待確認，未套用去年金額'};
            }
            if (!Number.isFinite(row.amount) || !Number.isFinite(matches[0].amount) || matches[0].amount <= 0) return row;
            const amount = matches[0].amount;
            if (row.counted === true) adjustment += amount - row.amount;
            return { ...row, amount, previousAmount: { appNo, original: row.amount, differentOwner: row.idNo !== matches[0].idNo } };
        });
        return { ...current, details, amount: Number.isFinite(current.amount) ? current.amount + adjustment : null, adjustment, unresolved };
    }

    function applyReviewHistory(results, previousAppNo, previousMovable, previousImmovable, population) {
        const external = usePreviousExternalAmounts(results.external, previousMovable, previousAppNo);
        const transferred = new Set((external?.details || []).map(r=>r.previousMovableIndex ?? r.previousAmount?.previousMovableIndex).filter(Number.isInteger));
        const comparisonPrevious = previousMovable && { ...previousMovable, details: (previousMovable.details || []).filter((r,i)=>!transferred.has(i)) };
        const comparedMovable = compareReviewAssets(results.movable, comparisonPrevious, previousAppNo, true);
        if (comparedMovable?.found && !comparedMovable.partial && previousMovable?.found && !previousMovable.partial && !previousMovable.error) {
            comparedMovable.previousDepositNotes = (comparisonPrevious.details || []).filter(r=>r.label==='存款本金' && r.memo?.trim() && !String(r.memo).normalize('NFKC').replace(/\s/g,'').includes('更新獎金所得為動產') && !(results.movable.details || []).some(now=>now.idNo===r.idNo && now.label===r.label && now.memo?.trim()===r.memo.trim())).map(r=>({...r,previousNoteAppNo:previousAppNo}));
        }
        const movable = usePreviousAssetAmounts(comparedMovable, previousMovable, previousAppNo, 'movable', population?.members);
        const immovable = compareReviewAssets(results.immovable, previousImmovable, previousAppNo);
        const summary = { ...results.summary };
        if (Number.isFinite(summary.movable)) summary.movable += movable?.adjustment || 0;
        const unavailable=data=>!data?.found||data.error||data.partial;
        return { ...results, movable:unavailable(previousMovable)?{...movable,unresolved:true}:movable, immovable:unavailable(previousImmovable)?{...immovable,unresolved:true}:immovable, summary, external };
    }

    function compareReviewAssets(current, previous, appNo, carsOnly = false) {
        if (!current?.found || current.partial || !previous?.found || previous.partial || previous.error) return current;
        const clean = value => String(value || '').normalize('NFKC').replace(/\s/g,'').replace(/臺/g,'台');
        const incomplete=row=>(!carsOnly||row.label==='汽車')&&row.counted!==false&&(!clean(row.idNo)||!clean(row.label)||!clean(row.source)||/^(查無資料|非集保戶)$/.test(clean(row.source)));
        if([...(current.details||[]),...(previous.details||[])].some(incomplete))return {...current,unresolved:true};
        const sourceKey = row => {
            const source=clean(row.source);
            return !carsOnly&&/土地|房屋|田賦/.test(row.label||'')?source.replace(/^(?:台北市|新北市|桃園市|台中市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣)/,''):source;
        };
        const assetKey = row => [clean(row.label),sourceKey(row) || clean(row.memo?.match(/資料類別[:：]([^,，\n]+)/)?.[1])].join('|');
        const compatibleLocation=(a,b)=>{
            if(carsOnly||!/土地|房屋|田賦/.test(a.label||''))return true;
            const county=value=>clean(value).match(/^(.{2,3}[縣市])/)?.[1];
            const left=county(a.source),right=county(b.source);
            return !left||!right||left===right;
        };
        const key = row => row.idNo + '|' + assetKey(row);
        const oldRows = previous.details || [], rows = current.details || [], used = new Set();
        const summary = { added:0, removed:0 };
        const reviewYear = /^[EK]A1\d{8}$/.test(appNo || '') ? Number(appNo.slice(2,6)) + 912 : null;
        const oldCar = row => {
            if (row.label !== '汽車' || !reviewYear) return false;
            const year = clean(row.source).match(/((?:19|20)\d{2}|\d{2,3})年/);
            if (!year) return false;
            const value = Number(year[1]), manufactured = value < 1911 ? value + 1911 : value;
            return reviewYear - manufactured >= 20;
        };
        const smallCar = row => {
            if (row.label !== '汽車') return false;
            const match = clean(row.source).match(/(\d+(?:\.\d+)?)cc\b/i);
            return !!match && Number(match[1]) > 0 && Number(match[1]) < 250;
        };
        // Match occurrences, not amounts: repeated identical items still contribute separate records.
        const details = rows.map(row => {
            if (carsOnly && row.label !== '汽車') return row;
            const index = oldRows.findIndex((old,i)=>!used.has(i)&&key(old)===key(row)&&compatibleLocation(old,row));
            if (index < 0) {
                if (row.counted === false || smallCar(row) || oldCar(row)) return row;
                summary.added++;return {...row,change:{kind:'added',appNo}};
            }
            used.add(index);
            return row;
        });
        const removedPrevious=oldRows.filter((r,i)=>!used.has(i)&&r.counted!==false&&(!carsOnly||r.label==='汽車')&&!oldCar(r)&&!smallCar(r)).map(r=>({...r,counted:false,removedFromPrevious:true,change:{kind:'removed',appNo}}));
        summary.removed=removedPrevious.length;
        return {...current,details,removedPrevious,changeSummary:summary};
    }

    function applyPreviousDeposits(results) {
        const data = results.movable;
        if (!data?.previousDepositNotes?.length || data.depositsApplied) return results;
        const members = results.population?.members || {};
        const notes = data.previousDepositNotes.map(row => {
            const duplicate = (data.details || []).some(now=>now.idNo===row.idNo && now.label===row.label && (now.memo?.trim()===row.memo?.trim() || (now.amount===row.amount && (now.source || '')===(row.source || ''))));
            const ambiguous = data.previousDepositNotes.filter(other=>other.idNo===row.idNo && (other.source || '')===(row.source || '') && other.memo?.trim()===row.memo?.trim()).length>1;
            const depositPending = !duplicate && row.counted!==false && members[row.idNo]!==false && (row.counted!==true || members[row.idNo]!==true || !Number.isFinite(row.amount) || row.amount<0 || ambiguous);
            return {...row,depositIncluded:!depositPending && row.counted===true && members[row.idNo]===true && Number.isFinite(row.amount) && row.amount>=0 && !duplicate,depositDuplicate:duplicate,depositPending};
        });
        const addition = notes.filter(r=>r.depositIncluded).reduce((sum,r)=>sum+r.amount,0);
        return {...results,movable:{...data,depositsApplied:true,previousDepositNotes:notes,unresolved:!!data.unresolved || notes.some(r=>r.depositPending),amount:Number.isFinite(data.amount)?data.amount+addition:data.amount},summary:{...results.summary,movable:Number.isFinite(results.summary?.movable)?results.summary.movable+addition:results.summary?.movable}};
    }

    function usePreviousExternalAmounts(external, previousMovable, appNo) {
        if (!external?.found || external.partial || !previousMovable?.found || previousMovable.partial || previousMovable.error) return external;
        let unresolved = !!external.unresolved;
        const details = (external.details || []).map(row => {
            if (classifyExternalRecords([row])[0].category !== 'movable' || !row.idNo) return row;
            const matches=findReviewBenefitMatches(row,previousMovable.details);
            if (!matches.length) return row;
            if(matches.length===1&&reviewBenefitNameConflict(row,matches[0])){
                unresolved=true;
                return {...row,reviewNote:'同一人原核付金額相同，但給付名稱不同，請確認；未套用去年金額'};
            }
            if(matches.length===1&&matches[0].counted===false){
                return {...row,previousExclusion:{appNo,memo:matches[0].memo,amount:matches[0].amount},reviewNote:`採 ${Number(appNo.slice(2,6))-1000} 年同筆給付不列計設定；僅本頁試算，尚未寫入財稅頁面，請確認並補登`};
            }
            if (matches.length !== 1 || matches[0].counted !== true) {
                unresolved = true;
                return {...row,reviewNote:'去年列計設定或給付比對待確認，未套用去年金額'};
            }
            const previous = matches[0];
            if (previous.amount === row.amount) return {...row,previousMovableIndex:previousMovable.details.indexOf(previous)};
            return { ...row, grantAmount: row.amount, amount: previous.amount,
                previousAmount: { appNo, original: row.amount, memo: previous.memo, benefitAdjustment: true, previousMovableIndex: previousMovable.details.indexOf(previous) } };
        });
        return { ...external, details, unresolved };
    }

    function historicalAmountHtml(row) {
        if (!row.previousAmount) return '';
        const history = row.previousAmount;
        return `<span class="swis-review-history" title="${escapeHtml(history.appNo)}">採 ${Number(history.appNo.slice(2,6)) - 1000} 年金額（${history.benefitAdjustment ? '原核付' : '今年'} ${Number(history.original).toLocaleString('zh-TW')} 元）${history.differentOwner ? ' · 持有人不同' : ''} · 僅本頁試算，尚未寫入財稅頁面，請記得補登</span>`;
    }

    function externalTransferReminder(row) {
        if (row.counted !== true || row.externalDuplicate || !row.category) return '';
        return '<span class="swis-review-history">僅本頁試算，請確認並轉入財稅（已轉入勿重複）</span>';
    }

    function reconcileReviewInvestments(results, population) {
        const investment = results.investment;
        if (investment?.reconciled || !investment?.found || investment.pending || investment.partial || investment.error) return results;
        // 已回覆且無投資：直接以0元完成投資處理；初審不依賴比對器或有無持股。
        if (Array.isArray(investment.details) && investment.details.length === 0) {
            return { ...results, investment: { ...investment, amount:0, personTotals:[], removed:0, duplicateCount:0, reconciled:true, unresolved:false } };
        }
        if (!results.movable?.found || results.movable.partial || !Number.isFinite(results.movable.amount) || typeof crossReference !== 'function') return { ...results, investment: { ...investment, unresolved: true } };
        const members = population.members || {};
        let unresolved = false;
        const details = (investment.details || []).map(row => {
            const counted = Object.prototype.hasOwnProperty.call(members,row.idNo) ? members[row.idNo] : null;
            if (counted === null || !Number.isFinite(row.amount) || row.amount < 0 || !row.source) unresolved = true;
            return { ...row, counted };
        });
        // 不完整的資料不先移除原動產，也不先加計部分投資。
        if (unresolved) return { ...results, investment: { ...investment, details, unresolved: true } };
        const totals = new Map();
        for (const row of details.filter(r => r.counted)) {
            const person = totals.get(row.idNo) || { idNo: row.idNo, name: row.name, amount: 0, securitiesAmount: 0, commercialAmount: 0, commercialCompanies: [] };
            person.amount += row.amount;
            if (row.sourceKind === 'commercial') {
                person.commercialAmount += row.amount;
                if (!person.commercialCompanies.includes(row.source)) person.commercialCompanies.push(row.source);
            } else person.securitiesAmount += row.amount;
            totals.set(row.idNo,person);
        }
        const originalRows = results.movable.details || [];
        const candidates = originalRows.filter(r => r.label === '投資' && r.source && r.idNo).map(row => ({ idNumber: row.idNo, personName: '', companyName: row.source, row }));
        const matched = new Set();
        // 逐人呼叫既有比對器，保留別名與名稱比對；不允許跨身分證同名誤配。
        for (const idNo of new Set(details.map(r=>r.idNo))) {
            const securities = details.filter(r=>r.idNo===idNo).map(r=>({idNumber:r.idNo,personName:'',securityName:r.source}));
            for (const candidate of candidates.filter(r=>r.idNumber===idNo)) {
                const {itemsToUncheck} = crossReference(securities,[candidate]);
                for (const item of itemsToUncheck) matched.add(item.row);
            }
        }
        let removed = 0;
        const movableDetails = originalRows.map(row => {
            const oldSubtotal = row.label === '投資' && totals.has(row.idNo) && /^投資現值(?:$|[（(])/.test((row.memo || '').trim());
            if (!matched.has(row) && !oldSubtotal) return row;
            if (row.counted && Number.isFinite(row.amount)) removed += row.amount;
            return { ...row, counted: false, investmentDuplicate: true, note: oldSubtotal ? '舊投資小計，由本次現值取代' : '與投資資料重複' };
        });
        const personTotals = [...totals.values()];
        const added = personTotals.reduce((sum,row)=>sum+row.amount,0);
        for (const row of personTotals) {
            const hasCommercial = row.commercialCompanies.length > 0;
            const hasSecurities = details.some(r=>r.idNo===row.idNo&&r.counted&&r.sourceKind!=='commercial');
            const source = hasCommercial ? `${hasSecurities ? '金管會／' : ''}商業司 · ${row.commercialCompanies.join('、')}` : '金管會';
            movableDetails.push({ ...row, label:'投資現值',source,sourceLabel:'來源',counted:true,investmentTotal:true,
                sourceKind:hasCommercial&&!hasSecurities?'commercial':hasCommercial?'mixed':'securities' });
        }
        const adjustment = added - removed;
        return { ...results,
            movable: { ...results.movable, details: movableDetails, amount: results.movable.amount + adjustment },
            summary: { ...results.summary, movable: Number.isFinite(results.summary?.movable) ? results.summary.movable + adjustment : null },
            investment: { ...investment, details, amount: added, personTotals, removed, duplicateCount: matched.size, reconciled:true, unresolved:false }
        };
    }

    function createPanel(current) {
        if (!current || !isEligibleReviewDocument(current.doc, selectedReviewYear())) return null;
        const hostDocument = current.doc;
        const existing = hostDocument.getElementById('swis-review-summary');
        if (existing) return existing;
        const collapsedRows = [...hostDocument.querySelectorAll('tr[data-swis-collapsible="1"]')];
        const anchor = collapsedRows.at(-1);
        const basicTable = [...hostDocument.querySelectorAll('table.titleb')].find(t => t.textContent.trim().startsWith('基本資料'));
        if (!anchor && !basicTable) return null;
        const panel = hostDocument.createElement('details');
        panel.id = 'swis-review-summary';
        panel.innerHTML = '<summary class="swis-review-header"><strong>財稅初次審查</strong><span data-review-preview class="swis-review-preview" role="status" aria-live="polite">查詢中…</span></summary>' +
            '<div class="swis-review-content"><div class="swis-review-toolbar"><span>案號：<strong data-review-app></strong></span><span data-review-population></span><input class="button1" type="button" data-review-load value="重新查詢"><span data-review-status class="swis-review-status" role="status" aria-live="polite">正在取得資料…</span></div>' +
            '<table class="titleb swis-review-table"><tbody data-review-cards></tbody></table></div>';
        if (anchor) {
            const row = hostDocument.createElement('tr');
            row.dataset.swisReviewRow = '1';
            const cell = hostDocument.createElement('td');
            cell.colSpan = [...anchor.cells].reduce((n,c) => n + c.colSpan, 0);
            cell.appendChild(panel); row.appendChild(cell); anchor.after(row);
        } else basicTable.after(panel);
        panel.querySelector('[data-review-load]').addEventListener('click', () => {
            const current = findActiveCase();
            if (current) loadReview(panel, current, true);
        });
        return panel;
    }
    function setStatus(panel, text, kind) {
        const node = panel.querySelector('[data-review-status]');
        node.textContent = text;
        node.dataset.kind = kind || 'info';
    }
    function parseSummary(doc) {
        const result = { income: null, movable: null, immovable: null, found: false };
        doc.querySelectorAll('input[name="cnt1"]').forEach((input) => {
            const label = input.closest('td')?.previousElementSibling?.textContent || '';
            const amount = numberValue(input.value);
            if (/^所得合計/.test(label.trim())) result.income = amount;
            else if (/^不動產合計/.test(label.trim())) result.immovable = amount;
            else if (/^動產合計/.test(label.trim())) result.movable = amount;
        });
        result.found = ['income', 'movable', 'immovable'].every(k => result[k] !== null);
        return result;
    }
    function parseDataPage(html, key) {
        const doc = typeof html==='string'||!html?new DOMParser().parseFromString(html || '', 'text/html'):html;
        if (key === 'investment') return parseReviewInvestment(doc);
        const text = doc.body?.textContent || '';
        const rows = [...doc.querySelectorAll('tr.title4')];
        const details = [];
        let noData = 0;
        for (const row of rows) {
            const cells = [...row.cells];
            const emptyItem=!cells[6]?.textContent.trim()||/^(查無資料|非集保戶)$/.test(cells[6]?.textContent.trim());
            if (/查無資料|非集保戶/.test(row.textContent)&&(!/^\d+$/.test(cells[0]?.textContent.trim()||'')||emptyItem)&&!row.querySelector('[name="grant_mny"]')) { noData++; continue; }
            if (key === 'external') {
                if (!row.querySelector('[name="grant_mny"]')) continue;
                const amount = numberValue(row.querySelector('[name="grant_mny"]').value);
                // 系統標示不能轉入且無金額者無從試算，視為不列計，避免整個外單位卡在待確認。
                const unconvertible = amount === null && /不能轉入/.test(cells[0]?.textContent || '');
                details.push({ name: row.querySelector('[name="cname"]')?.value || '',
                    idNo: (row.querySelector('[name="id_no"]')?.value || '').trim().toUpperCase(),
                    label: row.querySelector('[name="soc_desc"]')?.value || '',
                    amount, ...(unconvertible ? { unconvertible: true, reviewNote: '外單位標示不能轉入且無金額，不列計' } : {}),
                    note: `${cells[0]?.textContent.trim()}；資料年月 ${cells[2]?.textContent.trim()}` });
                continue;
            }
            if (!/^\d+$/.test(cells[0]?.textContent.trim() || '')) continue;
            const headers = [...(row.closest('table')?.querySelectorAll('tr') || [])]
                .filter(r => !r.querySelector('tr') && !r.matches('tr.title4'));
            const pattern = key === 'investment' ? /^(等值金額|投資金額)$/ : key === 'income' ? /年所得金額/ : /^(金額|現值|財產現值|公告現值)$/;
            let index = -1;
            for (const header of headers) {
                const i = [...header.cells].findIndex(c => pattern.test(c.textContent.replace(/\s/g, '')));
                if (i >= 0 && header.cells.length === cells.length) { index = i; break; }
            }
            const amount = index >= 0 ? numberValue(cells[index].textContent.split(/[（(]/)[0]) : null;
            const original = row.querySelector('[name="a_count_yn_ori"]');
            const countedValue = original?.value.normalize('NFKC').trim().toUpperCase();
            const counted = countedValue === 'Y' ? true : countedValue === 'N' ? false : null;
            const matchingHeader = headers.find(h => h.cells.length === cells.length && [...h.cells].some(c => /姓名/.test(c.textContent)));
            const field = regex => {
                const i = matchingHeader ? [...matchingHeader.cells].findIndex(c => regex.test(c.textContent.replace(/\s/g,''))) : -1;
                return i >= 0 ? cells[i]?.textContent.trim() || '' : '';
            };
            const idNo = String(row.querySelector('[name="a_id_no"]')?.value || field(/身[分份]證/).normalize('NFKC').toUpperCase().match(/[A-Z][A-Z0-9]\d{8}/)?.[0] || '').normalize('NFKC').trim().toUpperCase();
            const sourceLabel = key === 'income' ? '扣繳單位名稱' : key === 'movable' ? '公司名稱／車廠牌' : key === 'immovable' ? '座落' : '公司／證券名稱';
            const source = field(key === 'income' ? /扣繳單位名稱/ : key === 'movable' ? /公司名稱.*車廠牌/ : key === 'immovable' ? /^座落$/ : /^(公司名稱|證券名稱)$/);
            details.push({ name: field(/^姓名$|身[分份]證.*姓名/) || cells[key === 'investment' ? (cells.length > 10 ? 2 : 1) : 3]?.textContent.trim() || '',
                idNo, source, sourceLabel, area: key === 'immovable' ? field(/^面積/) : '',
                label: key === 'investment' ? (cells.length > 10 ? '金管會等值金額' : '商業司投資金額') : cells[6]?.textContent.trim(), amount,
                counted, memo: field(/^備註$/), note: key === 'investment' ? '' : counted===true ? '列計' : counted===false ? '不列計' : '列計待確認' });
        }
        const countedRows = key === 'investment' ? details : details.filter(r => r.counted);
        const amount = countedRows.every(r => r.amount !== null) ? countedRows.reduce((sum,r) => sum+r.amount,0) : null;
        return { count: details.length, counted: countedRows.length, amount, details, noData,
            pending: key === 'investment' && /等候回覆|等待回覆/.test(text),
            partial: Number(doc.querySelector('[name="total_page"]')?.value || 1) > 1,
            unresolved: key !== 'investment' && details.some(r=>r.counted===null),
            found: !!doc.querySelector('[name="q_data_type"]') };
    }
    function parseReviewInvestment(doc) {
        const details = [];
        const text = doc.body?.textContent || '';
        let noData = 0, invalid = false;
        for (const row of doc.querySelectorAll('tr.title4')) {
            const cells = [...row.cells];
            if (/查無資料|非集保戶/.test(row.textContent.replace(/\s/g,''))&&!/^\d+$/.test(cells[0]?.textContent.trim()||'')) { noData++;continue; }
            if (!/^\d+$/.test(cells[0]?.textContent.trim() || '')) continue;
            const securities = /^[AB]$/.test(cells[1]?.textContent.trim() || '');
            const commercial = cells.length === 6 && /投資金額/.test(row.closest('table')?.textContent || '');
            if (!securities && !commercial) { invalid = true;continue; }
            const personText = cells[securities ? 2 : 1]?.textContent.trim() || '';
            const idNo = personText.match(/[A-Z][A-Z0-9]\d{8}/)?.[0] || '';
            const amount = numberValue(cells[securities ? 9 : 4]?.textContent);
            const source = cells[securities ? 5 : 3]?.textContent.trim() || '';
            if(amount===0&&/^(查無資料|非集保戶)$/.test(source)&&(commercial||(securities&&numberValue(cells[6]?.textContent)===0))){noData++;continue;}
            // 已解約或空帳戶可能只有帳號、餘額0，並沒有證券名稱。
            if (securities && amount === 0 && !source && numberValue(cells[6]?.textContent) === 0) { noData++;continue; }
            if (!idNo || amount === null || !source || /^(查無資料|非集保戶)$/.test(source)) invalid = true;
            details.push({idNo,name:personText.replace(idNo,'').replace(/[-（(].*/, '').trim(),amount,source,
                label:securities?'投資現值':'小額投資',sourceLabel:securities?'證券':'公司',sourceKind:securities?'securities':'commercial',counted:null});
        }
        return {found:!!doc.querySelector('[name="q_data_type"]'),count:details.length,details,noData,
            amount:null,pending:/等候回覆|等待回覆/.test(text),
            parseInvalid:invalid,partial:invalid || Number(doc.querySelector('[name="total_page"]')?.value || 1)>1};
    }
    function buildParams(record, appNo, type) {
        const params = new URLSearchParams();
        // 優先補入主頁目前查詢表單；彈出視窗暫存的 payload 再覆蓋同名欄位。
        try {
            const frameDoc = window.frames.main_frm?.document;
            const form = frameDoc?.querySelector('form[name="main"]') || frameDoc?.querySelector('form');
            form?.querySelectorAll('input,select,textarea').forEach((el) => {
                if (!el.name || ((el.type === 'checkbox' || el.type === 'radio') && !el.checked)) return;
                const value = el.tagName === 'SELECT' ? (el.selectedOptions?.[0]?.value || el.value) : (el.value || '');
                params.set(el.name, value);
            });
        } catch (error) { /* 主頁尚未完成載入時，使用暫存 payload */ }
        for (const [key, value] of new URLSearchParams(record?.payloadString || '')) params.set(key, value);
        // 只帶查詢所需欄位，排除編輯金額、人口篩選與上一頁的分頁狀態。
        const query = new URLSearchParams();
        for (const name of ['q_soc_type','q_city','q_data_type','q_sys_code','chk_status','prog_id','taxTableName','zap_addr','return_url']) {
            if (params.has(name)) query.set(name, params.get(name));
        }
        query.set('app_no', appNo); query.set('chk_case', appNo); query.set('q_data_type', type); query.set('status', 'list');
        query.set('now_page', '1');
        return query;
    }
    async function fetchType(record, appNo, item, signal) {
        const isActive = () => record.isActive ? record.isActive() : findActiveCase()?.appNo === (record.ownerAppNo || appNo);
        if (!isActive()) throw new DOMException('案件不符合注入條件', 'AbortError');
        let doc;
        if(record.seedPage?.appNo===appNo&&record.seedPage.type===item.type)doc=record.seedPage.doc;
        else {
            const response = await fetch(`${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: buildParams(record, appNo, item.type).toString(), credentials: 'include', signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        }
        if (doc.querySelector('[name="app_no"]')?.value !== appNo || doc.querySelector('[name="q_data_type"]')?.value !== item.type) throw new Error('回應案件或資料類型不符');
        if (item.key === 'summary') {
            const summary = parseSummary(doc);
            return { ...summary, count: summary.found ? 1 : 0, amount: summary.income + summary.movable + summary.immovable };
        }
        if (item.key === 'investment') {
            const first = parseReviewInvestment(doc);
            const total = Math.max(1, Number(doc.querySelector('[name="total_page"]')?.value || 1));
            if (first.pending || total === 1) return first;
            if (!Number.isInteger(total) || total > 100) return { ...first, partial: true };
            const details = [...first.details];
            let invalid = first.parseInvalid;
            // 金管會換頁；商業司表格每頁重複，僅採第一頁的小額投資。
            for (let page = 2; page <= total; page++) {
                if (!isActive()) throw new DOMException('案件已切換','AbortError');
                const body = buildParams(record,appNo,item.type);
                body.set('now_page',String(page));body.set('total_page',String(total));body.set('run_page','rp');
                const response = await fetch(`${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`,{method:'POST',body,credentials:'include',signal});
                if (!response.ok) throw new Error(`投資第${page}頁查詢失敗`);
                const pageDoc = new DOMParser().parseFromString(await response.text(),'text/html');
                if (pageDoc.querySelector('[name="app_no"]')?.value !== appNo || pageDoc.querySelector('[name="q_data_type"]')?.value!==item.type || Number(pageDoc.querySelector('[name="now_page"]')?.value) !== page || Number(pageDoc.querySelector('[name="total_page"]')?.value)!==total) throw new Error('投資分頁回應不符');
                const part = parseReviewInvestment(pageDoc);
                // partial 可能只是因為總頁數大於一；另核對每頁金額。
                if (!part.found || part.pending || part.parseInvalid) invalid = true;
                details.push(...part.details.filter(r=>r.sourceKind==='securities'));
            }
            return {...first,details,count:details.length,partial:invalid};
        }
        const first=parseDataPage(doc,item.key);
        const total=Number(doc.querySelector('[name="total_page"]')?.value||1);
        // 外單位固定回傳頁碼 0／總頁數 0，但表格仍可能有完整資料。
        if(item.key==='external'&&total===0)return first;
        // 一般財稅的「查無資料」亦正常回傳 0 頁，不代表分頁遺漏。
        if(total===0&&first.found&&first.count===0&&first.noData>0)return {...first,partial:false};
        if(total===1)return first;
        if(!Number.isInteger(total)||total<1||total>100)return {...first,partial:true};
        const parts=[first];
        for(let page=2;page<=total;page++){
            if(!isActive())throw new DOMException('案件已切換','AbortError');
            const body=buildParams(record,appNo,item.type);
            body.set('now_page',String(page));body.set('total_page',String(total));body.set('run_page','rp');
            const response=await fetch(`${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`,{method:'POST',body,credentials:'include',signal});
            if(!response.ok)throw new Error(`${item.label}第${page}頁查詢失敗`);
            const pageHtml=await response.text(),pageDoc=new DOMParser().parseFromString(pageHtml,'text/html');
            if(pageDoc.querySelector('[name="app_no"]')?.value!==appNo||pageDoc.querySelector('[name="q_data_type"]')?.value!==item.type||Number(pageDoc.querySelector('[name="now_page"]')?.value)!==page||Number(pageDoc.querySelector('[name="total_page"]')?.value)!==total)throw new Error(`${item.label}分頁回應不符`);
            parts.push(parseDataPage(pageDoc,item.key));
        }
        const details=parts.flatMap(part=>part.details),counted=details.filter(row=>row.counted===true);
        return {...first,details,count:details.length,counted:counted.length,amount:counted.every(row=>Number.isFinite(row.amount))?counted.reduce((sum,row)=>sum+row.amount,0):null,noData:parts.reduce((sum,part)=>sum+part.noData,0),unresolved:parts.some(part=>part.unresolved),found:parts.every(part=>part.found),partial:false};
    }
    let reviewSettings, renderedReview;
    let reviewSettingsReady = !window.swisReviewConfig || typeof chrome === 'undefined' || typeof chrome.storage?.local?.get !== 'function';
    function selectedReviewYear() {
        return window.swisReviewConfig?.normalize(reviewSettings).year ?? 116;
    }
    function renderCards(panel, results) {
        renderedReview={panel,results};
        const money = n => n === null || n === undefined ? '未能辨識' : `${n.toLocaleString('zh-TW', { maximumFractionDigits: 2 })} 元`;
        const population = results.population || readReviewPopulation(panel.ownerDocument);
        // Current family exclusions also suppress historical removal notices.
        for (const key of ['movable','immovable']) {
            const data = results[key];
            if (!data?.changeSummary) continue;
            const details = (data.details || []).map(row=>population.members?.[row.idNo]===false ? {...row,change:undefined} : row);
            const removedPrevious = (data.removedPrevious || []).filter(row=>population.members?.[row.idNo]!==false);
            results = {...results,[key]:{...data,details,removedPrevious,changeSummary:{added:details.filter(r=>r.change?.kind==='added').length,removed:removedPrevious.length}}};
        }
        const divisor = population.count;
        const populationLabel = population.found ? `計算 ${divisor} 人／不計 ${population.excluded} 人` : '人口待確認';
        panel.querySelector('[data-review-population]').textContent = populationLabel;
        const external = externalContribution(results.external, population.members, results.movable, results.income);
        const combinedIncome = annual => Number.isFinite(annual) ? perPersonValue(annual / 12 + external.monthlyIncome, divisor) : null;
        const combinedMovable = amount => Number.isFinite(amount) ? perPersonValue(amount + external.movable, divisor) : null;
        const provisional = external.unresolved ? '（外單位待確認）' : '';
        const appNo=panel.ownerDocument.querySelector('[name="app_no"]')?.value||'';
        const config=window.swisReviewConfig?.normalize(reviewSettings);
        const year=config?.year||(/^(?:EA|KA)1\d{8}$/.test(appNo)?Number(appNo.slice(2,6))-1000:116);
        const standard=config?config.standardsByYear[year]||null:year===116?REVIEW_STANDARD:null;
        const assessment = reviewAssessment(results, population, external, standard);
        const compactResult = result => result.state === 'pending' && result.text.startsWith('暫符門檻') ? '暫符門檻' : result.text;
        const preview = panel.querySelector('[data-review-preview]');
        const changedAssets = ['movable','immovable'].filter(key=>Object.values(results[key]?.changeSummary || {}).some(n=>n>0));
        const previousCategory=results.previousCategory||readPreviousReviewCategory(panel.ownerDocument,panel.ownerDocument.querySelector('[name="app_no"]')?.value||'');
        const assessmentMarkup=compact=>{
            const text=result=>compact?compactResult(result):result.text;
            if(assessment.low.state===assessment.middle.state&&text(assessment.low)===text(assessment.middle))return `<span class="swis-review-result" data-result="${assessment.low.state}">低收／中低收：${escapeHtml(text(assessment.low))}</span>`;
            return `<span class="swis-review-result" data-result="${assessment.low.state}">低收：${escapeHtml(text(assessment.low))}</span> <span class="swis-review-result" data-result="${assessment.middle.state}">中低收：${escapeHtml(text(assessment.middle))}</span>`;
        };
        if(preview)preview.innerHTML=`<span class="swis-review-preview-line">${assessmentMarkup(true)}<span class="swis-review-meta">去年：${escapeHtml(previousCategory.label)}</span>${changedAssets.length?`<span class="swis-review-change">${changedAssets.map(key=>key==='movable'?'動產':'不動產').join('、')}有異動</span>`:''}</span> <span class="swis-review-preview-line swis-review-metrics"><span>每人月所得 <strong>${money(combinedIncome(results.summary?.income))}</strong></span> <span>每人動產 <strong>${money(combinedMovable(results.summary?.movable))}</strong></span> <span>全家不動產 <strong>${money(results.summary?.immovable)}</strong></span></span>`;
        const limits=standard?['low','middle'].map(kind=>`${kind==='low'?'低收':'中低收'}：月所得 ≤ ${standard[kind].income.toLocaleString('zh-TW')}／人、動產 ≤ ${standard[kind].movable.toLocaleString('zh-TW')}／人、不動產 ≤ ${standard[kind].immovable.toLocaleString('zh-TW')}／戶。`).join('<br>'):'未設定此年度初審門檻';
        const assessmentHtml = `<tr><th scope="row" class="title2">審查門檻</th><td class="title4"><details class="swis-review-standard"><summary>${year} 年標準</summary>${limits}</details></td></tr>`;
        panel.querySelector('[data-review-cards]').innerHTML = assessmentHtml + DATA_TYPES.map((item) => {
            let data = results[item.key] || {};
            if (item.key === 'external' && data.details) data = { ...data, details: external.details };
            else if (data.details) data = { ...data, details: sortReviewRecords(data.details.map(r => item.key === 'investment' ? { ...r, counted: Object.prototype.hasOwnProperty.call(population.members || {}, r.idNo) ? population.members[r.idNo] : null } : r)) };
            let value = data.error ? '查詢失敗' : '資料待確認';
            if (!data.error && data.found) {
                if (item.key === 'summary') value = `每人月所得 ${money(combinedIncome(data.income))} · 每人動產 ${money(combinedMovable(data.movable))} · 不動產 ${money(data.immovable)}${provisional}`;
                else if (item.key === 'external') {
                    value = `月所得 ${money(external.monthlyIncome)} · 動產 ${money(external.movable)}${provisional}`;
                }
                else if (item.key === 'investment') value = data.pending ? '等候回覆' : data.unresolved ? '投資待確認' : data.count ? `列計 ${money(data.amount)}${data.reconciled ? ` · 重複 ${data.duplicateCount} 筆不列計` : ''}` : '查無資料';
                else if (item.key === 'income') value = `每人月所得 ${money(combinedIncome(data.amount))}${provisional}`;
                else if (item.key === 'movable') value = `每人動產 ${money(combinedMovable(data.amount))}${provisional}`;
                else value = data.count ? money(data.amount) : '查無資料';
                if (data.details?.some(r => r.previousAmount && r.counted === true)) value += '（含去年金額）';
                value=`<span class="swis-review-value">${value}</span>`;
                if (data.changeSummary) {
                    const diff=data.changeSummary;
                    const messages=[diff.added?`新增 ${diff.added}`:'',diff.changed?`異動 ${diff.changed}`:'',diff.removed?`減少 ${diff.removed}`:'',diff.uncertain?`待核 ${diff.uncertain}`:''].filter(Boolean);
                    if (messages.length) value += `<span class="swis-review-change" data-change="changed">${messages.join(' · ')}</span>`;
                }
                if (data.partial && !data.pending) value = '僅第一頁，金額待確認';
                if (data.previousDepositNotes?.length) {
                    value += data.previousDepositNotes.map(r=>`<div class="swis-review-detail" data-counted="${r.depositPending?'unknown':r.depositIncluded?'counted':'excluded'}"><strong>${r.depositPending?'待確認':r.depositIncluded?'列計':'不列計'} ${escapeHtml(reviewPersonText(r,population))} · 存款本金 · 去年 ${money(r.amount)}</strong><span class="swis-review-source">${escapeHtml(r.memo)}</span><span class="swis-review-history">${r.depositIncluded?'已納入動產總計及平均；僅本頁試算，尚未寫入財稅頁面，請記得補登':r.counted===false?'去年不列計，本頁不加計':r.depositDuplicate?'今年已有同筆存款，不重複加計':'未加計（人口、列計欄位或比對待確認）'}</span></div>`).join('');
                }
                if (item.key === 'income' || item.key === 'movable') {
                    const applied = appliedExternalDetails(external, item.key);
                    if (applied.length) {
                        value += `<div class="swis-review-applied-external">${applied.map(r => `<div class="swis-review-detail" data-counted="counted"><strong class="swis-review-count-label">列計</strong>外單位 · ${escapeHtml(reviewPersonText(r,population))} · ${escapeHtml(r.label)} · <strong>${money(r.amount)}${item.key === 'income' ? '／月' : ''}</strong>${historicalAmountHtml(r)}<span class="swis-review-source">${escapeHtml(r.note)}${r.previousAmount?.memo ? ` · 去年備註：${escapeHtml(r.previousAmount.memo)}` : ''}</span>${externalTransferReminder(r)}</div>`).join('')}</div>`;
                    }
                }
                const visibleDetails=[...(data.details || []),...(data.removedPrevious || [])];
                if (visibleDetails.length) value += `<details><summary>明細</summary>${visibleDetails.map(r => {
                    const status = r.counted === true ? 'counted' : r.counted === false ? 'excluded' : 'unknown';
                    const classification = `<strong class="swis-review-count-label">${r.counted === true ? '列計' : r.counted === false ? '不列計' : '待確認'}</strong> `;
                    const category = item.key === 'external' ? ` · ${r.category === 'income' ? '所得' : r.category === 'movable' ? '動產' : r.amount === 40000 ? '40,000 元歸類待確認' : '金額待確認'}` : '';
                    const amount = item.key === 'income' && Number.isFinite(r.amount) ? r.amount / 12 : r.amount;
                    const monthly = item.key === 'income' || (item.key === 'external' && r.category === 'income');
                    const extra = item.key === 'income'
                        ? [!(/基本工資/.test(r.label || '')) && r.source ? escapeHtml(r.source) : '', r.memo ? `備註：${escapeHtml(r.memo)}` : ''].filter(Boolean).join(' · ')
                        : item.key === 'external'
                            ? escapeHtml(r.note)
                            : `${r.source ? `${escapeHtml(r.sourceLabel)}：${escapeHtml(r.source)}` : ''}${r.area ? ` · ${escapeHtml(r.area)} 平方公尺` : ''}`;
                    const historical = historicalAmountHtml(r) + (r.reviewNote ? `<span class="swis-review-history">${escapeHtml(r.reviewNote)}</span>` : '') + (item.key === 'external' ? externalTransferReminder(r) : '');
                    const change = r.change;
                    const changeText = !change ? '' : change.kind==='added'?'新增':change.kind==='removed'?'去年有／今年無':change.kind==='uncertain'?'比對待確認':`異動：${change.fields.join('、')}${change.fields.includes('金額')?`（去年 ${money(change.before.amount)}）`:''}`;
                    const changeHtml = changeText ? `<span class="swis-review-change" data-change="${change.kind}">${escapeHtml(changeText)}</span>` : '';
                    const investmentSource = r.sourceKind === 'commercial' ? '<span class="swis-review-commercial">商業司小額投資</span>' : r.sourceKind === 'mixed' ? `<span class="swis-review-commercial">含商業司 ${money(r.commercialAmount)}</span>` : '';
                    const duplicate = r.investmentDuplicate ? ' · 與投資重複，不列計' : r.externalDuplicate ? ` · ${escapeHtml(r.externalDuplicate)}，不重複加計` : '';
                    return `<div class="swis-review-detail" data-counted="${status}">${classification}${escapeHtml(reviewPersonText(r,population))} · ${escapeHtml(r.label)}${category} · <strong>${money(amount)}${monthly ? '／月' : ''}</strong>${changeHtml}${investmentSource}${historical}${duplicate}${extra ? `<span class="swis-review-source">${extra}${r.sourceKind === 'mixed' ? ` · 金管會 ${money(r.securitiesAmount)}／商業司 ${money(r.commercialAmount)}` : ''}</span>` : ''}</div>`;
                }).join('')}</details>`;
            }
            value = value.replace(/<br>/g, '；');
            return `<tr class="swis-review-card"><th scope="row" class="title2">${escapeHtml(item.label)}</th><td class="title4 swis-review-card-value">${value}</td></tr>`;
        }).join('');
        // 開案完成的最新試算同步到列表，避免永久快取顯示舊判定。
        if(window.swisReviewConfig?.matchesYear?.(appNo,config?.year)&&isEligibleReviewDocument(panel.ownerDocument, selectedReviewYear())&&panel.ownerDocument.querySelector('[name="case_status"]')?.value==='3'){
            const result={...reviewResult(appNo,{...results,previousCategory},population,standard),year:config.year,policyKey:window.swisReviewConfig.policyKey(config)};
            try{chrome.storage.local.set({[`swisReviewResult:${appNo}`]:result},()=>{void chrome.runtime.lastError;});}catch{/* 擴充功能重載時不影響本頁顯示。 */}
        }
    }
    function reviewSeedQuery(doc,appNo) {
        const field=name=>String(doc.querySelector(`[name="${name}"]`)?.value||'').trim();
        let city=field('grantcity')||field('q_city')||field('qzap_city');
        if(!city){try{city=window.top.frames.main_frm?.document.querySelector('[name="qzap_city"]')?.value||'';}catch{}}
        if(!city)throw new Error('缺少財稅查詢縣市，無法確認外單位資料');
        return new URLSearchParams({app_no:appNo,q_data_type:'1',chk_status:field('chk_status')||'0',prog_id:'SA12010',q_soc_type:field('soc_type')||field('qsoc_type')||'A111',q_city:city,return_url:''});
    }
    async function loadReview(panel, current, force = false) {
        if (!isEligibleReviewDocument(current.doc, selectedReviewYear()) || findActiveCase()?.doc !== current.doc) return;
        if (!extensionContextValid()) { setStatus(panel, '擴充功能已重新載入，請重新整理此頁面。', 'warning'); return; }
        activeRequest?.abort();
        const controller = new AbortController();
        activeRequest = controller;
        nextInvestmentRefresh = 0;
        const version = ++requestVersion;
        const { appNo, doc } = current;
        panel.querySelector('[data-review-app]').textContent = appNo;
        panel.querySelector('[data-review-preview]').textContent = '查詢中…';
        panel.querySelector('[data-review-cards]').replaceChildren();
        panel.querySelector('[data-review-load]').disabled = true;
        setStatus(panel, `案件 ${appNo} · 正在自動取得六類資料…`, 'info');
        try {
            let results;
            const cached = reviewCache.get(appNo);
            if (!force && cached && Date.now() - cached.timestamp < 120000) results = cached.results;
            else {
                // 從主頁案件表單啟動查詢，先取得後端自己的財稅查詢表單，無須開啟彈窗。
                const query = reviewSeedQuery(doc,appNo);
                const response = await fetch(`${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp?${query}`, { credentials: 'include', signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const html = await response.text();
                const seed = new DOMParser().parseFromString(html, 'text/html');
                if (seed.querySelector('[name="app_no"]')?.value !== appNo) throw new Error('未取得此案件的財稅查詢表單，請確認登入與權限');
                const params = new URLSearchParams();
                seed.querySelectorAll('input[name],select[name]').forEach(e => params.set(e.name, e.value));
                const record = { payloadString: params.toString(), ownerAppNo: appNo,seedPage:{appNo,type:'1',doc:seed} };
                const entries = await Promise.all(DATA_TYPES.map(async (item) => {
                    try { return [item.key, await fetchType(record, appNo, item, controller.signal)]; }
                    catch (error) { if (error.name === 'AbortError') throw error; return [item.key, { error: true, message: error.message }]; }
                }));
                results = {...Object.fromEntries(entries),previousCategory:readPreviousReviewCategory(doc,appNo)};
                const previousAppNo = findReviewPreviousCase(seed, appNo);
                if (previousAppNo) {
                    const previous = await Promise.all(['movable','immovable'].map(async key => {
                        try { return await fetchType(record, previousAppNo, DATA_TYPES.find(item => item.key === key), controller.signal); }
                        catch (error) { if (error.name === 'AbortError') throw error; return { error: true }; }
                    }));
                    results = applyReviewHistory(results, previousAppNo, ...previous, readReviewPopulation(doc));
                }
                if (!Object.values(results).some(r => r.error)) reviewCache.set(appNo, { timestamp: Date.now(), results });
            }
            if (version !== requestVersion || controller.signal.aborted || findActiveCase()?.appNo !== appNo) return;
            results = { ...results, population: readReviewPopulation(doc) };
            results = applyPreviousDeposits(results);
            results = reconcileReviewInvestments(results, results.population);
            renderCards(panel, results);
            if (results.investment?.pending) nextInvestmentRefresh = Date.now() + 120000;
            const incomplete = Object.values(results).some(r => r.error || !r.found || r.partial || r.pending || r.unresolved);
            setStatus(panel, incomplete ? '資料待確認' : '', incomplete ? 'warning' : 'success');
        } catch (error) {
            if (version === requestVersion && error.name !== 'AbortError') {
                panel.querySelector('[data-review-preview]').textContent = '查詢失敗';
                setStatus(panel, `案件 ${appNo} · ${error.message}`, 'warning');
            }
        } finally {
            if (version === requestVersion) panel.querySelector('[data-review-load]').disabled = false;
        }
    }
    function syncActiveCase() {
        if (!reviewSettingsReady) return;
        const current = findActiveCase();
        if (!current) {
            activeRequest?.abort(); requestVersion++;
            if (mountedPanel) { const row = mountedPanel.closest('[data-swis-review-row]'); (row || mountedPanel).remove(); mountedPanel = null; }
            lastAppNo = ''; lastCaseDocument = null;
            renderedReview = null;
            return;
        }
        if (mountedPanel && mountedPanel.ownerDocument !== current.doc) {
            (mountedPanel.closest('[data-swis-review-row]') || mountedPanel).remove(); mountedPanel = null;
        }
        const panel = createPanel(current);
        if (!panel) return;
        mountedPanel = panel;
        const populationKey = JSON.stringify(readReviewPopulation(current.doc));
        const refreshInvestment = nextInvestmentRefresh > 0 && Date.now() >= nextInvestmentRefresh;
        if (current.appNo === lastAppNo && current.doc === lastCaseDocument && panel.dataset.case === current.appNo && panel.dataset.population === populationKey && !refreshInvestment) return;
        lastAppNo = current.appNo; lastCaseDocument = current.doc;
        panel.dataset.case = current.appNo;
        panel.dataset.population = populationKey;
        loadReview(panel, current, refreshInvestment);
    }
    function safelySyncActiveCase() {
        try { syncActiveCase(); }
        catch (error) {
            // 載入或切換過程的暫時性 DOM 不完整，留給下一次監看重試。
            console.debug('[SWIS review] awaiting case document', error.message);
        }
    }

    async function scanReviewCase(appNo, {signal, isActive, year = 116, standard = year===116?REVIEW_STANDARD:null} = {}) {
        if (!Number.isInteger(year) || year<100 || year>199 || !/^(?:EA|KA)1\d{8}$/.test(appNo) || Number(appNo.slice(2,6))!==1000+year || typeof isActive !== 'function' || !isActive()) throw new Error('案件不符合所選清查年度');
        const getDocument = async url => {
            if (signal?.aborted || !isActive()) throw new DOMException('掃描已停止','AbortError');
            const response = await fetch(url,{credentials:'include',signal});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return new DOMParser().parseFromString(await response.text(),'text/html');
        };
        const doc = await getDocument(`/socs/jsp/sa/sa1/sa12010_action.jsp?app_no=${encodeURIComponent(appNo)}&status=get`);
        const checkedDoc = {location:{pathname:'/socs/jsp/sa/sa1/sa12010_action.jsp'},querySelector:s=>doc.querySelector(s),querySelectorAll:s=>doc.querySelectorAll(s)};
        if (!isEligibleReviewDocument(checkedDoc,year) || doc.querySelector('[name="app_no"]')?.value!==appNo) throw new Error('案件作業、年度或回應案號不符；請確認登入與權限');
        const caseStatus=doc.querySelector('[name="case_status"]')?.value;
        if(!caseStatus)throw new Error('未取得案件狀態，請確認登入與權限');
        if(caseStatus!=='3')return {appNo,skipped:true,caseStatus,checkedAt:Date.now(),version:2,reviewRuleVersion:REVIEW_RULE_VERSION};
        const population = readReviewPopulation(doc);
        const query = reviewSeedQuery(doc,appNo);
        const seed = await getDocument(`/socs/jsp/sz/sz3/sz31010_upd.jsp?${query}`);
        if (seed.querySelector('[name="app_no"]')?.value!==appNo) throw new Error('財稅回應案號不符；請確認登入與權限');
        const params = new URLSearchParams();
        seed.querySelectorAll('input[name],select[name]').forEach(e=>params.set(e.name,e.value));
        const record={payloadString:params.toString(),ownerAppNo:appNo,seedPage:{appNo,type:'1',doc:seed},isActive:()=>!signal?.aborted&&isActive()};
        // 六類本年資料與去年車輛、不動產同時送出；單類失敗只標示該類，中止則整案停止。
        const tolerate=async task=>{try{return await task();}catch(error){if(error.name==='AbortError')throw error;return {error:true,message:error.message};}};
        const previousAppNo=findReviewPreviousCase(seed,appNo);
        const [entries,previous]=await Promise.all([
            Promise.all(DATA_TYPES.map(async item=>[item.key,await tolerate(()=>fetchType(record,appNo,item,signal))])),
            previousAppNo?Promise.all(['movable','immovable'].map(key=>tolerate(()=>fetchType(record,previousAppNo,DATA_TYPES.find(t=>t.key===key),signal)))):[]
        ]);
        let results=Object.fromEntries(entries);
        if (previousAppNo) {
            results=applyReviewHistory(results,previousAppNo,...previous,population);
        }
        results=applyPreviousDeposits({...results,population});
        results=reconcileReviewInvestments(results,population);
        return reviewResult(appNo,{...results,previousCategory:readPreviousReviewCategory(doc,appNo)},population,standard);
    }
    function reviewResult(appNo,results,population,standard) {
        const external=externalContribution(results.external,population.members,results.movable,results.income);
        const assessment=reviewAssessment(results,population,external,standard);
        const income=Number.isFinite(results.summary?.income)?perPersonValue(results.summary.income/12+external.monthlyIncome,population.count):null;
        const movable=Number.isFinite(results.summary?.movable)?perPersonValue(results.summary.movable+external.movable,population.count):null;
        const flags=[];
        for(const [key,label] of [['movable','車輛'],['immovable','不動產']]) {
            const data=results[key];
            const added=(data?.details||[]).filter(r=>r.change?.kind==='added'&&r.counted===true&&population.members?.[r.idNo]===true).length;
            const removed=(data?.removedPrevious||[]).filter(r=>population.members?.[r.idNo]===true).length;
            // 不動產增加只作參考，不計不符；全戶總額超標由金額門檻判定。
            if(key==='movable'&&added)flags.push(`車輛新增${added}`);
            if(key==='immovable'&&added)flags.push(`參考：不動產新增${added}`);
            if(removed)flags.push(`${label}減少${removed}`);
        }
        if((results.movable?.details||[]).some(r=>r.previousAmount&&r.counted===true))flags.push('汽車採去年金額，請補登財稅');
        if((results.movable?.previousDepositNotes||[]).some(r=>r.depositIncluded))flags.push('存款採去年金額，請補登財稅');
        if(external.details.some(r=>r.counted===true&&r.category))flags.push('外單位請確認轉入財稅');
        if(results.investment?.personTotals?.some(r=>r.commercialAmount>0))flags.push('含商業司小額投資');
        return {appNo,checkedAt:Date.now(),version:2,reviewRuleVersion:REVIEW_RULE_VERSION,assetComparisonVersion:2,previousCategory:results.previousCategory,low:assessment.low,middle:assessment.middle,values:{income,movable,immovable:results.summary?.immovable??null},population:population.count,flags};
    }

    window.swisReviewEngine = Object.freeze({scanCase:scanReviewCase,lookupPreviousCategory:lookupPreviousReviewCategory,readPreviousCategory:readPreviousReviewCategory,version:2,ruleVersion:REVIEW_RULE_VERSION});
    // 最高優先級：其他頁面只提供共用計算，不建立面板或自動查詢。
    if (window.top === window || location.pathname !== '/socs/jsp/sa/sa1/sa12010_action.jsp') return;
    if (window.swisReviewSummaryLoaded) return;
    window.swisReviewSummaryLoaded = true;
    const updateSettings=value=>{
        reviewSettings=value?.batchReview;
        reviewSettingsReady=true;
        safelySyncActiveCase();
        if(renderedReview&&isEligibleReviewDocument(renderedReview.panel.ownerDocument, selectedReviewYear()))renderCards(renderedReview.panel,renderedReview.results);
    };
    try {
        chrome.storage.local.get('swisExtensionSettings',saved=>{updateSettings(chrome.runtime.lastError ? undefined : saved?.swisExtensionSettings);});
        chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.swisExtensionSettings)updateSettings(changes.swisExtensionSettings.newValue);});
    } catch { reviewSettingsReady=true; /* 無擴充功能儲存環境時沿用預設門檻。 */ }
    safelySyncActiveCase();
    const reviewInterval = window.setInterval(() => {
        if (!extensionContextValid()) { window.clearInterval(reviewInterval); return; }
        safelySyncActiveCase();
    }, 600);
    window.addEventListener('pageshow', safelySyncActiveCase);
    window.addEventListener('pagehide', () => { activeRequest?.abort(); });
})();






