import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MarketplaceListingPage as SharedMarketplaceListingPage } from "@enact/views/marketplace";
import { useWorkspaceId } from "@enact/core/hooks";
import { marketplaceListingOptions } from "@enact/core/marketplace";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function MarketplaceListingPage() {
  const { id } = useParams<{ id: string }>();
  const wsId = useWorkspaceId();
  const { data: listing } = useQuery(marketplaceListingOptions(wsId, id ?? ""));

  useDocumentTitle(listing?.name ?? "Marketplace");

  if (!id) return null;
  return <SharedMarketplaceListingPage listingId={id} />;
}
