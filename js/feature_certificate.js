// ============================================
// 申請證明功能模組
// ============================================

// 注入申請證明按鈕
function injectCertificateButton() {
    // 只在案件維護頁面注入
    const breadcrumb = document.querySelector('td.title1');
    const breadcrumbText = breadcrumb ? breadcrumb.textContent : '';
    const pageText = `${breadcrumbText} ${location.href}`;
    const hasSupportedPage = ['SA12010', 'SC12010', 'SH12010'].some((progId) => pageText.includes(progId));
    const hasIdField = document.querySelector('input[name="qid_no"]');

    if (!hasSupportedPage || !hasIdField) {
        return;
    }

    // 避免重複注入
    if (document.getElementById('gemini-apply-cert-btn')) return;

    // 尋找注入點 (優先 b_qryS)
    let targetBtn = document.querySelector('input[name="b_qryS"]');
    if (!targetBtn) {
        targetBtn = document.querySelector('input[name="b_qry"]');
    }

    if (targetBtn) {
        const newBtn = document.createElement('input');
        newBtn.type = 'button';
        newBtn.id = 'gemini-apply-cert-btn';
        newBtn.value = '申請證明';
        newBtn.className = 'button1';
        newBtn.style.cssText = 'margin-left:5px;background:#007bff;color:white;border:none;padding:3px 8px;cursor:pointer;border-radius:3px;';

        newBtn.onclick = (e) => {
            e.preventDefault();
            handleApplyCertificate();
        };

        targetBtn.parentNode.insertBefore(newBtn, targetBtn.nextSibling);
    }
}

// 處理申請證明邏輯
async function handleApplyCertificate() {
    // 1. 取得 qid_no
    const qidInput = document.querySelector('input[name="qid_no"]');
    const qidNo = qidInput ? qidInput.value.trim().toUpperCase() : '';

    if (!qidNo) {
        alert('無法取得身分證字號 (qid_no)，請確認頁面上有該欄位且已填值。');
        return;
    }

    const currentRocYear = new Date().getFullYear() - 1911;
    const qstandYear = prompt('請輸入申請年度 (民國年):', currentRocYear);

    if (qstandYear === null) {
        return;
    }
    if (!qstandYear.trim()) {
        alert('請輸入有效的年度。');
        return;
    }

    if (typeof queryEligibilityStatus !== 'function') {
        alert('資格偵測功能尚未載入，請稍後再試。');
        return;
    }

    const button = document.getElementById('gemini-apply-cert-btn');
    const originalValue = button ? button.value : '';
    if (button) {
        button.disabled = true;
        button.value = '查詢資格中...';
    }

    let eligibility;
    try {
        eligibility = await queryEligibilityStatus(qidNo, qstandYear.trim());
    } catch (error) {
        alert('資格查詢失敗: ' + error.message);
        return;
    } finally {
        if (button) {
            button.disabled = false;
            button.value = originalValue || '申請證明';
        }
    }

    if (!eligibility || eligibility.success === false) {
        alert('資格查詢失敗，無法自動判斷證明類型。');
        return;
    }

    if (!eligibility.currentStatus) {
        alert('查無目前年度資格，未列印證明。');
        return;
    }

    const statusType = eligibility.currentStatus.type;
    let payload = null;
    if (statusType === '中老') {
        payload = buildMiddleOldCertificatePayload(qidNo, qstandYear.trim());
    } else if (statusType === '低收' || statusType === '中低收') {
        payload = buildLowIncomeCertificatePayload(qidNo, qstandYear.trim());
    } else if (statusType === '身障') {
        payload = buildDisabilityCertificatePayload(qidNo, qstandYear.trim());
    } else {
        alert('目前尚未支援自動列印此資格證明。偵測到的資格: ' + statusType);
        return;
    }

    postToDownload('https://swis.mohw.gov.tw/socs/jsp/ml/rpt/rpt1070_pdf.jsp', payload);
}

