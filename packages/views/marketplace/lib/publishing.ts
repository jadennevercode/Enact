/**
 * Whether the UI offers publishing to the Marketplace.
 *
 * The Marketplace is a curated catalog for now: what it lists is published by
 * the deployment, not by the workspaces browsing it. Every publish and manage
 * affordance reads this, so the directory stays a place to install from.
 *
 * This hides the UI only. The server still accepts publishes from a workspace
 * owner or admin, which is how the catalog's own listings get there. Flip this
 * to true to bring the affordances back.
 */
export const MARKETPLACE_PUBLISHING_ENABLED = false;
