// Unit conversion done in code: small models get these wrong when they do the arithmetic themselves.

interface Unit {
  kind: string;
  /** how many base units one of these is (temperature is handled separately) */
  f: number;
  label: string;
}

const U: Record<string, Unit> = {};
function def(kind: string, label: string, f: number, ...names: string[]) {
  for (const n of [label, ...names]) U[n.toLowerCase()] = { kind, f, label };
}

def('length', 'm', 1, 'meter', 'meters', 'metre', 'metres');
def('length', 'km', 1000, 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms');
def('length', 'cm', 0.01, 'centimeter', 'centimeters', 'centimetre', 'centimetres');
def('length', 'mm', 0.001, 'millimeter', 'millimeters', 'millimetre', 'millimetres');
def('length', 'mi', 1609.344, 'mile', 'miles');
def('length', 'ft', 0.3048, 'foot', 'feet');
def('length', 'in', 0.0254, 'inch', 'inches');
def('length', 'yd', 0.9144, 'yard', 'yards');
def('mass', 'kg', 1, 'kilogram', 'kilograms', 'kilo', 'kilos');
def('mass', 'g', 0.001, 'gram', 'grams');
def('mass', 'mg', 0.000001, 'milligram', 'milligrams');
def('mass', 'lb', 0.45359237, 'lbs', 'pound', 'pounds');
def('mass', 'oz', 0.028349523125, 'ounce', 'ounces');
def('volume', 'l', 1, 'liter', 'liters', 'litre', 'litres');
def('volume', 'ml', 0.001, 'milliliter', 'milliliters', 'millilitre', 'millilitres');
def('volume', 'gal', 3.785411784, 'gallon', 'gallons');
def('volume', 'cup', 0.2365882365, 'cups');
def('volume', 'tbsp', 0.01478676478, 'tablespoon', 'tablespoons');
def('volume', 'tsp', 0.00492892159, 'teaspoon', 'teaspoons');
def('speed', 'm/s', 1, 'mps');
def('speed', 'km/h', 1 / 3.6, 'kmh', 'kph', 'kmph');
def('speed', 'mph', 0.44704, 'mi/h');
def('speed', 'knot', 0.514444, 'knots', 'kn');
def('time', 's', 1, 'sec', 'secs', 'second', 'seconds');
def('time', 'min', 60, 'mins', 'minute', 'minutes');
def('time', 'h', 3600, 'hr', 'hrs', 'hour', 'hours');
def('time', 'day', 86400, 'days');
def('time', 'week', 604800, 'weeks');
def('data', 'B', 1, 'byte', 'bytes');
def('data', 'KB', 1000, 'kilobyte', 'kilobytes');
def('data', 'MB', 1e6, 'megabyte', 'megabytes');
def('data', 'GB', 1e9, 'gigabyte', 'gigabytes');
def('data', 'TB', 1e12, 'terabyte', 'terabytes');
def('temp', '°C', 1, 'c', 'celsius', 'centigrade', '°c');
def('temp', '°F', 1, 'f', 'fahrenheit', '°f');
def('temp', 'K', 1, 'k', 'kelvin');

const find = (name: string): Unit | undefined => U[String(name).trim().toLowerCase().replace(/\.$/, '')];

function toC(v: number, u: string): number {
  return u === '°F' ? ((v - 32) * 5) / 9 : u === 'K' ? v - 273.15 : v;
}
function fromC(v: number, u: string): number {
  return u === '°F' ? (v * 9) / 5 + 32 : u === 'K' ? v + 273.15 : v;
}

const fmt = (n: number) => String(parseFloat(n.toPrecision(7)));

export function convertUnits(value: number, from: string, to: string): string {
  const a = find(from);
  const b = find(to);
  if (!a) return `Error: I do not know the unit "${from}".`;
  if (!b) return `Error: I do not know the unit "${to}".`;
  if (a.kind !== b.kind) return `Error: cannot convert ${a.label} (${a.kind}) to ${b.label} (${b.kind}).`;
  const out = a.kind === 'temp' ? fromC(toC(value, a.label), b.label) : (value * a.f) / b.f;
  return `${fmt(value)} ${a.label} = ${fmt(out)} ${b.label}`;
}
