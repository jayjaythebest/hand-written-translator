import React, { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, addDoc,
  deleteDoc, doc, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Project } from '../types';
import { getSessionId } from '../lib/session';
import { motion, AnimatePresence } from 'motion/react';
import { FolderOpen, Plus, Trash2, ChevronRight, FileText, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  onSelectProject: (project: Project) => void;
}

export default function ProjectList({ onSelectProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const uid = getSessionId();

  useEffect(() => {
    const q = query(collection(db, 'projects'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
        // Sort client-side to avoid composite index requirement
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setProjects(list);
      },
      (err) => console.error('Projects listener error:', err),
    );
  }, [uid]);

  const createProject = async () => {
    const name = newName.trim();
    if (!name) return;
    const ref = await addDoc(collection(db, 'projects'), {
      name,
      uid,
      createdAt: serverTimestamp(),
    });
    setNewName('');
    setCreating(false);
    onSelectProject({ id: ref.id, name, uid, createdAt: new Date() });
  };

  const deleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('確定要刪除此專案及所有資料嗎？')) return;
    setDeleting(projectId);
    try {
      // Delete sub-collections
      const imgSnap = await getDocs(query(collection(db, 'projectImages'), where('projectId', '==', projectId)));
      await Promise.all(imgSnap.docs.map((d) => deleteDoc(d.ref)));
      const recSnap = await getDocs(query(collection(db, 'projectRecords'), where('projectId', '==', projectId)));
      await Promise.all(recSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'projects', projectId));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <FileText className="text-white w-4 h-4" />
          </div>
          <h1 className="font-bold text-lg">手寫帳本翻譯平台</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Title row */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-800">我的專案</h2>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200"
          >
            <Plus className="w-4 h-4" />
            新建專案
          </button>
        </div>

        {/* New project form */}
        <AnimatePresence>
          {creating && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white border border-blue-200 rounded-2xl p-5 mb-5 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-slate-700 text-sm">新建專案</p>
                <button onClick={() => { setCreating(false); setNewName(''); }}
                  className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createProject()}
                  placeholder="例如：114年12月帳本、公司報銷…"
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  onClick={createProject}
                  disabled={!newName.trim()}
                  className="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-blue-700 transition-colors"
                >
                  建立
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Project list */}
        <div className="space-y-3">
          {projects.length === 0 && !creating ? (
            <div className="text-center py-20 text-slate-400">
              <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">尚無專案</p>
              <p className="text-sm mt-1">點擊「新建專案」開始批量上傳手寫帳本</p>
            </div>
          ) : (
            projects.map((project) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'bg-white border rounded-2xl p-5 cursor-pointer group transition-all',
                  deleting === project.id
                    ? 'opacity-50 pointer-events-none border-slate-200'
                    : 'border-slate-200 hover:border-blue-200 hover:shadow-md',
                )}
                onClick={() => onSelectProject(project)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                      <FolderOpen className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{project.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {project.createdAt?.toDate
                          ? project.createdAt.toDate().toLocaleDateString('zh-TW')
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => deleteProject(project.id, e)}
                      className="p-2 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                      title="刪除專案"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
