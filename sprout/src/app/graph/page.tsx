import type { Metadata } from "next";
import { GraphViewContainer } from "@/components/graph-view";

export const metadata: Metadata = {
  title: "Graph",
};

export default function GraphPage() {
  return <GraphViewContainer />;
}
