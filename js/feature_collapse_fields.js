// ============================================
// 可收合欄位功能：隱藏不常用的表單欄位
// ============================================
(function() {
    'use strict';

    // 跳過頂層 frameset
    if (window === window.top) return;
    // 跳過已命名的非 main_frm 子框架（如 ifm_filter, qdata_ifm 等）
    if (window.name && window.name !== 'main_frm') {
        return;
    }

    // 要收合的欄位標籤
    const COLLAPSE_LABELS = [
        '居住狀況',
        '居住情形',
        '每月租金',
        '建築種類',
        '貧困原因',
        '急需政府解決事項',
        '低收入戶房屋稅減免'
    ];

    function initCollapseFields() {

        // 掃描所有 <td>，找到包含目標標籤的 <tr>
        var allCells = document.querySelectorAll('td');
        var rowsToHide = new Set();


        for (var i = 0; i < allCells.length; i++) {
            var cell = allCells[i];
            // 只看 title2 或 must class 的 cell
            if (!cell.classList.contains('title2') && !cell.classList.contains('must')) continue;

            var text = cell.textContent.trim();
            for (var j = 0; j < COLLAPSE_LABELS.length; j++) {
                if (text.indexOf(COLLAPSE_LABELS[j]) !== -1) {
                    var row = cell.closest('tr');
                    if (row) {
                        rowsToHide.add(row);
                    }
                    break;
                }
            }
        }

        if (rowsToHide.size === 0) return;

        var hiddenRows = Array.from(rowsToHide);

        // 預設隱藏
        hiddenRows.forEach(function(tr) {
            tr.style.display = 'none';
            tr.dataset.swisCollapsible = '1';
        });

        // 在第一個隱藏列前插入切換按鈕列
        var firstRow = hiddenRows[0];
        var parentTable = firstRow.parentNode;

        var toggleRow = document.createElement('tr');
        toggleRow.className = 'title4 swis-collapse-toggle';
        toggleRow.style.cssText = 'cursor: pointer; user-select: none;';

        var toggleTd = document.createElement('td');
        toggleTd.colSpan = 4;
        toggleTd.style.cssText = 'padding: 6px 8px;';

        var arrow = document.createElement('span');
        arrow.textContent = '▶';
        arrow.style.cssText = 'display: inline-block; transition: transform 0.2s; margin-right: 6px; font-size: 12px;';

        var label = document.createElement('b');
        label.style.cssText = 'font-size: 13px; color: #0300DC;';
        label.textContent = '其他詳細資料';

        var hint = document.createElement('span');
        hint.style.cssText = 'font-size: 12px; color: #999; margin-left: 8px;';
        hint.textContent = '（點擊展開 ' + hiddenRows.length + ' 列欄位）';

        toggleTd.appendChild(arrow);
        toggleTd.appendChild(label);
        toggleTd.appendChild(hint);
        toggleRow.appendChild(toggleTd);

        parentTable.insertBefore(toggleRow, firstRow);

        // 展開/收合切換
        var expanded = false;
        toggleRow.addEventListener('click', function() {
            expanded = !expanded;
            hiddenRows.forEach(function(tr) {
                tr.style.display = expanded ? '' : 'none';
            });
            arrow.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)';
            hint.textContent = expanded
                ? '（點擊收合）'
                : '（點擊展開 ' + hiddenRows.length + ' 列欄位）';
        });

        // Hover 效果
        toggleRow.addEventListener('mouseenter', function() {
            label.style.color = '#e0e0e0';
        });
        toggleRow.addEventListener('mouseleave', function() {
            label.style.color = '#0300DC';
        });

    }

    // ============================================
    // 為 checkbox / radio 加上 <label> 包裝
    // ============================================
    function wrapInputsWithLabels() {
        var inputs = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
        var count = 0;

        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];

            // 已經在 <label> 裡面的跳過
            if (input.closest('label')) continue;

            // 取得緊接在 input 後面的文字節點
            var nextNode = input.nextSibling;
            if (!nextNode || nextNode.nodeType !== 3) continue; // 3 = TEXT_NODE

            var text = nextNode.textContent;
            // 跳過純空白或 &nbsp; 的文字節點
            if (!text || !text.replace(/[\s\u00a0]/g, '')) continue;

            // 建立 <label>，把 input + 文字包進去
            var lbl = document.createElement('label');
            lbl.style.cursor = 'pointer';
            input.parentNode.insertBefore(lbl, input);
            lbl.appendChild(input);
            lbl.appendChild(nextNode);
            count++;
        }

        if (count > 0) {
        }
    }

    // DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initCollapseFields();
            wrapInputsWithLabels();
        });
    } else {
        initCollapseFields();
        wrapInputsWithLabels();
    }
})();
