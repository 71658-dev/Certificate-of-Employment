// --- Date Parsing & Strict Calendar Calculation ---

// 解析民國年 (e.g., "1120520" or "112/05/20") 為 Date Object
function parseRocDate(dateStr) {
    if (!dateStr) return null;
    dateStr = String(dateStr).trim();
    if (dateStr.length < 6) return null;

    let year, month, day;
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        year = parseInt(parts[0]) + 1911;
        month = parseInt(parts[1]) - 1;
        day = parseInt(parts[2]);
    } else {
        const yearLen = dateStr.length === 7 ? 3 : 2;
        year = parseInt(dateStr.substring(0, yearLen)) + 1911;
        month = parseInt(dateStr.substring(yearLen, yearLen + 2)) - 1;
        day = parseInt(dateStr.substring(yearLen + 2));
    }

    const date = new Date(year, month, day);
    // 驗證日期是否有效
    if (isNaN(date.getTime())) return null;
    return date;
}

// 格式化民國年字串為中文顯示 (例: 1110718 -> 111年07月18日)
function formatRocDateString(dateStr) {
    if (!dateStr) return '';
    dateStr = String(dateStr).trim();
    if (dateStr.length < 6) return dateStr;

    let year, month, day;
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        year = parts[0];
        month = parts[1];
        day = parts[2];
    } else {
        const yearLen = dateStr.length === 7 ? 3 : 2;
        year = dateStr.substring(0, yearLen);
        month = dateStr.substring(yearLen, yearLen + 2);
        day = dateStr.substring(yearLen + 2);
    }
    return `${year}年${month}月${day}日`;
}

// 嚴格依據日曆計算兩個日期的差距 {y, m, d}
function getStrictDateDiff(startDate, endDate) {
    let years = endDate.getFullYear() - startDate.getFullYear();
    let months = endDate.getMonth() - startDate.getMonth();
    let days = endDate.getDate() - startDate.getDate();

    if (days < 0) {
        months--;
        let daysInStartMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
        days += daysInStartMonth;
    }

    if (months < 0) {
        years--;
        months += 12;
    }

    return { years, months, days };
}

// 加總年資：依據 30天=1月, 12月=1年 進位
// 註：此為常見的人力資源計算慣例，將日曆月份的差異轉換為標準化的單位以進行加總
function addDuration(total, part) {
    let res = {
        years: total.years + part.years,
        months: total.months + part.months,
        days: total.days + part.days
    };

    while (res.days >= 30) {
        res.days -= 30;
        res.months++;
    }
    while (res.months >= 12) {
        res.months -= 12;
        res.years++;
    }
    return res;
}

// 扣除年資：依據 30天=1月, 12月=1年 借位
function subFromTotal(total, deduc) {
    let res = {
        years: total.years - deduc.years,
        months: total.months - deduc.months,
        days: total.days - deduc.days
    };

    while (res.days < 0) {
        res.days += 30;
        res.months--;
    }
    while (res.months < 0) {
        res.months += 12;
        res.years--;
    }
    return res;
}

