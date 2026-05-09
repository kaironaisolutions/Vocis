import { parseTranscription, mergeItems, ParsedItem } from '../services/voiceParser';

// One-off trace of the user's reported scenario.
// Logs each step so the manual verification in the report has real data behind it.
test('manual trace: Nike hoodie → small → nineties → twenty five dollars', () => {
  const empty: ParsedItem = {
    size: '?',
    decade: '?',
    item_name: 'Unknown Item',
    price: 0,
    raw_title: '(?) ? Unknown Item',
    raw_transcript: '',
    confidence: { size: false, decade: false, price: false, item_name: false },
    confidence_score: 0,
  };

  const summarize = (label: string, item: ParsedItem) => {
    console.log(
      label,
      JSON.stringify(
        {
          size: item.size,
          decade: item.decade,
          item_name: item.item_name,
          price: item.price,
          confidence_score: item.confidence_score,
        },
        null,
        0
      )
    );
  };

  let item = empty;
  item = mergeItems(item, parseTranscription('Nike hoodie'));
  summarize('after "Nike hoodie":', item);
  expect(item.item_name.toLowerCase()).toContain('nike');
  expect(item.size).toBe('?');

  item = mergeItems(item, parseTranscription('small'));
  summarize('after "small":      ', item);
  expect(item.size).toBe('S');
  expect(item.item_name.toLowerCase()).toContain('nike'); // preserved!

  item = mergeItems(item, parseTranscription('nineties'));
  summarize('after "nineties":   ', item);
  expect(item.decade).toBe("90's");
  expect(item.size).toBe('S');
  expect(item.item_name.toLowerCase()).toContain('nike');

  item = mergeItems(item, parseTranscription('twenty five dollars'));
  summarize('after "twenty five":', item);
  expect(item.price).toBe(25);
  expect(item.decade).toBe("90's");
  expect(item.size).toBe('S');
  expect(item.item_name.toLowerCase()).toContain('nike');
  expect(item.confidence_score).toBe(100);
});
