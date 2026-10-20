(function () {
    'use strict';
    const STANDARD_116={low:{income:17890,movable:105000,immovable:4020000},middle:{income:26835,movable:157500,immovable:6030000}};
    const integer=(value,min,max,fallback)=>Number.isInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;
    function dates(year){return {startDate:`${year}0101`,endDate:`${year}0102`};}
    function validDate(value,year){
        if(!/^\d{7}$/.test(String(value))||Number(String(value).slice(0,3))!==year)return false;
        const month=Number(String(value).slice(3,5)),day=Number(String(value).slice(5,7));
        const date=new Date(year+1911,month-1,day);
        return date.getFullYear()===year+1911&&date.getMonth()===month-1&&date.getDate()===day;
    }
    function validStandard(value){return !!value&&['low','middle'].every(kind=>['income','movable','immovable'].every(key=>Number.isFinite(value[kind]?.[key])&&value[kind][key]>=0))&&['income','movable','immovable'].every(key=>value.middle[key]>=value.low[key]);}
    function normalize(raw={}){
        if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
        const year=integer(raw.year,100,199,116), range=dates(year);
        const standardsByYear={116:structuredClone(STANDARD_116)};
        for(const [key,value] of Object.entries(raw.standardsByYear||{}))if(/^1\d{2}$/.test(key)&&(value===null||validStandard(value)))standardsByYear[key]=value===null?null:structuredClone(value);
        const {cacheMinutes,...preserved}=raw;
        return {...preserved,schemaVersion:1,year,startDate:validDate(raw.startDate,year)?raw.startDate:range.startDate,endDate:validDate(raw.endDate,year)?raw.endDate:range.endDate,concurrency:integer(raw.concurrency,1,10,3),showResults:raw.showResults!==false,standardsByYear};
    }
    function validate(raw){
        const errors=[],year=Number(raw.year);
        if(!Number.isInteger(year)||year<100||year>199)errors.push('請選擇有效的清查年度');
        if(!validDate(raw.startDate,year)||!validDate(raw.endDate,year))errors.push('日期須為該年度有效的民國7碼日期');
        else if(raw.startDate>raw.endDate)errors.push('開始日期不可晚於結束日期');
        if(integer(raw.concurrency,1,10,null)===null)errors.push('同時掃描案件數須為1～10');
        const standard=raw.standardsByYear?.[year];
        if(standard!==undefined&&standard!==null&&!validStandard(standard))errors.push('門檻須為非負數，中低收門檻不可低於低收');
        return errors;
    }
    const matchesYear=(appNo,year)=>/^(?:EA|KA)1\d{8}$/.test(appNo||'')&&Number(appNo.slice(2,6))===1000+Number(year);
    function policyKey(raw){const config=normalize(raw);return JSON.stringify({year:config.year,standard:config.standardsByYear[config.year]||null});}
    function compatible(result,raw){const config=normalize(raw);return matchesYear(result?.appNo,config.year)&&(result.policyKey?result.policyKey===policyKey(config):config.year===116&&policyKey(config)===policyKey(normalize()));}
    window.swisReviewConfig=Object.freeze({normalize,validate,dates,validDate,validStandard,matchesYear,policyKey,compatible});
})();
