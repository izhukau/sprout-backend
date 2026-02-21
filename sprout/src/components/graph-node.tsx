import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { cva } from "class-variance-authority";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Globe,
  Layers,
} from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NodeVariant = "root" | "concept" | "subconcept";

export type GraphNodeData = {
  label: string;
  variant: NodeVariant;
  userId: string;
  branchId: string | null;
  parentId: string | null;
  completed?: boolean;
  next?: boolean;
  expanded?: boolean;
  onOpenConcept?: (conceptId: string) => void;
  summary?: string;
};

export type GraphNode = Node<GraphNodeData, "graph">;

const nodeVariants = cva(
  [
    "relative w-[340px] overflow-hidden rounded-2xl px-5 py-4",
    "bg-[rgba(17,34,20,0.55)] backdrop-blur-[16px]",
    "border border-[rgba(46,232,74,0.15)]",
    "shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
    "text-white font-sans text-base leading-snug",
    "transition-all duration-300 ease-out",
    "hover:shadow-[0_0_20px_rgba(46,232,74,0.25)]",
    "hover:border-[rgba(46,232,74,0.3)]",
  ],
  {
    variants: {
      variant: {
        root: "border-[rgba(46,232,74,0.4)]",
        concept: "border-[rgba(61,191,90,0.25)]",
        subconcept: "border-[rgba(0,255,65,0.15)]",
      },
    },
    defaultVariants: {
      variant: "subconcept",
    },
  },
);

const iconMap: Record<
  NodeVariant,
  { icon: React.ElementType; className: string }
> = {
  root: { icon: Globe, className: "text-[#2EE84A]" },
  concept: { icon: BookOpen, className: "text-[#3DBF5A]" },
  subconcept: { icon: Layers, className: "text-[#00FF41]" },
};

function GraphNodeComponent({ data, id, selected }: NodeProps<GraphNode>) {
  const { label, variant, completed, next, expanded, onOpenConcept, summary } =
    data;
  const { icon: Icon, className: iconClassName } = iconMap[variant];

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-[#3DBF5A] !border-[#0A1A0F] !h-2 !w-2"
      />
      <div
        className={cn(
          nodeVariants({ variant }),
          completed && "border-[rgba(46,232,74,0.35)]",
          next && "animate-[ambient-glow_4s_ease-in-out_infinite] opacity-100",
          !completed && !next && "opacity-60",
          selected &&
            "ring-2 ring-[#2EE84A] ring-offset-2 ring-offset-[#0A1A0F]",
          expanded && "border-[rgba(46,232,74,0.4)] opacity-100",
        )}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.06] to-transparent" />
        <div className="flex items-center gap-4">
          {completed ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#2EE84A]" />
          ) : (
            <Icon className={cn("h-5 w-5 shrink-0", iconClassName)} />
          )}
          <span className="min-w-0">{label}</span>
        </div>

        {/* Expansion — rolls out from within the node */}
        {(variant === "concept" || variant === "subconcept") && (
          <div
            className={cn(
              "overflow-hidden transition-opacity duration-400 ease-out",
              expanded ? "max-h-[160px] opacity-100 mt-3" : "max-h-0 opacity-0",
            )}
          >
            <div className="border-t border-[rgba(46,232,74,0.15)] pt-3">
              <p className="mb-3 text-sm leading-relaxed text-white/70">
                {summary}
              </p>
              <Button
                size="sm"
                className="w-full bg-[#2EE84A]/15 text-[#2EE84A] hover:bg-[#2EE84A]/25 border border-[#2EE84A]/20"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenConcept?.(id);
                }}
              >
                {variant === "concept" ? "Open Subconcepts" : "Open"}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-[#3DBF5A] !border-[#0A1A0F] !h-2 !w-2"
      />
    </>
  );
}

const MemoizedGraphNode = memo(GraphNodeComponent);

export const graphNodeTypes = {
  graph: MemoizedGraphNode,
} as const;
