// Adapted from Semantica Explorer's drawSemanticaNodeHover, MIT (see LICENSE).
import type { NodeHoverDrawingFunction } from "sigma/rendering";

export function createNodeHover(theme: { background: string; border: string; text: string; muted: string; font: string }): NodeHoverDrawingFunction {
  return (context, data) => {
    if (!data.label) return;
    const meta = typeof data.nodeType === "string" ? data.nodeType : "";
    context.save();
    context.textBaseline = "top";
    context.font = `600 13px ${theme.font}`;
    const titleWidth = context.measureText(data.label).width;
    context.font = `11px ${theme.font}`;
    const width = Math.max(titleWidth, context.measureText(meta).width) + 24;
    const height = meta ? 53 : 33;
    const x = data.x + Math.max(data.size * 0.9, 12);
    const y = data.y - Math.max(data.size * 1.1, 12) - height;
    context.fillStyle = theme.background;
    context.strokeStyle = theme.border;
    context.lineWidth = 1.2;
    context.beginPath();
    context.roundRect(x, y, width, height, 7);
    context.fill();
    context.stroke();
    context.fillStyle = theme.text;
    context.font = `600 13px ${theme.font}`;
    context.fillText(data.label, x + 12, y + 10);
    if (meta) {
      context.fillStyle = theme.muted;
      context.font = `11px ${theme.font}`;
      context.fillText(meta, x + 12, y + 31);
    }
    context.restore();
  };
}
