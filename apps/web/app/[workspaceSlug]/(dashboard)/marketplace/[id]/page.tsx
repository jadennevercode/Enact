"use client";

import { use } from "react";
import { MarketplaceListingPage } from "@enact/views/marketplace";

export default function MarketplaceListingRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <MarketplaceListingPage listingId={id} />;
}
