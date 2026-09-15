import type Graph from "graphology";
import type Sigma from "sigma";

// Adapted from Semantica Explorer: inject the graph instead of its global store.
export interface GraphInteractionState {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  hoveredNodeId: string | null;
  activePath: string[];
}
export type GraphBehaviorActionRequest =
  | { type: "fitView" }
  | {
      type: "focusNode" | "centerSelection" | "centerGroupedSelection";
      nodeId: string;
    };
export interface GraphBehaviorContext {
  sigma: Sigma;
  graph: Graph;
  displayGraph: Graph;
  getInteractionState: () => GraphInteractionState;
  setHoveredNodeId: (nodeId: string | null) => void;
  onNodeSelectionChange: (nodeId: string) => void;
  onEdgeSelectionChange: (edgeId: string) => void;
  focusNodeInView: (nodeId: string) => void;
  centerSelectionInView: (nodeId: string) => void;
  centerGroupedSelectionInView: (nodeId: string) => void;
  fitCurrentView: () => void;
  dispatchAction: (action: GraphBehaviorActionRequest) => void;
}
export interface GraphBehavior {
  id: string;
  attach: (context: GraphBehaviorContext) => void;
  detach: (context: GraphBehaviorContext) => void;
  onNodeEnter?: (context: GraphBehaviorContext, nodeId: string) => void;
  onNodeLeave?: (context: GraphBehaviorContext, nodeId: string) => void;
  onNodeClick?: (context: GraphBehaviorContext, nodeId: string) => void;
  onEdgeClick?: (context: GraphBehaviorContext, edgeId: string) => void;
  onStageClick?: (context: GraphBehaviorContext) => void;
  onStateChange?: (
    context: GraphBehaviorContext,
    state: GraphInteractionState,
  ) => void;
  performAction?: (
    context: GraphBehaviorContext,
    action: GraphBehaviorActionRequest,
  ) => boolean;
}
