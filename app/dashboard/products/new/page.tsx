"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProductForm } from "@/components/products/product-form";
import { useBusinessType } from "@/hooks/useBusinessType";

function NewProductContent() {
  const searchParams = useSearchParams();
  const supplierId = searchParams.get("supplier_id");
  const barcode = searchParams.get("barcode");
  const bt = useBusinessType();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          {bt.vocabulary.itemSingular} nuevo
        </h1>
        <p className="text-gray-500">
          Agrega {bt.vocabulary.itemSingular === "Producto" ? "un nuevo producto" : `un nuevo ${bt.vocabulary.itemSingular.toLowerCase()}`} al inventario
        </p>
      </div>

      <ProductForm
        initialData={
          supplierId || barcode
            ? {
                ...(supplierId ? { supplier_id: supplierId } : {}),
                ...(barcode ? { barcode } : {}),
              }
            : undefined
        }
      />
    </div>
  );
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <NewProductContent />
    </Suspense>
  );
}
