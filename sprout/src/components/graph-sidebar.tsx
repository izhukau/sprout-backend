"use client";

import { ArrowLeft, ArrowRight, GitBranch } from "lucide-react";
import type { Branch } from "@/lib/mock-data";
import type { GraphNode } from "@/components/graph-node";
import { cn } from "@/lib/utils";

type GraphView =
  | { level: "global" }
  | { level: "branch"; branchId: string }
  | { level: "concept"; branchId: string; conceptId: string };

type GraphSidebarProps = {
  view: GraphView;
  branches: Branch[];
  nodes: GraphNode[];
  highlightedBranchId: string | null;
  onSelectBranch: (branchId: string) => void;
  onOpenBranch: (branchId: string) => void;
  onSelectConcept: (conceptId: string) => void;
  onOpenConcept: (conceptId: string) => void;
  onBack: () => void;
};

export function GraphSidebar({
  view,
  branches,
  nodes,
  highlightedBranchId,
  onSelectBranch,
  onOpenBranch,
  onSelectConcept,
  onOpenConcept,
  onBack,
}: GraphSidebarProps) {
  return (
    <aside className="absolute left-0 top-0 z-10 flex h-full w-72 flex-col border-r border-[rgba(46,232,74,0.1)] bg-[rgba(10,26,15,0.85)] backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[rgba(46,232,74,0.08)] px-5 py-4">
        {view.level !== "global" && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(46,232,74,0.15)] bg-[rgba(17,34,20,0.6)] text-[#3DBF5A] transition-colors hover:border-[rgba(46,232,74,0.3)] hover:text-[#2EE84A]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="truncate font-mono text-sm font-medium tracking-wide text-[#3DBF5A]/80 uppercase">
          {view.level === "global" && "Branches"}
          {view.level === "branch" &&
            branches.find((b) => b.id === view.branchId)?.title}
          {view.level === "concept" &&
            nodes.find((n) => n.id === view.conceptId)?.data.label}
        </h2>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {view.level === "global" && (
          <GlobalLevel
            branches={branches}
            highlightedBranchId={highlightedBranchId}
            onSelectBranch={onSelectBranch}
            onOpenBranch={onOpenBranch}
          />
        )}
        {view.level === "branch" && (
          <BranchLevel
            nodes={nodes}
            branchId={view.branchId}
            onSelectConcept={onSelectConcept}
            onOpenConcept={onOpenConcept}
          />
        )}
        {view.level === "concept" && (
          <ConceptLevel nodes={nodes} conceptId={view.conceptId} />
        )}
      </div>
    </aside>
  );
}

function GlobalLevel({
  branches,
  highlightedBranchId,
  onSelectBranch,
  onOpenBranch,
}: {
  branches: Branch[];
  highlightedBranchId: string | null;
  onSelectBranch: (id: string) => void;
  onOpenBranch: (id: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {branches.map((branch) => {
        const isActive = highlightedBranchId === branch.id;
        return (
          <li key={branch.id}>
            <button
              type="button"
              onClick={() => onSelectBranch(branch.id)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200",
                isActive
                  ? "border border-[rgba(46,232,74,0.25)] bg-[rgba(46,232,74,0.08)] text-white"
                  : "border border-transparent text-white/60 hover:bg-[rgba(46,232,74,0.04)] hover:text-white/80",
              )}
            >
              <GitBranch
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-[#2EE84A]" : "text-[#3DBF5A]/40 group-hover:text-[#3DBF5A]/60",
                )}
              />
              <span className="min-w-0 truncate text-sm">{branch.title}</span>
            </button>

            {isActive && (
              <button
                type="button"
                onClick={() => onOpenBranch(branch.id)}
                className="mt-1 ml-7 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#2EE84A] transition-all hover:bg-[rgba(46,232,74,0.1)]"
              >
                Open Branch
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BranchLevel({
  nodes,
  branchId,
  onSelectConcept,
  onOpenConcept,
}: {
  nodes: GraphNode[];
  branchId: string;
  onSelectConcept: (id: string) => void;
  onOpenConcept: (id: string) => void;
}) {
  const concepts = nodes.filter(
    (n) => n.data.branchId === branchId && n.data.variant === "concept",
  );

  return (
    <ul className="space-y-1">
      {concepts.map((concept, i) => (
        <li key={concept.id} className="flex items-center gap-2">
          <div className="flex w-6 shrink-0 items-center justify-center">
            <span className="font-mono text-xs text-[#3DBF5A]/40">
              {String(i + 1).padStart(2, "0")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onSelectConcept(concept.id);
              onOpenConcept(concept.id);
            }}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-xl px-3 py-3 text-left text-sm transition-all duration-200",
              "border border-transparent text-white/60 hover:bg-[rgba(46,232,74,0.04)] hover:text-white/80",
              concept.data.completed && "text-white/80",
            )}
          >
            {concept.data.completed && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2EE84A]" />
            )}
            <span className="min-w-0 truncate">{concept.data.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConceptLevel({
  nodes,
  conceptId,
}: {
  nodes: GraphNode[];
  conceptId: string;
}) {
  const subconcepts = nodes.filter(
    (n) => n.data.variant === "subconcept" && n.data.parentId === conceptId,
  );

  return (
    <ul className="space-y-1">
      {subconcepts.map((sub) => (
        <li key={sub.id}>
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-3 text-sm",
              sub.data.completed ? "text-white/80" : "text-white/50",
            )}
          >
            {sub.data.completed && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2EE84A]" />
            )}
            <span className="min-w-0 truncate">{sub.data.label}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
