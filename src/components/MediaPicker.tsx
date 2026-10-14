"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, File, Video, FileText, Image as ImageIcon, Presentation, FolderPlus,
  Search, ChevronRight, Home, Loader2, X, Plus, Check, Upload
} from 'lucide-react';
import { getMediaRegistry, getFolderAncestors, createFolder } from '../app/(dashboard)/media/actions';

interface MediaPickerProps {
  onSelect: (item: any) => void;
  onClose: () => void;
}

export default function MediaPicker({ onSelect, onClose }: MediaPickerProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [media, setMedia] = useState<any[]>([]);
  const [path, setPath] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    if (currentFolderId) {
      formData.append("folderId", currentFolderId);
    }

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        fetchRegistry();
      }
    } catch (err) {
      alert("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

  const filteredFolders = folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));
  const filteredMedia = media.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Media Library</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Select an asset to insert</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-4 items-center justify-between bg-white dark:bg-slate-900">
          <div className="flex items-center gap-1 overflow-hidden flex-1">
            <button 
              onClick={() => setCurrentFolderId(null)}
              className={`p-1.5 rounded-lg transition-all ${!currentFolderId ? 'text-primary' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Home className="h-4 w-4" />
            </button>
            
            <div className="flex items-center overflow-x-auto no-scrollbar py-1">
              {path.map((item, idx) => (
                <React.Fragment key={item.id}>
                  <ChevronRight className="h-3 w-3 flex-shrink-0 text-slate-300 mx-1" />
                  <button 
                    onClick={() => setCurrentFolderId(item.id)}
                    className={`text-xs font-bold whitespace-nowrap px-2 py-1 rounded-lg transition-all ${idx === path.length - 1 ? 'text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800' : 'text-slate-500 hover:text-primary'}`}
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
                placeholder="Search library..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-4 py-1.5 bg-slate-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 transition-all w-48"
              />
            </div>

            <button 
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/30 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New Folder
            </button>

            <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} />
            <button 
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-primary/25 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[300px] relative">
          {/* Folder Dialog */}
          {showNewFolder && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
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

          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p className="font-bold text-xs uppercase tracking-widest">Loading assets...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Folders */}
              {filteredFolders.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {filteredFolders.map(folder => (
                    <div 
                      key={folder.id}
                      onClick={() => setCurrentFolderId(folder.id)}
                      className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-primary/50 transition-all cursor-pointer group shadow-sm"
                    >
                      <Folder className="h-5 w-5 text-amber-400 fill-amber-400/20 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{folder.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Media */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredMedia.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => onSelect(item)}
                    className="group flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-primary transition-all cursor-pointer shadow-sm hover:shadow-lg overflow-hidden"
                  >
                    <div className="aspect-video bg-slate-50 dark:bg-slate-900 flex items-center justify-center border-b border-slate-100 dark:border-slate-700 relative overflow-hidden">
                      {item.type === 'image' ? (
                        <img src={item.url} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                      ) : item.type === 'video' ? (
                        <Video className="h-8 w-8 text-primary opacity-30" />
                      ) : item.type === 'presentation' ? (
                        <Presentation className="h-8 w-8 text-amber-500 opacity-40" />
                      ) : (
                        <FileText className="h-8 w-8 text-slate-300" />
                      )}
                      <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-all flex items-center justify-center">
                         <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white scale-0 group-hover:scale-100 transition-all opacity-0 group-hover:opacity-100">
                            <Check className="h-4 w-4" />
                         </div>
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate" title={item.name}>{item.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{item.type}</p>
                    </div>
                  </div>
                ))}
              </div>

              {filteredFolders.length === 0 && filteredMedia.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <p className="text-sm font-bold uppercase tracking-widest">No matching assets found</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
