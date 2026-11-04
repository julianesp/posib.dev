"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getProducts, getCategories, getUserProfile } from "@/lib/cloudflare-api";
import { reviewFromPosib, type CatalogReview } from "@/lib/catalog-review";
import { CatalogReviewReport } from "@/components/products/catalog-review-report";
import type { Product, Category } from "@/lib/types";

export default function CatalogReviewPage() {
  const { getToken } = useAuth();
  const [review, setReview] = useState<CatalogReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [products, categories, profile] = await Promise.all([
          getProducts(getToken, { force: true }),
          getCategories(getToken),
          getUserProfile(getToken).catch(() => null),
        ]);
        if (cancelled) return;
        setReview(
          reviewFromPosib(
            products as unknown as Product[],
            categories as unknown as Category[],
            profile?.store_name || null,
          ),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar los productos.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/products">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer border-2 border-brand/60 font-semibold text-gray-800 hover:border-brand hover:bg-brand-light"
          >
            <ArrowLeft className="w-4 h-4 mr-1 text-brand" />
            Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Revisar catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Cómo están sus productos: precios, unidades, repetidos y categorías.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!review && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Revisando productos…
        </div>
      )}
      {review && review.total === 0 && (
        <p className="text-muted-foreground">
          Todavía no hay productos. Cuando los agregue o los importe, aquí verá la revisión.
        </p>
      )}
      {review && review.total > 0 && <CatalogReviewReport review={review} />}
    </div>
  );
}
