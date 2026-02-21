import type { GraphNode } from "@/components/graph-node";

export type Branch = {
  id: string;
  title: string;
  userId: string;
};

const USER_ID = "user-1";

export const mockBranches: Branch[] = [
  { id: "branch-dsa", title: "Data Structures & Algorithms", userId: USER_ID },
  { id: "branch-sys", title: "Systems", userId: USER_ID },
  { id: "branch-math", title: "Discrete Math", userId: USER_ID },
];

export const mockNodes: GraphNode[] = [
  // ── Root ──────────────────────────────────────────────────
  {
    id: "root",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Computer Science",
      variant: "root",
      userId: USER_ID,
      branchId: null,
      parentId: null,
      completed: true,
    },
  },

  // ── Branch 1: Data Structures & Algorithms ────────────────
  // Concepts (linear chain)
  {
    id: "dsa-data-structures",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Data Structures",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "root",
      completed: true,
      summary:
        "Explore fundamental data structures including arrays, linked lists, and trees. Understand how data is organized in memory and the trade-offs between different storage strategies.",
    },
  },
  {
    id: "dsa-algorithms",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Algorithms",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-data-structures",
      completed: true,
      summary:
        "Study core algorithmic techniques such as sorting and searching. Learn to analyze and compare algorithms by their efficiency and correctness.",
    },
  },
  {
    id: "dsa-complexity",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Complexity Analysis",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-algorithms",
      summary:
        "Master complexity analysis using Big-O notation. Compare space and time trade-offs to choose the right algorithm for each problem.",
    },
  },

  // Subconcepts: Data Structures
  {
    id: "ds-arrays",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Arrays",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-data-structures",
      completed: true,
      summary:
        "Contiguous memory blocks with O(1) random access. Learn indexing, dynamic resizing, and common array manipulation patterns.",
    },
  },
  {
    id: "ds-linked-lists",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Linked Lists",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-data-structures",
      completed: true,
      summary:
        "Node-based sequential structures with O(1) insertion and deletion. Compare singly, doubly, and circular variants.",
    },
  },
  {
    id: "ds-trees",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Trees",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-data-structures",
      summary:
        "Hierarchical structures with parent-child relationships. Cover binary trees, BSTs, AVL trees, and heap variants.",
    },
  },

  // Subconcepts: Algorithms
  {
    id: "alg-sorting",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Sorting",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-algorithms",
      completed: true,
      summary:
        "Comparison and non-comparison sorting algorithms. Master quicksort, mergesort, heapsort, and understand their trade-offs.",
    },
  },
  {
    id: "alg-searching",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Searching",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-algorithms",
      summary:
        "Linear and binary search strategies. Learn when to apply each and how data structure choice affects search performance.",
    },
  },

  // Subconcepts: Complexity
  {
    id: "cx-big-o",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Big-O Notation",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-complexity",
      summary:
        "Formal notation for describing algorithm growth rates. Learn to classify and compare O(1), O(n), O(log n), O(n²) and beyond.",
    },
  },
  {
    id: "cx-space-time",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Space vs Time",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-dsa",
      parentId: "dsa-complexity",
      summary:
        "Analyze the memory-speed trade-off in algorithm design. Learn when to optimize for space vs time and how caching affects both.",
    },
  },

  // ── Branch 2: Systems ─────────────────────────────────────
  // Concepts (linear chain)
  {
    id: "sys-os",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Operating Systems",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "root",
      completed: true,
      summary:
        "Dive into operating system internals: processes, threads, and CPU scheduling. Understand how the OS manages hardware resources and provides abstractions.",
    },
  },
  {
    id: "sys-networking",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Networking",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-os",
      summary:
        "Learn the networking stack from TCP/IP to HTTP and DNS. Understand how data travels across networks and how protocols ensure reliable communication.",
    },
  },
  {
    id: "sys-databases",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Databases",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-networking",
      summary:
        "Study database fundamentals including SQL querying and indexing strategies. Learn how databases store, retrieve, and optimize access to data.",
    },
  },

  // Subconcepts: Operating Systems
  {
    id: "os-processes",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Processes",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-os",
      completed: true,
      summary:
        "Independent execution units with their own address space. Learn process lifecycle, IPC mechanisms, and fork/exec patterns.",
    },
  },
  {
    id: "os-threads",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Threads",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-os",
      summary:
        "Lightweight execution units sharing process memory. Understand concurrency, synchronization primitives, and race conditions.",
    },
  },
  {
    id: "os-scheduling",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Scheduling",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-os",
      summary:
        "CPU scheduling algorithms that manage process execution order. Compare FCFS, round-robin, priority, and multilevel feedback queues.",
    },
  },

  // Subconcepts: Networking
  {
    id: "net-tcp-ip",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "TCP/IP",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-networking",
      summary:
        "The foundational protocol suite for internet communication. Understand the 4-layer model, packet structure, and reliable delivery.",
    },
  },
  {
    id: "net-http",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "HTTP",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-networking",
      summary:
        "The application-layer protocol powering the web. Learn request/response cycles, methods, status codes, and HTTP/2 improvements.",
    },
  },
  {
    id: "net-dns",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "DNS",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-networking",
      summary:
        "The internet's naming system that translates domains to IP addresses. Understand resolution, caching, record types, and DNS security.",
    },
  },

  // Subconcepts: Databases
  {
    id: "db-sql",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "SQL",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-databases",
      summary:
        "The standard language for relational databases. Master SELECT, JOIN, aggregation, subqueries, and query optimization.",
    },
  },
  {
    id: "db-indexing",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Indexing",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-sys",
      parentId: "sys-databases",
      summary:
        "Data structures that speed up database queries. Learn B-trees, hash indexes, composite indexes, and when indexing hurts performance.",
    },
  },

  // ── Branch 3: Discrete Math ───────────────────────────────
  // Concepts (linear chain)
  {
    id: "math-sets-logic",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Sets & Logic",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "root",
      completed: true,
      summary:
        "Build a foundation in propositional and predicate logic. Learn set operations, logical connectives, and formal reasoning techniques.",
    },
  },
  {
    id: "math-proofs",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Proofs",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-sets-logic",
      summary:
        "Learn proof techniques including mathematical induction and proof by contradiction. Develop rigorous reasoning skills for theoretical computer science.",
    },
  },
  {
    id: "math-graph-theory",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Graph Theory",
      variant: "concept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-proofs",
      summary:
        "Explore graph theory concepts such as trees and traversal algorithms. Understand how graph structures model relationships and solve real-world problems.",
    },
  },

  // Subconcepts: Sets & Logic
  {
    id: "sl-propositional",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Propositional Logic",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-sets-logic",
      completed: true,
      summary:
        "Formal logic of propositions using connectives (AND, OR, NOT, IMPLIES). Build and evaluate truth tables and logical equivalences.",
    },
  },
  {
    id: "sl-predicate",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Predicate Logic",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-sets-logic",
      summary:
        "Extends propositional logic with quantifiers and predicates. Reason about properties of objects using universal and existential statements.",
    },
  },

  // Subconcepts: Proofs
  {
    id: "pf-induction",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Induction",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-proofs",
      summary:
        "Prove statements for all natural numbers using base case and inductive step. Apply weak and strong induction to recursive structures.",
    },
  },
  {
    id: "pf-contradiction",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Contradiction",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-proofs",
      summary:
        "Prove statements by assuming the opposite and deriving a logical impossibility. A powerful technique for existence and uniqueness proofs.",
    },
  },

  // Subconcepts: Graph Theory
  {
    id: "gt-trees",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Trees",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-graph-theory",
      summary:
        "Connected acyclic graphs with n-1 edges. Study spanning trees, rooted trees, and their properties in graph theory.",
    },
  },
  {
    id: "gt-traversals",
    type: "graph",
    position: { x: 0, y: 0 },
    data: {
      label: "Traversals",
      variant: "subconcept",
      userId: USER_ID,
      branchId: "branch-math",
      parentId: "math-graph-theory",
      summary:
        "Systematic methods for visiting all vertices in a graph. Master BFS, DFS, and their applications in pathfinding and connectivity.",
    },
  },
];
