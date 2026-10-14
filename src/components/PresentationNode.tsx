import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import PresentationPlayer from './PresentationPlayer';

export interface PresentationOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    presentation: {
      setPresentation: (options: { src: string }) => ReturnType;
    };
  }
}

export const PresentationNode = Node.create<PresentationOptions>({
  name: 'presentation',

  group: 'block',

  selectable: true,

  draggable: true,

  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="presentation-container"]',
        getAttrs: (element) => {
          if (typeof element === 'string') return {};
          return {
            src: (element as HTMLElement).getAttribute('data-src'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const isPdf = HTMLAttributes.src?.toLowerCase().endsWith('.pdf');
    const viewerUrl = isPdf 
      ? HTMLAttributes.src 
      : `https://docs.google.com/viewer?url=${encodeURIComponent(HTMLAttributes.src)}&embedded=true`;

    return [
      'div',
      mergeAttributes({ 'data-type': 'presentation-container', 'data-src': HTMLAttributes.src }, HTMLAttributes),
      ['iframe', { 
        src: viewerUrl, 
        class: 'w-full aspect-[16/10] rounded-2xl border border-slate-200 shadow-lg',
        style: 'min-height: 500px;'
      }],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node }) => {
      return (
        <NodeViewWrapper className="my-8">
           <PresentationPlayer url={node.attrs.src} />
        </NodeViewWrapper>
      );
    });
  },

  addCommands() {
    return {
      setPresentation:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});
