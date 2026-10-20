// ============================================
// 過往備註與歷史案件功能模組
// ============================================

if (typeof window.ensureDialogInlineImportantStyles !== 'function') {
    window.ensureDialogInlineImportantStyles = function (root) {
        if (!root) return;

        const propsToPromote = [
            'background',
            'background-color',
            'color',
            'border',
            'border-top',
            'border-right',
            'border-bottom',
            'border-left',
            'border-color',
            'box-shadow'
        ];

        const targets = [];
        if (root instanceof Element && root.hasAttribute('style')) {
            targets.push(root);
        }
        if (root.querySelectorAll) {
            targets.push(...root.querySelectorAll('[style]'));
        }

        for (const el of targets) {
            for (const prop of propsToPromote) {
                const value = el.style.getPropertyValue(prop);
                if (value) {
                    el.style.setProperty(prop, value, 'important');
                }
            }
        }
    };
}

// 偵測頁面類型並回傳對應的 API 參數
function getPageApiConfig() {
    const title1 = document.querySelector('.title1')?.innerText || document.title || '';

    // 老人福利頁面 (中低老人生活津貼)
    if (title1.includes('老人福利') || title1.includes('中低老人') || title1.includes('SC12010') || title1.includes('SC19020')) {
        return {
            pageType: 'elderly',
            listApiUrl: '/socs/jsp/ml/app/app1030_list.jsp',
            detailApiUrl: '/socs/jsp/ml/app/app1030_action.jsp',
            sys_code: 'C1',
            prog_id: 'SC19020',
            // 老人福利使用不同的參數結構
            customParams: {
                sys_age: '65',
                sys_psnkind: 'A',
                sys_kind: '0',
                sys_idl: '0',
                chk_tax: 'Y',
                yn_qry: '',
                qchk_sts01: 'N'
            }
        };
    }

    // 身障福利頁面
    if (title1.includes('身障福利') || title1.includes('身心障礙') || title1.includes('SH22010') || title1.includes('SH29020')) {
        return {
            pageType: 'disability',
            listApiUrl: '/socs/jsp/sz/szz/szz9020_list.jsp',
            detailApiUrl: '/socs/jsp/sz/szz/szz9020_get_fam.jsp',
            soc_type: 'B211',
            sys_code: 'H2',
            prog_id: 'SH29020',
            q_type: '2'
        };
    }

    // 預設：低收入戶頁面
    return {
        pageType: 'lowIncome',
        listApiUrl: '/socs/jsp/sz/szz/szz9020_list.jsp',
        detailApiUrl: '/socs/jsp/sz/szz/szz9020_get_fam.jsp',
        soc_type: 'A111,A112,A113,A121,A122,B212,B213,C112,C113',
        sys_code: 'A1',
        prog_id: 'SA19020',
        q_type: '3'
    };
}

