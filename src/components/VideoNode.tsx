import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import VideoPlayer from './VideoPlayer';

export interface VideoOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    video: {
      setVideo: (options: { src: string }) => ReturnType;
    };
  }
}

export const VideoNode = Node.create<VideoOptions>({
  name: 'video',

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
        tag: 'div[data-type="video-container"]',
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
    return [
      'div',
      mergeAttributes({ 'data-type': 'video-container', 'data-src': HTMLAttributes.src }, HTMLAttributes),
      ['video', { src: HTMLAttributes.src, controls: true, class: 'w-full rounded-2xl' }],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node }) => {
      return (
        <NodeViewWrapper className="my-8">
           <VideoPlayer url={node.attrs.src} />
        </NodeViewWrapper>
      );
    });
  },

  addCommands() {
    return {
      setVideo:
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
