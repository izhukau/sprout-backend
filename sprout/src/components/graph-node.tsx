import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { cva } from "class-variance-authority";
import { CheckCircle2, Crosshair, ListOrdered, PenLine } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/utils";

type NodeVariant = "problem" | "step" | "practice";

type GraphNodeData = {
  label: string;
  variant: NodeVariant;
  completed?: boolean;
  next?: boolean;
};

export type GraphNode = Node<GraphNodeData, "graph">;

const nodeVariants = cva(
  [
    "relative overflow-hidden flex items-center gap-4 rounded-2xl px-5 py-4",
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
        problem: "border-[rgba(46,232,74,0.3)]",
        step: "border-[rgba(61,191,90,0.2)]",
        practice: "border-[rgba(0,255,65,0.25)]",
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
  practice: { icon: PenLine, className: "text-[#00FF41]" },
};

function GraphNodeComponent({ data, selected }: NodeProps<GraphNode>) {
  const { label, variant, completed, next } = data;
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
        )}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.06] to-transparent" />
        {completed ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[#2EE84A]" />
        ) : (
          <Icon className={cn("h-5 w-5 shrink-0", iconClassName)} />
        )}
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
