"use client";

import { useState, useRef, useEffect } from "react";
import {
  Save, Loader2, UploadCloud, Link as LinkIcon, Eye, Edit, RefreshCw,
  Type, AlignLeft, Clock, Tag, Headphones, ScrollText,
  ChevronDown, ChevronUp, RotateCcw, AlertCircle, FileText, Video,
} from "lucide-react";
import Editor from "@/components/Editor";
import VideoPlayer from "@/components/VideoPlayer";
import GoogleDrivePicker from "@/components/GoogleDrivePicker";
import { updateLesson, regenerateLessonQuiz } from "../../actions";
import { useRouter } from "next/navigation";
import { getProxyUrl, keyToGcsUrl, gcsUrlToKey } from "@/lib/mediaUtils";

// ─── CollapsibleSection (mirrors LessonViewer) ───────────────────────────────

function CollapsibleSection({
  icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
      >
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
          {title}
        </span>
        <span className="text-slate-400 group-hover:text-primary transition-colors">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      <div className={open ? "px-5 pb-5" : "hidden"}>{children}</div>
    </div>
  );
}

// ─── AudioPlayer (mirrors LessonViewer) ──────────────────────────────────────

function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playing ? audio.pause() : audio.play();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = Number(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const skip = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), duration);
  };

  const formatTime = (s: number) => {
    if (!isFinite(s) || s === 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <audio
        ref={audioRef}
        src={getProxyUrl(url)}
        preload="auto"
        onCanPlay={() => setLoading(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
      />
      <div className="space-y-1">
        <div className="relative h-2">
          <div className="absolute inset-0 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all pointer-events-none"
            style={{ width: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => skip(-10)}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-primary transition-colors"
        >
          <RotateCcw className="h-5 w-5" />
          <span className="text-[10px] font-bold">10s</span>
        </button>
        <button
          onClick={togglePlay}
          disabled={loading}
          className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 ml-0.5">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => skip(10)}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-primary transition-colors"
        >
          <RotateCcw className="h-5 w-5 -scale-x-100" />
          <span className="text-[10px] font-bold">10s</span>
        </button>
        <button
          onClick={cyclePlaybackRate}
          className="text-xs font-black text-slate-400 hover:text-primary transition-colors bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-lg min-w-[3rem] text-center"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}

// ─── TextVersion (mirrors LessonViewer) ──────────────────────────────────────

function TextVersion({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(getProxyUrl(url))
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      })
      .then((t) => setText(t))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading transcript…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm py-4">
        <AlertCircle className="h-4 w-4" />
        Failed to load transcript.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

// ─── UrlField: plain input with a link icon ──────────────────────────────────

function UrlField({
  label,
  icon,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
        {icon}
        {label}
      </label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <LinkIcon className="h-4 w-4" />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white"
        />
      </div>
    </div>
  );
}

// ─── ContentEditor ────────────────────────────────────────────────────────────

export default function ContentEditor({ lesson }: { lesson: any }) {
  const [text, setText] = useState(lesson.text || "");
  const [videoUrl, setVideoUrl] = useState(keyToGcsUrl(lesson.videoUrl || ""));
  const [audioUrl, setAudioUrl] = useState(keyToGcsUrl(lesson.audioUrl || ""));
  const [captionsUrl, setCaptionsUrl] = useState(keyToGcsUrl(lesson.captionsUrl || ""));
  const [dataUrl, setDataUrl] = useState(keyToGcsUrl(lesson.dataUrl || ""));
  const [name, setName] = useState(lesson.name || "");
  const [intro, setIntro] = useState(lesson.intro || "");
  const [timecodes, setTimecodes] = useState(lesson.timecodes || "");
  const [tags, setTags] = useState(lesson.tags || "");
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleRegenerateQuiz = async () => {
    if (!dataUrl) return;
    setRegenerating(true);
    try {
      console.log(`[ContentEditor] Regenerating quiz for lesson ${lesson.id} using dataUrl: ${dataUrl}`);
      const result = await regenerateLessonQuiz(lesson.id, dataUrl);
      alert(`Quiz regenerated successfully! ${result.questionsCount} question(s) created.`);
      router.refresh();
    } catch (err) {
      console.error("[ContentEditor] Regenerating quiz failed:", err);
      alert(err instanceof Error ? err.message : "Failed to regenerate quiz");
    } finally {
      setRegenerating(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setVideoUploading(true);
    console.log(`[ContentEditor] Uploading video file: ${file.name}...`);
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      
      if (data.url) {
        console.log(`[ContentEditor] Upload success, setting video URL from key: ${data.url}`);
        setVideoUrl(keyToGcsUrl(data.url));
      }
    } catch (err) {
      console.error("[ContentEditor] Video upload failed:", err);
      alert("Video upload failed");
    } finally {
      setVideoUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Convert display GCS URLs back to object keys for DB storage
      const updateData: Record<string, unknown> = {
        text,
        videoUrl: gcsUrlToKey(videoUrl),
        audioUrl: gcsUrlToKey(audioUrl),
        captionsUrl: gcsUrlToKey(captionsUrl),
        dataUrl: gcsUrlToKey(dataUrl),
      };
      if (lesson.type === "video") {
        updateData.name = name;
        updateData.intro = intro;
        updateData.timecodes = timecodes;
        updateData.tags = tags;
      }
      await updateLesson(lesson.id, updateData);
      router.refresh();
      alert("Lesson content saved successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to save lesson content");
    } finally {
      setSaving(false);
    }
  };

  const parsedTags = tags
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  const hasAudio = !!audioUrl;
  const hasCaptions = !!captionsUrl;
  const hasSupplementary = hasAudio || hasCaptions;

  return (
    <div className="space-y-6">
      {/* ── Header with the mode toggle ── */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          {previewMode ? <Eye className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
          {previewMode ? "Preview Mode" : "Editor Mode"}
        </h3>
        <button
          onClick={() => setPreviewMode(!previewMode)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all hover:shadow-sm bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary hover:border-primary/30"
        >
          {previewMode ? <Edit className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {previewMode ? "Switch to Editor" : "Switch to Preview"}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          PREVIEW MODE: mirrors the real LessonViewer UI
      ══════════════════════════════════════════════════════════════════════ */}
      {previewMode ? (
        <div className="space-y-6 animate-fade-in -mx-1">

          {/* Video */}
          {lesson.type === "video" && videoUrl && (
            <div className="bg-black sm:rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
            <VideoPlayer url={gcsUrlToKey(videoUrl)} poster={lesson.posterUrl ?? undefined} />
            </div>
          )}

          {/* Intro */}
          {intro && (
            <div className="bg-white dark:bg-slate-900 sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6">
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-sm sm:text-base">
                {intro}
              </p>
            </div>
          )}

          {/* Supplementary (Audio + Captions) */}
          {hasSupplementary && (
            <div className="bg-white dark:bg-slate-900 sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              {hasAudio && (
                <CollapsibleSection
                  icon={<Headphones className="h-4 w-4" />}
                  title="Audio Version"
                  defaultOpen
                >
                  <AudioPlayer url={gcsUrlToKey(audioUrl)} />
                </CollapsibleSection>
              )}
              {hasCaptions && (
                <CollapsibleSection
                  icon={<ScrollText className="h-4 w-4" />}
                  title="Text Version"
                  defaultOpen
                >
                  <TextVersion url={gcsUrlToKey(captionsUrl)} />
                </CollapsibleSection>
              )}
            </div>
          )}

          {/* Main content card */}
          <div className="bg-white dark:bg-slate-900 sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-8 space-y-6">
            {/* Title */}
            <div className="flex items-start gap-3 sm:gap-4">
              <div
                className={`shrink-0 w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center ${
                  lesson.type === "video"
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {lesson.type === "video" ? (
                  <Video className="h-5 w-5 sm:h-7 sm:w-7" />
                ) : (
                  <FileText className="h-5 w-5 sm:h-7 sm:w-7" />
                )}
              </div>
              <div>
                <h1 className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight leading-tight">
                  {name || lesson.name || "Untitled Lesson"}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 text-xs font-bold text-slate-400 uppercase tracking-widest">
                  <span>Study Material</span>
                </div>
              </div>
            </div>

            {/* Prose */}
            <div
              className="prose prose-base sm:prose-lg prose-slate dark:prose-invert max-w-none pt-2
                prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter
                prose-p:leading-loose prose-p:text-slate-600 dark:prose-p:text-slate-400
                prose-strong:text-slate-900 dark:prose-strong:text-white
                prose-a:text-primary hover:prose-a:text-primary-dark
                prose-li:text-slate-600 dark:prose-li:text-slate-400
                prose-code:text-sm prose-code:px-1 prose-code:py-0.5 prose-code:rounded"
              dangerouslySetInnerHTML={{
                __html:
                  text ||
                  '<p class="text-slate-400 italic">This lesson has no written content yet.</p>',
              }}
            />
          </div>

          {/* Tags */}
          {parsedTags.length > 0 && (
            <div className="bg-white dark:bg-slate-900 sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-slate-400" />
                <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  Tags
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {parsedTags.map((tag: string, i: number) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20"
                  >
                    <Tag className="h-3 w-3" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

      ) : (
        /* ══════════════════════════════════════════════════════════════════════
            EDITOR MODE
        ══════════════════════════════════════════════════════════════════════ */
        <>
          {lesson.type === "video" && (
            <div className="space-y-4">
              {/* Lesson Title */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Type className="h-4 w-4 text-slate-400" />
                  Lesson Title
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter lesson title..."
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white text-lg font-semibold"
                />
              </div>

              {/* Brief Introduction */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <AlignLeft className="h-4 w-4 text-slate-400" />
                  Brief Introduction
                </label>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  placeholder="Short description or introduction for this lesson..."
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white resize-y"
                />
              </div>

              {/* Lesson Video */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Lesson Video
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <LinkIcon className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                                            placeholder="https://storage.googleapis.com/bucket/..."
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white"
                    />
                  </div>
                  <input
                    type="file"
                    ref={videoInputRef}
                    className="hidden"
                    onChange={handleVideoUpload}
                    accept="video/*"
                  />
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={videoUploading}
                    className="flex items-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold transition-all disabled:opacity-50"
                  >
                    {videoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    {videoUploading ? "Uploading..." : "Upload Video"}
                  </button>
                  <GoogleDrivePicker onImport={(url) => setVideoUrl(url)} disabled={videoUploading} />
                </div>
              </div>

              {/* Mini Video Preview */}
              {videoUrl && (
                <div className="max-w-md">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-widest">Video Preview</p>
                  <VideoPlayer url={gcsUrlToKey(videoUrl)} poster={lesson.posterUrl ?? undefined} />
                </div>
              )}

              {/* Audio URL */}
              <UrlField
                label="Audio Version URL"
                icon={<Headphones className="h-4 w-4 text-slate-400" />}
                value={audioUrl}
                onChange={setAudioUrl}
                placeholder="https://storage.googleapis.com/bucket/courses/..."
              />

              {/* Captions / Text Version URL */}
              <UrlField
                label="Text Version URL (Captions)"
                icon={<ScrollText className="h-4 w-4 text-slate-400" />}
                value={captionsUrl}
                onChange={setCaptionsUrl}
                placeholder="https://storage.googleapis.com/bucket/courses/..."
              />

              {/* Data URL + Regenerate Quiz */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-slate-400" />
                  Data / Attachment URL
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <LinkIcon className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      value={dataUrl}
                      onChange={(e) => setDataUrl(e.target.value)}
                      placeholder="https://storage.googleapis.com/bucket/courses/..."
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="relative group">
                    <button
                      type="button"
                      onClick={handleRegenerateQuiz}
                      disabled={!dataUrl || regenerating}
                      className="flex items-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-300 dark:hover:border-amber-700 text-slate-700 dark:text-slate-300 border border-transparent rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {regenerating
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <RefreshCw className="h-4 w-4" />
                      }
                      <span className="hidden sm:inline">
                        {regenerating ? "Regenerating..." : "Refresh Data"}
                      </span>
                    </button>
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-56 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                      <div className="bg-slate-900 dark:bg-slate-700 text-white text-xs rounded-lg px-3 py-2 shadow-xl leading-relaxed">
                        Regenerates quizzes for this lesson by re-reading the data file at the URL above.
                        <div className="absolute top-full right-4 border-4 border-transparent border-t-slate-900 dark:border-t-slate-700" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timecodes */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-400" />
                  Timecodes
                </label>
                <textarea
                  value={timecodes}
                  onChange={(e) => setTimecodes(e.target.value)}
                  placeholder={"00:00 Introduction\n01:30 Main Topic\n05:00 Summary"}
                  rows={5}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white font-mono text-sm resize-y"
                />
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Tag className="h-4 w-4 text-slate-400" />
                  Tags
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. AI, Machine Learning, Intro"
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-900 dark:text-white"
                />
                {parsedTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {parsedTags.map((tag: string, i: number) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20"
                      >
                        <Tag className="h-3 w-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Study Materials */}
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Study Materials & Content
            </label>
            <Editor
              content={text}
              onChange={setText}
              placeholder="Detailed explanation, instructions, or transcript..."
            />
          </div>
        </>
      )}

      {/* Save Button */}
      {!previewMode && (
        <div className="flex justify-end pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving Changes..." : "Save Lesson Content"}
          </button>
        </div>
      )}
    </div>
  );
}
