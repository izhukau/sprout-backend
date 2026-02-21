"use client";

import {
  Background,
  Controls,
  MiniMap,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import "@xyflow/react/dist/style.css";
import { type GraphNode, graphNodeTypes } from "@/components/graph-node";
import { buildEdgesFromNodes } from "@/lib/graph-utils";
import { getLayoutedElements } from "@/lib/layout";

const FIT_VIEW_OPTIONS = { padding: 0.15 };

const edgeStyle = {
  stroke: "#2A6B30",
  strokeWidth: 1.5,
  strokeDasharray: "6,4",
};

function minimapNodeColor(node: GraphNode): string {
  if (node.data?.completed) return "#2EE84A";
  switch (node.data?.variant) {
    case "root":
      return "#2EE84A";
    case "concept":
      return "#1A4D20";
    case "subconcept":
      return "#00FF41";
    default:
      return "#1A4D20";
  }
}

type GraphCanvasProps = {
  nodes: GraphNode[];
  onNodeClick?: (nodeId: string) => void;
  expandedNodeId?: string | null;
  onOpenConcept?: (conceptId: string) => void;
  onPaneClick?: () => void;
};

export default function GraphCanvas({
  nodes: inputNodes,
  onNodeClick,
  expandedNodeId,
  onOpenConcept,
  onPaneClick,
}: GraphCanvasProps) {
  const { layoutedNodes, layoutedEdges } = useMemo(() => {
    const initialEdges = buildEdgesFromNodes(inputNodes);

    // Derive frontier: edges from completed → not-completed nodes
    const nodeCompletionMap = new Map(
      inputNodes.map((n) => [n.id, !!n.data.completed]),
    );

    const nextNodeIds = new Set(
      initialEdges
        .filter(
          (e) =>
            nodeCompletionMap.get(e.source) && !nodeCompletionMap.get(e.target),
        )
        .map((e) => e.target),
    );

    const styledEdges = initialEdges.map((edge) => {
      const isFrontier =
        nodeCompletionMap.get(edge.source) &&
        !nodeCompletionMap.get(edge.target);
      return { ...edge, style: edgeStyle, animated: isFrontier };
    });

    const nodesWithNext = inputNodes.map((node) =>
      nextNodeIds.has(node.id)
        ? { ...node, data: { ...node.data, next: true } }
        : node,
    );

    const result = getLayoutedElements(nodesWithNext, styledEdges);
    return { layoutedNodes: result.nodes, layoutedEdges: result.edges };
  }, [inputNodes]);

  const nodesWithExpansion = useMemo(() => {
    const EXPANSION_HEIGHT = 160;
    const expandedNode = expandedNodeId
      ? layoutedNodes.find((n) => n.id === expandedNodeId)
      : null;
    const expandedY = expandedNode?.position.y ?? 0;

    return layoutedNodes.map((node) => {
      const isExpanded = node.id === expandedNodeId;
      const needsShift =
        expandedNode && !isExpanded && node.position.y > expandedY;
      return {
        ...node,
        zIndex: isExpanded ? 1000 : undefined,
        position: needsShift
          ? { ...node.position, y: node.position.y + EXPANSION_HEIGHT }
          : node.position,
        data: {
          ...node.data,
          expanded: isExpanded,
          onOpenConcept,
        },
      };
    });
  }, [layoutedNodes, expandedNodeId, onOpenConcept]);

  const [nodes, setNodes, onNodesChange] = useNodesState(nodesWithExpansion);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current);

    const startPositions = prevPositionsRef.current;

    // First render — no animation needed
    if (startPositions.size === 0) {
      setNodes(nodesWithExpansion);
      prevPositionsRef.current = new Map(
        nodesWithExpansion.map((n) => [n.id, { ...n.position }]),
      );
      return;
    }

    const startTime = performance.now();
    const duration = 300;

    function animate(now: number) {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic

      setNodes(
        nodesWithExpansion.map((node) => {
          const from = startPositions.get(node.id) ?? node.position;
          return {
            ...node,
            position: {
              x: from.x + (node.position.x - from.x) * eased,
              y: from.y + (node.position.y - from.y) * eased,
            },
          };
        }),
      );

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        prevPositionsRef.current = new Map(
          nodesWithExpansion.map((n) => [n.id, { ...n.position }]),
        );
      }
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [nodesWithExpansion, setNodes]);

  useEffect(() => {
    setEdges(layoutedEdges);
  }, [layoutedEdges, setEdges]);

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    onNodeClick?.(node.id);
  };

  return (
    <div className="h-full w-full bg-[#0A1A0F]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={graphNodeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
      >
        <Background color="rgba(46, 232, 74, 0.08)" gap={24} size={1.5} />
        <Controls
          style={{
            borderRadius: "8px",
            overflow: "hidden",
            border: "1px solid #1E3D24",
          }}
        />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(10, 26, 15, 0.7)"
          style={{
            backgroundColor: "#0D2010",
            border: "1px solid #1E3D24",
            borderRadius: "8px",
          }}
        />
      </ReactFlow>
    </div>
  );
}
