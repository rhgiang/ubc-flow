import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

/**
 * Every course and professor page, plus the handful of static routes.
 *
 * ~15,700 URLs total, well inside the 50,000-per-sitemap limit, so this is one
 * flat file rather than a generateSitemaps index. The route is a special
 * handler Next caches by default, so the two queries do not run per crawl.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [courses, instructors] = await Promise.all([
    db.course.findMany({
      where: { campus: 'V', subject: { code: { not: null } } },
      select: { number: true, subject: { select: { code: true } } },
    }),
    db.instructor.findMany({
      where: { campus: 'V' },
      select: { slug: true },
    }),
  ]);

  const staticPages: MetadataRoute.Sitemap = ['', '/explore', '/guidance', '/about'].map(
    (path) => ({ url: `${SITE_URL}${path}`, changeFrequency: 'weekly' }),
  );

  const coursePages: MetadataRoute.Sitemap = courses.map((c) => ({
    url: `${SITE_URL}/course/${c.subject.code!.toLowerCase()}-${c.number.toLowerCase()}`,
    changeFrequency: 'weekly',
  }));

  const professorPages: MetadataRoute.Sitemap = instructors.map((i) => ({
    url: `${SITE_URL}/professor/${i.slug}`,
    changeFrequency: 'weekly',
  }));

  return [...staticPages, ...coursePages, ...professorPages];
}
