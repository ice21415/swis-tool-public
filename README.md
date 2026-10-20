# SWIS Tool / 弱E小工具

Chrome Manifest V3 插件，提供財稅比對、投資小計、初次審查、歷史備註與案件操作輔助。

此公開儲存庫只提供插件程式及更新工具。實際案件資料、姓名、身分證號、備註內容、瀏覽器儲存資料與開發歷史不在發佈範圍。備註功能程式保留，備註資料僅在原系統及使用者本機使用。

## 安裝與更新（Windows）

下載最新 Release 的 `swis-tool.zip`、`install-auto-update.ps1` 與 `update-installed-extension.ps1`。兩支 PowerShell 放在相同資料夾，執行 `powershell -NoProfile -File .\install-auto-update.ps1`。

安裝程式會先驗證版本及 SHA-256，再安裝到 `%LOCALAPPDATA%\SWIS-Tool\extension`，建立每小時檢查 GitHub Release 的排程 `SWIS-Tool-GitHub-Update`。第一次需在 `chrome://extensions` 啟用開發人員模式，以「載入未封裝項目」選擇上述安裝目錄。若原本已從另一個資料夾安裝，請先匯出所需設定，再切換；不同擴充功能 ID 的本機資料不會自動移轉。

新版本只在版本號較新時安裝，不降版。安裝前保存舊目錄，替換失敗時回復；成功後重新啟動 Chrome 套用新版。更新不會重新整理案件頁面或送出案件。SHA-256 防止下載損壞，不是獨立數位簽章；來源信任依賴此 GitHub 儲存庫。

檢查失敗時保留目前版本，錯誤寫入 `%LOCALAPPDATA%\SWIS-Tool\last-error.txt`。備份及下載暫存保留在同一目錄；不自動刪除。

取消排程：`Unregister-ScheduledTask -TaskName SWIS-Tool-GitHub-Update -Confirm:$false`。

## 發佈

僅使用正式 GitHub Release，tag 必須為 `v` 加上 manifest 版本。資產須包含 `swis-tool.zip` 與 `swis-tool.zip.sha256`，ZIP 根目錄須有 `manifest.json`、`release-files.json`。同版本但內容不同時不自動覆蓋，請增加版本號。

更新程式只向 GitHub 查詢版本、下載公開發佈資產，不上傳 SWIS 資料。官方 Chrome 發佈限制：https://developer.chrome.com/docs/extensions/how-to/distribute
