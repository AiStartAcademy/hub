"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder, FolderPlus, File, Video, FileText, Image as ImageIcon,
  MoreVertical, Trash2, Edit2, Search, Upload, ChevronRight, Home,
  ChevronLeft, Loader2, X, Plus, ExternalLink, Globe, HardDrive, Presentation, Download
} from 'lucide-react';
import { getMediaRegistry, createFolder, deleteMedia, deleteFolder, renameFolder, getFolderAncestors, toggleDownloadable, updateMediaDescription } from '../actions';
import { useRouter } from 'next/navigation';

export default function MediaManager() {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [media, setMedia] = useState<any[]>([]);
  const [path, setPath] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
    current: string;
  } | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [editingDescValue, setEditingDescValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const fetchRegistry = useCallback(async () => {
    setLoading(true);
    try {
      const { folders, media } = await getMediaRegistry(currentFolderId);
      setFolders(folders);
      setMedia(media);
      
      if (currentFolderId) {
        const ancestors = await getFolderAncestors(currentFolderId);
        setPath(ancestors);
      } else {
        setPath([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentFolderId]);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName, currentFolderId);
      setNewFolderName("");
      setShowNewFolder(false);
      fetchRegistry();
    } catch (err) {
      alert("Failed to create folder");
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    const failed: string[] = [];

    // Upload one at a time so a huge batch doesn't blow the request size limit
    // and the user gets per-file progress.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({ done: i, total: files.length, current: file.name });

      const formData = new FormData();
      formData.append("file", file);
      if (currentFolderId) {
        formData.append("folderId", currentFolderId);
      }

      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        const result = data.files?.[0] ?? data;
        if (!result.url) {
          failed.push(`${file.name}: ${result.error || data.error || "upload failed"}`);
        }
      } catch (err) {
        failed.push(`${file.name}: network error`);
      }
    }

    fetchRegistry();
    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (failed.length > 0) {
      alert(`${failed.length} of ${files.length} uploads failed:\n${failed.join("\n")}`);
    }
  };

  const handleDeleteMedia = async (id: string) => {
    if (!confirm("Are you sure you want to delete this file?")) return;
    try {
      await deleteMedia(id);
      fetchRegistry();
    } catch (err) {
      alert("Delete failed");
    }
  };

  const handleToggleDownloadable = async (id: string) => {
    try {
      await toggleDownloadable(id);
      fetchRegistry();
    } catch (err) {
      alert("Failed to update");
    }
  };

  const handleSaveDescription = async (id: string) => {
    try {
      await updateMediaDescription(id, editingDescValue);
      setEditingDescId(null);
      fetchRegistry();
    } catch (err) {
      alert("Failed to save description");
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Are you sure you want to delete this folder and its contents?")) return;
    try {
      await deleteFolder(id);
      fetchRegistry();
    } catch (err) {
      alert("Delete failed");
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredFolders = folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
  const filteredMedia = media.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Media Toolbar */}
      <div className="bg-white dark:bg-slate-900 px-8 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-4 items-center justify-between transition-colors">
        <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-[300px]">
          <button 
            onClick={() => setCurrentFolderId(null)}
            className={`p-2 rounded-lg transition-all ${!currentFolderId ? 'bg-primary/20 text-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400'}`}
          >
            <Home className="h-4 w-4" />
          </button>
          
          <div className="flex items-center overflow-x-auto no-scrollbar py-1">
            {path.map((item, idx) => (
              <React.Fragment key={item.id}>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 mx-1" />
                <button 
                  onClick={() => setCurrentFolderId(item.id)}
                  className={`text-sm font-bold whitespace-nowrap px-2 py-1 rounded-lg transition-all ${idx === path.length - 1 ? 'text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800' : 'text-slate-500 hover:text-primary'}`}
                >
                  {item.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 transition-all w-48 lg:w-64"
            />
          </div>

          <button 
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/30 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-bold transition-all shadow-sm"
          >
            <FolderPlus className="h-4 w-4" />
            New Folder
          </button>

          <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} multiple />
          <button 
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-primary/25 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading
              ? uploadProgress && uploadProgress.total > 1
                ? `Uploading ${uploadProgress.done + 1}/${uploadProgress.total}…`
                : "Uploading..."
              : "Upload Files"}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950 transition-colors">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="h-10 w-10 animate-spin mb-4" />
            <p className="font-bold text-sm uppercase tracking-widest">Syincing library...</p>
          </div>
        ) : (
          <div className="space-y-10 max-w-[1400px] mx-auto animate-fade-in">
            
            {/* Folder Dialog */}
            {showNewFolder && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-100 dark:border-slate-800">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Create New Folder</h3>
                  <form onSubmit={handleCreateFolder} className="space-y-4">
                    <input 
                      autoFocus
                      type="text"
                      placeholder="Enter folder name..."
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary/20 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                    />
                    <div className="flex justify-end gap-3">
                      <button type="button" onClick={() => setShowNewFolder(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Cancel</button>
                      <button type="submit" className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-primary/20">Create Folder</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Folders Section */}
            {(filteredFolders.length > 0) && (
              <section>
                <div className="flex items-center gap-2 mb-4 px-1">
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Folders</h2>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {filteredFolders.map(folder => (
                    <div 
                      key={folder.id}
                      onDoubleClick={() => setCurrentFolderId(folder.id)}
                      className="group relative bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 hover:border-primary/50 dark:hover:border-primary/50 transition-all cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-1 overflow-hidden"
                    >
                      <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-center justify-center mb-3">
                          <Folder className="h-6 w-6 text-amber-500 fill-amber-500/20" />
                        </div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 line-clamp-1">{folder.name}</p>
                      </div>
                      <button 
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Files Section */}
            <section>
              <div className="flex items-center gap-2 mb-4 px-1">
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Assets</h2>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              </div>
              
              {filteredMedia.length === 0 && filteredFolders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <HardDrive className="h-16 w-16 mb-4 opacity-10" />
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">This directory is empty</p>
                  <p className="text-xs mt-1">Upload files or create subfolders to get started</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {filteredMedia.map(item => (
                    <div 
                      key={item.id}
                      className="group relative bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 hover:border-primary/50 dark:hover:border-primary/50 transition-all shadow-sm hover:shadow-xl hover:-translate-y-2 flex flex-col overflow-hidden"
                    >
                      {/* Preview Area */}
                      <div className="aspect-square bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center overflow-hidden border-b border-slate-100 dark:border-slate-800">
                        {item.type === 'image' ? (
                          <img src={item.url} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                        ) : item.type === 'video' ? (
                          <div className="relative w-full h-full flex items-center justify-center">
                            <Video className="h-10 w-10 text-primary opacity-20" />
                            <div className="absolute inset-0 flex items-center justify-center">
                               <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center text-primary group-hover:scale-125 transition-transform">
                                  <Video className="h-5 w-5 fill-primary" />
                               </div>
                            </div>
                          </div>
                        ) : item.type === 'presentation' ? (
                          <div className="relative w-full h-full flex items-center justify-center">
                             <Presentation className="h-10 w-10 text-amber-500 opacity-20" />
                             <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-500 group-hover:scale-125 transition-transform">
                                   <Presentation className="h-5 w-5 fill-amber-500" />
                                </div>
                             </div>
                          </div>
                        ) : (
                          <FileText className="h-10 w-10 text-slate-300" />
                        )}
                      </div>

                      {/* Info Area */}
                      <div className="p-4 flex-1">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1 mr-2">
                             <p className="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-primary transition-colors" title={item.name}>
                               {item.name}
                             </p>
                             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">{formatSize(item.size)} • {item.type}</p>
                          </div>

                          <div className="flex items-center gap-1">
                             <button
                              onClick={() => handleToggleDownloadable(item.id)}
                              title={item.downloadable ? "Disable download" : "Allow download"}
                              className={`p-1.5 rounded-lg transition-all ${item.downloadable ? 'text-green-500 bg-green-50 dark:bg-green-900/20' : 'text-slate-300 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'}`}
                             >
                               <Download className="h-3.5 w-3.5" />
                             </button>
                             <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-slate-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                             >
                               <ExternalLink className="h-3.5 w-3.5" />
                             </a>
                             <button
                              onClick={() => handleDeleteMedia(item.id)}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                             >
                               <Trash2 className="h-3.5 w-3.5" />
                             </button>
                          </div>
                        </div>

                        {/* Description (for downloadable files) */}
                        {item.downloadable && (
                          <div className="mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                            {editingDescId === item.id ? (
                              <div className="space-y-2">
                                <textarea
                                  autoFocus
                                  value={editingDescValue}
                                  onChange={(e) => setEditingDescValue(e.target.value)}
                                  placeholder="File description..."
                                  rows={2}
                                  className="w-full px-2 py-1.5 text-xs border rounded-lg focus:ring-2 focus:ring-primary/20 dark:bg-slate-800 dark:border-slate-700 dark:text-white resize-none"
                                />
                                <div className="flex justify-end gap-2">
                                  <button onClick={() => setEditingDescId(null)} className="px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-600">Cancel</button>
                                  <button onClick={() => handleSaveDescription(item.id)} className="px-2 py-1 text-[10px] font-bold text-white bg-primary rounded-lg">Save</button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditingDescId(item.id); setEditingDescValue(item.description || ""); }}
                                className="w-full text-left"
                              >
                                {item.description ? (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 hover:text-primary transition-colors">{item.description}</p>
                                ) : (
                                  <p className="text-[11px] text-slate-300 dark:text-slate-600 italic hover:text-primary transition-colors">Add description...</p>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
