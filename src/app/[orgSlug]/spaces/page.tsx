import { Cms2SpacesList } from "@/components/cms2/Cms2SpacesList";
import { prepareCmsPublicView } from "@/lib/cms2/cms-public-view";
import { getOrgPublicSiteCached } from "@/lib/cms2/get-public-org";
import { buildCmsMarketingLanguageAlternates } from "@/lib/cms2/marketing-alternates";
import { notFound } from "next/navigation";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await getOrgPublicSiteCached(orgSlug);
  if (!org) return { title: "Not found" };
  return {
    title: `Spaces · ${org.brandName}`,
    alternates: {
      languages: buildCmsMarketingLanguageAlternates(`/${orgSlug}/spaces`),
    },
  };
}

export default async function OrgSpacesPage({
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
  return <Cms2SpacesList org={org} basePath={`/${orgSlug}`} locale={locale} ui={ui} publicBrowse />;
}
