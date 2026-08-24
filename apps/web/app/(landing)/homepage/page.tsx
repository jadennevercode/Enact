import type { Metadata } from "next";
import { EnactLanding } from "@/features/landing/components/enact-landing";

export const metadata: Metadata = {
  title: "Homepage",
  description:
    "Enact — open-source platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills.",
  openGraph: {
    title: "Enact — Governed agentic delivery",
    description:
      "Manage your human + agent workforce in one place.",
    url: "/homepage",
  },
  alternates: {
    canonical: "/homepage",
  },
};

export default function HomepagePage() {
  return <EnactLanding />;
}
