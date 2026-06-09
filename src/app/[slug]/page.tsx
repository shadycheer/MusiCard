import { notFound } from 'next/navigation';
import SongView from '@/components/SongView';
import { parseSlug } from '@/lib/music/slug';

/* Per-song route. Slug shapes:
     /spotify-{22charId}
     /netease-{numericId}
     /apple-{cc}-{numericId}
   parseSlug rebuilds the canonical music URL the existing fetch
   pipeline expects, so the SongView client can drive useTrackInfo
   the same way the old home page did before the route split. */
type RouteParams = { slug: string };

export default async function SlugPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();
  return <SongView canonicalUrl={parsed.canonicalUrl} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: 'MusiCard' };
  return {
    title: `MusiCard · ${slug}`,
  };
}