async function fetchHistoricalCases(idNo) {
    const config = getPageApiConfig();
    const url = `${location.origin}${config.listApiUrl}`;

    let params;

    // 老人福利使用不同的參數結構
    if (config.pageType === 'elderly') {
        params = new URLSearchParams({
            sys_code: config.sys_code,
            prog_id: config.prog_id,
            ...config.customParams,
            zipno: '',
            qcityno: '',
            qtownno: '',
            qvillageno: '',
            qstand_year: '',
            qapp_no: '',
            qid_no: idNo,
            qcname: '',
            qapp_sdate: '',
            qapp_edate: '',
            qchk_status: '',
            status: 'qry'
        });
    } else {
        // 低收入戶 / 身障福利
        params = new URLSearchParams({
            soc_type: config.soc_type,
            sys_code: config.sys_code,
            prog_id: config.prog_id,
            chk_yn: 'Y',
            zipno: '',
            qzap_city: '',
            qzap_town: '',
            qzap_vill: '',
            qstand_year: '',
            qapp_no: '',
            qid_no: idNo,
            qcname: '',
            qapp_sdate: '',
            qapp_edate: '',
            qchk_status: '',
            q_type: config.q_type,
            qdata_type: 'fam',
            status: 'qry'
        });
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });

        if (!response.ok) throw new Error('API request failed');
        const html = await response.text();

        // 解析案件列表
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const cases = [];
        const seenAppNos = new Set(); // 用於去重複
        const config = getPageApiConfig();

        // 老人福利頁面：嘗試從下拉選單或表格行解析案件
        if (config.pageType === 'elderly') {
            // 方法1: 從下拉選單解析 (detail 頁面)
            const selectOptions = doc.querySelectorAll('select[name="qry_app_no"] option');

            if (selectOptions.length > 0) {
                for (const option of selectOptions) {
                    // 格式: 案號｜｜審核階段｜年度｜行政區
                    const value = option.value || '';
                    const text = option.innerText || '';
                    const parts = value.split('｜');

                    if (parts.length >= 1) {
                        const appNo = parts[0];
                        const typeText = parts.length >= 3 ? parts[2] : '';

                        if (appNo && appNo.match(/^[A-Z]{2}\d+$/) && !seenAppNos.has(appNo)) {
                            seenAppNos.add(appNo);
                            const dateMatch = text.match(/【(\d+)年度】/);
                            const appDate = dateMatch ? `${dateMatch[1]}/01/01` : '';
                            cases.push({ appNo, lowType: typeText, typeText: typeText || '複審', headName: '', status: '', appDate });
                        }
                    }
                }
            } else {
                const rows = doc.querySelectorAll('tr.title4');

                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    const district = cells[1]?.innerText?.trim() || '';  // 鄉鎮市區村里

                    // 嘗試從各欄位找案號格式 EC/AC/NC...
                    for (let i = 0; i < cells.length && i < 5; i++) {
                        const cellText = cells[i]?.innerText?.trim();
                        if (cellText && cellText.match(/^[A-Z]{2}\d{8,}$/)) {
                            if (!seenAppNos.has(cellText)) {
                                seenAppNos.add(cellText);
                                const dateCell = cells[i + 1]?.innerText?.trim() || '';
                                cases.push({ appNo: cellText, lowType: '', typeText: '複審', headName: '', status: '', appDate: dateCell, district });
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            const rows = doc.querySelectorAll('tr.title4');

            for (const row of rows) {
                const cells = row.querySelectorAll('td');

                if (cells.length >= 5) {
                    const district = cells[1]?.innerText.trim();  // 鄉鎮市區村里
                    const appNo = cells[2]?.innerText.trim();
                    const lowType = cells[3]?.innerText.trim();
                    const headName = cells[4]?.innerText.trim();
                    const status = cells.length >= 12 ? cells[11]?.innerText.replace(/\s+/g, ' ').trim() : '';

                    if (appNo && appNo.match(/^[A-Z]{2}\d+$/) && !seenAppNos.has(appNo)) {
                        seenAppNos.add(appNo);
                        let typeText = lowType;
                        if (lowType === '1' || lowType === '2' || lowType === '3' || lowType === '4') typeText = '低收' + lowType;
                        else if (lowType === 'M') typeText = '中低收';

                        cases.push({ appNo, lowType, typeText, headName, status, district });
                    }
                }
            }
        }

        return cases;
    } catch (error) {
        return [];
    }
}

async function fetchCaseDetails(appNo, applicantIdNo) {
    const config = getPageApiConfig();
    const url = `${location.origin}${config.detailApiUrl}`;

    let params;

    // 獲取 qcityno (老人福利需要)
    const qcityno = document.querySelector('input[name="qcityno"]')?.value ||
        document.querySelector('select[name="zap_city"]')?.value || '';

    if (config.pageType === 'elderly') {
        params = new URLSearchParams({
            sys_code: config.sys_code,
            prog_id: config.prog_id,
            sys_age: '65',
            sys_psnkind: 'A',
            sys_kind: '0',
            sys_idl: '0',
            chk_tax: 'Y',
            yn_qry: 'N',
            qchk_sts01: 'N',
            qprint_type: '',
            qcityno: qcityno,
            qtownno: '',
            qvillageno: '',
            qstand_year: '',
            qapp_no: '',
            qid_no: applicantIdNo || '',
            qcname: '',
            qapp_sdate: '',
            qapp_edate: '',
            qchk_status: '',
            qcase_status: '',
            qnum_type: '',
            total_page: '1',
            now_page: '1',
            key: appNo,
            status: 'get'
        });
    } else {
        params = new URLSearchParams({
            prog_id: config.prog_id,
            qzap_city: '',
            qzap_town: '',
            qzap_vill: '',
            qapp_no: '',
            qid_no: applicantIdNo || '',
            qcname: '',
            qapp_sdate: '',
            qapp_edate: '',
            qchk_status: '',
            q_type: config.q_type,
            qdata_type: 'fam',
            soc_type: config.soc_type,
            sys_code: config.sys_code,
            qkey: appNo,
            key: appNo,
            history_yn: '',
            qstand_year: '',
            qlow_type: '',
            qcase_type: '',
            chk_yn: 'Y',
            qwindow_type: '',
            status: 'get'
        });
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });

        if (!response.ok) throw new Error('API request failed');
        const html = await response.text();

        // 解析詳細資料
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 提取各項資料
        const result = {
            appNo: appNo,
            caseType: '',      // 核定款類別
            appDate: '',       // 申請日期
            headId: '',
            headName: '',
            address: '',
            phone: '',
            memo: '',          // 備註
            members: []        // 人口資料
        };

        // 找所有 title2 + title4 的配對
        const rows = doc.querySelectorAll('tr');
        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            for (let i = 0; i < cells.length - 1; i++) {
                const label = cells[i]?.innerText?.trim();
                const value = cells[i + 1]?.innerText?.trim();

                if (label === '核定款類別：') result.caseType = value?.replace('核定款類別：', '').trim() || '';
                if (label === '申請日期') result.appDate = value || '';
                if (label === '證件備齊日期' && !result.appDate) result.appDate = value || '';
                if (label === '戶長身分證字號') result.headId = value || '';
                if (label === '戶長姓名') result.headName = value || '';
                if (label === '戶籍地址') result.address = cells[i + 1]?.innerText?.trim() || '';
                if (label === '聯絡電話1' || label === '聯絡電話') result.phone = value || '';
                if (label === '備註') result.memo = cells[i + 1]?.innerText?.trim() || '';
            }
        }

        // 提取核定款類別 (在 title4 的 font color=blue 中)
        const caseTypeFont = doc.querySelector('tr.title4 td b font[color="blue"]');
        if (caseTypeFont) {
            result.caseType = caseTypeFont.innerText.trim();
        }

        // 提取人口資料表格 - 根據頁面類型使用不同解析
        const config = getPageApiConfig();

        if (config.pageType === 'elderly') {
            const memberRows = doc.querySelectorAll('tr.title4');

            for (const row of memberRows) {
                const cells = row.querySelectorAll('td');

                if (cells.length >= 10) {
                    const firstCellText = cells[0]?.innerText?.trim();
                    if (/^\d+$/.test(firstCellText)) {
                        const nameIdCell = cells[6]?.innerHTML || '';
                        const birthAgeCell = cells[7]?.innerHTML || '';

                        const nameIdParts = nameIdCell.split(/<br\s*\/?>/i);
                        const birthAgeParts = birthAgeCell.split(/<br\s*\/?>/i);

                        result.members.push({
                            relation: cells[5]?.innerText?.trim() || '',
                            name: nameIdParts[0]?.replace(/<[^>]*>/g, '').trim() || '',
                            idNo: nameIdParts[1]?.replace(/<[^>]*>/g, '').trim() || '',
                            birthDate: birthAgeParts[0]?.replace(/<[^>]*>/g, '').trim() || '',
                            age: birthAgeParts[1]?.replace(/<[^>]*>/g, '').trim() || ''
                        });
                    }
                }
            }
        } else {
            const memberRows = doc.querySelectorAll('table#list_t tr.title4');
            for (const row of memberRows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 12) {
                    result.members.push({
                        relation: cells[7]?.innerText?.trim() || '',
                        idNo: cells[8]?.innerText?.trim() || '',
                        name: cells[9]?.innerText?.trim() || '',
                        birthDate: cells[10]?.innerText?.trim() || '',
                        age: cells[11]?.innerText?.trim() || ''
                    });
                }
            }
        }

        const yearDropdown = doc.querySelector('select[name="qry_app_no"]');
        if (yearDropdown) {
            const historyCases = [];
            yearDropdown.querySelectorAll('option').forEach(opt => {
                const value = opt.value || '';
                const match = value.match(/^([A-Z]{2}\d+)/);
                if (match) {
                    const textMatch = opt.textContent.match(/【(\d+)年度】/);
                    historyCases.push({
                        appNo: match[1],
                        year: textMatch ? parseInt(textMatch[1]) : null,
                        text: opt.textContent.trim()
                    });
                }
            });
            result.historyCases = historyCases;

            const currentCase = historyCases.find(c => c.appNo === appNo);
            if (currentCase?.year) {
                const prevYearCase = historyCases.find(c => c.year === currentCase.year - 1);
                result.previousYearAppNo = prevYearCase?.appNo || '';
            }
        }

        return result;
    } catch (error) {
        return { error: '獲取資料失敗: ' + error.message };
    }
}

