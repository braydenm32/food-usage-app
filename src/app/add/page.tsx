import type { Metadata } from "next";
import { Suspense } from "react";
import { AddFlow, AddSkeleton } from "@/components/add/add-flow";

export const metadata: Metadata = {
  title: "Add food",
  description: "Scan a receipt, snap a list, paste an order email, scan barcodes or add food by hand.",
};

export default function AddPage() {
  return (
    <Suspense fallback={<AddSkeleton />}>
      <AddFlow />
    </Suspense>
  );
}
