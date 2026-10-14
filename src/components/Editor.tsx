"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Youtube from '@tiptap/extension-youtube';
import { VideoNode } from './VideoNode';
import { PresentationNode } from './PresentationNode';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Quote, Heading1, Heading2,
  AlignLeft, AlignCenter, AlignRight, Image as ImageIcon, Link as LinkIcon, Undo, Redo,
  Code, Terminal, HelpCircle, UploadCloud, Loader2, Youtube as YoutubeIcon, FolderOpen
} from 'lucide-react';
import { useRef, useState } from 'react';
import MediaPicker from './MediaPicker';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

const MenuButton = ({ 
  onClick, 
  isActive = false, 
  disabled = false, 
  children,
  title
}: { 
  onClick: () => void; 
  isActive?: boolean; 
  disabled?: boolean; 
  children: React.ReactNode;
  title?: string; 
}) => (
  <button
    type="button"
    onClick={(e) => {
      e.preventDefault();
      onClick();
    }}
    disabled={disabled}
    className={`p-2 rounded-lg transition-colors ${
      isActive 
        ? 'bg-primary/20 text-primary' 
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
    } disabled:opacity-50`}
  >
    {children}
  </button>
);

export default function Editor({ content, onChange, placeholder = 'Start writing your lesson content...' }: EditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary hover:underline cursor-pointer',
        },
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
           class: 'my-6 rounded-2xl border border-slate-200 dark:border-slate-800'
        }
      }),
      VideoNode,
      PresentationNode,
      Youtube.configure({
        width: 480,
        height: 320,
        HTMLAttributes: {
          class: 'my-6 rounded-2xl overflow-hidden'
        }
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-slate dark:prose-invert max-w-none focus:outline-none min-h-[400px] p-6',
      },
    },
  });

  if (!editor) {
    return null;
  }

  const handlePick = (item: any) => {
    const isPresentation = item.type === 'presentation' || 
                           item.url.toLowerCase().endsWith('.pdf') || 
                           item.url.toLowerCase().endsWith('.pptx');

    if (item.type === 'image') {
      editor.chain().focus().setImage({ src: item.url }).run();
    } else if (item.type === 'video') {
      (editor.commands as any).setVideo({ src: item.url });
    } else if (isPresentation) {
      (editor.commands as any).setPresentation({ src: item.url });
    } else {
      editor.chain().focus().setLink({ href: item.url }).insertContent(item.name).run();
    }
    setShowPicker(false);
  };

  const addYoutubeVideo = () => {
    const url = window.prompt('Enter YouTube URL');
    if (url) {
      editor.commands.setYoutubeVideo({
        src: url,
        width: 640,
        height: 480,
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        if (file.type.startsWith("image/")) {
          editor.chain().focus().setImage({ src: data.url }).run();
        } else if (file.type.startsWith("video/")) {
           (editor.commands as any).setVideo({ src: data.url });
        } else if (file.type === "application/pdf" || file.name.endsWith(".pptx") || file.name.endsWith(".pdf")) {
           (editor.commands as any).setPresentation({ src: data.url });
        } else {
          editor.chain().focus().setLink({ href: data.url }).insertContent(file.name).run();
        }
      }
    } catch (err) {
      console.error(err);
      alert("File upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addImage = () => {
    const url = window.prompt('Enter image URL');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="w-full border border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900 overflow-hidden shadow-xl ring-1 ring-slate-200/50 dark:ring-slate-800/10 h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 flex-shrink-0">
        <MenuButton 
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="h-4 w-4" />
        </MenuButton>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-800 mx-1 self-center" />

        <MenuButton 
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          <Heading1 className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="h-4 w-4" />
        </MenuButton>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-800 mx-1 self-center" />

        <MenuButton 
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Ordered List"
        >
          <ListOrdered className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Blockquote"
        >
          <Quote className="h-4 w-4" />
        </MenuButton>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-800 mx-1 self-center" />

        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          title="Align Left"
        >
          <AlignLeft className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          title="Align Center"
        >
          <AlignCenter className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          title="Align Right"
        >
          <AlignRight className="h-4 w-4" />
        </MenuButton>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-800 mx-1 self-center" />

        <MenuButton 
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
          title="Inline Code"
        >
          <Code className="h-4 w-4" />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive('codeBlock')}
          title="Code Block"
        >
          <Terminal className="h-4 w-4" />
        </MenuButton>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-800 mx-1 self-center" />
        
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          onChange={handleFileUpload}
          accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
        />
        <MenuButton onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Upload File">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        </MenuButton>

        <MenuButton onClick={() => setShowPicker(true)} title="Browse Library">
          <FolderOpen className="h-4 w-4" />
        </MenuButton>

        <MenuButton onClick={setLink} isActive={editor.isActive('link')} title="Add Link">
          <LinkIcon className="h-4 w-4" />
        </MenuButton>
        <MenuButton onClick={addImage} title="Add Image by URL">
          <ImageIcon className="h-4 w-4" />
        </MenuButton>
        <MenuButton onClick={addYoutubeVideo} title="Add YouTube Video">
          <YoutubeIcon className="h-4 w-4" />
        </MenuButton>

        <div className="flex-1" />

        <MenuButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
          <Undo className="h-4 w-4" />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
          <Redo className="h-4 w-4" />
        </MenuButton>
      </div>
      <div className="flex-1 overflow-auto bg-white dark:bg-slate-950 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
        <EditorContent editor={editor} />
      </div>

      {showPicker && (
        <MediaPicker onSelect={handlePick} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}