async function fetchTaxData(appNo, applicantIdNo) {
    const config = getPageApiConfig();

    if (config.pageType === 'elderly') {
        return [];
    }

    const url = `${location.origin}/socs/jsp/sz/szz/szz9020_get_tax.jsp`;

    const params = new URLSearchParams({
        prog_id: config.prog_id,
        qzap_city: '',
        qzap_town: '',
        qzap_vill: '',
        qapp_no: '',
        qid_no: applicantIdNo || '',
        qcname: '',
        qapp_sdate: '',
        qapp_edate: '',
        qchk_status: '',
        q_type: config.q_type,
        qdata_type: 'tax',
        soc_type: config.soc_type,
        sys_code: config.sys_code,
        qkey: appNo,
        key: appNo,
        history_yn: '',
        qstand_year: '',
        qlow_type: '',
        qcase_type: '',
        chk_yn: 'Y',
        qwindow_type: '',
        status: 'get'
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });

        if (!response.ok) throw new Error('API request failed');
        const html = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const taxRecords = [];
        const rows = doc.querySelectorAll('table#list_t tr.title4[name="list"]');

        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 10) {
                taxRecords.push({
                    idNo: cells[0]?.innerText?.trim() || '',
                    name: cells[1]?.innerText?.trim() || '',
                    relation: cells[2]?.innerText?.trim() || '',
                    year: cells[3]?.innerText?.trim() || '',
                    counted: cells[4]?.innerText?.trim() || '',
                    incomeType: cells[5]?.innerText?.trim() || '',
                    company: cells[6]?.innerText?.trim() || '',
                    amount: cells[7]?.innerText?.trim() || '',
                    detail: cells[9]?.innerText?.trim() || '',
                    note: cells[11]?.innerText?.trim() || ''
                });
            }
        }

        return taxRecords;
    } catch (error) {
        return [];
    }
}

