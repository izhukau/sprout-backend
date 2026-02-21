import type { Edge } from "@xyflow/react";
import type { GraphNode } from "@/components/graph-node";
import type { Branch } from "@/lib/mock-data";

export type BranchColors = { concept: string; subconcept: string };

/** Build a stable color map for branches using golden-angle hue spacing */
export function buildBranchColorMap(
  branches: Branch[],
): Map<string, BranchColors> {
  const map = new Map<string, BranchColors>();
  branches.forEach((branch, i) => {
    const hue = (i * 137.5) % 360;
    map.set(branch.id, {
      concept: `hsl(${hue}, 80%, 65%)`,
      subconcept: `hsl(${hue}, 50%, 35%)`,
    });
  });
  return map;
}

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

/** Get a concept node and its subconcepts */
export function getSubconceptNodesForConcept(
  allNodes: GraphNode[],
  conceptId: string,
): GraphNode[] {
  const concept = allNodes.find((n) => n.id === conceptId);
  const subconcepts = allNodes.filter(
    (n) => n.data.variant === "subconcept" && n.data.parentId === conceptId,
  );
  if (!concept) return subconcepts;
  // Null out parentId so no dangling edge to nodes outside this view
  const conceptAsRoot = {
    ...concept,
    data: { ...concept.data, parentId: null },
  };
  return [conceptAsRoot, ...subconcepts];
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

/** Convert GraphNode[] to the format expected by react-force-graph */
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
