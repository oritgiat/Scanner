let foundCount = 0;
 
document.getElementById('filePicker').addEventListener('change', (e) => {
    const files = e.target.files;
    const fileInfo = document.getElementById('fileInfo');
    const startBtn = document.getElementById('startBatch');
    const statusList = document.getElementById('statusList');
 
    if (files.length > 0) {
        const xmlCount = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.xml')).length;
        const pdfCount = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')).length;
        
        fileInfo.innerText = `נבחרו ${xmlCount} קבצי XML ו-${pdfCount} קבצי PDF`;
        startBtn.disabled = false;
        statusList.innerHTML = `<div class="status-item item-info">📋 מוכן לתחילת עבודה...</div>`;
    } else {
        fileInfo.innerText = "טרם נבחרו קבצים";
        startBtn.disabled = true;
    }
});

const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});
 
document.getElementById('startBatch').addEventListener('click', async () => {
    const files = Array.from(document.getElementById('filePicker').files);
    const statusList = document.getElementById('statusList');
    const summaryArea = document.getElementById('summaryArea');
    const startBtn = document.getElementById('startBatch');
 
    const pdfFile = files.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFile) {
        alert("❌ חובה לבחור קובץ PDF אחד לפחות ביחד עם קבצי ה-XML!");
        return;
    }

    startBtn.disabled = true;
    startBtn.innerText = "⏳ אוטומציה פועלת, לא לגעת במסך..."; 
    foundCount = 0;
    statusList.innerHTML = ""; 
    summaryArea.style.display = "flex"; 
 
    let pdfBase64 = '';
    let pdfName = pdfFile.name;
    try {
        pdfBase64 = await fileToBase64(pdfFile);
    } catch (e) {
        alert("❌ שגיאה בטעינת קובץ ה-PDF.");
        startBtn.disabled = false;
        return;
    }

    const xmlFiles = files.filter(f => f.name.toLowerCase().endsWith('.xml'));

    for (let i = 0; i < xmlFiles.length; i++) {
        const file = xmlFiles[i];
        const fileName = file.name;
        
        try {
            const fileText = await file.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(fileText, "text/xml");
            
            const idNode = xmlDoc.getElementsByTagName("inidNum")[0] || xmlDoc.getElementsByTagName("inidnum")[0];
            if (!idNode || !idNode.textContent.trim()) {
                statusList.innerHTML += `<div class="status-item item-info">ℹ️ ${fileName} - אין תגית ת"ז בתוך ה-XML, דולג.</div>`;
                continue;
            }
            
            const tz = idNode.textContent.trim();

            const injuryDateNode = xmlDoc.getElementsByTagName("injuryDate")[0];
            const eventDate = injuryDateNode ? injuryDateNode.textContent.trim().split(' ')[0] : "";

            const sentDateNode = xmlDoc.getElementsByTagName("sentDate")[0];
            let receiptDate = sentDateNode ? sentDateNode.textContent.trim().split(' ')[0] : "";
            
            if(receiptDate) {
                let parts = receiptDate.split('/');
                if(parts.length === 3) {
                    parts[0] = parts[0].padStart(2, '0');
                    parts[1] = parts[1].padStart(2, '0');
                    receiptDate = parts.join('/');
                }
            }

            const resultStatus = await runRobotWorkflow(tz, receiptDate, eventDate, pdfBase64, pdfName);
           
            if (resultStatus === 'SUCCESS_WITH_EXCEPTION') {
                foundCount++;
                statusList.innerHTML += `<div class="status-item item-success">✅ ${tz} - עבודה הושלמה (יש טיפול בחריגים)</div>`;
            } else if (resultStatus === 'SUCCESS_NO_EXCEPTION') {
                foundCount++;
                statusList.innerHTML += `<div class="status-item item-info" style="background:#e0f2fe;">👍 ${tz} - עבודה הושלמה (ללא טיפול בחריגים)</div>`;
            } else if (resultStatus === 'FOUND_NO_TASK') {
                statusList.innerHTML += `<div class="status-item item-warning">⚠️ ${tz} - אין 'המתנה לסריקה' (דולג)</div>`;
            } else if (resultStatus === 'NOT_FOUND') {
                statusList.innerHTML += `<div class="status-item item-error">❌ ${tz} - לא נמצא בתבל</div>`;
            } else {
                statusList.innerHTML += `<div class="status-item item-error">🛑 ${tz} - שגיאה: ${resultStatus}</div>`;
            }
        } catch (e) {
            statusList.innerHTML += `<div class="status-item item-error">🛑 ${fileName} - הקובץ אינו תקין</div>`;
        }
       
        document.getElementById('totalChecked').innerText = i + 1;
        document.getElementById('totalFound').innerText = foundCount;
        statusList.scrollTo({ top: statusList.scrollHeight, behavior: 'smooth' });

        if (i < xmlFiles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000)); 
        }
    }
   
    startBtn.innerText = "🚀 התחל סריקה אוטומטית";
    startBtn.disabled = false;
    alert(`העבודה הסתיימה!\n${foundCount} לקוחות טופלו בהצלחה.`);
});
 
