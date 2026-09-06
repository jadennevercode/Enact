"use client";

import React from "react";

type DragDir = "left" | "top" | "corner";

interface ChatResizeHandlesProps {
  onDragStart: (e: React.PointerEvent, dir: DragDir) => void;
}

export function ChatResizeHandles({ onDragStart }: ChatResizeHandlesProps) {
  return (
    <>
      {/* Left edge — expands width when dragged left */}
      <div
        aria-hidden
        onPointerDown={(e) => onDragStart(e, "left")}
        data-edge="left"
        className="enact-chat-resize-handle absolute left-0 top-4 bottom-0 w-1 z-10"
      />
      {/* Top edge — expands height when dragged up */}
      <div
        aria-hidden
        onPointerDown={(e) => onDragStart(e, "top")}
        data-edge="top"
        className="enact-chat-resize-handle absolute top-0 left-4 right-0 h-1 z-10"
      />
      {/* Top-left corner — expands both width and height */}
      <div
        aria-hidden
        onPointerDown={(e) => onDragStart(e, "corner")}
        data-edge="corner"
        className="enact-chat-resize-handle absolute top-0 left-0 size-4 z-20"
      />
    </>
  );
}
