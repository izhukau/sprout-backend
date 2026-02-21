"use client";

import { forceX, forceY } from "d3-force";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ForceNode } from "@/lib/graph-utils";
import { toForceGraphData } from "@/lib/graph-utils";
import { mockBranches, mockNodes } from "@/lib/mock-data";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

// Branch cluster positions — evenly spaced around origin
const branchCenters = new Map<string, { x: number; y: number }>();
mockBranches.forEach((branch, i) => {
  const angle = (2 * Math.PI * i) / mockBranches.length - Math.PI / 2;
  const radius = 200;
  branchCenters.set(branch.id, {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  });
});

const graphData = toForceGraphData(mockNodes);

const COLOR_MAP = {
  root: "#2EE84A",
  concept: "#3DBF5A",
  subconcept: "#1A6B2A",
} as const;

type ForceGraphViewProps = {
  highlightedBranchId: string | null;
  onNodeClick: (nodeId: string) => void;
};

export function ForceGraphView({
  highlightedBranchId,
  onNodeClick,
}: ForceGraphViewProps) {
  // biome-ignore lint/suspicious/noExplicitAny: react-force-graph ref type is untyped
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Apply branch clustering forces once graph is mounted
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    fg.d3Force(
      "x",
      forceX((d) => {
        const node = d as unknown as ForceNode;
        if (!node.branchId) return 0;
        return branchCenters.get(node.branchId)?.x ?? 0;
      }).strength(0.3),
    );

    fg.d3Force(
      "y",
      forceY((d) => {
        const node = d as unknown as ForceNode;
        if (!node.branchId) return 0;
        return branchCenters.get(node.branchId)?.y ?? 0;
      }).strength(0.3),
    );

    fg.d3Force("charge")?.strength(-80);
    fg.d3Force("link")?.distance(40);

    fg.d3ReheatSimulation();
  }, []);

  // Zoom to highlighted branch
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || !highlightedBranchId) return;

    const center = branchCenters.get(highlightedBranchId);
    if (center) {
      fg.centerAt(center.x, center.y, 600);
      fg.zoom(3, 600);
    }
  }, [highlightedBranchId]);

  // Reset zoom when no branch is highlighted
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || highlightedBranchId) return;

    fg.zoomToFit(600, 60);
  }, [highlightedBranchId]);

  const handleNodeClick = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph node type
    (node: any) => {
      onNodeClick(node.id);
    },
    [onNodeClick],
  );

  const nodeCanvasObject = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: canvas rendering callback
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const { variant, completed, branchId, label } = node as ForceNode;
      const x = node.x as number;
      const y = node.y as number;

      const isHighlighted =
        !highlightedBranchId ||
        branchId === highlightedBranchId ||
        variant === "root";
      const alpha = isHighlighted ? 1 : 0.15;

      const baseColor = COLOR_MAP[variant];
      const radius = variant === "root" ? 8 : variant === "concept" ? 5 : 3;
      const displayRadius =
        isHighlighted && highlightedBranchId ? radius * 1.3 : radius;

      // Outer glow
      if (isHighlighted && (variant !== "subconcept" || completed)) {
        ctx.beginPath();
        ctx.arc(x, y, displayRadius + 4, 0, 2 * Math.PI);
        ctx.fillStyle = `${baseColor}${Math.round(alpha * 0.12 * 255)
          .toString(16)
          .padStart(2, "0")}`;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, displayRadius, 0, 2 * Math.PI);
      ctx.fillStyle = completed
        ? `${baseColor}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, "0")}`
        : `${baseColor}${Math.round(alpha * 0.5 * 255)
            .toString(16)
            .padStart(2, "0")}`;
      ctx.fill();

      // Label for root and concept nodes (subconcepts too small)
      if (variant !== "subconcept" && globalScale > 0.8) {
        const fontSize = Math.max(10 / globalScale, 3);
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
        ctx.fillText(label, x, y + displayRadius + 3);
      }

      // Store for hit detection
      node.__radius = displayRadius;
    },
    [highlightedBranchId],
  );

  const nodePointerAreaPaint = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: canvas hit area callback
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const r = (node.__radius as number) || 5;
      ctx.beginPath();
      ctx.arc(node.x as number, node.y as number, r + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  const linkColor = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph link type
    (link: any) => {
      if (!highlightedBranchId) return "rgba(46, 232, 74, 0.08)";

      const sourceNode = typeof link.source === "object" ? link.source : null;
      const targetNode = typeof link.target === "object" ? link.target : null;

      if (!sourceNode || !targetNode) return "rgba(46, 232, 74, 0.03)";

      const sourceInBranch =
        sourceNode.branchId === highlightedBranchId ||
        sourceNode.variant === "root";
      const targetInBranch =
        targetNode.branchId === highlightedBranchId ||
        targetNode.variant === "root";

      if (sourceInBranch && targetInBranch) return "rgba(46, 232, 74, 0.2)";
      return "rgba(46, 232, 74, 0.03)";
    },
    [highlightedBranchId],
  );

  if (dimensions.width === 0) return null;

  return (
    <ForceGraph2D
      ref={graphRef}
      graphData={graphData}
      width={dimensions.width}
      height={dimensions.height}
      backgroundColor="#0A1A0F"
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={nodePointerAreaPaint}
      onNodeClick={handleNodeClick}
      linkColor={linkColor}
      linkWidth={1}
      cooldownTicks={200}
      minZoom={0.5}
      maxZoom={10}
      enableNodeDrag={false}
    />
  );
}