function buildLowIncomeCertificatePayload(qidNo, qstandYear) {
    return {
        login_kind: 'C',
        sys_code: 'A1',
        userCityNo: '6400000000',
        userKind: 'C',
        zipno: '806',
        qcityno: '6400000000',
        qtownno: '6400009000',
        qvillageno: '',
        qstand_year: String(qstandYear || getCurrentRocYear()),
        qapp_no: '',
        qapp_sdate: '',
        qapp_edate: '',
        qchk_sdate2: '',
        qchk_edate2: '',
        qid_no: qidNo,
        qpsn_kind: 'Y',
        qcname: '',
        qgrant_yn: 'Y',
        show1: 'N',
        show2: 'N',
        show3: 'Y',
        qpos_yn: 'N',
        show4: '3',
        qdate_type: '1',
        qrpt_date: '',
        show_idno: 'N',
        quse_memo: '',
        qrpt_no: '',
        qeffective_type: '1',
        qeffective_date: '',
        qchk_result: 'N',
        qno_grant: 'N',
        qstop_yn: 'N',
        qstop_ym_type: 'Y',
        status: 'rpt',
        prog_id: 'sa1z200'
    };
}

function buildDisabilityCertificatePayload(qidNo, qstandYear) {
    return {
        login_kind: 'C',
        sys_code: 'H2',
        userCityNo: '6400000000',
        userKind: 'C',
        zipno: '806',
        qcityno: '6400000000',
        qtownno: '6400009000',
        qvillageno: '',
        qstand_year: String(qstandYear || getCurrentRocYear()),
        qapp_no: '',
        qapp_sdate: '',
        qapp_edate: '',
        qchk_sdate2: '',
        qchk_edate2: '',
        qid_no: qidNo,
        qpsn_kind: 'Y',
        qcname: '',
        show1: 'N',
        show2: 'N',
        show3: 'Y',
        qpos_yn: 'N',
        show4: '3',
        qdate_type: '1',
        qrpt_date: '',
        show_idno: 'N',
        quse_memo: '',
        qrpt_no: '',
        qeffective_type: '1',
        qeffective_date: '',
        qchk_result: 'N',
        qstop_yn: 'N',
        qstop_ym_type: 'Y',
        status: 'rpt',
        prog_id: 'sh2z180'
    };
}

function buildMiddleOldCertificatePayload(qidNo, qstandYear) {
    const payload = {
        login_kind: 'C',
        sys_code: 'C1',
        userCityNo: '6400000000',
        userKind: 'C',
        zipno: '806',
        qcityno: '6400000000',
        qtownno: '6400009000',
        qvillageno: '',
        qstand_year: String(qstandYear || getCurrentRocYear()),
        qapp_no: '',
        qapp_sdate: '',
        qapp_edate: '',
        qchk_sdate2: '',
        qchk_edate2: '',
        qid_no: qidNo,
        qpsn_kind: 'N',
        qcname: '',
        show1: 'N',
        show2: 'N',
        show3: 'Y',
        qpos_yn: 'N',
        show4: '3',
        qdate_type: '1',
        qrpt_date: '',
        show_idno: 'N',
        quse_memo: '',
        qrpt_no: '',
        qeffective_type: '1',
        qeffective_date: '',
        qchk_result: 'N',
        qstop_yn: 'N',
        qstop_ym_type: 'Y',
        status: 'rpt',
        prog_id: 'sc1z210'
    };

    return payload;
}

function postToDownload(url, data) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = '_blank'; // 開新分頁下載，避免影響當前頁面
    form.style.display = 'none';

    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const hiddenField = document.createElement('input');
            hiddenField.type = 'hidden';
            hiddenField.name = key;
            hiddenField.value = data[key];
            form.appendChild(hiddenField);
        }
    }

    document.body.appendChild(form);
    form.submit();
    setTimeout(() => {
        document.body.removeChild(form);
    }, 1000);
}

// 初始化
// 由 content.js 統一調度
// if (document.readyState === 'complete') {
//     injectCertificateButton();
// } else {
//     window.addEventListener('load', injectCertificateButton, { once: true });
// }
