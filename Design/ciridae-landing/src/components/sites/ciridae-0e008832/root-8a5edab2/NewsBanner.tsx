/**
 * NewsBanner — top fixed announcement strip linking to Crucible early access.
 *
 * Pure markup: the shimmer sweep layers and their keyframes (dn1/dn2/ds1/ds2)
 * live in the ported global CSS (ciridae-base.css / ciridae-utilities.css),
 * including the prefers-reduced-motion fallback. Markup copied verbatim from
 * docs/research/ciridae-0e008832/root-8a5edab2/extract/00-news-banner.html.
 */
export function NewsBanner() {
  return (
    <a
      rel="noopener noreferrer"
      href="https://ciridae.typeform.com/early-access"
      target="_blank"
      className="draft-news-banner-v2 w-inline-block"
    >
      <div aria-hidden="true" className="draft-banner-sweep-wrap">
        <div className="draft-banner-sweep draft-banner-sweep-a" />
        <div className="draft-banner-sweep draft-banner-sweep-b" />
      </div>
      <div aria-hidden="true" className="draft-banner-sweep-wrap">
        <div className="draft-banner-sweep draft-banner-sweep-a" />
        <div className="draft-banner-sweep draft-banner-sweep-b" />
      </div>
      <div className="draft-news-banner-inner-v2">
        <div className="draft-news-banner-label-v2">News</div>
        <div className="draft-news-banner-dot-v2" />
        <div className="draft-news-banner-label-v2">Jun 15, 2026</div>
        <div className="draft-news-banner-dot-v2" />
        <div className="draft-news-banner-label-v2">Crucible early access is now open</div>
      </div>
    </a>
  );
}
