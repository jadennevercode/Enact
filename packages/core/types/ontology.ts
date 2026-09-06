export interface OntologyCatalogItem {
  name: string;
  nameZh: string | null;
  description: string | null;
  descriptionZh: string | null;
}

export interface OntologySummary {
  name: string;
  nameZh: string | null;
  version: string;
  description: string;
  descriptionZh: string | null;
  entityCount: number;
  actionCount: number;
  policyCount: number;
  capabilityCount: number;
  isLayered: boolean;
  capHubUrl: string;
  /**
   * Whether this workspace already holds a skill projected from this domain.
   * The ontology's equivalent of a listing's `installed`, so the Marketplace
   * can badge every tab the same way.
   */
  attached: boolean;
}

export interface OntologyDetail extends OntologySummary {
  entities: OntologyCatalogItem[];
  actions: OntologyCatalogItem[];
  policies: OntologyCatalogItem[];
  capabilities: OntologyCatalogItem[];
  preview: string;
}