async function runRobotWorkflow(tz, receiptDate, eventDate, b64Data, fName) {
    return new Promise(async (resolve) => {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
 
        const executionResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (id, rDate, eDate, b64, fName) => {
                
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                const clickTabByTextWithRetry = async (text) => {
                    for (let i = 0; i < 12; i++) { 
                        const allElements = Array.from(document.querySelectorAll('*'));
                        const matchingElements = allElements.filter(el => {
                            const cleanText = el.innerText ? el.innerText.replace(/\s+/g, ' ').trim() : '';
                            return cleanText === text;
                        });
                        
                        if (matchingElements.length > 0) {
                            matchingElements[matchingElements.length - 1].click(); 
                            return true;
                        }
                        await sleep(500); 
                    }
                    return false;
                };

                const fillDojoFieldWithRetry = async (fieldId, value) => {
                    if (!value) return true; 
                    for (let i = 0; i < 10; i++) {
                        const el = document.getElementById(fieldId);
                        if (el) {
                            el.removeAttribute('disabled'); 
                            el.focus();
                            el.value = '';
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            
                            el.value = value;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            
                            const keyOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
                            el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
                            el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
                            el.blur();
                            await sleep(300);
                            return true;
                        }
                        await sleep(500);
                    }
                    return false;
                };

                // ⭐ הפונקציה המנצחת שפותחת את הרשימה דרך החץ ולוחצת פיזית על הערך המדויק! ⭐
                const selectDojoDropdown = async (inputEl, expectedText, shortText) => {
                    console.log(`📝 מנסה לבחור פיזית '${expectedText}' מהרשימה הנפתחת...`);
                    if (!inputEl) return false;

                    inputEl.removeAttribute('disabled');
                    inputEl.focus();
                    
                    // כותב טקסט קצר ('211' או 'דמי פגיעה') כדי לסנן את הרשימה (ומעיר את המערכת)
                    inputEl.value = shortText || expectedText;
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    await sleep(800);

                    // מחפש את החץ שפותח את התפריט ולוחץ עליו
                    const wrapper = inputEl.closest('.dijitComboBox, .gridxCell');
                    if (wrapper) {
                        const arrowBtn = wrapper.querySelector('.dijitArrowButtonInner, .dijitArrowButton');
                        if (arrowBtn) {
                            arrowBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                            arrowBtn.click();
                            await sleep(1500); // ⏳ ממתין בסבלנות שהתפריט העמוס ייפתח
                        }
                    }

                    // סורק את התפריט שנפתח ומחפש את הטקסט באופן *מדויק*
                    const menuItems = Array.from(document.querySelectorAll('.dijitMenuItem'));
                    const targetItem = menuItems.find(el => el.innerText && el.innerText.trim() === expectedText.trim());

                    if (targetItem) {
                        console.log(`✔️ נמצא הערך המדויק בתפריט! לוחץ עליו פיזית!`);
                        targetItem.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}));
                        targetItem.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true}));
                        targetItem.click();
                        await sleep(500);
                        
                        // נועלים את הערך עם אנטר ויציאה מהשדה
                        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                        inputEl.dispatchEvent(new KeyboardEvent('change', { bubbles: true }));
                        inputEl.blur();
                        return true;
                    } else {
                        console.warn(`⚠️ לא מצאתי את המילה המדויקת בתפריט.`);
                        return false;
                    }
                };

                const isTaskVisible = async (taskName) => {
                    for (let i = 0; i < 8; i++) { 
                        const taskCells = Array.from(document.querySelectorAll('td.mesimaNameCell'));
                        const found = taskCells.some(cell => {
                            if (!cell.innerText || !cell.innerText.includes(taskName)) return false;
                            const rect = cell.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 && cell.offsetParent !== null;
                        });
                        if (found) return true;
                        await sleep(500);
                    }
                    return false;
                };

                console.log(`\n======================================`);
                console.log(`🤖 מתחיל אוטומציה מול תבל עבור ת"ז ${id}...`);

                // 1. חיפוש לקוח
                const idInput = document.getElementById('btl_appl_modules_search_BtlSearch_0mainTabsSearchField');
                if (!idInput) return 'ERROR_NO_SEARCH_BAR';
                
                idInput.focus(); idInput.value = ''; idInput.dispatchEvent(new Event('input', { bubbles: true }));
                idInput.value = id; idInput.dispatchEvent(new Event('input', { bubbles: true }));
                const keyOpts = { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true };
                idInput.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
                idInput.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
                idInput.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
                if (idInput.form) { try { idInput.form.requestSubmit(); } catch(e) {} }
                
                await sleep(2000); 
                if (document.body.innerText.includes("לא נמצאו נתונים")) return 'NOT_FOUND';

                // 2. משימות
                const taskTabClicked = await clickTabByTextWithRetry('משימות ותהליכים');
                if (!taskTabClicked) return 'ERROR_NO_TASKS_TAB';

                // 3. בודק 'המתנה לסריקה'
                const hasTask = await isTaskVisible('המתנה לסריקה');
                if (!hasTask) return 'FOUND_NO_TASK'; 

                // 4. לחיצה על בית
                let homeBtnClicked = false;
                for(let i=0; i<5; i++){
                    const homeBtn = document.querySelector('.tabHome');
                    if (homeBtn) { homeBtn.click(); homeBtnClicked = true; break; }
                    await sleep(500);
                }
                if (!homeBtnClicked) return 'ERROR_NO_HOME_BTN';
                await sleep(1500); 

                // 5. מסכי עזר
                const ezerTabClicked = await clickTabByTextWithRetry('מסכי עזר');
                if (!ezerTabClicked) return 'ERROR_NO_EZER_TAB';
                await sleep(2500); 

                // 6. העלאת קובץ PDF
                console.log("📎 מעלה קובץ PDF אמיתי...");
                let fileUploaded = false;
                for(let i=0; i<8; i++){
                    const fileInput = document.querySelector('input[type="file"][name="uploadedfile"]');
                    if (fileInput) {
                        try {
                            const fetchRes = await fetch(b64);
                            const blob = await fetchRes.blob();
                            const actualFile = new File([blob], fName, { type: "application/pdf" });
                            
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(actualFile);
                            fileInput.files = dataTransfer.files;
                            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                            fileUploaded = true;
                            break;
                        } catch(e) {}
                    }
                    await sleep(500);
                }
                if (!fileUploaded) return 'ERROR_NO_FILE_INPUT';
                await sleep(3000); 

                // ⭐ 7. מילוי שדות - תחום עסקי (בחירה פיזית מהרשימה!) ⭐
                console.log("📝 ממלא תחום עסקי...");
                const filterInput = document.getElementById('btl_infra_form_BtlFilteringSelect_0') || document.getElementById('btl_infra_form_BtlFilteringSelect_2');
                if (filterInput) {
                    await selectDojoDropdown(filterInput, 'דמי פגיעה');
                }
                await sleep(1500);

                // 8. תעודת זהות ואנטר כבד
                console.log("📝 מקליד תעודת זהות ולוחץ Enter...");
                const tzField = document.getElementById('btl_infra_form_BtlIdShemTextBox_0');
                if (tzField) {
                    tzField.focus();
                    tzField.value = id;
                    tzField.dispatchEvent(new Event('input', { bubbles: true }));
                    tzField.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                    tzField.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                    tzField.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                    tzField.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                    tzField.blur();
                }
                await sleep(2500);

                // 9. מילוי תאריכים ראשיים
                console.log("📝 ממלא תאריכים...");
                await fillDojoFieldWithRetry('btl_infra_form_BtlDateTextBox_0', rDate); 
                await fillDojoFieldWithRetry('btl_infra_form_BtlDateTextBox_1', eDate); 
                await sleep(1000);

                // ⭐ 10. הוספה ומילוי טבלת מסמכים (סוג מסמך מלא + לחיצה בתפריט!) ⭐
                let docFilled = false;
                try {
                    console.log("📝 מכין שורה חדשה בטבלת המסמכים...");
                    const addBtn = document.querySelector('[automationid="addButton"], [title="הוסף"]');
                    if (addBtn) { addBtn.click(); await sleep(2500); } // ⏳ המתנה ארוכה יותר ليצירת השורה!

                    console.log("📝 ממלא סוג מסמך מלא...");
                    
                    const docTypeInput = document.getElementById('btl_admin_michtavim_myMeda_0');
                    if (docTypeInput) {
                        // שולח '211' ואז לוחץ על המשפט המלא
                        docFilled = await selectDojoDropdown(docTypeInput, 'טופס תביעה לתשלום דמי פגיעה (בל211)', '211');
                    } else {
                        // גיבוי דרך התא בטבלה
                        const sugMismachCell = document.querySelector('td[colid="sugMismach"]');
                        if (sugMismachCell) {
                            sugMismachCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                            await sleep(1000); // ממתין לשדה ההקלדה שיצוץ מתוך התא
                            const inputInside = sugMismachCell.querySelector('input');
                            if (inputInside) {
                                docFilled = await selectDojoDropdown(inputInside, 'טופס תביעה לתשלום דמי פגיעה (בל211)', '211');
                            }
                        }
                    }
                    
                    console.log("📝 ממלא תאריך מסמך...");
                    const possibleDateFields = document.querySelectorAll('input[id^="btl_infra_form_BtlDateTextBox_"]');
                    const lastDateFieldId = possibleDateFields.length > 0 ? possibleDateFields[possibleDateFields.length - 1].id : null;
                    if(lastDateFieldId) {
                        await fillDojoFieldWithRetry(lastDateFieldId, rDate);
                    }

                } catch(e) { console.warn("דילוג או שגיאה במילוי טבלת מסמכים"); }
                
                await sleep(1500);

                if (!docFilled) {
                    console.error("🛑 לא הצלחתי לבחור מסמך (בל211). עוצר כדי לא לשמור טופס פגום.");
                    return 'ERROR_NO_DOCUMENT_TYPE';
                }

                // 11. לחיצה על סיום ושמירה
                console.log("💾 שומר...");
                let finishBtnClicked = false;
                for(let i=0; i<8; i++){
                    let finishBtn = document.getElementById('btl_infra_form_BtlButton_27_label');
                    if (!finishBtn) {
                        const allBtnSpans = Array.from(document.querySelectorAll('span.dijitButtonText'));
                        finishBtn = allBtnSpans.find(el => el.innerText && el.innerText.trim() === 'סיום');
                    }
                    if (finishBtn) {
                        const parentButtonNode = finishBtn.closest('.dijitButtonNode') || finishBtn;
                        parentButtonNode.click();
                        finishBtnClicked = true;
                        break;
                    }
                    await sleep(500);
                }
                if (!finishBtnClicked) return 'ERROR_NO_FINISH_BTN';
                
                console.log("✅ טופס נשמר! ממתין 4.5 שניות...");
                await sleep(4500); 

                // 12. חזרה למשימות לבדיקה סופית
                console.log("🔄 חוזר למשימות לבדיקה סופית...");
                const returnTasksClicked = await clickTabByTextWithRetry('משימות ותהליכים');
                if (!returnTasksClicked) return 'ERROR_RETURN_TO_TASKS';
                await sleep(2000); 

                // 13. וידוא חריגים
                const hasException = await isTaskVisible('טיפול בחריגים');
                if (hasException) {
                    return 'SUCCESS_WITH_EXCEPTION';
                } else {
                    return 'SUCCESS_NO_EXCEPTION';
                }
            },
            args: [tz, receiptDate, eventDate, b64Data, fName] 
        });

        resolve(executionResult[0].result);
    });
}
