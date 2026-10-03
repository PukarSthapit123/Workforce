import { downloadText, toCsv } from './download';

test('a CSV quotes a cell holding a comma, a quote or a line break, and doubles its quotes', () => {
  expect(toCsv([['Row', 'Field', 'Reason'], [31, 'Location', 'Unknown location code "WH-2", not in master data']]))
    .toBe('Row,Field,Reason\r\n31,Location,"Unknown location code ""WH-2"", not in master data"');
  expect(toCsv([['a\nb']])).toBe('"a\nb"');
});

test('a download is refused, and says so, when the browser cannot build a file', () => {
  const was = URL.createObjectURL;
  Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true, writable: true });
  try {
    expect(downloadText('x.csv', 'a')).toBe(false);
  } finally {
    Object.defineProperty(URL, 'createObjectURL', { value: was, configurable: true, writable: true });
  }
});
