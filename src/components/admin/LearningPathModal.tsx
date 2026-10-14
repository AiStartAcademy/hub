"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  X, Plus, Trash2, Check, Loader2, Route, BookOpen, Search, 
  ChevronDown, ChevronRight, GripVertical, Copy
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface LearningPathModalProps {
  cohortId: string;
  onClose: () => void;
  onSaved: () => void;
}

// === Sortable Item Component ===
function SortableSequenceItem({ item, onRemove }: { item: any; onRemove: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2.5 rounded-lg border bg-white dark:bg-slate-800 group ${
        isDragging 
          ? "border-primary shadow-lg opacity-75" 
          : "border-slate-200 dark:border-slate-700 hover:border-slate-300"
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="text-slate-300 hover:text-primary cursor-grab active:cursor-grabbing p-1"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-xs font-medium text-slate-400 min-w-[20px]">{item.order + 1}.</span>
        <p className="text-sm font-semibold truncate text-slate-800 dark:text-slate-200">
          {item.lesson?.name || "Loading..."}
        </p>
      </div>
      <button 
        onClick={() => onRemove(item.lessonId)} 
        className="text-slate-400 hover:text-rose-500 p-1 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// === Copy Path Modal ===
function CopyPathModal({ 
  pathId, 
  currentCohortId, 
  onClose, 
  onSuccess 
}: { 
  pathId: string, 
  currentCohortId: string, 
  onClose: () => void,
  onSuccess: () => void 
}) {
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/cohorts/list')
      .then(res => res.json())
      .then(data => {
        // Exclude current cohort
        const filtered = Array.isArray(data) ? data.filter(c => c.id !== currentCohortId) : [];
        setCohorts(filtered);
        if (filtered.length > 0) setSelectedCohortId(filtered[0].id);
        setLoading(false);
      });
  }, [currentCohortId]);

  const handleCopy = async () => {
    if (!selectedCohortId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/learning-paths/${pathId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCohortId: selectedCohortId })
      });
      if (res.ok) {
        alert("Path copied successfully!");
        onSuccess();
        onClose();
      } else {
        alert("Failed to copy path");
      }
    } catch {
      alert("Error copying path");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 rounded-xl shadow-xl w-80">
        <h3 className="font-bold text-sm mb-3">Copy Path to...</h3>
        {loading ? (
          <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
        ) : cohorts.length === 0 ? (
          <p className="text-xs text-slate-500 mb-4">No other cohorts available.</p>
        ) : (
          <select 
            value={selectedCohortId} 
            onChange={(e) => setSelectedCohortId(e.target.value)}
            className="w-full mb-4 p-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:border-primary"
          >
            {cohorts.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-3 py-1.5 text-xs font-medium rounded hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={handleCopy} disabled={saving || cohorts.length === 0} className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50 flex items-center gap-1">
            {saving ? <Loader2 className="h-3 w-3 animate-spin"/> : <Copy className="h-3 w-3"/>} Copy
          </button>
        </div>
      </div>
    </div>
  );
}

export function LearningPathModal({ cohortId, onClose, onSaved }: LearningPathModalProps) {
  const [paths, setPaths] = useState<any[]>([]);
  const [programs, setPrograms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Searches
  const [pathSearch, setPathSearch] = useState("");
  const [lessonSearch, setLessonSearch] = useState("");
  const [lastSearchQuery, setLastSearchQuery] = useState(""); // helps track if search just changed
  
  // Tree state
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Input editing state
  const [editingTitle, setEditingTitle] = useState("");
  
  // Modals
  const [showCopyModal, setShowCopyModal] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const pathsRes = await fetch(`/api/admin/cohorts/${cohortId}/learning-paths`);
      if (pathsRes.ok) {
        const pathsData = await pathsRes.json();
        setPaths(pathsData);
        if (pathsData.length > 0 && !selectedPathId) {
          setSelectedPathId(pathsData[0].id);
          setEditingTitle(pathsData[0].title);
        }
      }

      const treeRes = await fetch('/api/programs/tree');
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        setPrograms(treeData);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const selectedPath = paths.find(p => p.id === selectedPathId);

  // Sync edit title when selected path changes
  useEffect(() => {
    if (selectedPath) {
      setEditingTitle(selectedPath.title);
    }
  }, [selectedPathId]);

  const handleCreatePath = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cohorts/${cohortId}/learning-paths`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Learning Path" }),
      });
      if (res.ok) {
        const newPath = await res.json();
        setPaths(prev => [...prev, { ...newPath, _count: { items: 0 }, items: [] }]);
        setSelectedPathId(newPath.id);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  const saveTitle = async () => {
    if (!selectedPathId || editingTitle === selectedPath?.title || !editingTitle.trim()) {
      setEditingTitle(selectedPath?.title || "");
      return;
    }
    
    setPaths(prev => prev.map(p => p.id === selectedPathId ? { ...p, title: editingTitle } : p));
    
    try {
      await fetch(`/api/admin/learning-paths/${selectedPathId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editingTitle })
      });
      onSaved();
    } catch (e) {
      console.error(e);
      setPaths(prev => prev.map(p => p.id === selectedPathId ? { ...p, title: selectedPath.title } : p));
      setEditingTitle(selectedPath.title);
    }
  };

  const handleDeletePath = async (id: string) => {
    if (!confirm("Are you sure you want to delete this path?")) return;
    try {
      await fetch(`/api/admin/learning-paths/${id}`, { method: "DELETE" });
      setPaths(prev => prev.filter(p => p.id !== id));
      if (selectedPathId === id) setSelectedPathId(null);
      onSaved();
    } catch (e) {
      console.error(e);
    }
  };

  const fetchItemsForPath = async (pathId: string) => {
    try {
      const res = await fetch(`/api/admin/learning-paths/${pathId}/items`);
      if (res.ok) {
        const items = await res.json();
        setPaths(prev => prev.map(p => p.id === pathId ? { ...p, items } : p));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (selectedPathId && selectedPath && !selectedPath.items) {
      fetchItemsForPath(selectedPathId);
    }
  }, [selectedPathId]);

  const handleToggleLesson = async (lessonId: string) => {
    if (!selectedPathId || !selectedPath) return;
    const existingItem = selectedPath.items?.find((i: any) => i.lessonId === lessonId);
    
    setSaving(true);
    try {
      if (existingItem) {
        await fetch(`/api/admin/learning-paths/${selectedPathId}/items/${existingItem.id}`, { method: "DELETE" });
      } else {
        await fetch(`/api/admin/learning-paths/${selectedPathId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonIds: [lessonId] })
        });
      }
      await fetchItemsForPath(selectedPathId);
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // === DND Logic ===
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedPath || !selectedPath.items) return;

    const oldIndex = selectedPath.items.findIndex((i: any) => i.id === active.id);
    const newIndex = selectedPath.items.findIndex((i: any) => i.id === over.id);

    const reordered = arrayMove(selectedPath.items, oldIndex, newIndex).map((item: any, idx) => ({
      ...item,
      order: idx,
    }));

    setPaths(prev => prev.map(p => p.id === selectedPathId ? { ...p, items: reordered } : p));

    try {
      await fetch(`/api/admin/learning-paths/${selectedPathId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: reordered.map(i => ({ id: i.id, order: i.order })) })
      });
      onSaved();
    } catch (err) {
      console.error(err);
      fetchItemsForPath(selectedPathId!);
    }
  }, [selectedPath, selectedPathId, onSaved]);

  const selectedLessonIds = selectedPath?.items?.map((i: any) => i.lessonId) || [];
  const filteredPaths = paths.filter(p => p.title.toLowerCase().includes(pathSearch.toLowerCase()));

  // === Smart Accordion Logic for Search ===
  useEffect(() => {
    if (lessonSearch && lessonSearch !== lastSearchQuery) {
      const progsToExpand = new Set<string>();
      const modsToExpand = new Set<string>();

      programs.forEach(prog => {
        if (!prog.modules) return;
        const progMatches = prog.name.toLowerCase().includes(lessonSearch);
        
        let hasMatchesInMod = false;
        prog.modules.forEach((m: any) => {
          const modMatches = m.name.toLowerCase().includes(lessonSearch);
          const matchedLessonsLength = (m.lessons || []).filter((l: any) => 
            l.name.toLowerCase().includes(lessonSearch)
          ).length;

          if (modMatches || progMatches || matchedLessonsLength > 0) {
            hasMatchesInMod = true;
            modsToExpand.add(m.id);
          }
        });

        if (progMatches || hasMatchesInMod) {
          progsToExpand.add(prog.id);
        }
      });

      setExpandedPrograms(prev => new Set([...prev, ...progsToExpand]));
      setExpandedModules(prev => new Set([...prev, ...modsToExpand]));
      setLastSearchQuery(lessonSearch);
    }
  }, [lessonSearch, programs, lastSearchQuery]);

  const toggleProgram = (id: string) => {
    setExpandedPrograms(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleModule = (id: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-6xl h-[85vh] flex overflow-hidden animate-fade-in text-slate-900 dark:text-white relative">
        
        {/* Modal interlays */}
        {showCopyModal && (
          <CopyPathModal 
            pathId={showCopyModal} 
            currentCohortId={cohortId} 
            onClose={() => setShowCopyModal(null)}
            onSuccess={() => {}} // Could refresh or just rely on the cohort page 
          />
        )}

        {/* === Left Sidebar: Paths List === */}
        <div className="w-1/3 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="font-bold flex items-center gap-2 mb-3">
              <Route className="h-5 w-5 text-primary" />
              Learning Paths
            </h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={pathSearch}
                onChange={(e) => setPathSearch(e.target.value)}
                placeholder="Search paths..."
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : filteredPaths.length === 0 ? (
              <div className="text-center p-4 text-sm text-slate-500">No paths found</div>
            ) : (
              filteredPaths.map(path => (
                <div
                  key={path.id}
                  onClick={() => setSelectedPathId(path.id)}
                  className={`p-3 flex items-center justify-between rounded-xl cursor-pointer transition-colors ${
                    selectedPathId === path.id 
                      ? "bg-primary text-white shadow-sm" 
                      : "hover:bg-slate-200 dark:hover:bg-slate-700 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <span className="font-semibold text-sm truncate pr-2">{path.title}</span>
                  <div className="flex items-center">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowCopyModal(path.id); }}
                      className={`p-1.5 rounded-lg transition-colors mr-1 ${selectedPathId === path.id ? "hover:bg-white/20" : "text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"}`}
                      title="Duplicate to another cohort"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeletePath(path.id); }}
                      className={`p-1.5 rounded-lg transition-colors ${selectedPathId === path.id ? "hover:bg-white/20" : "text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
              onClick={handleCreatePath}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary-dark transition-all shadow-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Path
            </button>
          </div>
        </div>

        {/* === Right Area: Path Editor === */}
        <div className="w-2/3 flex flex-col bg-white dark:bg-slate-900 relative">
          <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors z-10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
          
          {!selectedPath ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select or create a path
            </div>
          ) : (
            <>
              {/* Header Editor */}
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 pt-10">
                <div className="flex items-center group relative w-full">
                  {/* Left icon */}
                  <div className="flex-shrink-0 text-slate-400 mr-3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                    </svg>
                  </div>
                  
                  {/* Input */}
                  <input 
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        saveTitle();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="text-xl font-bold bg-transparent border-b-2 border-transparent hover:border-slate-200 focus:border-primary focus:bg-slate-50 dark:focus:bg-slate-800 transition-all focus:outline-none w-full placeholder:text-slate-400 py-1 flex-1 min-w-0 pr-10"
                    placeholder="Path Title..."
                  />

                  {/* Save icon (right), shown only when the text changed */}
                  {editingTitle !== selectedPath?.title && (
                    <button 
                      onMouseDown={(e) => { e.preventDefault(); saveTitle(); }}
                      className="absolute right-0 p-1 bg-primary text-white rounded hover:bg-primary-dark transition-colors mr-1 cursor-pointer z-10 flex-shrink-0"
                      title="Save changes"
                    >
                      <Check className="h-5 w-5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-2 ml-8">Click to edit</p>
              </div>

              {/* Main Content Area */}
              <div className="flex-1 overflow-hidden flex">
                
                {/* === Left: Current Lessons in Path === */}
                <div className="w-1/2 flex flex-col border-r border-slate-200 dark:border-slate-700">
                  <div className="p-4 pb-2">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Route className="h-4 w-4" /> Sequence in Path
                    </h3>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800/50">
                    {(!selectedPath.items || selectedPath.items.length === 0) ? (
                      <p className="text-sm text-slate-400 italic text-center py-10 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                        Select lessons from the right to add them here.
                      </p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={selectedPath.items.map((i: any) => i.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {selectedPath.items.map((item: any) => (
                            <SortableSequenceItem 
                              key={item.id} 
                              item={item} 
                              onRemove={handleToggleLesson} 
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                </div>

                {/* === Right: Available Lessons Picker === */}
                <div className="w-1/2 flex flex-col bg-white dark:bg-slate-800/10">
                  <div className="p-4 pb-0">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <BookOpen className="h-4 w-4" /> Available Lessons
                    </h3>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        value={lessonSearch}
                        onChange={(e) => setLessonSearch(e.target.value.toLowerCase())}
                        placeholder="Search courses, modules, lessons..."
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 pt-1 space-y-3">
                    {programs.map(prog => {
                      if (!prog.modules) return null;

                      const progMatches = prog.name.toLowerCase().includes(lessonSearch);
                      
                      const matchedModules = prog.modules.map((m: any) => {
                        const modMatches = m.name.toLowerCase().includes(lessonSearch);
                        const matchedLessons = (m.lessons || []).filter((l: any) => 
                          l.name.toLowerCase().includes(lessonSearch)
                        );
                        
                        return {
                          ...m,
                          matches: modMatches || progMatches || matchedLessons.length > 0,
                          matchedLessons: lessonSearch && !modMatches && !progMatches ? matchedLessons : m.lessons
                        };
                      }).filter((m: any) => m.matches);

                      const hasMatches = progMatches || matchedModules.length > 0;
                      if (lessonSearch && !hasMatches) return null;
                      if (!lessonSearch && prog.modules.length === 0) return null;

                      // Active state is driven purely from set state (which gets smart-populated on search edit)
                      const isProgExpanded = expandedPrograms.has(prog.id);

                      return (
                        <div key={prog.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                          {/* Program Header */}
                          <div 
                            className="bg-slate-50 dark:bg-slate-800 p-2.5 flex items-center gap-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                            onClick={() => toggleProgram(prog.id)}
                          >
                            {isProgExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{prog.name}</h4>
                          </div>

                          {/* Program Content (Modules) */}
                          {isProgExpanded && (
                            <div className="p-2 space-y-1 border-t border-slate-200 dark:border-slate-700">
                              {matchedModules.map((mod: any) => {
                                const isModExpanded = expandedModules.has(mod.id);
                                const lessonsToRender = lessonSearch ? mod.matchedLessons : mod.lessons;

                                return (
                                <div key={mod.id} className="border border-slate-100 dark:border-slate-700/50 rounded-lg overflow-hidden">
                                  {/* Module Header */}
                                  <div 
                                    className="bg-white dark:bg-slate-900 p-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                    onClick={() => toggleModule(mod.id)}
                                  >
                                    {isModExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-300" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                                    <p className="text-[11px] uppercase font-bold text-slate-500 truncate">{mod.name}</p>
                                  </div>

                                  {/* Module Content (Lessons) */}
                                  {isModExpanded && (
                                    <div className="p-1.5 space-y-1 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/30 dark:bg-slate-900/50">
                                      {lessonsToRender?.map((lesson: any) => {
                                        const isSelected = selectedLessonIds.includes(lesson.id);
                                        return (
                                          <button
                                            key={lesson.id}
                                            onClick={() => handleToggleLesson(lesson.id)}
                                            disabled={saving}
                                            className={`w-full text-left px-3 py-2 rounded-md border text-xs flex items-center justify-between transition-all group ${
                                              isSelected 
                                                ? "border-primary bg-primary/10 text-primary font-medium" 
                                                : "border-transparent text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-white dark:hover:bg-slate-800"
                                            }`}
                                          >
                                            <span className="truncate pr-2 flex-1">{lesson.name}</span>
                                            {isSelected 
                                              ? <Check className="h-3.5 w-3.5 shrink-0" /> 
                                              : <Plus className="h-3.5 w-3.5 text-slate-400 shrink-0 opacity-0 group-hover:opacity-100" />
                                            }
                                          </button>
                                        );
                                      })}
                                      {lessonsToRender?.length === 0 && (
                                        <div className="text-center text-[10px] text-slate-400 italic py-1">No matches in module</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}