async function fetchTaxSummaryForCase(appNo, previousYearAppNo = '') {
    try {
        async function fetchTaxForOneCase(caseNo) {
            const url = `${location.origin}/socs/jsp/sz/sz3/sz31010_upd.jsp`;
            const form = document.querySelector('form[name="main"]') || document.querySelector('form');
            const params = new URLSearchParams();

            if (form) {
                const fields = form.querySelectorAll('input, select, textarea');
                fields.forEach(el => {
                    const name = el.name;
                    if (!name) return;
                    if (el.tagName === 'SELECT') {
                        const opt = el.selectedOptions?.[0];
                        params.append(name, opt ? opt.value : el.value);
                        return;
                    }
                    if (el.tagName === 'TEXTAREA') {
                        params.append(name, el.value || '');
                        return;
                    }
                    if (el.type === 'checkbox' || el.type === 'radio') {
                        if (!el.checked) return;
                        params.append(name, el.value || 'on');
                        return;
                    }
                    params.append(name, el.value || '');
                });
            }

            params.set('app_no', caseNo);
            params.set('q_data_type', '4');
            params.set('chk_case', caseNo);
            params.set('status', 'list');

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                credentials: 'include'
            });

            if (!response.ok) return null;
            const html = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const inputs = doc.querySelectorAll('input[name="cnt1"]');
            let income = 0, incomeMonthly = 0, movable = 0, immovable = 0;

            inputs.forEach(input => {
                const td = input.closest('td');
                const prevTd = td?.previousElementSibling;
                if (!prevTd) return;
                const label = prevTd.textContent.trim();
                const value = parseInt(input.value.replace(/,/g, '')) || 0;

                const tdText = td?.textContent || '';
                const monthlyMatch = tdText.match(/月[:：]\s*([\d,.]+)/);
                const monthlyValue = monthlyMatch ? parseFloat(monthlyMatch[1].replace(/,/g, '')) : 0;

                if (label.includes('所得合計')) {
                    income = value;
                    incomeMonthly = monthlyValue;
                } else if (label.includes('不動產合計')) {
                    immovable = value;
                } else if (label.includes('動產合計')) {
                    movable = value;
                }
            });

            return { income, incomeMonthly, movable, immovable };
        }

        const [currentTax, currentCounts] = await Promise.all([
            fetchTaxForOneCase(appNo),
            (typeof fetchAndParseCurrentImmovableCounts === 'function') ? fetchAndParseCurrentImmovableCounts(appNo) : Promise.resolve({})
        ]);

        if (!currentTax) return null;

        const currentYear = { ...currentTax, ...(currentCounts || {}) };
        let previousYear = { income: 0, movable: 0, immovable: 0 };

        if (previousYearAppNo && previousYearAppNo !== appNo) {
            const [prevTax, prevCounts] = await Promise.all([
                fetchTaxForOneCase(previousYearAppNo),
                (typeof fetchAndParseCurrentImmovableCounts === 'function') ? fetchAndParseCurrentImmovableCounts(previousYearAppNo) : Promise.resolve({})
            ]);
            if (prevTax) {
                previousYear = { ...prevTax, ...(prevCounts || {}) };
            }
        }

        return { currentYear, previousYear };
    } catch (error) {
        return null;
    }
}

