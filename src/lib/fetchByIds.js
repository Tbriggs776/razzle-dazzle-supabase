import { base44 } from '@/api/base44Client';

/**
 * Fetch exactly the records a screen needs, by id.
 *
 * THE PROBLEM THIS REPLACES. Several pages resolved a name by downloading the
 * whole table and searching it in the browser:
 *
 *     const { data: leads } = useQuery({ queryFn: () => Lead.list() });
 *     const lead = leads.find(l => l.id === appointment.customer);
 *
 * That was cheap when `lead` held 2,101 rows. It now holds 17,458, and the data
 * client pages an unbounded list 1,000 rows at a time -- so a page showing
 * twenty appointments downloaded 4.8 MB over 18 sequential round trips to put
 * twenty names on the screen. Growth in one table silently slowed pages that
 * have nothing to do with it.
 *
 * WHY CHUNKED. The ids go into a PostgREST `in.(...)` filter, which lands in the
 * URL, and URLs have length limits -- a few hundred ids is enough to produce a
 * request the server rejects. 25 keeps each URL comfortably short, and the
 * chunks are issued together rather than in sequence, so the cost is one round
 * trip's latency rather than N.
 *
 * An explicit limit is passed on every chunk because the data client's default
 * is "keep paging until 50,000 rows", which is the behaviour being fixed here.
 *
 * @param {string} entityName  key in the entity map, e.g. 'Lead'
 * @param {Array<string>} ids  may contain nulls and duplicates; both are handled
 * @returns {Promise<Array>}   records, in no guaranteed order
 */
export async function fetchByIds(entityName, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return [];

  const entity = base44.entities[entityName];
  if (!entity) throw new Error(`fetchByIds: no entity named "${entityName}"`);

  const CHUNK = 25;
  const chunks = [];
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));

  const results = await Promise.all(
    chunks.map((chunk) =>
      entity
        .filter({ id: { $in: chunk } }, '-created_date', chunk.length)
        // One failed chunk should not blank the whole screen: the page renders
        // with the names it did get rather than showing nothing at all.
        .catch(() => []),
    ),
  );
  return results.flat();
}

/**
 * The same, returned as an id -> record map, which is what callers almost always
 * build next. Saves every page writing its own reduce, and makes the lookup a
 * hash rather than the `.find()` scan these pages used to do per row.
 */
export async function fetchMapByIds(entityName, ids) {
  const rows = await fetchByIds(entityName, ids);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}
