import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Loader2, AlertCircle, ChevronRight, Calendar, Download, Trash2, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  orderBy 
} from 'firebase/firestore';
import { db } from './firebase';
import { parseExpenseImage } from './services/geminiService';
import { ExtractionResult, DailyExpense } from './types';
import { cn } from './lib/utils';

// Simple session ID generator to keep history local to the browser
const getSessionId = () => {
  let sid = localStorage.getItem('expense_session_id');
  if (!sid) {
    sid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('expense_session_id', sid);
  }
  return sid;
};

export default function App() {
  const [sessionId] = useState(getSessionId());
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [history, setHistory] = useState<(DailyExpense & { id: string })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // History Listener
  useEffect(() => {
    const q = query(
      collection(db, 'expenses'),
      where('uid', '==', sessionId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as (DailyExpense & { id: string })[];
      setHistory(docs);
    }, (err) => {
      console.error("Firestore Error:", err);
      setError("Failed to load history. Please refresh the page.");
    });

    return () => unsubscribe();
  }, [sessionId]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImage(reader.result as string);
        setResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false,
  } as any);

  const handleParse = async () => {
    if (!image) return;
    setLoading(true);
    setError(null);
    try {
      const data = await parseExpenseImage(image);
      setResult(data);
      
      // Auto-save to Firestore using sessionId
      for (const day of data.dailyExpenses) {
        await addDoc(collection(db, 'expenses'), {
          ...day,
          uid: sessionId,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error(err);
      setError('Failed to parse image. Please try again with a clearer photo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (err) {
      console.error(err);
      setError("Failed to delete record.");
    }
  };

  const exportToExcel = (data: DailyExpense[]) => {
    const rows: any[] = [];
    data.forEach(day => {
      day.entries.forEach(entry => {
        entry.items.forEach(item => {
          rows.push({
            'Date': day.date,
            'Name': entry.name,
            'Description': item.description,
            'Amount': item.amount,
            'Entry Total': entry.total,
            'Day Total': day.dayTotal
          });
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Expenses");
    XLSX.writeFile(workbook, `Expenses_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight hidden sm:block">Expense Parser</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showHistory ? "bg-blue-50 text-blue-600" : "hover:bg-slate-100 text-slate-600"
              )}
              title="History"
            >
              <History className="w-5 h-5" />
            </button>
            <button
              onClick={() => exportToExcel(history)}
              disabled={history.length === 0}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30"
              title="Export All to Excel"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Upload & Preview */}
          <section className="space-y-6">
            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 min-h-[300px]",
                isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400 bg-white",
                image ? "p-4" : "p-12"
              )}
            >
              <input {...getInputProps()} />
              {image ? (
                <div className="relative w-full group">
                  <img
                    src={image}
                    alt="Ledger Preview"
                    className="w-full rounded-xl shadow-lg border border-slate-200"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                    <p className="text-white font-medium">Click or drag to change image</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                    <Upload className="text-slate-400 w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold">Upload Ledger Image</p>
                    <p className="text-slate-500 text-sm">Drag and drop or click to select</p>
                  </div>
                </>
              )}
            </div>

            {image && !loading && (
              <button
                onClick={handleParse}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-blue-200 transition-all active:scale-95"
              >
                Parse & Save Ledger
              </button>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </section>

          {/* Right Column: Results & History */}
          <section className="space-y-6">
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-2xl p-12 border border-slate-200 flex flex-col items-center justify-center gap-4 text-center h-full"
                >
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                  <div>
                    <h3 className="font-bold text-lg">Analyzing Ledger...</h3>
                    <p className="text-slate-500 text-sm">Extracting text and saving to database</p>
                  </div>
                </motion.div>
              ) : showHistory ? (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold tracking-tight">History</h2>
                    <button 
                      onClick={() => exportToExcel(history)}
                      className="text-sm text-blue-600 font-bold hover:underline"
                    >
                      Export All
                    </button>
                  </div>
                  <div className="space-y-4">
                    {history.length === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>No saved expenses yet</p>
                      </div>
                    ) : (
                      history.map((day) => (
                        <div key={day.id} className="relative group">
                          <DayCard day={day} />
                          <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => exportToExcel([day])}
                              className="p-2 bg-white border border-slate-200 rounded-lg text-blue-500 shadow-sm hover:bg-blue-50"
                              title="Export Day"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(day.id)}
                              className="p-2 bg-white border border-slate-200 rounded-lg text-red-500 shadow-sm hover:bg-red-50"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              ) : result ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold tracking-tight">Recent Parse</h2>
                    <button 
                      onClick={() => exportToExcel(result.dailyExpenses)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                  </div>
                  <div className="space-y-4">
                    {result.dailyExpenses.map((day, idx) => (
                      <div key={idx}>
                        <DayCard day={day} />
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-slate-100/50 rounded-2xl p-12 border border-dashed border-slate-300 flex flex-col items-center justify-center gap-4 text-center h-full text-slate-400"
                >
                  <FileText className="w-12 h-12" />
                  <p className="max-w-[200px]">Upload an image to parse and save expenses</p>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </main>
    </div>
  );
}

function DayCard({ day }: { day: DailyExpense }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <h3 className="font-bold text-slate-700">{day.date}</h3>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Day Total</p>
          <p className="text-lg font-black text-blue-600">${day.dayTotal.toLocaleString()}</p>
        </div>
      </div>
      
      <div className="divide-y divide-slate-100">
        {day.entries.map((entry, eIdx) => (
          <div key={eIdx} className="p-6 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-500">
                {eIdx + 1}
              </span>
              <span className="font-semibold text-slate-800">{entry.name}</span>
            </div>
            
            <div className="space-y-2">
              {entry.items.map((item, iIdx) => (
                <div key={iIdx} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 flex items-center gap-2">
                    <ChevronRight className="w-3 h-3 text-slate-300" />
                    {item.description}
                  </span>
                  <span className="font-medium text-slate-900">${item.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
            
            <div className="pt-3 flex justify-end">
              <div className="bg-slate-50 px-3 py-1 rounded-lg border border-slate-100">
                <span className="text-xs text-slate-400 mr-2">Subtotal:</span>
                <span className="font-bold text-slate-700">${entry.total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
