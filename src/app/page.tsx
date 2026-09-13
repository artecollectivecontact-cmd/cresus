import { DashboardClient } from "@/components/DashboardClient";
import { authEnabled } from "@/lib/auth";

// Coquille instantanée : le chargement des données se fait côté client, avec
// l'écran de progression, puis la navigation par période est instantanée.
export const dynamic = "force-dynamic";

export default function Home() {
  return <DashboardClient authEnabled={authEnabled()} />;
}
