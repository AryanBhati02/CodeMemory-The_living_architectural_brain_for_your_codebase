

export type DecisionType =
  | 'pattern'     
  | 'constraint'  
  | 'convention'  
  | 'why';        

export type DecisionStatus =
  | 'proposed'    
  | 'accepted'    
  | 'deprecated'  
  | 'superseded'; 

export type RelationType =
  | 'CONFLICTS_WITH'
  | 'DEPENDS_ON'
  | 'SUPERSEDES'
  | 'RELATED_TO'
  | 'APPLIES_TO';

export interface DecisionPayload {
  title: string;
  rationale: string;
  type: DecisionType;
  status: DecisionStatus;
    filePaths: string[];
    tags: string[];
    codeContext?: string;
    lineNumber?: number;
}

export interface DecisionNode {
  id: string;
  type: 'decision';
  payload: DecisionPayload;
    embedding: Float32Array | null;
  createdAt: string;   
  updatedAt: string;   
  authorName: string;
  authorEmail: string;
}

export interface DecisionEdge {
  id: string;  
  fromId: string;
  toId: string;
  relationType: RelationType;
  weight: number;
  createdAt: string;
  note?: string;
}

export interface DecisionFilter {
  type?: DecisionType;
  status?: DecisionStatus;
  tags?: string[];
  authorEmail?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export interface GraphStats {
  totalDecisions: number;
  byType: Record<DecisionType, number>;
  byStatus: Record<DecisionStatus, number>;
  totalEdges: number;
  embeddingsReady: number;
}

export interface GraphChangeEvent {
  kind: 'insert' | 'update' | 'delete';
  nodeId: string;
  timestamp: number;
}

export interface ProviderChangeEvent {
  previousProviderId: string | null;
  newProviderId: string;
}

export interface EmbedRequest {
  nodeId: string;
  text: string;
}

export interface EmbedResult {
  nodeId: string;
  embedding: Float32Array;
  error?: string;
}
