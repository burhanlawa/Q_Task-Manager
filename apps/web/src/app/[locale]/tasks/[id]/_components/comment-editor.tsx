'use client';

import Mention from '@tiptap/extension-mention';
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { api } from '@/lib/api';

// Public ref API so the parent can clear the editor after submit and read
// the current HTML + extracted mention IDs.
export type CommentEditorHandle = {
  clear: () => void;
  getHTML: () => string;
  /// Replace the editor's content. Used by the inline-edit flow to seed
  /// an existing comment's body into a fresh editor instance.
  setHTML: (html: string) => void;
  getMentionIds: () => string[];
  isEmpty: () => boolean;
};

type SuggestionUser = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

function userLabel(u: SuggestionUser): string {
  return u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ?? u.email;
}

// React renderer for the suggestion popover. Lives outside the React tree
// (mounted into document.body via Tippy) so it survives even when the
// editor re-renders for other reasons. The handlers expose a keyboard
// API the suggestion extension wires up.
type SuggestionListProps = {
  items: SuggestionUser[];
  command: (item: { id: string; label: string }) => void;
};
type SuggestionListHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(
  function SuggestionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    function select(idx: number) {
      const item = items[idx];
      if (!item) return;
      command({ id: item.id, label: userLabel(item) });
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          select(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          No matches
        </div>
      );
    }
    return (
      <div className="max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
        {items.map((u, idx) => (
          <button
            key={u.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              select(idx);
            }}
            className={`block w-full px-3 py-2 text-start text-sm ${
              idx === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            }`}
          >
            <div className="font-medium">{userLabel(u)}</div>
            <div className="text-xs text-muted-foreground">{u.email}</div>
          </button>
        ))}
      </div>
    );
  },
);

export const CommentEditor = forwardRef<
  CommentEditorHandle,
  {
    // Constrain the suggestion list. We bias to the task's department +
    // assignees per the spec; an extra `?q=` substring narrows on each key.
    departmentId?: string;
    assigneeIds?: string[];
    placeholder?: string;
    onUpdate?: () => void;
  }
>(function CommentEditor({ departmentId, assigneeIds, placeholder, onUpdate }, ref) {
  // Hold the latest props in a ref so the Mention extension's items()
  // — built once at editor creation — always reads the current values
  // when it fires.
  const propsRef = useRef({ departmentId, assigneeIds });
  useEffect(() => {
    propsRef.current = { departmentId, assigneeIds };
  }, [departmentId, assigneeIds]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: {
          class: 'mention rounded bg-primary/15 px-1 text-primary',
        },
        // Encodes the user id into the rendered span. Our server-side
        // mention parser reads data-id when it walks the HTML.
        renderHTML({ options, node }) {
          return [
            'span',
            {
              'data-type': 'mention',
              'data-id': node.attrs.id,
              class: options.HTMLAttributes.class,
            },
            `@${node.attrs.label ?? node.attrs.id}`,
          ];
        },
        suggestion: {
          char: '@',
          items: async ({ query }) => {
            const { departmentId, assigneeIds } = propsRef.current;
            const params = new URLSearchParams({ status: 'active' });
            // The /users endpoint filters by department server-side; we
            // bias the suggestion set toward the task's department to
            // match the spec's "department + watchers" framing. If the
            // task is cross-department, the prefix filter on the client
            // catches the rest.
            if (departmentId) params.set('departmentId', departmentId);
            let users: SuggestionUser[] = await api.get(`users?${params.toString()}`);
            // Substring filter on display / first / last / email.
            if (query) {
              const q = query.toLowerCase();
              users = users.filter((u) => {
                const hay =
                  `${u.displayName ?? ''} ${u.firstName ?? ''} ${u.lastName ?? ''} ${u.email}`.toLowerCase();
                return hay.includes(q);
              });
            }
            // Sort: assignees first (most relevant), then by displayName.
            const set = new Set(assigneeIds ?? []);
            users.sort((a, b) => {
              const aw = set.has(a.id) ? 0 : 1;
              const bw = set.has(b.id) ? 0 : 1;
              if (aw !== bw) return aw - bw;
              return userLabel(a).localeCompare(userLabel(b));
            });
            return users.slice(0, 10);
          },
          render: () => {
            let component: ReactRenderer<SuggestionListHandle, SuggestionListProps> | null = null;
            let popup: TippyInstance | null = null;

            return {
              onStart: (props) => {
                component = new ReactRenderer(SuggestionList, {
                  props: {
                    items: props.items as SuggestionUser[],
                    command: props.command as (item: { id: string; label: string }) => void,
                  },
                  editor: props.editor,
                });
                if (!props.clientRect) return;
                popup = tippy(document.body, {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },
              onUpdate(props) {
                component?.updateProps({
                  items: props.items as SuggestionUser[],
                  command: props.command as (item: { id: string; label: string }) => void,
                });
                if (props.clientRect && popup) {
                  popup.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
                }
              },
              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  popup?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                popup?.destroy();
                component?.destroy();
                popup = null;
                component = null;
              },
            };
          },
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[80px] px-3 py-2 focus:outline-none dark:prose-invert',
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
    },
    onUpdate: () => onUpdate?.(),
  });

  useImperativeHandle(
    ref,
    () => ({
      clear: () => editor?.commands.clearContent(),
      getHTML: () => editor?.getHTML() ?? '',
      setHTML: (html: string) => editor?.commands.setContent(html, { emitUpdate: false }),
      getMentionIds: () => {
        if (!editor) return [];
        const ids = new Set<string>();
        editor.state.doc.descendants((node) => {
          if (node.type.name === 'mention' && node.attrs.id) {
            ids.add(String(node.attrs.id));
          }
        });
        return Array.from(ids);
      },
      isEmpty: () => {
        if (!editor) return true;
        return editor.getText().trim().length === 0;
      },
    }),
    [editor],
  );

  if (!editor) return null;
  return <div className="rounded-md border bg-background">{<EditorContent editor={editor} />}</div>;
});
