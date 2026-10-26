import test from 'node:test';
import assert from 'node:assert';

import { parseSearchResponse } from '../lib/searchresponse';

function page(productIds: unknown) {
  return { body: { child: { analytics: { contexts: [{ data: { search_term: "appels" } }, { data: { product_ids: productIds } }] } } } };
}

test('reads the ids from the props of a named expression in a wrapped page', () => {
  const body = JSON.stringify({
    script: { getFilterProductsExpression2006355095: "(__sp, __cp) => { return __sp.v0; }" },
    layout: page({ type: "EXPRESSION", expression: "getFilterProductsExpression2006355095", props: { v0: ["s1014644", "s1016300"] } })
  });

  assert.deepStrictEqual(parseSearchResponse(body), { productId: "s1014644" });
});

test('reads the ids from the source of an inline expression', () => {
  const body = JSON.stringify(page({ type: "EXPRESSION", expression: 'function() { return ["s1000094","s1000097"] }' }));

  assert.deepStrictEqual(parseSearchResponse(body), { productId: "s1000094" });
});

test('reads a plain list of ids', () => {
  assert.deepStrictEqual(parseSearchResponse(JSON.stringify(page(["s1000097"]))), { productId: "s1000097" });
});

test('reports a search without results instead of throwing', () => {
  const outcome = parseSearchResponse(JSON.stringify(page({ type: "EXPRESSION", expression: "f", props: { v0: [] } })));

  assert.strictEqual(outcome.productId, undefined);
  assert.match(outcome.reason!, /no ids/);
});

test('reports a page of an unknown shape instead of throwing', () => {
  assert.strictEqual(parseSearchResponse(JSON.stringify({ layout: {} })).reason, 'the response has no analytics contexts');
  assert.strictEqual(parseSearchResponse("<html>").reason, 'the response is not json');
});
