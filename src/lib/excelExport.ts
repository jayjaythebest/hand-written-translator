import * as XLSX from 'xlsx';
import { DailyExpense, ProjectRecord } from '../types';

function safeName(name: string, max = 31): string {
  return name.replace(/[\\/*?[\]:]/g, '_').slice(0, max);
}

/** Export all records from a project into a multi-sheet Excel file. */
export function exportProjectToExcel(projectName: string, records: ProjectRecord[]): void {
  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: 完整明細 ───────────────────────────────────────────────
  const detailRows: any[] = [];
  records.forEach((rec) => {
    rec.dailyExpenses.forEach((day) => {
      day.entries.forEach((entry) => {
        entry.items.forEach((item) => {
          detailRows.push({
            日期: day.date,
            姓名: entry.name,
            品項說明: item.description,
            金額: item.amount,
            小計: entry.total,
            日合計: day.dayTotal,
          });
        });
      });
    });
  });

  if (detailRows.length === 0) {
    detailRows.push({ 日期: '（尚無資料）' });
  }

  const detailWs = XLSX.utils.json_to_sheet(detailRows);
  // Column widths
  detailWs['!cols'] = [
    { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, detailWs, '完整明細');

  // ─── Sheet 2: 日期統計 ───────────────────────────────────────────────
  const dailyMap = new Map<string, { total: number; count: number }>();
  records.forEach((rec) => {
    rec.dailyExpenses.forEach((day) => {
      const prev = dailyMap.get(day.date) ?? { total: 0, count: 0 };
      dailyMap.set(day.date, {
        total: prev.total + day.dayTotal,
        count: prev.count + day.entries.length,
      });
    });
  });

  const dailySorted = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dailyRows = dailySorted.map(([date, { total, count }]) => ({
    日期: date,
    消費筆數: count,
    日合計金額: total,
  }));

  const totalAmount = dailyRows.reduce((s, r) => s + r['日合計金額'], 0);
  dailyRows.push({ 日期: '── 總計 ──', 消費筆數: dailyRows.reduce((s, r) => s + r['消費筆數'], 0), 日合計金額: totalAmount });

  const dailyWs = XLSX.utils.json_to_sheet(dailyRows);
  dailyWs['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, dailyWs, '日期統計');

  // ─── Sheet 3: 人員統計 ───────────────────────────────────────────────
  const personMap = new Map<string, { total: number; count: number }>();
  records.forEach((rec) => {
    rec.dailyExpenses.forEach((day) => {
      day.entries.forEach((entry) => {
        const prev = personMap.get(entry.name) ?? { total: 0, count: 0 };
        personMap.set(entry.name, {
          total: prev.total + entry.total,
          count: prev.count + 1,
        });
      });
    });
  });

  const personRows = [...personMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, { total, count }]) => ({
      姓名: name,
      消費次數: count,
      累計金額: total,
    }));

  const personWs = XLSX.utils.json_to_sheet(personRows.length ? personRows : [{ 姓名: '（尚無資料）' }]);
  personWs['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, personWs, '人員統計');

  const fileName = `${safeName(projectName)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/** Export a single DailyExpense array (used for per-image export). */
export function exportDayToExcel(days: DailyExpense[], fileName: string): void {
  const rows: any[] = [];
  days.forEach((day) => {
    day.entries.forEach((entry) => {
      entry.items.forEach((item) => {
        rows.push({
          日期: day.date,
          姓名: entry.name,
          品項說明: item.description,
          金額: item.amount,
          小計: entry.total,
          日合計: day.dayTotal,
        });
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 日期: '（尚無資料）' }]);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '明細');
  XLSX.writeFile(wb, fileName);
}
