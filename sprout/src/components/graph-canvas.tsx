"use client";

import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type GraphNode, graphNodeTypes } from "@/components/graph-node";
import { getLayoutedElements } from "@/lib/layout";

const edgeStyle = {
  stroke: "#2A6B30",
  strokeWidth: 1.5,
  strokeDasharray: "6,4",
};

// Mock: "Find the acceleration of a 5kg block on a 30° incline with friction μ=0.2"
const initialNodes: GraphNode[] = [
  // Main problem
  {
    id: "problem",
    type: "graph",
    data: {
      label: "Find acceleration of block on incline",
      variant: "problem",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  // Solution steps (vertical spine)
  {
    id: "step-fbd",
    type: "graph",
    data: {
      label: "Step 1: Draw free-body diagram",
      variant: "step",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-decompose",
    type: "graph",
    data: {
      label: "Step 2: Decompose forces along incline",
      variant: "step",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-normal",
    type: "graph",
    data: {
      label: "Step 3: Find normal force N = mg·cos θ",
      variant: "step",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-friction",
    type: "graph",
    data: { label: "Step 4: Find friction f = μN", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-net",
    type: "graph",
    data: { label: "Step 5: Net force = mg·sin θ − f", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-newton",
    type: "graph",
    data: { label: "Step 6: Apply F = ma, solve for a", variant: "step" },
    position: { x: 0, y: 0 },
  },

  // Branch off Step 2: trig subgraph
  {
    id: "trig",
    type: "graph",
    data: {
      label: "sin & cos on right triangles",
      variant: "step",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  {
    id: "trig-1",
    type: "graph",
    data: {
      label: "What is a right triangle?",
      variant: "step",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  {
    id: "trig-2",
    type: "graph",
    data: {
      label: "SOH-CAH-TOA definitions",
      variant: "step",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },
  {
    id: "trig-practice",
    type: "graph",
    data: {
      label: "Practice: find sin 30° and cos 30°",
      variant: "practice",
      completed: true,
    },
    position: { x: 0, y: 0 },
  },

  // Branch off Step 4: friction subgraph
  {
    id: "friction",
    type: "graph",
    data: { label: "Understanding friction", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "friction-1",
    type: "graph",
    data: { label: "What causes friction?", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "friction-practice",
    type: "graph",
    data: {
      label: "Practice: compute f = μN given values",
      variant: "practice",
    },
    position: { x: 0, y: 0 },
  },

  // Branch off Step 6: Newton's 2nd law subgraph
  {
    id: "newton",
    type: "graph",
    data: { label: "Newton's 2nd Law", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "newton-1",
    type: "graph",
    data: { label: "F = ma: what each variable means", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "newton-practice",
    type: "graph",
    data: { label: "Practice: solve a = F/m", variant: "practice" },
    position: { x: 0, y: 0 },
  },
];

const initialEdges: Edge[] = [
  // Main solution spine
  { id: "e-problem-fbd", source: "problem", target: "step-fbd" },
  { id: "e-fbd-decompose", source: "step-fbd", target: "step-decompose" },
  { id: "e-decompose-normal", source: "step-decompose", target: "step-normal" },
  { id: "e-normal-friction", source: "step-normal", target: "step-friction" },
  { id: "e-friction-net", source: "step-friction", target: "step-net" },
  { id: "e-net-newton", source: "step-net", target: "step-newton" },

  // Trig branch (off Step 2)
  { id: "e-decompose-trig", source: "step-decompose", target: "trig" },
  { id: "e-trig-1", source: "trig", target: "trig-1" },
  { id: "e-trig-2", source: "trig-1", target: "trig-2" },
  { id: "e-trig-3", source: "trig-2", target: "trig-practice" },

  // Friction branch (off Step 4)
  { id: "e-friction-branch", source: "step-friction", target: "friction" },
  { id: "e-friction-1", source: "friction", target: "friction-1" },
  { id: "e-friction-2", source: "friction-1", target: "friction-practice" },

  // Newton branch (off Step 6)
  { id: "e-newton-branch", source: "step-newton", target: "newton" },
  { id: "e-newton-1", source: "newton", target: "newton-1" },
  { id: "e-newton-2", source: "newton-1", target: "newton-practice" },
];

// Derive frontier: edges from completed → not-completed nodes
const nodeCompletionMap = new Map(
  initialNodes.map((n) => [n.id, !!n.data.completed]),
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
    nodeCompletionMap.get(edge.source) && !nodeCompletionMap.get(edge.target);
  return { ...edge, style: edgeStyle, animated: isFrontier };
});

const nodesWithNext = initialNodes.map((node) =>
  nextNodeIds.has(node.id)
    ? { ...node, data: { ...node.data, next: true } }
    : node,
);

const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
  nodesWithNext,
  styledEdges,
);

function minimapNodeColor(node: GraphNode): string {
  if (node.data?.completed) return "#2EE84A";
  switch (node.data?.variant) {
    case "problem":
      return "#2EE84A";
    case "step":
      return "#1A4D20";
    case "practice":
      return "#00FF41";
    default:
      return "#1A4D20";
  }
}

export default function GraphCanvas() {
  const [nodes, , onNodesChange] = useNodesState(layoutedNodes);
  const [edges, , onEdgesChange] = useEdgesState(layoutedEdges);

  return (
    <div className="h-screen w-screen bg-[#0A1A0F]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={graphNodeTypes}
        colorMode="dark"
        fitView
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
