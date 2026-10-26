import type { PicnicJson } from './picnicjson';

// What a search came to: the id of the first product found, and otherwise why
// there is none.
export interface SearchOutcome {
  productId?: string;
  reason?: string;
}

// The id of the first product in Picnic's answer to a search.
//
// Picnic answers with a page, and the ids of the products on it are in the
// analytics context that carries `product_ids`. Three shapes have been seen:
//
// - a plain list of ids
// - an EXPRESSION whose `expression` is the source of a function ending in
//   `return ["s1", "s2", ...]`
// - since October 2026, the page wrapped as `{ script, layout }` and an
//   EXPRESSION whose `expression` only names a function in `script`, with the
//   ids in `props.v0`. Without a filter chosen that function returns `v0`
//   as it is, so `v0` is the list of results in the order Picnic shows them.
//
// Like the cart parser this never throws: it runs inside a response handler.
export function parseSearchResponse(body: string): SearchOutcome {
  var parsed: PicnicJson;

  try {
    parsed = JSON.parse(body);
  } catch (exception) {
    return { reason: 'the response is not json' };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { reason: 'the response is not an object' };
  }

  const page = parsed['layout'] ?? parsed;
  const contexts = page?.['body']?.['child']?.['analytics']?.['contexts'];

  if (!Array.isArray(contexts)) {
    return { reason: 'the response has no analytics contexts' };
  }

  const context = contexts.find((c: PicnicJson) => c && c['data'] && c['data']['product_ids']);

  if (context === undefined) {
    return { reason: 'no analytics context lists product ids' };
  }

  const productId = firstId(context['data']['product_ids']);

  if (productId === undefined) {
    return { reason: 'product_ids holds no ids: ' + JSON.stringify(context['data']['product_ids']).slice(0, 160) };
  }

  return { productId };
}

function firstId(productIds: PicnicJson): string | undefined {
  if (Array.isArray(productIds)) return asId(productIds[0]);

  if (productIds['type'] !== 'EXPRESSION') return undefined;

  const v0 = productIds['props']?.['v0'];

  if (Array.isArray(v0)) return asId(v0[0]);

  if (typeof productIds['expression'] == 'string') {
    const match = productIds['expression'].match(/return (\["[^"]*"(?:,"[^"]*")*\])/);

    if (match) {
      try {
        return asId(JSON.parse(match[1])[0]);
      } catch (exception) {
        return undefined;
      }
    }
  }

  return undefined;
}

function asId(value: unknown): string | undefined {
  return typeof value == 'string' && value !== '' ? value : undefined;
}
