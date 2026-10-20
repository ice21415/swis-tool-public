(function () {
    'use strict';
    function decideBase(result) {
        if(result.error)return {text:`不符：資料讀取失敗（${result.error}）`,state:'error'};
        // 減少與金額超標列為不符；新增車輛由顯示層標為待確認。
        const reasons=(result.flags||[]).flatMap(flag=>{
            if(flag.startsWith('不動產減少'))return [flag];
            const removed=flag.startsWith('車輛')&&flag.match(/減少\d+/);
            return removed?[`車輛${removed[0]}`]:[];
        });
        if(result.middle?.state==='exceeded')reasons.push(...result.middle.text.replace(/^不符[:：]/,'').replace(/（試算）/g,'').split(' · ')[0].split('；'));
        if(reasons.length)return {text:`不符：${[...new Set(reasons)].join('；')}`,state:'exceeded'};
        const within=value=>{
            if(value?.state==='matched')return true;
            if(value?.state!=='pending'||!value.text?.startsWith('暫符門檻'))return false;
            const reasons=value.text.split(' · ').slice(1).join('、').split('、');
            return reasons.every(reason=>['投資待回覆','汽車採去年金額'].includes(reason)||(reason==='投資資料待核'&&reasons.includes('投資待回覆')));
        };
        if(within(result.low))return {text:'符合低收',state:'matched'};
        if(within(result.middle))return {text:'符合中低收',state:'matched'};
        return {text:`待確認：${(result.middle?.text||result.low?.text||'人口或財稅資料待確認').replace(/^待確認[:：]/,'')}`,state:'pending'};
    }
    // 不動產增加不影響判定，但結果必須特別標示，提醒人工留意。
    function decideResult(result) {
        const base=decideBase(result);
        const added=(result.flags||[]).some(flag=>/^車輛新增/.test(flag));
        if(added&&base.state==='matched'){
            const property=(result.flags||[]).some(flag=>flag.startsWith('參考：不動產新增'))?'（不動產增加）':'';
            return {text:`待確認：車輛新增${property}`,state:'pending'};
        }
        const notes=[];
        if(added&&!base.text.includes('車輛新增'))notes.push('車輛新增');
        if((result.flags||[]).some(flag=>flag.startsWith('參考：不動產新增')))notes.push('不動產增加');
        return notes.length?{...base,text:`${base.text}（${notes.join('、')}）`}:base;
    }
    function decision(result) {
        const base=decideResult(result);
        base.text=base.text.replace(/超標/g,'超過');
        return result.previousCategory?{...base,text:`${base.text}\n去年：${result.previousCategory.label||'待確認'}`}:base;
    }
    function renderSummary(summary,data) {
        const result=decision(data);
        if(summary.textContent===result.text&&summary.querySelector('.swis-batch-current'))return;
        const current=document.createElement('span');
        current.className='swis-batch-current';
        current.textContent=decideResult(data).text.replace(/超標/g,'超過');
        summary.replaceChildren(current);
        if(data.previousCategory){
            const previous=document.createElement('span');
            previous.className='swis-batch-previous';
            previous.textContent=`去年：${data.previousCategory.label||'待確認'}`;
            summary.append(document.createTextNode('\n'),previous);
        }
    }
    window.swisReviewBatchPresentation=Object.freeze({decision,renderSummary});
    if(window.swisReviewBatchPresentationLoaded)return;
    window.swisReviewBatchPresentationLoaded=true;
    function eligible() {
        if(location.pathname!=='/socs/jsp/sa/sa1/sa12010_list.jsp'||document.querySelector('[name="prog_id"]')?.value!=='SA12010')return false;
        try {const d=window.parent.document;return d.location.pathname==='/socs/jsp/sa/sa1/sa12010_main.jsp'&&[...d.querySelectorAll('table.title1')].some(t=>t.textContent.replace(/\s/g,'')==='社會救助／低收入戶生活扶助／案件管理／申請資料維護作業(SA12010)');}catch{return false;}
    }
    if(!eligible())return;
    const painted=new WeakMap();
    function update() {
        if(!eligible())return;
        for(const box of document.querySelectorAll('[data-swis-batch-result]')) {
            const headers=[...(document.querySelector('tr.title1')?.cells||[])];
            const statusIndex=headers.findIndex(c=>c.textContent.replace(/\s/g,'').includes('案件狀態'));
            if(statusIndex<0||!/財稅已轉入/.test(box.closest('tr')?.cells[statusIndex]?.textContent||'')){box.remove();continue;}
            if(painted.get(box)===box.dataset.stamp)continue;
            const year=window.swisReviewBatchActiveYear||window.swisReviewConfig?.normalize(window.swisExtensionSettings?.batchReview).year||116;
            if(!/^(?:EA|KA)1\d{8}$/.test(box.dataset.swisBatchResult)||Number(box.dataset.swisBatchResult.slice(2,6))!==1000+year)continue;
            let data;try{data=JSON.parse(box.dataset.stamp);}catch{continue;}
            painted.set(box,box.dataset.stamp);
            const result=window.swisReviewBatchPresentation.decision(data);
            const summary=box.querySelector('summary');
            if(summary)window.swisReviewBatchPresentation.renderSummary(summary,data);
            box.dataset.state=result.state;
            box.title=`本頁試算；低收：${data.low?.text||'待確認'}；中低收：${data.middle?.text||'待確認'}`.replace(/超標/g,'超過');
        }
    }
    new MutationObserver(update).observe(document.body,{childList:true,subtree:true});
    update();
})();
