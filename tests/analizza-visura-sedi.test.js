import assert from 'node:assert/strict';
import test from 'node:test';

const {
  isPlausibleAddress,
  parseSedi,
} = await import('../api/analizza-visura.js');

test('non considera una descrizione di attività come sede', () => {
  const activity = 'COMMERCIO ALL’INGROSSO SENZA DEPOSITO DI CONFETTURE E ALTRI PRODOTTI ALIMENTARI';
  assert.equal(isPlausibleAddress(activity), false);

  const result = parseSedi(`Sede legale: ${activity}`);
  assert.deepEqual(result.sedi, []);
});

test('mantiene una sede con via, CAP e comune', () => {
  const address = 'VIA DEL COMMERCIO 12, 00155 ROMA (RM)';
  assert.equal(isPlausibleAddress(address), true);

  const result = parseSedi(`Sede legale: ${address}`);
  assert.deepEqual(result.sedi, [{
    indirizzo: address,
    data_inizio: null,
    tipo: 'sede_legale',
  }]);
});

test('mantiene una variazione sede con comune e provincia', () => {
  const address = '64010 COLONNELLA (TE)';
  const result = parseSedi(`Variazione sede legale: ${address}`);
  assert.deepEqual(result.sedi, [{
    indirizzo: address,
    data_inizio: null,
    tipo: 'variazione',
  }]);
});
