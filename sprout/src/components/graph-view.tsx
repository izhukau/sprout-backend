"use client";

import { useCallback, useState } from "react";
import { ForceGraphView } from "@/components/force-graph-view";
import GraphCanvas from "@/components/graph-canvas";
import { GraphSidebar, type GraphView } from "@/components/graph-sidebar";
import {
  getConceptNodesForBranch,
  getSubconceptNodesForConcept,
} from "@/lib/graph-utils";
import { mockBranches, mockNodes } from "@/lib/mock-data";

export function GraphViewContainer() {
  const [view, setView] = useState<GraphView>({ level: "global" });
  const [highlightedBranchId, setHighlightedBranchId] = useState<string | null>(
    null,
  );
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const handleSelectBranch = useCallback((branchId: string) => {
    setHighlightedBranchId((prev) => (prev === branchId ? null : branchId));
  }, []);

  const handleOpenBranch = useCallback((branchId: string) => {
    setView({ level: "branch", branchId });
    setHighlightedBranchId(null);
  }, []);

  const handleSelectConcept = useCallback((_conceptId: string) => {
    // Could zoom to concept in React Flow — noop for now
  }, []);

  const handleOpenConcept = useCallback(
    (conceptId: string) => {
      if (view.level === "branch") {
        setExpandedNodeId(null);
        setView({ level: "concept", branchId: view.branchId, conceptId });
      }
    },
    [view],
  );

  const handleOpenNode = useCallback(
    (nodeId: string) => {
      if (view.level === "branch") {
        handleOpenConcept(nodeId);
      } else if (view.level === "concept") {
        // Subconcept "Open" — noop for now, will navigate to learn view later
        setExpandedNodeId(null);
      }
    },
    [view, handleOpenConcept],
  );

  const handleBack = useCallback(() => {
    setExpandedNodeId(null);
    setFocusedNodeId(null);
    if (view.level === "concept") {
      setView({ level: "branch", branchId: view.branchId });
    } else if (view.level === "branch") {
      setView({ level: "global" });
    }
  }, [view]);

  const handleForceNodeClick = useCallback(
    (nodeId: string) => {
      const node = mockNodes.find((n) => n.id === nodeId);
      if (!node) return;

      if (node.data.variant === "root") return;

      // Second click on focused node → navigate to ReactFlow level
      if (nodeId === focusedNodeId) {
        if (node.data.variant === "concept" && node.data.branchId) {
          setView({ level: "branch", branchId: node.data.branchId });
          setExpandedNodeId(nodeId);
        } else if (
          node.data.variant === "subconcept" &&
          node.data.branchId &&
          node.data.parentId
        ) {
          setView({
            level: "concept",
            branchId: node.data.branchId,
            conceptId: node.data.parentId,
          });
        }
        setFocusedNodeId(null);
        setHighlightedBranchId(null);
        return;
      }

      // First click → focus + highlight branch
      setFocusedNodeId(nodeId);
      if (node.data.branchId) {
        setHighlightedBranchId(node.data.branchId);
      }
    },
    [focusedNodeId],
  );

  const handleReactFlowNodeClick = useCallback(
    (nodeId: string) => {
      if (view.level === "branch") {
        const node = mockNodes.find((n) => n.id === nodeId);
        if (node?.data.variant === "concept") {
          setExpandedNodeId((prev) => (prev === nodeId ? null : nodeId));
        }
      } else if (view.level === "concept") {
        const node = mockNodes.find((n) => n.id === nodeId);
        if (node?.data.variant === "subconcept") {
          setExpandedNodeId((prev) => (prev === nodeId ? null : nodeId));
        }
      }
    },
    [view],
  );

  // Compute filtered nodes for levels 2 and 3
  const filteredNodes = (() => {
    if (view.level === "branch") {
      return getConceptNodesForBranch(mockNodes, view.branchId);
    }
    if (view.level === "concept") {
      return getSubconceptNodesForConcept(mockNodes, view.conceptId);
    }
    return [];
  })();

  return (
    <div className="relative h-screen w-screen bg-[#0A1A0F]">
      <GraphSidebar
        view={view}
        branches={mockBranches}
        nodes={mockNodes}
        highlightedBranchId={highlightedBranchId}
        onSelectBranch={handleSelectBranch}
        onOpenBranch={handleOpenBranch}
        onSelectConcept={handleSelectConcept}
        onOpenConcept={handleOpenConcept}
        onSelectSubconcept={handleOpenNode}
        onBack={handleBack}
      />

      {/* Graph area — offset by sidebar width */}
      <div className="absolute inset-0 left-72">
        {view.level === "global" && (
          <ForceGraphView
            highlightedBranchId={highlightedBranchId}
            focusedNodeId={focusedNodeId}
            onNodeClick={handleForceNodeClick}
          />
        )}
        {(view.level === "branch" || view.level === "concept") && (
          <GraphCanvas
            key={
              view.level === "branch"
                ? `branch-${view.branchId}`
                : `concept-${view.conceptId}`
            }
            nodes={filteredNodes}
            onNodeClick={handleReactFlowNodeClick}
            expandedNodeId={expandedNodeId}
            onOpenConcept={handleOpenNode}
            onPaneClick={() => setExpandedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
