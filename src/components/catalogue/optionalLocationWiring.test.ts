import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalogue = readFileSync(new URL('./CataloguePage.tsx', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../forms/OptionalLocationPicker.tsx', import.meta.url), 'utf8');

function componentSource(name: string, nextName: string): string {
  const start = catalogue.indexOf(`function ${name}(`);
  const end = catalogue.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} component exists`);
  assert.notEqual(end, -1, `${nextName} component boundary exists`);
  return catalogue.slice(start, end);
}

test('Cashfree Production checkout renders the optional location picker and submits its value', () => {
  const cashfreeCheckout = componentSource('CashfreeCheckoutDialog', 'CompareDialog');
  assert.match(cashfreeCheckout, /<OptionalLocationPicker value=\{location\} onChange=\{setLocation\} \/>/);
  assert.match(cashfreeCheckout, /location,\s*packages:/);
});

test('Service Cart enquiry renders the optional location picker and submits its value', () => {
  const cart = componentSource('CartDialog', 'CheckoutDialog');
  assert.match(cart, /const \[location, setLocation\] = useState<CustomerLocation>\(\)/);
  assert.match(cart, /<OptionalLocationPicker value=\{location\} onChange=\{setLocation\} \/>/);
  assert.match(cart, /customerBusinessName,\s*location,[\s\S]*requestNote: note,/);
});

test('location picker gives explicit optional sharing and removal controls', () => {
  assert.match(picker, /Share My Location/);
  assert.match(picker, /location is optional/i);
  assert.match(picker, /onClick=\{requestLocation\}/);
  assert.match(picker, /onChange\(undefined\)/);
});
