import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, where, onSnapshot, addDoc,
  deleteDoc, doc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Project, ProjectImage, ProjectRecord, DailyExpense, EntryRecord, ExpenseItem } from '../types';
import { getSessionId } from '../lib/session';
import { compressImage, computeImageHash } from '../lib/imageUtils';
import { exportProjectToExcel, exportDayToExcel } from '../lib/excelExport';
import { parseExpenseImage } from '../services/geminiService';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  ArrowLeft, Upload, Download, Trash2, CheckCircle2, AlertCircle,
  Loader2, ImageIcon, BarChart3, FileSpreadsheet, PenLine, Plus,
  X, Save, ChevronDown, ChevronUp, Calendar, DollarSign, Share2,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  processing: 'bg-blue-50 text-blue-600',
  done: 'bg-green-50 text-green-600',
  error: 'bg-red-50 text-red-500',
};
const STATUS_LABELS: Record<string, string> = {
  pending: '等待中',
  processing: '處理中',
  done: '完成',
  error: '失敗',
};

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
interface Props {
  project: Project;
  onBack: () => void;
}

type Tab = 'upload' | 'data' | 'stats';

export default function ProjectDetail({ project, onBack }: Props) {
  const uid = getSessionId();
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [records, setRecords] = useState<ProjectRecord[]>([]);
  const [tab, setTab] = useState<Tab>('upload');
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  // Real-time listeners (no orderBy to avoid composite index requirement — sort client-side)
  useEffect(() => {
    const q = query(collection(db, 'projectImages'), where('projectId', '==', project.id));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectImage));
        list.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        setImages(list);
      },
      (err) => console.error('Images listener error:', err),
    );
  }, [project.id]);

  useEffect(() => {
    const q = query(collection(db, 'projectRecords'), where('projectId', '==', project.id));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectRecord));
        list.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        setRecords(list);
      },
      (err) => console.error('Records listener error:', err),
    );
  }, [project.id]);

  const showToast = (msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Processing pipeline ──────────────────────────────────────────────
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pending = images.find(
      (img) => img.status === 'pending' && !inFlightRef.current.has(img.id),
    );
    if (!pending) return;

    inFlightRef.current.add(pending.id);

    (async () => {
      const imgRef = doc(db, 'projectImages', pending.id);
      try {
        await updateDoc(imgRef, { status: 'processing' });
        const result = await parseExpenseImage(pending.imageDataUrl);

        await addDoc(collection(db, 'projectRecords'), {
          projectId: project.id,
          imageId: pending.id,
          uid,
          dailyExpenses: result.dailyExpenses,
          createdAt: serverTimestamp(),
        });
        await updateDoc(imgRef, { status: 'done' });
      } catch (err: any) {
        await updateDoc(imgRef, {
          status: 'error',
          errorMessage: err?.message ?? '未知錯誤',
        });
      } finally {
        inFlightRef.current.delete(pending.id);
      }
    })();
  }, [images, project.id, uid]);

  // ── Upload handler (parallel) ────────────────────────────────────────
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      // Step 1: read all files in parallel
      const fileDataList = await Promise.all(
        acceptedFiles.map(async (file) => {
          const rawDataUrl = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result as string);
            reader.onerror = () => rej(new Error(`無法讀取 ${file.name}`));
            reader.readAsDataURL(file);
          });
          return { file, rawDataUrl, hash: computeImageHash(rawDataUrl) };
        }),
      );

      // Step 2: deduplicate (against existing + within this batch)
      const seen = new Set(images.map((img) => img.imageHash));
      let skipped = 0;
      const unique = fileDataList.filter(({ hash }) => {
        if (seen.has(hash)) { skipped++; return false; }
        seen.add(hash);
        return true;
      });

      // Step 3: compress + upload all in parallel
      const results = await Promise.allSettled(
        unique.map(async ({ file, rawDataUrl, hash }) => {
          const compressed = await compressImage(rawDataUrl);
          await addDoc(collection(db, 'projectImages'), {
            projectId: project.id,
            uid,
            fileName: file.name,
            imageHash: hash,
            imageDataUrl: compressed,
            status: 'pending',
            createdAt: serverTimestamp(),
          });
        }),
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) showToast(`${failed} 張圖片上傳失敗`, 'error');
      if (skipped > 0) showToast(`已跳過 ${skipped} 張重複圖片`);
      if (results.some((r) => r.status === 'fulfilled')) setTab('data');
    },
    [images, project.id, uid],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
  } as any);

  // ── Delete image + record ────────────────────────────────────────────
  const deleteImage = async (imgId: string) => {
    const rec = records.find((r) => r.imageId === imgId);
    if (rec) await deleteDoc(doc(db, 'projectRecords', rec.id));
    await deleteDoc(doc(db, 'projectImages', imgId));
  };

  // ── Retry failed image ───────────────────────────────────────────────
  const retryImage = async (imgId: string) => {
    await updateDoc(doc(db, 'projectImages', imgId), { status: 'pending', errorMessage: null });
  };

  // ── Stats ────────────────────────────────────────────────────────────
  const allDays = records.flatMap((r) => r.dailyExpenses);
  const dateMap = new Map<string, number>();
  allDays.forEach((d) => dateMap.set(d.date, (dateMap.get(d.date) ?? 0) + d.dayTotal));
  const sortedDates = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const grandTotal = sortedDates.reduce((s, [, v]) => s + v, 0);

  const personMap = new Map<string, number>();
  allDays.forEach((d) =>
    d.entries.forEach((e) => personMap.set(e.name, (personMap.get(e.name) ?? 0) + e.total)),
  );

  const doneCount = images.filter((i) => i.status === 'done').length;
  const pendingCount = images.filter((i) => i.status === 'pending' || i.status === 'processing').length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              'fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium shadow-lg',
              toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-800 text-white',
            )}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h1 className="font-bold text-slate-800 truncate">{project.name}</h1>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" />
                處理中 {pendingCount}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?project=${project.id}`;
              navigator.clipboard.writeText(url).then(() => showToast('分享連結已複製'));
            }}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition-colors"
          >
            <Share2 className="w-4 h-4" />
            分享
          </button>
          <button
            onClick={() => exportProjectToExcel(project.name, records)}
            disabled={records.length === 0}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-30"
          >
            <Download className="w-4 h-4" />
            匯出 Excel
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1 pb-0">
          {(['upload', 'data', 'stats'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-semibold border-b-2 transition-colors',
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {t === 'upload' && '上傳圖片'}
              {t === 'data' && `資料 ${doneCount > 0 ? `(${doneCount})` : ''}`}
              {t === 'stats' && '統計'}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* ── TAB: UPLOAD ── */}
        {tab === 'upload' && (
          <div className="space-y-6">
            <div
              {...getRootProps()}
              className={cn(
                'border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all min-h-[220px]',
                isDragActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 hover:border-slate-400 bg-white',
              )}
            >
              <input {...getInputProps()} />
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center">
                <Upload className="w-7 h-7 text-slate-400" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-700">拖曳或點擊上傳圖片</p>
                <p className="text-sm text-slate-400 mt-1">支援批量上傳，自動偵測重複圖片</p>
              </div>
            </div>

            {/* Image queue */}
            {images.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-700 text-sm">已上傳圖片 ({images.length})</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {images.map((img) => (
                    <div
                      key={img.id}
                      className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3"
                    >
                      <img
                        src={img.imageDataUrl}
                        alt={img.fileName}
                        className="w-14 h-14 object-cover rounded-lg border border-slate-100 shrink-0"
                        loading="lazy"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{img.fileName}</p>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-flex items-center gap-1', STATUS_STYLES[img.status])}>
                          {img.status === 'processing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {img.status === 'done' && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {img.status === 'error' && <AlertCircle className="w-2.5 h-2.5" />}
                          {STATUS_LABELS[img.status]}
                        </span>
                        {img.status === 'error' && img.errorMessage && (
                          <p className="text-xs text-red-400 mt-1 truncate">{img.errorMessage}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {img.status === 'error' && (
                          <button
                            onClick={() => retryImage(img.id)}
                            className="text-xs text-blue-500 hover:text-blue-700 font-medium"
                          >
                            重試
                          </button>
                        )}
                        <button
                          onClick={() => deleteImage(img.id)}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: DATA ── */}
        {tab === 'data' && (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <FileSpreadsheet className="w-14 h-14 mx-auto mb-4 opacity-20" />
                <p className="font-medium">尚無轉譯資料</p>
                <p className="text-sm mt-1">上傳圖片後將自動解析</p>
              </div>
            ) : (
              records.map((rec) => {
                const img = images.find((i) => i.id === rec.imageId);
                return (
                  <RecordCard
                    key={rec.id}
                    record={rec}
                    image={img}
                    onDelete={() => img && deleteImage(img.id)}
                    onSave={async (updated) => {
                      await updateDoc(doc(db, 'projectRecords', rec.id), {
                        dailyExpenses: updated,
                      });
                    }}
                    onExport={(days) =>
                      exportDayToExcel(
                        days,
                        `${project.name}_${img?.fileName ?? rec.id}_${new Date().toISOString().slice(0, 10)}.xlsx`,
                      )
                    }
                  />
                );
              })
            )}
          </div>
        )}

        {/* ── TAB: STATS ── */}
        {tab === 'stats' && (
          <div className="space-y-5">
            {allDays.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <BarChart3 className="w-14 h-14 mx-auto mb-4 opacity-20" />
                <p className="font-medium">尚無統計資料</p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard icon={<Calendar className="w-5 h-5 text-blue-500" />} label="已記錄天數" value={`${sortedDates.length} 天`} />
                  <StatCard icon={<DollarSign className="w-5 h-5 text-green-500" />} label="總金額" value={`$${grandTotal.toLocaleString()}`} />
                  <StatCard icon={<ImageIcon className="w-5 h-5 text-purple-500" />} label="已處理圖片" value={`${doneCount} 張`} />
                </div>

                {/* Date breakdown */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-700">各日期帳目</h3>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {sortedDates.map(([date, total]) => {
                      const dayEntries = allDays.filter((d) => d.date === date);
                      const itemCount = dayEntries.reduce((s, d) => s + d.entries.reduce((ss, e) => ss + e.items.length, 0), 0);
                      return (
                        <div key={date} className="px-5 py-3 flex items-center justify-between">
                          <div>
                            <p className="font-medium text-slate-700 text-sm">{date}</p>
                            <p className="text-xs text-slate-400">{itemCount} 項消費</p>
                          </div>
                          <p className="font-bold text-blue-600">${total.toLocaleString()}</p>
                        </div>
                      );
                    })}
                    <div className="px-5 py-3 flex items-center justify-between bg-slate-50">
                      <p className="font-bold text-slate-700 text-sm">合計</p>
                      <p className="font-black text-blue-700 text-lg">${grandTotal.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Person breakdown */}
                {personMap.size > 0 && (
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-700">人員消費統計</h3>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {[...personMap.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([name, total]) => (
                          <div key={name} className="px-5 py-3 flex items-center justify-between">
                            <p className="font-medium text-slate-700 text-sm">{name}</p>
                            <p className="font-bold text-slate-800">${total.toLocaleString()}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────
// StatCard
// ─────────────────────────────────────────────
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="font-bold text-slate-800 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RecordCard – shows one image's extracted data with inline editing
// ─────────────────────────────────────────────
interface RecordCardProps {
  record: ProjectRecord;
  image?: ProjectImage;
  onDelete: () => void;
  onSave: (days: DailyExpense[]) => Promise<void>;
  onExport: (days: DailyExpense[]) => void;
}

function RecordCard({ record, image, onDelete, onSave, onExport }: RecordCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DailyExpense[]>([]);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const startEdit = () => {
    setDraft(structuredClone(record.dailyExpenses));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft([]);
  };

  const save = async () => {
    setSaving(true);
    // Recalculate totals
    const recalculated = draft.map((day) => ({
      ...day,
      entries: day.entries.map((entry) => ({
        ...entry,
        total: entry.items.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      })),
      dayTotal: day.entries.reduce(
        (s, entry) => s + entry.items.reduce((ss, i) => ss + (Number(i.amount) || 0), 0),
        0,
      ),
    }));
    await onSave(recalculated);
    setEditing(false);
    setSaving(false);
  };

  // Draft mutation helpers
  const updateDate = (di: number, val: string) => {
    setDraft((d) => d.map((day, i) => (i === di ? { ...day, date: val } : day)));
  };
  const updateEntryName = (di: number, ei: number, val: string) => {
    setDraft((d) =>
      d.map((day, i) =>
        i !== di ? day : {
          ...day,
          entries: day.entries.map((e, j) => (j !== ei ? e : { ...e, name: val })),
        },
      ),
    );
  };
  const updateItem = (di: number, ei: number, ii: number, field: 'description' | 'amount', val: string) => {
    setDraft((d) =>
      d.map((day, i) =>
        i !== di ? day : {
          ...day,
          entries: day.entries.map((entry, j) =>
            j !== ei ? entry : {
              ...entry,
              items: entry.items.map((item, k) =>
                k !== ii ? item : { ...item, [field]: field === 'amount' ? Number(val) || 0 : val },
              ),
            },
          ),
        },
      ),
    );
  };
  const addItem = (di: number, ei: number) => {
    setDraft((d) =>
      d.map((day, i) =>
        i !== di ? day : {
          ...day,
          entries: day.entries.map((entry, j) =>
            j !== ei ? entry : {
              ...entry,
              items: [...entry.items, { description: '', amount: 0 }],
            },
          ),
        },
      ),
    );
  };
  const removeItem = (di: number, ei: number, ii: number) => {
    setDraft((d) =>
      d.map((day, i) =>
        i !== di ? day : {
          ...day,
          entries: day.entries.map((entry, j) =>
            j !== ei ? entry : {
              ...entry,
              items: entry.items.filter((_, k) => k !== ii),
            },
          ),
        },
      ),
    );
  };
  const addEntry = (di: number) => {
    setDraft((d) =>
      d.map((day, i) =>
        i !== di ? day : {
          ...day,
          entries: [...day.entries, { name: '', items: [{ description: '', amount: 0 }], total: 0 }],
        },
      ),
    );
  };
  const removeEntry = (di: number, ei: number) => {
    setDraft((d) =>
      d.map((day, i) =>
        i !== di ? day : { ...day, entries: day.entries.filter((_, j) => j !== ei) },
      ),
    );
  };
  const addDay = () => {
    setDraft((d) => [
      ...d,
      { date: '', entries: [{ name: '', items: [{ description: '', amount: 0 }], total: 0 }], dayTotal: 0 },
    ]);
  };
  const removeDay = (di: number) => {
    setDraft((d) => d.filter((_, i) => i !== di));
  };

  const displayData = editing ? draft : record.dailyExpenses;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        {image && (
          <img
            src={image.imageDataUrl}
            alt={image.fileName}
            className="w-12 h-12 object-cover rounded-xl border border-slate-100 shrink-0"
            loading="lazy"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-700 text-sm truncate">
            {image?.fileName ?? record.imageId}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {record.dailyExpenses.length} 天・
            ${record.dailyExpenses.reduce((s, d) => s + d.dayTotal, 0).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <>
              <button
                onClick={() => onExport(record.dailyExpenses)}
                className="p-2 rounded-xl text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                title="匯出此圖片"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={startEdit}
                className="p-2 rounded-xl text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors"
                title="編輯資料"
              >
                <PenLine className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-50 transition-colors"
                title="刪除此圖片資料"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          {editing && (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                儲存
              </button>
              <button
                onClick={cancelEdit}
                className="flex items-center gap-1.5 bg-slate-100 text-slate-600 text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-slate-200 transition-colors"
              >
                取消
              </button>
            </>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Card body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-slate-50">
              {displayData.map((day, di) => (
                <div key={di} className="p-5">
                  {/* Date row */}
                  <div className="flex items-center justify-between mb-3">
                    {editing ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          value={day.date}
                          onChange={(e) => updateDate(di, e.target.value)}
                          placeholder="日期"
                          className="text-sm font-bold text-slate-700 border-b border-slate-300 focus:border-blue-400 focus:outline-none bg-transparent w-36"
                        />
                        <button onClick={() => removeDay(di)} className="text-red-400 hover:text-red-600 ml-auto">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-bold text-slate-700 text-sm">{day.date}</span>
                      </div>
                    )}
                    {!editing && (
                      <span className="text-sm font-bold text-blue-600">${day.dayTotal.toLocaleString()}</span>
                    )}
                  </div>

                  {/* Entries */}
                  <div className="space-y-4">
                    {day.entries.map((entry, ei) => (
                      <div key={ei} className={cn('rounded-xl p-4 space-y-2', editing ? 'bg-amber-50 border border-amber-100' : 'bg-slate-50')}>
                        {editing ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={entry.name}
                              onChange={(e) => updateEntryName(di, ei, e.target.value)}
                              placeholder="姓名"
                              className="text-sm font-semibold text-slate-700 border-b border-amber-300 focus:border-blue-400 focus:outline-none bg-transparent flex-1"
                            />
                            <button onClick={() => removeEntry(di, ei)} className="text-red-400 hover:text-red-600">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm font-semibold text-slate-700">{entry.name}</p>
                        )}

                        {entry.items.map((item, ii) => (
                          <div key={ii} className="flex items-center gap-2 text-sm">
                            {editing ? (
                              <>
                                <input
                                  value={item.description}
                                  onChange={(e) => updateItem(di, ei, ii, 'description', e.target.value)}
                                  placeholder="品項說明"
                                  className="flex-1 text-slate-600 border-b border-amber-200 focus:border-blue-400 focus:outline-none bg-transparent text-xs"
                                />
                                <input
                                  type="number"
                                  value={item.amount || ''}
                                  onChange={(e) => updateItem(di, ei, ii, 'amount', e.target.value)}
                                  placeholder="金額"
                                  className="w-20 text-right text-slate-800 font-medium border-b border-amber-200 focus:border-blue-400 focus:outline-none bg-transparent text-xs"
                                />
                                <button onClick={() => removeItem(di, ei, ii)} className="text-red-400 hover:text-red-600 shrink-0">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-slate-500 flex-1">{item.description}</span>
                                <span className="font-medium text-slate-800">${item.amount.toLocaleString()}</span>
                              </>
                            )}
                          </div>
                        ))}

                        {editing && (
                          <button
                            onClick={() => addItem(di, ei)}
                            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 mt-1"
                          >
                            <Plus className="w-3 h-3" /> 新增品項
                          </button>
                        )}

                        {!editing && (
                          <div className="flex justify-end pt-2 border-t border-slate-200/60">
                            <span className="text-xs text-slate-400 mr-2">小計</span>
                            <span className="text-sm font-bold text-slate-700">${entry.total.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    ))}

                    {editing && (
                      <button
                        onClick={() => addEntry(di)}
                        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                      >
                        <Plus className="w-3 h-3" /> 新增人員
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {editing && (
                <div className="p-5">
                  <button
                    onClick={addDay}
                    className="flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-700 font-medium"
                  >
                    <Plus className="w-4 h-4" /> 新增日期
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
