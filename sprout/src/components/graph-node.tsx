import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { cva } from "class-variance-authority";
import { BookOpen, Crosshair, ListOrdered, PenLine } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

type NodeVariant = "problem" | "step" | "prereq" | "practice";

type GraphNodeData = {
  label: string;
  variant: NodeVariant;
};

export type GraphNode = Node<GraphNodeData, "graph">;

const nodeVariants = cva(
  [
    "relative overflow-hidden flex items-center gap-3 rounded-xl px-4 py-3",
    "bg-[rgba(17,34,20,0.55)] backdrop-blur-[16px]",
    "border border-[rgba(46,232,74,0.15)]",
    "shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
    "text-white font-sans text-sm leading-tight",
    "transition-all duration-300 ease-out",
    "hover:shadow-[0_0_20px_rgba(46,232,74,0.25)]",
    "hover:border-[rgba(46,232,74,0.3)]",
  ],
  {
    variants: {
      variant: {
        problem:
          "border-[rgba(46,232,74,0.3)] shadow-[0_0_20px_rgba(46,232,74,0.2)] animate-[ambient-glow_4s_ease-in-out_infinite]",
        step: "border-[rgba(61,191,90,0.2)]",
        prereq: "border-[rgba(176,184,180,0.15)] opacity-90",
        practice:
          "border-[rgba(0,255,65,0.25)] shadow-[0_0_12px_rgba(0,255,65,0.15)]",
      },
    },
    defaultVariants: {
      variant: "step",
    },
  },
);

const iconMap: Record<
  NodeVariant,
  { icon: React.ElementType; className: string }
> = {
  problem: { icon: Crosshair, className: "text-[#2EE84A]" },
  step: { icon: ListOrdered, className: "text-[#3DBF5A]" },
  prereq: { icon: BookOpen, className: "text-[#B0B8B4]" },
  practice: { icon: PenLine, className: "text-[#00FF41]" },
};

function GraphNodeComponent({ data, selected }: NodeProps<GraphNode>) {
  const { label, variant } = data;
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
          selected &&
            "ring-2 ring-[#2EE84A] ring-offset-2 ring-offset-[#0A1A0F]",
        )}
      >
        {/* Liquid glass light refraction highlight */}
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-white/[0.06] to-transparent" />
        <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />
        <span className="min-w-0">{label}</span>
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