async function showHistoricalNotesDialog(cases, currentAppNo, queryIdNo = null) {
    const existing = document.getElementById('historical-notes-dialog');
    if (existing) existing.remove();

    const filteredCases = cases;

    if (filteredCases.length === 0) {
        showStatusBanner('找不到其他歷史案件', 'info', 2000);
        return;
    }

    const caseRelations = {};
    if (queryIdNo) {
        showStatusBanner('正在載入案件資訊...', 'info', 1500);

        // 使用併發管理器處理請求，避免過多同時請求
        const tasks = filteredCases.map(c => () => (async () => {
            try {
                const details = await fetchCaseDetails(c.appNo, queryIdNo);
                if (details?.members && details.members.length > 0) {
                    let member = details.members.find(m => m.idNo === queryIdNo);
                    if (!member) {
                        member = details.members.find(m => m.idNo && m.idNo.includes(queryIdNo));
                    }
                    if (!member) {
                        member = details.members.find(m => m.relation === '戶長');
                    }
                    if (member?.relation) {
                        caseRelations[c.appNo] = member.relation;
                    }
                }
            } catch (e) { }
        })());

        if (window.apiConcurrencyManager) {
            await Promise.all(tasks.map(task => window.apiConcurrencyManager.add(task)));
        } else {
            await Promise.all(tasks.map(t => t()));
        }
    }

    const overlay = document.createElement('div');
    overlay.id = 'historical-notes-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:8px;padding:20px;max-width:700px;width:90%;max-height:80vh;overflow:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);';

    const title = document.createElement('h3');
    title.textContent = '過往備註';
    title.style.cssText = 'margin:0 0 15px 0;color:#333;border-bottom:2px solid #007bff;padding-bottom:10px;';

    const selectContainer = document.createElement('div');
    selectContainer.style.cssText = 'margin-bottom:15px;';

    const selectLabel = document.createElement('label');
    selectLabel.textContent = '選擇案號：';
    selectLabel.style.cssText = 'font-weight:bold;margin-right:10px;';

    const select = document.createElement('select');
    select.style.cssText = 'padding:8px 12px;font-size:14px;border:1px solid #ccc;border-radius:4px;min-width:200px;';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- 請選擇 --';
    select.appendChild(defaultOption);

    filteredCases.forEach(c => {
        const option = document.createElement('option');
        option.value = c.appNo;
        option.dataset.appNo = c.appNo;
        const districtShort = c.district ? c.district.replace(/^.{2,3}(市|縣)/, '') : '';
        const relationText = caseRelations[c.appNo] ? ` [${caseRelations[c.appNo]}]` : '';
        option.textContent = `${c.appNo} - ${c.typeText || c.lowType || '?'} - ${c.headName || ''} ${districtShort}${relationText}`;
        select.appendChild(option);
    });

    selectContainer.appendChild(selectLabel);
    selectContainer.appendChild(select);

    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = 'background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:15px;min-height:300px;max-height:60vh;overflow-y:auto;font-size:13px;';
    contentContainer.innerHTML = '<div style="color:#666;text-align:center;padding:50px;">請選擇案號以查看詳細資料</div>';
    window.ensureDialogInlineImportantStyles(contentContainer);

    function formatMemoText(text) {
        if (!text) return text;
        let result = text;
        const actionKeywords = '複查|重審|檢附|電聯|全戶|依據|送件|補件|核列|維持|改列|申復|案主|經查';
        result = result.replace(new RegExp(`([^\\n])(\\d{3}[\\.\\/]\\d{1,2}[\\.\\/]\\d{1,2})(${actionKeywords})`, 'g'), '$1\n$2$3');
        result = result.replace(/([。）；\n])(\d{3}(?:年度?)?(?:複查|總清查?|中低收總清))/g, '$1\n$2');
        return result;
    }

    function buildDetailsHtml(details, queryIdNo, taxRecords, taxSummary = null) {
        if (details.error) {
            return `<div style="color:red;padding:20px;">${escapeHtml(details.error)}</div>`;
        }

        let html = '';

        // 安全轉義使用者資料
        const safeAppNo = escapeHtml(details.appNo);
        const safeCaseType = escapeHtml(details.caseType);
        const safeAppDate = escapeHtml(details.appDate);
        const safeHeadName = escapeHtml(details.headName);
        const safeHeadId = escapeHtml(details.headId);
        const safeAddress = escapeHtml(details.address);
        const safePhone = escapeHtml(details.phone);

        html += '<div style="margin-bottom:15px;padding:10px;background:#e8f4fc;border-radius:4px;">';
        html += `<div style="font-weight:bold;margin-bottom:8px;color:#0066cc;">案件資訊</div>`;
        html += `<div>案號：<b>${safeAppNo}</b></div>`;
        if (details.caseType) html += `<div>款類別：<b style="color:#28a745;">${safeCaseType}</b></div>`;
        if (details.appDate) html += `<div>申請日期：${safeAppDate}</div>`;
        if (details.headName) html += `<div>戶長：${safeHeadName} (${safeHeadId})</div>`;
        if (details.address) html += `<div>地址：${safeAddress}</div>`;
        if (details.phone) html += `<div>電話：${safePhone}</div>`;
        html += '</div>';

        if (details.members && details.members.length > 0) {
            html += '<details open style="margin-bottom:10px;">';
            html += `<summary style="font-weight:bold;color:#0066cc;cursor:pointer;padding:8px;background:#f0f0f0;border-radius:4px;">家戶成員 (${details.members.length}人)</summary>`;
            html += '<div style="max-height:150px;overflow-y:auto;margin-top:8px;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<tr style="background:#ddd;"><th style="padding:4px;border:1px solid #ccc;">稱謂</th><th style="padding:4px;border:1px solid #ccc;">姓名</th><th style="padding:4px;border:1px solid #ccc;">身分證號</th><th style="padding:4px;border:1px solid #ccc;">生日</th><th style="padding:4px;border:1px solid #ccc;">足齡</th></tr>';
            for (const m of details.members) {
                const isHead = m.relation === '戶長';
                const rowStyle = isHead ? 'background:#fff59d;' : '';
                const safeRelation = escapeHtml(m.relation);
                const safeName = escapeHtml(m.name);
                const safeIdNo = escapeHtml(m.idNo);
                const safeBirthDate = escapeHtml(m.birthDate || '');
                const safeAge = escapeHtml(m.age || '');
                html += `<tr style="${rowStyle}"><td style="padding:4px;border:1px solid #ccc;">${safeRelation}</td><td style="padding:4px;border:1px solid #ccc;">${safeName}</td><td style="padding:4px;border:1px solid #ccc;">${safeIdNo}</td><td style="padding:4px;border:1px solid #ccc;">${safeBirthDate}</td><td style="padding:4px;border:1px solid #ccc;">${safeAge}</td></tr>`;
            }
            html += '</table></div></details>';
        }

        if (details.memo) {
            html += '<div style="margin-bottom:10px;">';
            html += `<div style="font-weight:bold;margin-bottom:8px;color:#0066cc;">備註</div>`;
            const safeMemo = escapeHtml(formatMemoText(details.memo));
            html += `<div style="white-space:pre-wrap;font-family:'NotoSansTC-Regular','Microsoft JhengHei','Segoe UI',sans-serif;font-size:14px;line-height:2.0;letter-spacing:0.3px;background:#fff;padding:12px;border:1px solid #ddd;border-radius:4px;">${safeMemo}</div>`;
            html += '</div>';
        }

        if (taxSummary) {
            const { currentYear, previousYear } = taxSummary;
            const formatNum = (n) => n ? n.toLocaleString() : '0';
            const formatDecimal = (n) => n ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0';
            const formatDiff = (curr, prev) => {
                const diff = curr - prev;
                if (diff === 0) return '';
                const color = diff > 0 ? '#dc3545' : '#28a745';
                const sign = diff > 0 ? '+' : '';
                return `<span style="color:${color};font-weight:bold;font-size:12px;">(${sign}${diff.toLocaleString()})</span>`;
            };

            html += '<div style="margin-bottom:12px;">';

            html += '<div style="background:linear-gradient(135deg,#ffb6c1,#ffc0cb);padding:4px 8px;font-weight:bold;font-size:13px;border-radius:3px 3px 0 0;">◎全家人口所得</div>';
            html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">';
            html += '<tr>';
            html += `<td style="padding:6px 10px;border:1px solid #ddd;width:30%;font-weight:bold;background:#fff8f8;">所得合計(年)</td>`;
            const incomeMonthly = currentYear.incomeMonthly || Math.round(currentYear.income / 12 * 100) / 100;
            const prevMonthly = previousYear.incomeMonthly || Math.round(previousYear.income / 12 * 100) / 100;
            const monthlyDiff = incomeMonthly - prevMonthly;
            const monthlyDiffHtml = monthlyDiff === 0 ? '' : `<span style="color:${monthlyDiff > 0 ? '#dc3545' : '#28a745'};font-weight:bold;font-size:11px;">(${monthlyDiff > 0 ? '+' : ''}${Math.round(monthlyDiff).toLocaleString()})</span>`;
            html += `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;background:#fff;">${formatNum(currentYear.income)}元 <font color="brown" style="font-size:11px;">【月: ${formatDecimal(incomeMonthly)}元】${monthlyDiffHtml}</font></td>`;
            html += '</tr>';
            if (previousYear.income > 0 || currentYear.income !== previousYear.income) {
                html += '<tr>';
                html += `<td colspan="2" style="padding:3px 10px;border:1px solid #ddd;background:#fff;"><font color="brown" style="font-size:12px;">【去年: ${formatNum(previousYear.income)}元】【月: ${formatDecimal(prevMonthly)}元】</font></td>`;
                html += '</tr>';
            }
            html += '</table>';

            html += '<div style="background:linear-gradient(135deg,#ffb6c1,#ffc0cb);padding:4px 8px;font-weight:bold;font-size:13px;">◎全家人口動產</div>';
            html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">';
            html += '<tr>';
            html += `<td style="padding:6px 10px;border:1px solid #ddd;width:30%;font-weight:bold;background:#fff8f8;">動產合計(年)</td>`;
            html += `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;background:#fff;">${formatNum(currentYear.movable)}元 ${formatDiff(currentYear.movable, previousYear.movable)}</td>`;
            html += '</tr>';
            if (previousYear.movable > 0 || currentYear.movable !== previousYear.movable) {
                html += '<tr>';
                html += `<td colspan="2" style="padding:3px 10px;border:1px solid #ddd;background:#fff;"><font color="brown" style="font-size:12px;">【去年: ${formatNum(previousYear.movable)}元】</font></td>`;
                html += '</tr>';
            }
            html += '</table>';

            html += '<div style="background:linear-gradient(135deg,#ffb6c1,#ffc0cb);padding:4px 8px;font-weight:bold;font-size:13px;">◎全家人口不動產</div>';
            html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';

            if ((currentYear.landTaxCount || 0) > 0 || (previousYear.landTaxCount || 0) > 0) {
                const currCount = currentYear.landTaxCount || 0;
                const prevCount = previousYear.landTaxCount || 0;
                const countDiff = currCount - prevCount;
                const diffText = countDiff === 0 ? '' : `<span style="color:${countDiff > 0 ? '#dc3545' : '#28a745'};font-size:11px;">(${countDiff > 0 ? '+' : ''}${countDiff})</span>`;
                html += '<tr>';
                html += `<td style="padding:4px 10px;border:1px solid #ddd;width:30%;background:#fff8f8;">田賦</td>`;
                html += `<td style="padding:4px 10px;border:1px solid #ddd;text-align:right;background:#fff;">${currCount}筆 ${diffText} <font color="brown" style="font-size:11px;">【去年: ${prevCount}筆】</font></td>`;
                html += '</tr>';
            }

            if ((currentYear.houseCount || 0) > 0 || (previousYear.houseCount || 0) > 0) {
                const currCount = currentYear.houseCount || 0;
                const prevCount = previousYear.houseCount || 0;
                const countDiff = currCount - prevCount;
                const diffText = countDiff === 0 ? '' : `<span style="color:${countDiff > 0 ? '#dc3545' : '#28a745'};font-size:11px;">(${countDiff > 0 ? '+' : ''}${countDiff})</span>`;
                html += '<tr>';
                html += `<td style="padding:4px 10px;border:1px solid #ddd;width:30%;background:#fff8f8;">房屋</td>`;
                html += `<td style="padding:4px 10px;border:1px solid #ddd;text-align:right;background:#fff;">${currCount}棟 ${diffText} <font color="brown" style="font-size:11px;">【去年: ${prevCount}棟】</font></td>`;
                html += '</tr>';
            }

            if ((currentYear.landCount || 0) > 0 || (previousYear.landCount || 0) > 0) {
                const currCount = currentYear.landCount || 0;
                const prevCount = previousYear.landCount || 0;
                const countDiff = currCount - prevCount;
                const diffText = countDiff === 0 ? '' : `<span style="color:${countDiff > 0 ? '#dc3545' : '#28a745'};font-size:11px;">(${countDiff > 0 ? '+' : ''}${countDiff})</span>`;
                html += '<tr>';
                html += `<td style="padding:4px 10px;border:1px solid #ddd;width:30%;background:#fff8f8;">土地</td>`;
                html += `<td style="padding:4px 10px;border:1px solid #ddd;text-align:right;background:#fff;">${currCount}筆 ${diffText} <font color="brown" style="font-size:11px;">【去年: ${prevCount}筆】</font></td>`;
                html += '</tr>';
            }

            html += '<tr>';
            html += `<td style="padding:6px 10px;border:1px solid #ddd;width:30%;font-weight:bold;background:#fff8f8;">不動產合計(年)</td>`;
            html += `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;background:#fff;">${formatNum(currentYear.immovable)}元 ${formatDiff(currentYear.immovable, previousYear.immovable)}</td>`;
            html += '</tr>';
            if (previousYear.immovable > 0 || currentYear.immovable !== previousYear.immovable) {
                html += '<tr>';
                html += `<td colspan="2" style="padding:3px 10px;border:1px solid #ddd;background:#fff;"><font color="brown" style="font-size:12px;">【去年: ${formatNum(previousYear.immovable)}元】</font></td>`;
                html += '</tr>';
            }
            html += '</table>';
            html += '</div>';
        }

        if (taxRecords && taxRecords.length > 0) {
            html += '<details style="margin-bottom:10px;">';
            html += `<summary style="font-weight:bold;color:#0066cc;cursor:pointer;padding:8px;background:#f0f0f0;border-radius:4px;">財稅資料 (${taxRecords.length}筆) - 點擊展開</summary>`;
            html += '<div style="max-height:250px;overflow-y:auto;margin-top:8px;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
            html += '<tr style="background:#ddd;"><th style="padding:4px;border:1px solid #ccc;">稱謂</th><th style="padding:4px;border:1px solid #ccc;">姓名</th><th style="padding:4px;border:1px solid #ccc;">列計</th><th style="padding:4px;border:1px solid #ccc;">類別</th><th style="padding:4px;border:1px solid #ccc;">單位</th><th style="padding:4px;border:1px solid #ccc;">金額</th><th style="padding:4px;border:1px solid #ccc;">明細</th></tr>';
            for (const t of taxRecords) {
                const isQueryPerson = queryIdNo && t.idNo && t.idNo.includes(queryIdNo);
                const rowStyle = isQueryPerson ? 'background:#fff59d;' : '';
                const countedStyle = t.counted.includes('Ｖ') ? 'color:green;font-weight:bold;' : 'color:#999;';
                html += `<tr style="${rowStyle}"><td style="padding:3px;border:1px solid #ccc;text-align:center;">${t.relation}</td><td style="padding:3px;border:1px solid #ccc;">${t.name}</td><td style="padding:3px;border:1px solid #ccc;text-align:center;${countedStyle}">${t.counted || '-'}</td><td style="padding:3px;border:1px solid #ccc;">${t.incomeType}</td><td style="padding:3px;border:1px solid #ccc;font-size:10px;">${t.company}</td><td style="padding:3px;border:1px solid #ccc;text-align:right;">${t.amount}</td><td style="padding:3px;border:1px solid #ccc;font-size:10px;">${t.detail}</td></tr>`;
            }
            html += '</table></div></details>';
        }

        return html;
    }

    const applicantIdNo = getApplicantIdNo();

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '關閉';
    closeBtn.style.cssText = 'margin-top:15px;padding:10px 30px;background:#007bff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;';
    closeBtn.onclick = () => overlay.remove();

    select.onchange = async () => {
        if (!select.value) {
            contentContainer.innerHTML = '<div style="color:#666;text-align:center;padding:50px;">請選擇案號以查看詳細資料</div>';
            window.ensureDialogInlineImportantStyles(contentContainer);
            return;
        }
        contentContainer.innerHTML = '<div style="text-align:center;padding:50px;">載入中...</div>';
        window.ensureDialogInlineImportantStyles(contentContainer);

        const [details, taxRecords] = await Promise.all([
            fetchCaseDetails(select.value, applicantIdNo),
            fetchTaxData(select.value, applicantIdNo)
        ]);

        const currentAppNo = select.value;
        const getYearFromAppNo = (appNo) => {
            const match = appNo.match(/^[A-Z]{2}(\d{4})/);
            return match ? parseInt(match[1]) : null;
        };
        const currentYear = getYearFromAppNo(currentAppNo);
        const previousYearCode = currentYear ? currentYear - 1 : null;

        const currentCase = filteredCases.find(c => c.appNo === currentAppNo);
        const currentHeadName = currentCase?.headName || details.headName || '';

        let previousYearAppNo = '';
        if (previousYearCode && currentHeadName) {
            const prefix = currentAppNo.substring(0, 2);
            const prevCase = filteredCases.find(c => {
                const cYear = getYearFromAppNo(c.appNo);
                return c.appNo.startsWith(prefix) &&
                    cYear === previousYearCode &&
                    c.headName === currentHeadName;
            });
            if (prevCase) {
                previousYearAppNo = prevCase.appNo;
            }
        }

        const taxSummary = await fetchTaxSummaryForCase(select.value, previousYearAppNo);

        contentContainer.innerHTML = buildDetailsHtml(details, applicantIdNo, taxRecords, taxSummary);
        window.ensureDialogInlineImportantStyles(contentContainer);
    };

    dialog.appendChild(title);
    dialog.appendChild(closeBtn);
    dialog.appendChild(selectContainer);
    dialog.appendChild(contentContainer);
    overlay.appendChild(dialog);
    window.ensureDialogInlineImportantStyles(overlay);

    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
}

