"use client";

import { forceX, forceY } from "d3-force";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ForceNode } from "@/lib/graph-utils";
import { buildBranchColorMap, toForceGraphData } from "@/lib/graph-utils";
import { mockBranches, mockNodes } from "@/lib/mock-data";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
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

const BRANCH_COLORS = buildBranchColorMap(mockBranches);
const ROOT_COLOR = "#ffffff";

type ForceGraphViewProps = {
  highlightedBranchId: string | null;
  focusedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
};

export function ForceGraphView({
  highlightedBranchId,
  focusedNodeId,
  onNodeClick,
}: ForceGraphViewProps) {
  // biome-ignore lint/suspicious/noExplicitAny: react-force-graph ref type is untyped
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const focusNodeRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const initialFitDone = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Apply branch clustering forces once graph is mounted
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    fg.d3Force(
      "x",
      forceX((d: unknown) => {
        const node = d as ForceNode;
        if (!node.branchId) return 0;
        return branchCenters.get(node.branchId)?.x ?? 0;
      }).strength(0.3),
    );

    fg.d3Force(
      "y",
      forceY((d: unknown) => {
        const node = d as ForceNode;
        if (!node.branchId) return 0;
        return branchCenters.get(node.branchId)?.y ?? 0;
      }).strength(0.3),
    );

    fg.d3Force("charge")?.strength(-80);
    fg.d3Force("link")?.distance(40);

    fg.d3ReheatSimulation();
  }, []);

  // Zoom to highlighted branch, centering on the clicked node
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || !highlightedBranchId) return;

    const focus = focusNodeRef.current;
    if (focus) {
      fg.cameraPosition(
        { x: focus.x, y: focus.y, z: focus.z + 150 },
        { x: focus.x, y: focus.y, z: focus.z },
        600,
      );
      focusNodeRef.current = null;
      return;
    }

    // Fallback: center on branch centroid (e.g. sidebar click)
    const branchNodes = graphData.nodes.filter(
      (n) => n.branchId === highlightedBranchId,
    ) as (ForceNode & { x?: number; y?: number; z?: number })[];

    if (branchNodes.length === 0) return;

    const cx =
      branchNodes.reduce((sum, n) => sum + (n.x ?? 0), 0) / branchNodes.length;
    const cy =
      branchNodes.reduce((sum, n) => sum + (n.y ?? 0), 0) / branchNodes.length;
    const cz =
      branchNodes.reduce((sum, n) => sum + (n.z ?? 0), 0) / branchNodes.length;

    fg.cameraPosition(
      { x: cx, y: cy, z: cz + 150 },
      { x: cx, y: cy, z: cz },
      600,
    );
  }, [highlightedBranchId]);

  // Reset zoom when no branch is highlighted
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || highlightedBranchId) return;

    fg.zoomToFit(600, 0);
  }, [highlightedBranchId]);

  const focusAndSelect = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph node type
    (node: any) => {
      const fg = graphRef.current;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = node.z ?? 0;

      if (fg) {
        fg.cameraPosition({ x, y, z: z + 150 }, { x, y, z }, 600);
      }

      focusNodeRef.current = { x, y, z };
      onNodeClick(node.id);
    },
    [onNodeClick],
  );

  // Track drag start position to detect micro-drags (accidental)
  const dragStartRef = useRef<{ x: number; y: number; z: number } | null>(null);

  const handleNodeDrag = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph node type
    (node: any) => {
      if (!dragStartRef.current) {
        dragStartRef.current = {
          x: node.x ?? 0,
          y: node.y ?? 0,
          z: node.z ?? 0,
        };
      }
    },
    [],
  );

  const handleNodeDragEnd = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph node type
    (node: any) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (!start) return;

      const dx = (node.x ?? 0) - start.x;
      const dy = (node.y ?? 0) - start.y;
      const dz = (node.z ?? 0) - start.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // If barely moved, treat as a click
      if (dist < 5) {
        focusAndSelect(node);
      }
    },
    [focusAndSelect],
  );

  const nodeThreeObject = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph node type
    (node: any) => {
      const { variant, completed, branchId } = node as ForceNode;
      const isHighlighted =
        !highlightedBranchId ||
        branchId === highlightedBranchId ||
        variant === "root";

      const radius = variant === "root" ? 3 : variant === "concept" ? 2 : 1;
      const branchColors = branchId ? BRANCH_COLORS.get(branchId) : null;
      const color =
        variant === "root"
          ? ROOT_COLOR
          : (branchColors?.[variant] ?? ROOT_COLOR);
      const opacity = isHighlighted ? (completed ? 1 : 0.6) : 0.15;

      const isFocused = node.id === focusedNodeId;
      const geometry = new THREE.SphereGeometry(radius, 16, 16);
      const material = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity,
        emissive: isFocused
          ? new THREE.Color(color)
          : new THREE.Color(0x000000),
        emissiveIntensity: isFocused ? 0.6 : 0,
      });
      const mesh = new THREE.Mesh(geometry, material);

      // Label sprite — always for root/concept, subconcepts only when branch is focused
      const showLabel =
        variant !== "subconcept" ||
        (highlightedBranchId && branchId === highlightedBranchId);
      if (showLabel) {
        const { label } = node as ForceNode;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = 256;
          canvas.height = 64;
          ctx.font = "24px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
          ctx.fillText(label, 128, 40);

          const texture = new THREE.CanvasTexture(canvas);
          const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
          });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.scale.set(16, 4, 1);
          sprite.position.set(0, -(radius + 3), 0);
          mesh.add(sprite);
        }
      }

      return mesh;
    },
    [highlightedBranchId, focusedNodeId],
  );

  const linkColor = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: force-graph link type
    (link: any) => {
      if (!highlightedBranchId) return "rgba(255, 255, 255, 0.06)";

      const sourceNode = typeof link.source === "object" ? link.source : null;
      const targetNode = typeof link.target === "object" ? link.target : null;

      if (!sourceNode || !targetNode) return "rgba(255, 255, 255, 0.02)";

      const sourceInBranch =
        sourceNode.branchId === highlightedBranchId ||
        sourceNode.variant === "root";
      const targetInBranch =
        targetNode.branchId === highlightedBranchId ||
        targetNode.variant === "root";

      if (sourceInBranch && targetInBranch) return "rgba(255, 255, 255, 0.15)";
      return "rgba(255, 255, 255, 0.02)";
    },
    [highlightedBranchId],
  );

  if (dimensions.width === 0)
    return <div ref={containerRef} className="h-full w-full" />;

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#0A1A0F"
        nodeThreeObject={nodeThreeObject}
        onNodeClick={focusAndSelect}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        onEngineStop={() => {
          if (!initialFitDone.current) {
            initialFitDone.current = true;
            graphRef.current?.zoomToFit(600, 50);
          }
        }}
        linkColor={linkColor}
        linkWidth={1}
        linkOpacity={0.6}
        cooldownTicks={200}
        enableNodeDrag={true}
      />
    </div>
  );
}