function formatDurationObject(d) {
    if (!d) return "00年00月00日";
    // 確保非負數 (理論上不應該發生，但做個防護)
    const y = Math.max(0, d.years);
    const m = Math.max(0, d.months);
    const day = Math.max(0, d.days);

    return `${String(y).padStart(2, '0')}年${String(m).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
}

function processHistory(history, today = new Date()) {
    // 1. 解析日期，但不排序，保留原始資料順序
    // 修改：不再過濾掉 dateObj 為 null 的項目，因為要保留在列表中
    let list = history.map(item => ({
        ...item,
        dateObj: parseRocDate(item.applyDate)
    }));

    // 確保資料按時間降序排列 (新到舊)
    list.sort((a, b) => {
        if (!a.dateObj) return 1;
        if (!b.dateObj) return -1;
        return b.dateObj - a.dateObj;
    });

    let totalSeniority = { years: 0, months: 0, days: 0 };

    // 狀態變數
    let activeStartDate = null; // 目前執業開始日
    let activeHospital = null; // 目前執業機構
    let suspendStartDate = null; // 目前停業開始日
    let accumulatedDeduction = { years: 0, months: 0, days: 0 }; // 當次執業期間累積的扣除 YMD

    // 從列表底部 (最舊) 開始遍歷
    for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        const currentDate = item.dateObj;
        const type = item.type;
        const currentHospital = item.hospital;

        item.displayPeriod = null;
        item.displayAccumulated = null;
        item.displaySuspensionDuration = null;

        // 新增：若日期無效，則跳過計算，但資料已保留在 list 中會被 render
        if (!currentDate) {
            continue;
        }

        if (type.includes('執業') && !type.includes('歇業')) {
            // 開始執業
            if (!activeStartDate) {
                activeStartDate = currentDate;
                activeHospital = currentHospital;
                accumulatedDeduction = { years: 0, months: 0, days: 0 };
                suspendStartDate = null;
            }
        } else if (type.includes('歇業')) {
            // 結束執業
            if (activeStartDate) {
                if (currentHospital === activeHospital) {
                    // 計算這段總長度 (Gross) - 嚴格曆法計算
                    // 修改：如果歇業日期(endDate)存在，使用歇業日期計算；否則降級使用申請日期(currentDate)
                    let terminationDate = currentDate;
                    if (item.endDate) {
                        const parsedEnd = parseRocDate(item.endDate);
                        if (parsedEnd) {
                            terminationDate = parsedEnd;
                        }
                    }

                    let gross = getStrictDateDiff(activeStartDate, terminationDate);

                    // 處理未結的停業扣除
                    if (suspendStartDate) {
                        let pendingSusp = getStrictDateDiff(suspendStartDate, terminationDate); // 扣除也要對齊結束日期
                        accumulatedDeduction = addDuration(accumulatedDeduction, pendingSusp);
                        suspendStartDate = null;
                    }

                    // 淨年資 = 總長度 - 扣除額
                    let net = subFromTotal(gross, accumulatedDeduction);

                    // 加到總年資
                    totalSeniority = addDuration(totalSeniority, net);

                    // 紀錄顯示資訊
                    item.displayPeriod = formatDurationObject(net);
                    item.displayAccumulated = formatDurationObject(totalSeniority);

                    // 重置
                    activeStartDate = null;
                    activeHospital = null;
                    accumulatedDeduction = { years: 0, months: 0, days: 0 };
                }
            }
        } else if (type.includes('停業')) {
            if (activeStartDate && !suspendStartDate) {
                if (currentHospital === activeHospital) {
                    suspendStartDate = currentDate;
                }
            }
        } else if (type.includes('復業')) {
            if (suspendStartDate) {
                if (currentHospital === activeHospital) {
                    // 計算此次停業時間
                    let suspDuration = getStrictDateDiff(suspendStartDate, currentDate);
                    accumulatedDeduction = addDuration(accumulatedDeduction, suspDuration);

                    // 紀錄顯示
                    item.displaySuspensionDuration = formatDurationObject(suspDuration);

                    suspendStartDate = null;
                }
            }
        }
    }

    // 處理最後如果還在執業中 (計算到今天)
    if (activeStartDate) {
        let gross = getStrictDateDiff(activeStartDate, today);

        let currentSegmentDeduction = { ...accumulatedDeduction };
        if (suspendStartDate) {
            let pendingSusp = getStrictDateDiff(suspendStartDate, today);
            currentSegmentDeduction = addDuration(currentSegmentDeduction, pendingSusp);
        }

        let net = subFromTotal(gross, currentSegmentDeduction);
        totalSeniority = addDuration(totalSeniority, net);

        if (list.length > 0) {
            const lastItem = list[0];
            const isTermination = lastItem.type.includes('歇業');
            const isSuspension = lastItem.type.includes('停業');

            if (!isTermination && !isSuspension) {
                lastItem.displayPeriod = formatDurationObject(net);
                lastItem.displayAccumulated = formatDurationObject(totalSeniority);
            }
        }
    }

    return {
        totalString: formatDurationObject(totalSeniority),
        processedList: list
    };
}

// --- Test Framework ---
const testCases = [];
let passedCount = 0;
let failedCount = 0;

function test(description, fn) {
    testCases.push({ description, fn });
}

function runTests() {
    console.log("Running tests...");
    testCases.forEach(({ description, fn }) => {
        try {
            fn();
            console.log(`✅ PASS: ${description}`);
            passedCount++;
        } catch (error) {
            console.error(`❌ FAIL: ${description}`);
            console.error(error);
            failedCount++;
        }
    });
    console.log("--------------------");
    console.log(`Tests finished. Passed: ${passedCount}, Failed: ${failedCount}`);
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, but got ${actual}`);
    }
}

