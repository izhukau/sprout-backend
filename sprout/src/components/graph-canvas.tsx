"use client";

import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Mock: "Find the acceleration of a 5kg block on a 30° incline with friction μ=0.2"
const initialNodes: Node[] = [
  // Main problem
  {
    id: "problem",
    type: "input",
    data: { label: "Find acceleration of block on incline" },
    position: { x: 400, y: 0 },
  },
  // Solution steps (vertical spine)
  {
    id: "step-fbd",
    data: { label: "Step 1: Draw free-body diagram" },
    position: { x: 400, y: 120 },
  },
  {
    id: "step-decompose",
    data: { label: "Step 2: Decompose forces along incline" },
    position: { x: 400, y: 240 },
  },
  {
    id: "step-normal",
    data: { label: "Step 3: Find normal force N = mg·cos θ" },
    position: { x: 400, y: 360 },
  },
  {
    id: "step-friction",
    data: { label: "Step 4: Find friction f = μN" },
    position: { x: 400, y: 480 },
  },
  {
    id: "step-net",
    data: { label: "Step 5: Net force = mg·sin θ − f" },
    position: { x: 400, y: 600 },
  },
  {
    id: "step-newton",
    data: { label: "Step 6: Apply F = ma, solve for a" },
    position: { x: 400, y: 720 },
  },

  // Prereq branch off Step 2: trig knowledge gap
  {
    id: "prereq-trig",
    data: { label: "Prereq: sin & cos on right triangles" },
    position: { x: 750, y: 240 },
  },
  {
    id: "prereq-trig-1",
    data: { label: "What is a right triangle?" },
    position: { x: 750, y: 360 },
  },
  {
    id: "prereq-trig-2",
    data: { label: "SOH-CAH-TOA definitions" },
    position: { x: 750, y: 480 },
  },
  {
    id: "prereq-trig-3",
    type: "output",
    data: { label: "Practice: find sin 30° and cos 30°" },
    position: { x: 750, y: 600 },
  },

  // Prereq branch off Step 4: friction knowledge gap
  {
    id: "prereq-friction",
    data: { label: "Prereq: Friction" },
    position: { x: 50, y: 480 },
  },
  {
    id: "prereq-friction-1",
    data: { label: "What causes friction?" },
    position: { x: 50, y: 600 },
  },
  {
    id: "prereq-friction-2",
    type: "output",
    data: { label: "Practice: compute f = μN given values" },
    position: { x: 50, y: 720 },
  },

  // Prereq branch off Step 6: Newton's 2nd law gap
  {
    id: "prereq-newton",
    data: { label: "Prereq: Newton's 2nd Law" },
    position: { x: 750, y: 720 },
  },
  {
    id: "prereq-newton-1",
    data: { label: "F = ma: what each variable means" },
    position: { x: 750, y: 840 },
  },
  {
    id: "prereq-newton-2",
    type: "output",
    data: { label: "Practice: solve a = F/m" },
    position: { x: 750, y: 960 },
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

  // Trig prereq branch (off Step 2)
  { id: "e-decompose-trig", source: "step-decompose", target: "prereq-trig", style: { strokeDasharray: "5,5" } },
  { id: "e-trig-1", source: "prereq-trig", target: "prereq-trig-1", style: { strokeDasharray: "5,5" } },
  { id: "e-trig-2", source: "prereq-trig-1", target: "prereq-trig-2", style: { strokeDasharray: "5,5" } },
  { id: "e-trig-3", source: "prereq-trig-2", target: "prereq-trig-3", style: { strokeDasharray: "5,5" } },

  // Friction prereq branch (off Step 4)
  { id: "e-friction-prereq", source: "step-friction", target: "prereq-friction", style: { strokeDasharray: "5,5" } },
  { id: "e-friction-1", source: "prereq-friction", target: "prereq-friction-1", style: { strokeDasharray: "5,5" } },
  { id: "e-friction-2", source: "prereq-friction-1", target: "prereq-friction-2", style: { strokeDasharray: "5,5" } },

  // Newton prereq branch (off Step 6)
  { id: "e-newton-prereq", source: "step-newton", target: "prereq-newton", style: { strokeDasharray: "5,5" } },
  { id: "e-newton-1", source: "prereq-newton", target: "prereq-newton-1", style: { strokeDasharray: "5,5" } },
  { id: "e-newton-2", source: "prereq-newton-1", target: "prereq-newton-2", style: { strokeDasharray: "5,5" } },
];

export default function GraphCanvas() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-screen w-screen">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