function injectHistoricalNotesButton() {
    if (document.getElementById('historical-notes-btn')) return true;

    const memoTextarea = document.querySelector('textarea[name="memo"]');
    if (!memoTextarea) return false;
    const actionRow = getSwisMemoActionRow(memoTextarea);

    const btn = document.createElement('input');
    btn.id = 'historical-notes-btn';
    btn.type = 'button';
    btn.value = '查看過往備註';
    btn.style.cssText = 'margin-left:10px;background:#4CAF50;color:white;border:none;padding:3px 8px;cursor:pointer;border-radius:3px;';

    btn.onclick = async () => {
        btn.disabled = true;
        btn.value = '載入中...';

        const idNo = getApplicantIdNo();
        if (!idNo) {
            showStatusBanner('無法獲取申請人身分證字號', 'error', 3000);
            btn.disabled = false;
            btn.value = '查看過往備註';
            return;
        }

        const cases = await fetchHistoricalCases(idNo);
        const currentAppNo = document.querySelector('input[name="app_no"]')?.value;

        if (cases.length === 0) {
            showStatusBanner('找不到歷史案件', 'info', 2000);
        } else {
            showHistoricalNotesDialog(cases, currentAppNo, idNo);
        }

        btn.disabled = false;
        btn.value = '查看過往備註';
    };

    actionRow.appendChild(btn);
    return true;
}

