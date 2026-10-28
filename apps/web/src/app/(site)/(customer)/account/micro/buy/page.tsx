import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, PageHeader, buttonClass } from "@im/ui";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { getProfile } from "@/lib/auth";
import { microProductForBuy } from "@/server/micro";
import { UUID_RE, account } from "../../_lib/data";
import { MicroBuyForm } from "./buy-form";

export const metadata: Metadata = { title: "Buy micro cover" };

export default function MicroBuyPage({ searchParams }: PageProps<"/account/micro/buy">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Buy searchParams={searchParams} />
    </Suspense>
  );
}

async function Buy({ searchParams }: Pick<PageProps<"/account/micro/buy">, "searchParams">) {
  const sp = await searchParams;
  const version = typeof sp.version === "string" && UUID_RE.test(sp.version) ? sp.version : null;
  await account(`/account/micro/buy${version ? `?version=${version}` : ""}`);
  const [product, profile] = await Promise.all([version ? microProductForBuy(version) : Promise.resolve(null), getProfile()]);
  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "Micro cover", href: "/account/micro" }, { label: "Buy" }]} />
      {!product || !product.prices.length ? (
        <Notice tone="wait" title="This cover isn't on sale right now">
          <Link href="/micro" className="font-semibold underline">See the micro products on sale</Link>
        </Notice>
      ) : (
        <>
          <PageHeader title={product.productName} description={`From ${product.insurerName}. Short cover, paid as you go.`} actions={<Link href="/micro" className={buttonClass("ghost", "sm")}>Other products</Link>} />
          {product.keyExclusion && <p className="mb-5 text-sm text-muted">Not covered: {product.keyExclusion}</p>}
          <MicroBuyForm versionId={product.versionId} prices={product.prices} insurer={product.insurerName} defaultPhone={profile?.phone ?? ""} />
        </>
      )}
    </div>
  );
}
