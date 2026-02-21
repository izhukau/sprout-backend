import type { Metadata } from "next";
import GraphCanvas from "@/components/graph-canvas";

export const metadata: Metadata = {
  title: "Graph",
};

export default function GraphPage() {
  return <GraphCanvas />;
}
