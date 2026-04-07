import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import { Project } from './types';

export default function App() {
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: if URL has ?project=ID, load that project directly (enables share links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    if (projectId) {
      getDoc(doc(db, 'projects', projectId))
        .then((snap) => {
          if (snap.exists()) setActiveProject({ id: snap.id, ...snap.data() } as Project);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleSelectProject = (project: Project) => {
    setActiveProject(project);
    window.history.pushState({}, '', `?project=${project.id}`);
  };

  const handleBack = () => {
    setActiveProject(null);
    window.history.pushState({}, '', window.location.pathname);
  };

  if (loading) return null;

  return activeProject ? (
    <ProjectDetail project={activeProject} onBack={handleBack} />
  ) : (
    <ProjectList onSelectProject={handleSelectProject} />
  );
}
