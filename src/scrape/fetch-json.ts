import { fetchText } from '@/scrape/http';
import type { JsonApiResource } from '@/scrape/parse-nodes';

const BASE = 'https://courses.students.ubc.ca/jsonapi/node/section';

type JsonApiPage = {
  data: JsonApiResource[];
  included?: JsonApiResource[];
  links?: { next?: { href: string } };
  meta?: { count?: number };
};

export function sectionsUrl(ubcPeriodId: string, limit = 50): string {
  const p = new URLSearchParams({
    'filter[field_academic_term.meta.drupal_internal__target_id]': ubcPeriodId,
    'filter[field_is_visible]': '1',
    include:
      'field_course.field_subject,field_status,field_instructional_method,field_delivery_mode',
    'page[limit]': String(limit),
  });
  return `${BASE}?${p.toString()}`;
}

/** Walks every page of one term, yielding each page's data + included together. */
export async function* sectionPages(
  ubcPeriodId: string,
): AsyncGenerator<{ data: JsonApiResource[]; included: JsonApiResource[] }> {
  let url: string | undefined = sectionsUrl(ubcPeriodId);
  while (url) {
    const page = JSON.parse(await fetchText(url)) as JsonApiPage;
    yield { data: page.data ?? [], included: page.included ?? [] };
    url = page.links?.next?.href;
  }
}