function assertDeepEquals(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(message || `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
    }
}

// --- Test Cases ---

test('parseRocDate: should parse "1120520" format', () => {
    const d = parseRocDate('1120520');
    assertEquals(d.getFullYear(), 2023);
    assertEquals(d.getMonth(), 4);
    assertEquals(d.getDate(), 20);
});

test('parseRocDate: should parse "112/05/20" format', () => {
    const d = parseRocDate('112/05/20');
    assertEquals(d.getFullYear(), 2023);
    assertEquals(d.getMonth(), 4);
    assertEquals(d.getDate(), 20);
});

test('getStrictDateDiff: should calculate correct diff', () => {
    const start = new Date(2022, 0, 1); // Jan 1, 2022
    const end = new Date(2023, 5, 15); // Jun 15, 2023
    const diff = getStrictDateDiff(start, end);
    assertDeepEquals(diff, { years: 1, months: 5, days: 14 });
});

test('getStrictDateDiff: should handle borrowing days from previous month', () => {
    const start = new Date(2023, 0, 31); // Jan 31, 2023
    const end = new Date(2023, 2, 1);   // Mar 1, 2023
    const diff = getStrictDateDiff(start, end);
    assertDeepEquals(diff, { years: 0, months: 1, days: 1 });
});

test('getStrictDateDiff: should handle different month lengths (Feb)', () => {
    const start = new Date(2023, 1, 15); // Feb 15, 2023
    const end = new Date(2023, 2, 15);   // Mar 15, 2023
    const diff = getStrictDateDiff(start, end);
    assertDeepEquals(diff, { years: 0, months: 1, days: 0 });
});

test('getStrictDateDiff: should handle leap years', () => {
    const start = new Date(2024, 1, 29); // Feb 29, 2024
    const end = new Date(2024, 2, 1);   // Mar 1, 2024
    const diff = getStrictDateDiff(start, end);
    assertDeepEquals(diff, { years: 0, months: 0, days: 1 });
});

test('addDuration: should sum durations correctly', () => {
    const total = { years: 1, months: 2, days: 10 };
    const part = { years: 2, months: 3, days: 5 };
    const result = addDuration(total, part);
    assertDeepEquals(result, { years: 3, months: 5, days: 15 });
});

test('addDuration: should handle day overflow', () => {
    const total = { years: 1, months: 2, days: 20 };
    const part = { years: 0, months: 0, days: 15 };
    const result = addDuration(total, part);
    assertDeepEquals(result, { years: 1, months: 3, days: 5 });
});

test('addDuration: should handle month overflow', () => {
    const total = { years: 1, months: 10, days: 10 };
    const part = { years: 0, months: 5, days: 5 };
    const result = addDuration(total, part);
    assertDeepEquals(result, { years: 2, months: 3, days: 15 });
});

test('subFromTotal: should subtract durations correctly', () => {
    const total = { years: 3, months: 5, days: 15 };
    const deduc = { years: 1, months: 2, days: 10 };
    const result = subFromTotal(total, deduc);
    assertDeepEquals(result, { years: 2, months: 3, days: 5 });
});

test('subFromTotal: should handle day underflow', () => {
    const total = { years: 3, months: 5, days: 10 };
    const deduc = { years: 1, months: 2, days: 15 };
    const result = subFromTotal(total, deduc);
    assertDeepEquals(result, { years: 2, months: 2, days: 25 });
});

test('subFromTotal: should handle month underflow', () => {
    const total = { years: 3, months: 2, days: 10 };
    const deduc = { years: 1, months: 5, days: 5 };
    const result = subFromTotal(total, deduc);
    assertDeepEquals(result, { years: 1, months: 9, days: 5 });
});

test('processHistory: simple case with one employment period', () => {
    const history = [
        { applyDate: '1120101', type: '歇業', hospital: 'A' },
        { applyDate: '1100101', type: '執業', hospital: 'A' }
    ];
    const result = processHistory(history);
    assertEquals(result.totalString, '02年00月00日');
});

test('processHistory: multiple employment periods', () => {
    const history = [
        { applyDate: '1110101', type: '歇業', hospital: 'A' },
        { applyDate: '1100101', type: '執業', hospital: 'A' },
        { applyDate: '1090101', type: '歇業', hospital: 'B' },
        { applyDate: '1080101', type: '執業', hospital: 'B' }
    ];
    const result = processHistory(history);
    assertEquals(result.totalString, '02年00月00日');
});

test('processHistory: with suspension and resumption', () => {
    const history = [
        { applyDate: '1120101', type: '歇業', hospital: 'A' },
        { applyDate: '1110101', type: '復業', hospital: 'A' },
        { applyDate: '1100601', type: '停業', hospital: 'A' },
        { applyDate: '1100101', type: '執業', hospital: 'A' }
    ];
    const result = processHistory(history);
    // Total period: 2 years. Suspension: 7 months. Net: 1 year 5 months
    assertEquals(result.totalString, '01年05月00日');
});

test('processHistory: currently employed (to date)', () => {
    const history = [
        { applyDate: '1120101', type: '執業', hospital: 'A' },
    ];
    const today = new Date('2024-01-01');
    const result = processHistory(history, today);
    assertEquals(result.totalString, '01年00月00日');
});

// Run all tests
runTests();
