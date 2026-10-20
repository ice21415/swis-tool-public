// ============================================
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

async function fetchPassbookDataForMembers(memberIds, appNo) {
    // 獲取頁面資訊
    const standYear = document.querySelector('select[name="stand_year"]')?.value ||
        document.querySelector('input[name="stand_year"]')?.value || '115';
    const grantcity = document.querySelector('input[name="grantcity"]')?.value || '6400000000';
    const chkStatus = document.querySelector('input[name="chk_status"]')?.value || '9';
    const appDate = document.querySelector('input[name="app_date"]')?.value || '';
    const reappYn = document.querySelector('input[name="reapp_yn"]')?.value || 'N';
    const lockYn = document.querySelector('input[name="lock_yn"]')?.value || 'N';
    const chkUpd = document.querySelector('input[name="chk_upd"]')?.value || 'N';

    const passbookResults = [];
    const baseUrl = `${location.origin}/socs/jsp/sa/sa1/sa12010_fam_action.jsp`;

    for (const member of memberIds) {
        try {
            const queryParams = new URLSearchParams({
                status: 'get',
                key: member.idNo,
                app_no: appNo,
                stand_year: standYear,
                grantcity: grantcity,
                chk_status: chkStatus,
                app_date: appDate,
                reapp_yn: reappYn,
                lock_yn: lockYn,
                chk_upd: chkUpd,
                prog_id: 'SA12010',
                app_type: '0'
            });

            // 從當前頁面表單獲取更多參數
            const form = document.querySelector('form[name="main"]') || document.querySelector('form');
            const formData = new URLSearchParams();

            if (form) {
                const fields = form.querySelectorAll('input, select, textarea');
                fields.forEach(el => {
                    const name = el.name;
                    if (!name) return;
                    if (el.tagName === 'SELECT') {
                        const opt = el.selectedOptions?.[0];
                        formData.append(name, opt ? opt.value : el.value);
                        return;
                    }
                    if (el.tagName === 'TEXTAREA') {
                        formData.append(name, el.value || '');
                        return;
                    }
                    if (el.type === 'checkbox' || el.type === 'radio') {
                        if (!el.checked) return;
                        formData.append(name, el.value || 'on');
                        return;
                    }
                    formData.append(name, el.value || '');
                });
            }

            // 確保關鍵參數正確設置
            formData.set('app_no', appNo);
            formData.set('stand_year', standYear);
            formData.set('grantcity', grantcity);
            formData.set('chk_status', chkStatus);
            formData.set('key', member.idNo);
            formData.set('status', 'get');
            formData.set('prog_id', 'SA12010');

            const url = `${baseUrl}?${queryParams.toString()}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
                credentials: 'include'
            });

            if (!response.ok) continue;
            const html = await response.text();

            // 解析回應 HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 檢查付款方式 (pay_type_l)
            const payType = doc.querySelector('select[name="pay_type_l"]')?.value ||
                doc.querySelector('input[name="pay_type_l"]')?.value || '';

            // 如果付款方式是空的，代表未設定
            if (payType === '') {
                passbookResults.push({
                    idNo: member.idNo,
                    name: member.name,
                    position: member.position,
                    age: member.age || '',
                    payeeIdNo: '',
                    payeeName: '',
                    bankNo: '',
                    accountNo: '',
                    paymentType: '未設定'
                });
                continue;
            }

            if (payType === '5' || payType === '4') {
                passbookResults.push({
                    idNo: member.idNo,
                    name: member.name,
                    position: member.position,
                    age: member.age || '',
                    payeeIdNo: '',
                    payeeName: '',
                    bankNo: '',
                    accountNo: '',
                    paymentType: payType === '5' ? '現金' : '支票'
                });
                continue;
            }

            const drawBankNo = doc.querySelector('input[name="draw_bankno_l"]')?.value || '';
            const drawAcctNo = doc.querySelector('input[name="draw_acctno_l"]')?.value || '';
            const drawIdNo = doc.querySelector('input[name="draw_id_l"]')?.value || '';
            const drawName = doc.querySelector('input[name="draw_name_l"]')?.value || '';

            passbookResults.push({
                idNo: member.idNo,
                name: member.name,
                position: member.position,
                age: member.age || '',
                payeeIdNo: drawIdNo || member.idNo,
                payeeName: drawName || member.name,
                bankNo: drawBankNo,
                accountNo: drawAcctNo
            });
        } catch (error) {
            // 忽略單一成員的錯誤，繼續處理其他成員
        }
    }

    return passbookResults;
}

async function fetchFamilyPassbookData() {
    // 先等待一小段時間確保 DOM 完全載入
    await new Promise(resolve => setTimeout(resolve, 100));

    // 獲取案號
    const appNo = document.querySelector('input[name="app_no"]')?.value;

    if (!appNo) {
        throw new Error('找不到案號');
    }

    const memberIds = [];

    // 方法1: 從 checkbox 獲取（除了申請人）
    const checkboxes = document.querySelectorAll('input[name="key_ary"]');
    checkboxes.forEach(cb => {
        const idNo = cb.value;
        if (!idNo || !/^[A-Z][A-Z0-9]\d{8}$/.test(idNo)) return;

        // 找到所在的 tr
        const row = cb.closest('tr');
        if (!row) return;

        const cells = row.querySelectorAll('td');

        // 檢查「非列冊」欄位（通常是第4個有 V 的 td）
        // 找包含 famGet 的 td，從那裡開始算
        let famGetIndex = -1;
        for (let i = 0; i < cells.length; i++) {
            const onclick = cells[i].getAttribute('onclick') || '';
            if (onclick.includes('famGet')) {
                famGetIndex = i;
                break;
            }
        }

        if (famGetIndex < 0) return;

        // 非列冊是 famGet 之後的第3個 td
        const grantYnCell = cells[famGetIndex + 3];
        if (grantYnCell?.innerText?.trim() === 'V') {
            return;
        }

        // 稱謂是 famGet 之後的第7個 td
        const positionCell = cells[famGetIndex + 7];
        const nameCell = cells[famGetIndex + 9];
        // 足齡是 famGet 之後的第10個 td
        const ageCell = cells[famGetIndex + 10];

        memberIds.push({
            idNo: idNo,
            name: nameCell?.innerText?.trim() || '',
            position: positionCell?.innerText?.trim() || '',
            age: ageCell?.innerText?.trim() || ''
        });
    });

    // 方法2: 使用 getApplicantIdNo 函數（與「查看過往備註」相同的方式）
    const applicantIdNo = getApplicantIdNo();
    if (applicantIdNo && !memberIds.some(m => m.idNo === applicantIdNo)) {
        let applicantName = '';
        let applicantPosition = '戶長';
        let applicantAge = '';

        // 嘗試從頁面文字中提取戶長資訊
        const pageText = document.body.innerText;
        const headMatch = pageText.match(/【戶長：([A-Z][A-Z0-9]\d{8})\s+([^\]】]+)】/);
        if (headMatch && headMatch[1] === applicantIdNo) {
            applicantName = headMatch[2].trim();
        }

        // 如果沒找到，嘗試從表格中找
        if (!applicantName) {
            const allRows = document.querySelectorAll('tr.title4');
            for (const row of allRows) {
                const rowText = row.innerText;
                if (rowText.includes(applicantIdNo)) {
                    const cells = row.querySelectorAll('td');
                    for (let i = 0; i < cells.length; i++) {
                        const onclick = cells[i].getAttribute('onclick') || '';
                        if (onclick.includes(`famGet('${applicantIdNo}')`)) {
                            // 稱謂是 famGet 之後的第7個 td
                            const posCell = cells[i + 7];
                            const nameCell = cells[i + 9];
                            // 足齡是 famGet 之後的第10個 td
                            const ageCell = cells[i + 10];
                            if (posCell) applicantPosition = posCell.innerText?.trim() || '戶長';
                            if (nameCell) applicantName = nameCell.innerText?.trim() || '';
                            if (ageCell) applicantAge = ageCell.innerText?.trim() || '';
                            break;
                        }
                    }
                    break;
                }
            }
        }

        // 申請人插入到最前面
        memberIds.unshift({
            idNo: applicantIdNo,
            name: applicantName,
            position: applicantPosition,
            age: applicantAge
        });
    }

    if (memberIds.length === 0) {
        throw new Error('找不到家戶成員');
    }

    return await fetchPassbookDataForMembers(memberIds, appNo);
}

function showPassbookDialog(passbookData) {
    // 移除現有對話框
    const existing = document.getElementById('passbook-dialog');
    if (existing) existing.remove();

    // 建立對話框
    const overlay = document.createElement('div');
    overlay.id = 'passbook-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:8px;padding:20px;max-width:600px;width:90%;max-height:80vh;overflow:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);';

    const title = document.createElement('h3');
    title.textContent = '家戶成員存摺資料';
    title.style.cssText = 'margin:0 0 15px 0;color:#2196F3;border-bottom:2px solid #2196F3;padding-bottom:10px;';

    // 建立表格
    let tableHtml = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="background:#e3f2fd;">
                    <th style="padding:8px;border:1px solid #ddd;text-align:left;">成員</th>
                    <th style="padding:8px;border:1px solid #ddd;text-align:left;">領款人</th>
                    <th style="padding:8px;border:1px solid #ddd;text-align:left;">局號</th>
                    <th style="padding:8px;border:1px solid #ddd;text-align:left;">帳號</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const item of passbookData) {
        const hasBankInfo = item.bankNo || item.accountNo;
        const hasSpecialPayment = item.paymentType === '現金' || item.paymentType === '支票' || item.paymentType === '未設定';
        const rowStyle = hasBankInfo ? '' : (hasSpecialPayment ? 'background:#f5f5f5;' : 'background:#fff3e0;');

        // 判斷領款人是否與成員相同
        const isSamePerson = item.idNo === item.payeeIdNo;
        const payeeStyle = isSamePerson ? 'color:#4CAF50;' : '';
        const payeeNote = isSamePerson ? '(本人)' : '';

        // 使用 escapeHtml 防止 XSS
        const safeIdNo = escapeHtml(item.idNo);
        const safeName = escapeHtml(item.name);
        const safePosition = escapeHtml(item.position);
        const safeAge = escapeHtml(item.age);
        const safePayeeName = escapeHtml(item.payeeName);
        const safePayeeIdNo = escapeHtml(item.payeeIdNo);
        const safeBankNo = escapeHtml(item.bankNo);
        const safeAccountNo = escapeHtml(item.accountNo);
        const safePaymentType = escapeHtml(item.paymentType);

        // 如果是現金、支票或未設定，顯示對應的提示
        const bankNoDisplay = hasSpecialPayment ? `<span style="color:#888;">${safePaymentType}</span>` : (safeBankNo || '-');
        const accountNoDisplay = hasSpecialPayment ? '-' : (safeAccountNo || '-');
        const payeeDisplay = hasSpecialPayment ? '-' : `<b>${safePayeeName || '-'}</b> <small>${payeeNote}</small>`;
        const payeeIdDisplay = hasSpecialPayment ? '' : `<br><small style="color:#666;">${safePayeeIdNo || '-'}</small>`;

        // 成員資訊（包含年齡）
        const ageDisplay = safeAge ? `<small style="color:#888;">(${safeAge}歲)</small>` : '';

        tableHtml += `
            <tr style="${rowStyle}">
                <td style="padding:8px;border:1px solid #ddd;">
                    <b>${safePosition || '-'}</b> ${safeName || '-'} ${ageDisplay}
                    <br><small style="color:#666;">${safeIdNo}</small>
                </td>
                <td style="padding:8px;border:1px solid #ddd;${payeeStyle}">
                    ${payeeDisplay}
                    ${payeeIdDisplay}
                </td>
                <td style="padding:8px;border:1px solid #ddd;font-family:'NotoSansTC-Regular','Microsoft JhengHei','Segoe UI',sans-serif;font-weight:bold;">${bankNoDisplay}</td>
                <td style="padding:8px;border:1px solid #ddd;font-family:'NotoSansTC-Regular','Microsoft JhengHei','Segoe UI',sans-serif;font-weight:bold;">${accountNoDisplay}</td>
            </tr>
        `;
    }

    tableHtml += '</tbody></table>';

    // 統計資訊
    const withBankInfo = passbookData.filter(p => p.bankNo && p.accountNo).length;
    const summaryHtml = `
        <div style="margin-top:15px;padding:10px;background:#e8f5e9;border-radius:4px;font-size:13px;">
            <b>統計：</b>共 ${passbookData.length} 人，其中 ${withBankInfo} 人有存摺資料
        </div>
    `;

    const content = document.createElement('div');
    content.innerHTML = tableHtml + summaryHtml;
    window.ensureDialogInlineImportantStyles(content);

    // 關閉按鈕
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '關閉';
    closeBtn.style.cssText = 'margin-top:15px;padding:10px 30px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;';
    closeBtn.onclick = () => overlay.remove();

    dialog.appendChild(title);
    dialog.appendChild(content);
    dialog.appendChild(closeBtn);
    overlay.appendChild(dialog);
    window.ensureDialogInlineImportantStyles(overlay);

    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
}

function injectPassbookButton() {
    // 檢查是否已注入
    if (document.getElementById('view-passbook-btn')) return true;

    // 必須在「申請資料維護作業」頁面
    if (!isApplicationMaintenancePage()) return false;

    // 找到備註 textarea
    const memoTextarea = document.querySelector('textarea[name="memo"]');
    if (!memoTextarea) return false;
    const actionRow = getSwisMemoActionRow(memoTextarea);

    const passbookBtn = document.createElement('input');
    passbookBtn.id = 'view-passbook-btn';
    passbookBtn.type = 'button';
    passbookBtn.value = '查看目前存摺';
    passbookBtn.style.cssText = 'margin-left:10px;background:#2196F3;color:white;border:none;padding:3px 8px;cursor:pointer;border-radius:3px;';

    passbookBtn.onclick = async () => {
        passbookBtn.disabled = true;
        passbookBtn.value = '載入中...';

        try {
            const passbookData = await fetchFamilyPassbookData();
            if (passbookData && passbookData.length > 0) {
                showPassbookDialog(passbookData);
            } else {
                showStatusBanner('無法獲取存摺資料', 'error', 3000);
            }
        } catch (error) {
            showStatusBanner('獲取存摺資料失敗: ' + error.message, 'error', 3000);
        }

        passbookBtn.disabled = false;
        passbookBtn.value = '查看目前存摺';
    };

    actionRow.appendChild(passbookBtn);

    return true;
}

// 頁面載入時檢查並注入按鈕
function safeInjectPassbookButton() {
    if (document.body) {
        return injectPassbookButton();
    }
    return false;
}

// 監聽歷史按鈕是否出現（如果歷史模組載入較慢）
// 由 content.js 統一調度
// if (document.readyState === 'complete') {
//     safeInjectPassbookButton();
//     // 再次嘗試，以防 history button 稍後才插入
//     setTimeout(safeInjectPassbookButton, 500);
// } else {
//     window.addEventListener('load', () => {
//         safeInjectPassbookButton();
//         setTimeout(safeInjectPassbookButton, 500);
//     }, { once: true });
// }
