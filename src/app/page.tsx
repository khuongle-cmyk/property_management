import { Cms2Home } from "@/components/cms2/Cms2Home";
import { prepareCmsPublicView } from "@/lib/cms2/cms-public-view";
import { getRootMarketingOrgCached } from "@/lib/cms2/get-public-org";
import { buildCmsMarketingLanguageAlternates } from "@/lib/cms2/marketing-alternates";
import { buildLocalBusinessJsonLd } from "@/lib/cms2/seo";
export async function generateMetadata() {
  const org = await getRootMarketingOrgCached();
  return {
    title: org.brandName,
    description: org.settings.seoDescription ?? `${org.brandName} — workspaces and meeting rooms.`,
    alternates: {
      languages: buildCmsMarketingLanguageAlternates("/"),
    },
  };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const sp = await searchParams;
  const raw = await getRootMarketingOrgCached();
  const { locale, ui, org } = prepareCmsPublicView(raw, sp.lang);
  const jsonLd = buildLocalBusinessJsonLd(org, "/");

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Cms2Home org={org} basePath="" locale={locale} ui={ui} publicBrowse />
    </>
  );
}
