"use client";

import { useCallback } from "react";

type Props = {
  editorRef: React.RefObject<HTMLDivElement | null>;
};

export default function EmailRichToolbar({ editorRef }: Props) {
  const focusEditor = useCallback(() => editorRef.current?.focus(), [editorRef]);

  const exec = useCallback(
    (command: "bold" | "italic" | "insertUnorderedList" | "insertOrderedList") => {
      focusEditor();
      document.execCommand(command, false);
    },
    [focusEditor],
  );

  const insertLink = useCallback(() => {
    const url = window.prompt("Link URL (https://…)");
    if (!url?.trim()) return;
    focusEditor();
    document.execCommand("createLink", false, url.trim());
  }, [focusEditor]);

  return (
    <div className="mb-1 flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-stone-200 bg-stone-100 px-2 py-1">
      <button type="button" className="rounded px-2 py-1 text-xs font-semibold hover:bg-white" onClick={() => exec("bold")}>
        B
      </button>
      <button type="button" className="rounded px-2 py-1 text-xs italic hover:bg-white" onClick={() => exec("italic")}>
        I
      </button>
      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-white" onClick={insertLink}>
        Link
      </button>
      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-white" onClick={() => exec("insertUnorderedList")}>
        • List
      </button>
      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-white" onClick={() => exec("insertOrderedList")}>
        1. List
      </button>
    </div>
  );
}
