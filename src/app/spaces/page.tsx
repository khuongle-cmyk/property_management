import { Cms2SpacesList } from "@/components/cms2/Cms2SpacesList";
import { prepareCmsPublicView } from "@/lib/cms2/cms-public-view";
import { getRootMarketingOrgCached } from "@/lib/cms2/get-public-org";
import { buildCmsMarketingLanguageAlternates } from "@/lib/cms2/marketing-alternates";
export async function generateMetadata() {
  const org = await getRootMarketingOrgCached();
  return {
    title: `Spaces · ${org.brandName}`,
    alternates: {
      languages: buildCmsMarketingLanguageAlternates("/spaces"),
    },
  };
}

export default async function RootSpacesPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const sp = await searchParams;
  const raw = await getRootMarketingOrgCached();
  const { locale, ui, org } = prepareCmsPublicView(raw, sp.lang);
  return <Cms2SpacesList org={org} basePath="" locale={locale} ui={ui} publicBrowse />;
}
