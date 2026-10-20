document.addEventListener('DOMContentLoaded', async () => {
    const escapeText = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const contentDiv = document.getElementById('content');
    const backBtn = document.getElementById('back-btn');
    const clearBtn = document.getElementById('clear-btn');
    const appNo = new URLSearchParams(window.location.search).get('appNo') || '';

    if (!appNo) {
        contentDiv.innerHTML = `
            <div class="empty-state">
                <h2>找不到案件號</h2>
                <p>這個明細頁需要從目前案件的 popup 進來。</p>
            </div>
        `;
        clearBtn.disabled = true;
        return;
    }

    const result = await new Promise((resolve) => {
        getScopedTaxBundle(appNo, resolve);
    });

    if (!result || !result.personSubtotals || Object.keys(result.personSubtotals).length === 0) {
        contentDiv.innerHTML = `
            <div class="empty-state">
                <h2>沒有資料</h2>
                <p>這個案件目前沒有可顯示的投資明細。</p>
            </div>
        `;
        clearBtn.disabled = true;
        return;
    }

    const subtotals = result.personSubtotals;
    const idToNameMap = result.idToNameMap || {};
    const familyData = result.familyData || {};
    const familyOrder = Object.keys(familyData);
    const personIds = Object.keys(subtotals).sort((a, b) => {
        const ia = familyOrder.indexOf(a.trim());
        const ib = familyOrder.indexOf(b.trim());
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });

    if (personIds.length === 0) {
        contentDiv.innerHTML = `
            <div class="empty-state">
                <h2>沒有資料</h2>
                <p>這個案件目前沒有可顯示的投資明細。</p>
            </div>
        `;
        return;
    }

    let grandTotal = 0;
    personIds.forEach((idNumber) => {
        grandTotal += subtotals[idNumber];
    });

    const statusConfig = {
        listed: { label: '列冊', color: '#1a3a5c' },
        counted: { label: '計入', color: '#1e5c2e' },
        not_counted: { label: '不計', color: '#7a3b00' }
    };

    function getStatusTag(idNumber) {
        const person = familyData[idNumber];
        if (!person) return '';
        const cfg = statusConfig[person.status] || statusConfig.counted;
        const relationTag = person.relation
            ? `<span class="tag tag-relation">${escapeText(person.relation)}</span>`
            : '';
        return `${relationTag}<span class="tag" style="background:${cfg.color}">${cfg.label}</span>`;
    }

    let html = `
        <div class="subtotal-info">
            <h2>投資彙總</h2>
            <div class="info-row">
                <span class="info-label">人數</span>
                <span class="info-value">${personIds.length} 人</span>
            </div>
            <div class="info-row">
                <span class="info-label">總金額</span>
                <span class="amount">${Math.round(grandTotal)} 元</span>
            </div>
        </div>
        <h2 style="color: #0056b3; margin-top: 20px; margin-bottom: 15px;">投資明細</h2>
    `;

    personIds.forEach((idNumber, index) => {
        const amount = subtotals[idNumber];
        const cleanId = idNumber.trim();

        let foundName = idToNameMap[idNumber] || idToNameMap[cleanId];
        if (!foundName) {
            const matchingKey = Object.keys(idToNameMap).find((k) => k.includes(cleanId) || cleanId.includes(k));
            if (matchingKey) {
                foundName = idToNameMap[matchingKey];
            }
        }

        const displayName = foundName || idNumber;
        const statusTags = getStatusTag(cleanId);
        html += `
            <div class="subtotal-info" style="background-color: ${index % 2 === 0 ? '#f8f9fa' : '#e9ecef'}; border-left-color: #007bff;">
                <div class="info-row" style="border: none;">
                    <div class="person-name-row">
                        <span class="person-name">${escapeText(displayName)}</span>
                        <span class="tag-group">${statusTags}</span>
                    </div>
                    <span class="amount" style="font-size: 1.1em;">${Math.round(amount)} 元</span>
                </div>
            </div>
        `;
    });

    contentDiv.innerHTML = html;

    backBtn.onclick = () => {
        window.location.href = 'popup.html';
    };

    clearBtn.onclick = () => {
        if (confirm('確定要清除此案件的投資資料嗎？')) {
            clearScopedTaxBundle(appNo, () => {
                alert('已清除此案件的投資資料。');
                window.location.href = 'popup.html';
            });
        }
    };
});