function isMainQueryPage() {
    const url = location.href;
    const title = document.title || '';

    if (url.includes('_main.jsp') &&
        (title.includes('申請資料維護作業') || title.includes('資料查詢') || title.includes('全部案件查詢'))) {
        const idInput = document.querySelector('input[name="qid_no"]');
        return idInput !== null;
    }
    return false;
}

function injectManualHistoricalNotesButton() {
    const idInput = document.querySelector('input[name="qid_no"]');
    if (!idInput) return false;

    if (document.getElementById('manual-historical-notes-btn')) return true;

    const btn = document.createElement('input');
    btn.type = 'button';
    btn.id = 'manual-historical-notes-btn';
    btn.value = '過往全部案件';
    btn.className = 'button1';
    btn.style.cssText = 'margin-left:5px;background:#4CAF50;color:white;border:none;padding:3px 8px;cursor:pointer;border-radius:3px;';

    btn.onclick = async function () {
        const inputId = idInput.value.trim();
        if (!inputId || !/^[A-Z]\d{9}$/.test(inputId)) {
            alert('請輸入有效的身分證字號');
            return;
        }

        btn.disabled = true;
        btn.value = '查詢中...';

        try {
            const cases = await fetchHistoricalCases(inputId);
            if (cases.length === 0) {
                showStatusBanner('找不到歷史案件', 'info', 2000);
            } else {
                showHistoricalNotesDialog(cases, '', inputId);
            }
        } catch (error) {
            showStatusBanner('查詢失敗: ' + error.message, 'error', 3000);
        }

        btn.disabled = false;
        btn.value = '過往全部案件';
    };

    const qrySBtn = document.querySelector('input[name="b_qryS"]');
    if (qrySBtn) {
        qrySBtn.parentNode.insertBefore(btn, qrySBtn.nextSibling);
    } else {
        idInput.parentNode.insertBefore(btn, idInput.nextSibling);
    }

    return true;
}

// 頁面載入時檢查並注入按鈕 (統一入口)
let historicalNotesInjected = false;
function safeInjectHistoricalNotes() {
    if (historicalNotesInjected) return true;
    if (!document.body) return false;

    const injectedOnMaintenancePage = isApplicationMaintenancePage() ? injectHistoricalNotesButton() : false;
    const injectedOnQueryPage = isMainQueryPage() ? injectManualHistoricalNotesButton() : false;

    historicalNotesInjected = !!(injectedOnMaintenancePage || injectedOnQueryPage);
    return historicalNotesInjected;
}

// 自動偵測並注入按鈕
// 由 content.js 統一調度
// if (document.readyState === 'complete') {
//     safeInjectHistoricalNotes();
// } else {
//     window.addEventListener('load', safeInjectHistoricalNotes, { once: true });
// }
