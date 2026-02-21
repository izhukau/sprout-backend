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

const mainEdgeStyle = { stroke: "#3DBF5A", strokeWidth: 2 };
const prereqEdgeStyle = {
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
    },
    position: { x: 0, y: 0 },
  },
  // Solution steps (vertical spine)
  {
    id: "step-fbd",
    type: "graph",
    data: { label: "Step 1: Draw free-body diagram", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-decompose",
    type: "graph",
    data: { label: "Step 2: Decompose forces along incline", variant: "step" },
    position: { x: 0, y: 0 },
  },
  {
    id: "step-normal",
    type: "graph",
    data: { label: "Step 3: Find normal force N = mg·cos θ", variant: "step" },
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

  // Prereq branch off Step 2: trig knowledge gap
  {
    id: "prereq-trig",
    type: "graph",
    data: { label: "Prereq: sin & cos on right triangles", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-trig-1",
    type: "graph",
    data: { label: "What is a right triangle?", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-trig-2",
    type: "graph",
    data: { label: "SOH-CAH-TOA definitions", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-trig-3",
    type: "graph",
    data: { label: "Practice: find sin 30° and cos 30°", variant: "practice" },
    position: { x: 0, y: 0 },
  },

  // Prereq branch off Step 4: friction knowledge gap
  {
    id: "prereq-friction",
    type: "graph",
    data: { label: "Prereq: Friction", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-friction-1",
    type: "graph",
    data: { label: "What causes friction?", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-friction-2",
    type: "graph",
    data: {
      label: "Practice: compute f = μN given values",
      variant: "practice",
    },
    position: { x: 0, y: 0 },
  },

  // Prereq branch off Step 6: Newton's 2nd law gap
  {
    id: "prereq-newton",
    type: "graph",
    data: { label: "Prereq: Newton's 2nd Law", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-newton-1",
    type: "graph",
    data: { label: "F = ma: what each variable means", variant: "prereq" },
    position: { x: 0, y: 0 },
  },
  {
    id: "prereq-newton-2",
    type: "graph",
    data: { label: "Practice: solve a = F/m", variant: "practice" },
    position: { x: 0, y: 0 },
  },
];

const initialEdges: Edge[] = [
  // Main solution spine
  {
    id: "e-problem-fbd",
    source: "problem",
    target: "step-fbd",
    animated: true,
    style: mainEdgeStyle,
  },
  {
    id: "e-fbd-decompose",
    source: "step-fbd",
    target: "step-decompose",
    animated: true,
    style: mainEdgeStyle,
  },
  {
    id: "e-decompose-normal",
    source: "step-decompose",
    target: "step-normal",
    animated: true,
    style: mainEdgeStyle,
  },
  {
    id: "e-normal-friction",
    source: "step-normal",
    target: "step-friction",
    animated: true,
    style: mainEdgeStyle,
  },
  {
    id: "e-friction-net",
    source: "step-friction",
    target: "step-net",
    animated: true,
    style: mainEdgeStyle,
  },
  {
    id: "e-net-newton",
    source: "step-net",
    target: "step-newton",
    animated: true,
    style: mainEdgeStyle,
  },

  // Trig prereq branch (off Step 2)
  {
    id: "e-decompose-trig",
    source: "step-decompose",
    target: "prereq-trig",
    style: prereqEdgeStyle,
  },
  {
    id: "e-trig-1",
    source: "prereq-trig",
    target: "prereq-trig-1",
    style: prereqEdgeStyle,
  },
  {
    id: "e-trig-2",
    source: "prereq-trig-1",
    target: "prereq-trig-2",
    style: prereqEdgeStyle,
  },
  {
    id: "e-trig-3",
    source: "prereq-trig-2",
    target: "prereq-trig-3",
    style: prereqEdgeStyle,
  },

  // Friction prereq branch (off Step 4)
  {
    id: "e-friction-prereq",
    source: "step-friction",
    target: "prereq-friction",
    style: prereqEdgeStyle,
  },
  {
    id: "e-friction-1",
    source: "prereq-friction",
    target: "prereq-friction-1",
    style: prereqEdgeStyle,
  },
  {
    id: "e-friction-2",
    source: "prereq-friction-1",
    target: "prereq-friction-2",
    style: prereqEdgeStyle,
  },

  // Newton prereq branch (off Step 6)
  {
    id: "e-newton-prereq",
    source: "step-newton",
    target: "prereq-newton",
    style: prereqEdgeStyle,
  },
  {
    id: "e-newton-1",
    source: "prereq-newton",
    target: "prereq-newton-1",
    style: prereqEdgeStyle,
  },
  {
    id: "e-newton-2",
    source: "prereq-newton-1",
    target: "prereq-newton-2",
    style: prereqEdgeStyle,
  },
];

const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
  initialNodes,
  initialEdges,
);

function minimapNodeColor(node: GraphNode): string {
  switch (node.data?.variant) {
    case "problem":
      return "#2EE84A";
    case "step":
      return "#1A4D20";
    case "prereq":
      return "#2A6B30";
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
