import { Cms2Home } from "@/components/cms2/Cms2Home";
import { prepareCmsPublicView } from "@/lib/cms2/cms-public-view";
import { getOrgPublicSiteCached } from "@/lib/cms2/get-public-org";
import { buildCmsMarketingLanguageAlternates } from "@/lib/cms2/marketing-alternates";
import { buildLocalBusinessJsonLd } from "@/lib/cms2/seo";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await getOrgPublicSiteCached(orgSlug);
  if (!org) return { title: "Not found" };
  return {
    title: org.brandName,
    description: org.settings.seoDescription ?? `${org.brandName} — workspaces and meeting rooms.`,
    alternates: {
      languages: buildCmsMarketingLanguageAlternates(`/${orgSlug}`),
    },
  };
}

export default async function OrgHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const raw = await getOrgPublicSiteCached(orgSlug);
  if (!raw) notFound();
  const { locale, ui, org } = prepareCmsPublicView(raw, sp.lang);
  const jsonLd = buildLocalBusinessJsonLd(org, `/${orgSlug}`);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Cms2Home org={org} basePath={`/${orgSlug}`} locale={locale} ui={ui} publicBrowse />
    </>
  );
}
