import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertUnits } from './units.ts';

test('converts common units', () => {
  assert.equal(convertUnits(5, 'miles', 'km'), '5 mi = 8.04672 km');
  assert.equal(convertUnits(100, 'celsius', 'fahrenheit'), '100 °C = 212 °F');
  assert.equal(convertUnits(32, 'F', 'C'), '32 °F = 0 °C');
  assert.equal(convertUnits(2, 'kg', 'lb'), '2 kg = 4.409245 lb');
  assert.equal(convertUnits(90, 'km/h', 'mph'), '90 km/h = 55.92341 mph');
  assert.equal(convertUnits(1.5, 'hours', 'min'), '1.5 h = 90 min');
});

test('refuses nonsense', () => {
  assert.match(convertUnits(1, 'kg', 'km'), /cannot convert/);
  assert.match(convertUnits(1, 'parsec', 'km'), /do not know the unit "parsec"/);
});
