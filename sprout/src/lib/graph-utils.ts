import type { Edge } from "@xyflow/react";
import type { GraphNode } from "@/components/graph-node";

export function buildEdgesFromNodes(nodes: GraphNode[]): Edge[] {
  return nodes
    .filter(
      (n): n is GraphNode & { data: { parentId: string } } =>
        n.data.parentId !== null,
    )
    .map((n) => ({
      id: `e-${n.data.parentId}-${n.id}`,
      source: n.data.parentId,
      target: n.id,
    }));
}

/** Get concept nodes for a branch + include the first concept's parent link to root */
export function getConceptNodesForBranch(
  allNodes: GraphNode[],
  branchId: string,
): GraphNode[] {
  return allNodes.filter(
    (n) => n.data.branchId === branchId && n.data.variant === "concept",
  );
}

/** Get subconcept nodes for a given concept */
export function getSubconceptNodesForConcept(
  allNodes: GraphNode[],
  conceptId: string,
): GraphNode[] {
  return allNodes.filter(
    (n) => n.data.variant === "subconcept" && n.data.parentId === conceptId,
  );
}

export type ForceNode = {
  [others: string]: unknown;
  id: string;
  label: string;
  variant: "root" | "concept" | "subconcept";
  completed: boolean;
  branchId: string | null;
  val: number;
};

export type ForceLink = {
  source: string;
  target: string;
};

/** Convert GraphNode[] to the format expected by react-force-graph-2d */
export function toForceGraphData(nodes: GraphNode[]): {
  nodes: ForceNode[];
  links: ForceLink[];
} {
  const sizeMap = { root: 20, concept: 10, subconcept: 4 };

  const forceNodes: ForceNode[] = nodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    variant: n.data.variant,
    completed: !!n.data.completed,
    branchId: n.data.branchId,
    val: sizeMap[n.data.variant],
  }));

  const forceLinks: ForceLink[] = nodes
    .filter((n) => n.data.parentId !== null)
    .map((n) => ({
      source: n.data.parentId as string,
      target: n.id,
    }));

  return { nodes: forceNodes, links: forceLinks };
}
